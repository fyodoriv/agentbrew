/** Core leak audit and telemetry redaction: step 10 of #208. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { home, previousHome } = vi.hoisted(() => {
  const { mkdtempSync: mk } = require("node:fs") as typeof import("node:fs");
  const { tmpdir: td } = require("node:os") as typeof import("node:os");
  const { join: j } = require("node:path") as typeof import("node:path");
  const previous = process.env.HOME;
  const dir = mk(j(td(), "leak-audit-home-"));
  process.env.HOME = dir;
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  delete process.env.XDG_STATE_HOME;
  return { home: dir, previousHome: previous };
});

import { fixtureGit, fixtureKey, pluginFixture } from "../test-utils/plugin-fixture.js";
import {
  auditRepo,
  LeakPatternError,
  loadLeakPatterns,
  pruneOldMetrics,
  redactPatternsPath,
  writeRedactPatterns,
} from "./leak-audit.js";
import { addPlugin, pluginDir } from "./store.js";

const KEY = fixtureKey();

function install(patterns: unknown, name = "acme"): void {
  const f = pluginFixture({
    schema: 1,
    name,
    version: "1.0.0",
    contributes: { leak_patterns: "leak-patterns.yaml" },
  });
  f.release("v1", { "leak-patterns.yaml": yaml.dump(patterns) });
  addPlugin(`${f.dir}@v1`, { yes: true, signer: KEY.pub });
}

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "audit-repo-"));
  fixtureGit(dir, "init", "-q");
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(dir, rel), body);
  fixtureGit(dir, "add", ".");
  return dir;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  for (const d of [".config", ".local"]) rmSync(join(home, d), { recursive: true, force: true });
});

afterAll(() => {
  process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("leak audit", () => {
  it("finds tracked lines that match a plugin pattern, by file and line, without echoing the match", () => {
    install({ patterns: ["acme-internal", "corp\\.acme\\.example"] });
    const repo = repoWith({ "a.md": "ok\nsee corp.acme.example/wiki\n", "b.txt": "clean" });

    const findings = auditRepo(repo);

    expect(findings).toEqual([{ file: "a.md", line: 2, plugin: "acme" }]);
  });

  it("is clean with no plugins installed", () => {
    expect(auditRepo(repoWith({ "a.md": "acme-internal" }))).toEqual([]);
  });

  it("only scans tracked files", () => {
    install({ patterns: ["acme-internal"] });
    const repo = repoWith({ "a.md": "fine" });
    writeFileSync(join(repo, "untracked.md"), "acme-internal");
    expect(auditRepo(repo)).toEqual([]);
  });

  it("fails closed when an installed plugin's patterns cannot be read", () => {
    install({ patterns: ["acme-internal"] });
    rmSync(join(pluginDir("acme"), "leak-patterns.yaml"));
    expect(() => loadLeakPatterns()).toThrow(LeakPatternError);
  });

  it("fails closed on an invalid regex", () => {
    install({ patterns: ["(unclosed"] });
    expect(() => loadLeakPatterns()).toThrow(/invalid leak pattern/i);
  });

  it("accepts a plain list as well as { patterns: [...] }", () => {
    install(["acme-internal"]);
    expect(loadLeakPatterns().map((p) => p.source)).toEqual(["acme-internal"]);
  });
});

describe("telemetry redaction", () => {
  const HOOK = join(import.meta.dirname, "..", "..", "hooks", "checks", "perf-record.sh");

  function runHook(state: string, cwd: string): string {
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      session_id: "s1",
      cwd,
      tool_name: "Read",
      tool_input: { file_path: "x" },
      duration_ms: 3,
    });
    execFileSync("/bin/bash", [HOOK], { input: payload, env: { ...process.env, XDG_STATE_HOME: state } });
    const dir = join(state, "agentbrew", "perf");
    const file = execFileSync("ls", [dir], { encoding: "utf-8" }).trim().split("\n")[0] as string;
    return readFileSync(join(dir, file), "utf-8").trim().split("\n").pop() as string;
  }

  it("sync writes the redact list, and the perf hook logs a matching project as redacted", () => {
    install({ patterns: ["acme-secret-[a-z]+"] });
    const state = join(home, ".local", "state");
    writeRedactPatterns(state);
    expect(readFileSync(redactPatternsPath(state), "utf-8")).toBe("acme-secret-[a-z]+\n");

    const secretRepo = join(mkdtempSync(join(tmpdir(), "p-")), "acme-secret-project");
    execFileSync("mkdir", ["-p", join(secretRepo, ".git")]);
    expect(JSON.parse(runHook(state, secretRepo)).project).toBe("redacted");

    const plainRepo = join(mkdtempSync(join(tmpdir(), "p-")), "public-thing");
    execFileSync("mkdir", ["-p", join(plainRepo, ".git")]);
    expect(JSON.parse(runHook(state, plainRepo)).project).toBe("public-thing");
  });

  it("removes the redact list when no plugin has patterns", () => {
    const state = join(home, ".local", "state");
    writeRedactPatterns(state);
    expect(existsSync(redactPatternsPath(state))).toBe(false);
  });

  it("prunes context-budget metric files older than the retention window", () => {
    const dir = mkdtempSync(join(tmpdir(), "metrics-"));
    const old = join(dir, "context-budget-2025-01-01.json");
    const fresh = join(dir, "context-budget-2026-10-19.json");
    const other = join(dir, "latest.json");
    for (const f of [old, fresh, other]) writeFileSync(f, "{}");
    const longAgo = new Date(Date.now() - 400 * 24 * 3600 * 1000);
    utimesSync(old, longAgo, longAgo);
    utimesSync(other, longAgo, longAgo);

    expect(pruneOldMetrics(dir, 180)).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });
});
