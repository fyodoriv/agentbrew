// A catalog-pinned MCP server with an outdated version in an agent that
// agentbrew does not manage (not detected) is never rewritten, but status
// must name it with the exact edit. Shape copied from a real VS Code
// settings.json: a top-level `mcpServers` object next to other settings.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../types.js";
import { formatUnmanagedPinLines, outdatedPinsInUnmanagedAgents } from "./catalog-pin-sweep.js";

function writeVscodeSettings(): string {
  // Safety: the scratch HOME from vitest.isolated-home.ts, never the real one.
  expect(homedir()).not.toBe(userInfo().homedir);
  const path = join(homedir(), "Library", "Application Support", "Code", "User", "settings.json");
  mkdirSync(dirname(path), { recursive: true });
  const settings = {
    "editor.tabSize": 2,
    "http.proxyStrictSSL": false,
    mcpServers: {
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp@latest"] },
      "tasks-mcp": { command: "npx", args: ["-y", "tasks-mcp@0.5.0"] },
    },
  };
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return path;
}

const copilotNotDetected = [{ name: "copilot", detected: false }] as unknown as AgentConfig[];

describe.runIf(process.platform === "darwin")("outdated pins in agents agentbrew does not manage", () => {
  it("finds the old exact pin with its current and catalog versions, and leaves the file alone", () => {
    const path = writeVscodeSettings();
    const before = readFileSync(path, "utf-8");

    const results = outdatedPinsInUnmanagedAgents(copilotNotDetected);

    expect(results).toEqual([
      {
        path,
        agentName: "copilot",
        fixedCount: 0,
        findings: [
          { path: "mcpServers.tasks-mcp", from: "tasks-mcp@0.5.0", to: expect.stringMatching(/^tasks-mcp@\d/) },
        ],
      },
    ]);
    expect(readFileSync(path, "utf-8")).toBe(before);
  });

  it("prints an edit that works: it changes only the pin and keeps valid JSON", () => {
    const path = writeVscodeSettings();
    const [line = ""] = formatUnmanagedPinLines(outdatedPinsInUnmanagedAgents(copilotNotDetected));
    const copy = join(mkdtempSync(join(tmpdir(), "pin-edit-")), "settings.json");
    copyFileSync(path, copy);
    const edit = line.slice(line.indexOf("perl ")).replace(path, copy);
    execFileSync("sh", ["-c", edit]);
    const after = JSON.parse(readFileSync(copy, "utf-8"));
    expect(after.mcpServers["tasks-mcp"].args[1]).toMatch(/^tasks-mcp@\d/);
    expect(after.mcpServers["tasks-mcp"].args[1]).not.toBe("tasks-mcp@0.5.0");
    expect(after.mcpServers.context7.args[1]).toBe("@upstash/context7-mcp@latest");
    expect(after["editor.tabSize"]).toBe(2);
  });

  it("does not report an agent missing from state, which the next sync may manage", () => {
    writeVscodeSettings();
    expect(outdatedPinsInUnmanagedAgents([])).toEqual([]);
  });

  it("skips agents that agentbrew manages, since sync already repairs them", () => {
    writeVscodeSettings();
    const detected = [{ name: "copilot", detected: true }] as unknown as AgentConfig[];
    expect(outdatedPinsInUnmanagedAgents(detected)).toEqual([]);
  });

  it("formats a status line with the exact one-line edit", () => {
    const path = writeVscodeSettings();
    const [line] = formatUnmanagedPinLines(outdatedPinsInUnmanagedAgents(copilotNotDetected));
    expect(line).toContain("tasks-mcp@0.5.0");
    expect(line).toContain("copilot");
    expect(line).toContain(`perl -pi -e 's{"tasks\\-mcp\\@0\\.5\\.0"}{"tasks-mcp\\@`);
    expect(line).toContain(path);
  });

  it("prints a working edit for a scoped package name", () => {
    const file = join(mkdtempSync(join(tmpdir(), "pin-scoped-")), "it's settings.json");
    writeFileSync(
      file,
      `${JSON.stringify({ mcpServers: { x: { command: "npx", args: ["-y", "@acme/x-mcp@1.0.0"] } } }, null, 2)}\n`,
    );
    const [line = ""] = formatUnmanagedPinLines([
      {
        path: file,
        agentName: "copilot",
        fixedCount: 0,
        findings: [{ path: "mcpServers.x", from: "@acme/x-mcp@1.0.0", to: "@acme/x-mcp@2.0.0+build.1" }],
      },
    ]);
    execFileSync("sh", ["-c", line.slice(line.indexOf("perl "))]);
    expect(JSON.parse(readFileSync(file, "utf-8")).mcpServers.x.args[1]).toBe("@acme/x-mcp@2.0.0+build.1");
  });
});
