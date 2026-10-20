import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

// Guard for #286: Cursor and Grok support was removed on purpose.
// These checks fail if any of it comes back.

const repoRoot = resolve(import.meta.dirname, "..", "..");
const REMOVED_NAME = /cursor|grok|xai/i;
const CURSOR_PATH = /(^|[\s"'`(/~])\.cursor(\/|\b)/;

interface RawAgent {
  name?: unknown;
  [key: string]: unknown;
}

function readText(path: string): string {
  return readFileSync(join(repoRoot, path), "utf-8");
}

function coreAgents(): RawAgent[] {
  return yaml.load(readText("src/core/agents.yaml")) as RawAgent[];
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringValues);
  return [];
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  }
  return out;
}

/** Drop comment lines so notes about other tools do not trip the code check. */
function codeLines(text: string): string[] {
  return text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*|#)/.test(line));
}

describe("removed agents stay removed (#286)", () => {
  it("has no Cursor, Grok, or xAI agent entry in agents.yaml", () => {
    const names = coreAgents().map((agent) => String(agent.name));
    expect(names.filter((name) => REMOVED_NAME.test(name))).toEqual([]);
  });

  it("has no agents.yaml path under ~/.cursor", () => {
    const paths = coreAgents().flatMap((agent) => stringValues(agent));
    expect(paths.filter((path) => CURSOR_PATH.test(path))).toEqual([]);
  });

  it("has no cursor hooks format or command transform", () => {
    for (const agent of coreAgents()) {
      expect(agent.hooksFormat, String(agent.name)).not.toBe("cursor");
      expect(agent.commandTransform, String(agent.name)).not.toBe("cursor");
    }
  });

  it("targets no removed agent in the hook manifest", () => {
    const manifest = yaml.load(readText("hooks/manifest.yaml")) as { hooks?: Array<{ agents?: string[] }> };
    const targets = (manifest.hooks ?? []).flatMap((hook) => hook.agents ?? []);
    expect(targets.filter((name) => REMOVED_NAME.test(name))).toEqual([]);
  });

  it("does not back up or write ~/.cursor in the installer", () => {
    const install = codeLines(readText("scripts/install.sh"));
    expect(install.filter((line) => CURSOR_PATH.test(line))).toEqual([]);
  });

  it("has no ~/.cursor write path in non-test source code", () => {
    const offenders: string[] = [];
    for (const file of listFiles("src")) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file.includes("test-utils")) continue;
      for (const line of codeLines(readText(file))) {
        if (CURSOR_PATH.test(line)) offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has no Cursor-only script, launcher, or LaunchAgent", () => {
    const files = [...listFiles("scripts"), ...listFiles("hooks"), ...listFiles("src")];
    expect(files.filter((file) => /cursor/i.test(file))).toEqual([]);
    const launchAgents = files.filter((file) => file.endsWith(".plist") || /launchagent/i.test(file));
    for (const file of launchAgents) {
      const code = codeLines(readText(file)).join("\n");
      expect(code, file).not.toMatch(/cursor/i);
    }
  });
});
