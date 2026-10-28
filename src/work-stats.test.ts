/** `agentbrew work stats`: what one /work run costs (instruction bytes, time, calls). */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWorkPlan, workPlanJson } from "./work.js";
import { collectWorkStats, formatWorkStats, workInstructionBytes } from "./work-stats.js";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PERF_SCRIPT = join(REPO_ROOT, "templates", "scripts", "agent-perf.mjs");
const NOW = Date.parse("2026-10-15T12:00:00Z");

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "work-stats-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("workInstructionBytes", () => {
  it("counts the command text plus the --json plan, the two things /work loads", () => {
    const plan = buildWorkPlan({ agents: [], catalogVersion: "test" } as never, []);
    const bytes = workInstructionBytes(plan, "abc");
    expect(bytes.commandBytes).toBe(3);
    expect(bytes.planBytes).toBe(Buffer.byteLength(`${workPlanJson(plan)}\n`));
    expect(bytes.totalBytes).toBe(bytes.commandBytes + bytes.planBytes);
  });
});

describe("collectWorkStats", () => {
  it("reads /work runs from the perf log under the given home", async () => {
    const dir = join(home, ".local", "state", "agentbrew", "perf");
    mkdirSync(dir, { recursive: true });
    const row = (ts: string, extra: object) => JSON.stringify({ project: "p", ts, sid: "s1", agent: null, ...extra });
    writeFileSync(
      join(dir, "2026-10.jsonl"),
      `${[
        row("2026-10-15T10:00:00Z", { tool: "Bash", ms: 500, ok: true, key: "agentbrew work" }),
        row("2026-10-15T10:00:30Z", { tool: "Skill", ms: 10, ok: true, key: "skill:agentbrew" }),
        row("2026-10-15T10:01:00Z", { tool: "Artifact", ms: 2000, ok: true, key: "Artifact" }),
        row("2026-10-15T10:05:00Z", { tool: "Bash", ms: 100, ok: true, key: "git status" }),
      ].join("\n")}\n`,
    );
    const stats = await collectWorkStats({ home, env: {}, nowMs: NOW, perfScript: PERF_SCRIPT, commandText: "x" });
    expect(stats.available).toBe(true);
    expect(stats.totals.runs).toBe(1);
    expect(stats.runs[0]).toMatchObject({ wallMs: 300_000, calls: 4, artifactCalls: 1 });
    expect(stats.instructions.commandBytes).toBe(1);
    const text = formatWorkStats(stats);
    expect(text).toContain("Instructions per run:");
    expect(text).toContain("/work runs, last 30d: 1");
  });

  it("skips an older synced reader that has no work report and uses the next one", async () => {
    const old = join(home, "old-agent-perf.mjs");
    writeFileSync(old, "export function buildReport() { return {}; }\n");
    const stats = await collectWorkStats({
      home,
      env: {},
      nowMs: NOW,
      perfScripts: [old, PERF_SCRIPT],
      commandText: "x",
    });
    expect(stats.available).toBe(true);
  });

  it("still reports the instruction bytes when the perf reader is missing", async () => {
    const stats = await collectWorkStats({
      home,
      env: {},
      nowMs: NOW,
      perfScript: join(home, "missing.mjs"),
      commandText: "x",
    });
    expect(stats.available).toBe(false);
    expect(stats.instructions.totalBytes).toBeGreaterThan(1);
    expect(formatWorkStats(stats)).toContain("perf log reader not installed");
  });
});
