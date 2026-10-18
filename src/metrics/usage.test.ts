import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectUsageMetrics, renderUsageShare, renderUsageText, shareStepKey } from "./usage.js";

const NOW = Date.parse("2026-10-16T12:00:00.000Z");
const roots: string[] = [];

function fakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "agentbrew-metrics-"));
  roots.push(home);
  const perf = join(home, ".local", "state", "agentbrew", "perf");
  mkdirSync(perf, { recursive: true });
  const row = (key: string, ms: number, ok = true) =>
    JSON.stringify({
      project: "secret-project",
      ts: "2026-10-15T10:00:00.000Z",
      sid: "s1",
      tool: "Bash",
      ms,
      ok,
      key,
      id: key + ms,
      agent: null,
    });
  writeFileSync(
    join(perf, "2026-10.jsonl"),
    [row("npm run verify", 120_000), row("python3 night_lanes.py", 30_000, false), row("cat <arg>", 2_000)].join("\n"),
  );
  const cache = join(home, ".cache", "agentbrew");
  mkdirSync(cache, { recursive: true });
  const decision = (hookId: string, decision: string, ts = "2026-10-15T10:00:00.000Z", sessionId = "sess-1") =>
    JSON.stringify({ timestamp: ts, hookId, decision, reason: "private reason text", sessionId });
  writeFileSync(
    join(cache, "hook-decisions.jsonl"),
    [
      decision("verify-before-completion", "block"),
      decision("verify-before-completion", "allow"),
      decision("private-org-hook", "block"),
      decision("verify-before-completion", "block", "2026-01-01T00:00:00.000Z"),
      // Fixture-run rows carry no sessionId; metrics must skip them.
      decision("selectors-pure", "block", "2026-10-15T10:00:00.000Z", ""),
    ].join("\n"),
  );
  writeFileSync(
    join(cache, "mcp-health.json"),
    JSON.stringify({
      servers: [
        { name: "playwright", status: "ok" },
        { name: "corp-internal-mcp", status: "fail" },
      ],
    }),
  );
  return home;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("agentbrew metrics", () => {
  it("counts only hook decisions that carry a session id", async () => {
    const metrics = await collectUsageMetrics({
      home: fakeHome(),
      env: {},
      nowMs: NOW,
      days: 7,
      version: "9.9.9",
      perfScript: join(import.meta.dirname, "..", "..", "templates", "scripts", "agent-perf.mjs"),
    });
    expect(metrics.hooks.top.map((s) => s.hookId)).not.toContain("selectors-pure");
  });

  it("collects agent time, hook decisions in the window, and MCP health from local logs", async () => {
    const metrics = await collectUsageMetrics({
      home: fakeHome(),
      env: {},
      nowMs: NOW,
      days: 7,
      version: "9.9.9",
      perfScript: join(import.meta.dirname, "..", "..", "templates", "scripts", "agent-perf.mjs"),
    });
    expect(metrics.agentTime).toMatchObject({ available: true, toolMs: 152_000, calls: 3, failures: 1 });
    expect(metrics.hooks).toMatchObject({ available: true, decisions: 3, blocks: 2 });
    expect(metrics.mcp).toEqual({ available: true, ok: 1, failing: 1, failingNames: ["corp-internal-mcp"] });
    expect(renderUsageText(metrics)).toContain("nothing is uploaded");
  });

  it("share snapshot carries aggregates only: no project, script, reason, overlay hook, or MCP names", async () => {
    const metrics = await collectUsageMetrics({
      home: fakeHome(),
      env: {},
      nowMs: NOW,
      perfScript: join(import.meta.dirname, "..", "..", "templates", "scripts", "agent-perf.mjs"),
    });
    const share = renderUsageShare(metrics, new Set(["verify-before-completion"]));
    expect(share).toContain("`npm run verify`");
    expect(share).toContain("`verify-before-completion`");
    expect(share).toContain("(other hooks)");
    for (const secret of [
      "secret-project",
      "night_lanes",
      "private reason",
      "private-org-hook",
      "corp-internal-mcp",
      "s1",
    ]) {
      expect(share).not.toContain(secret);
    }
  });

  it("reports missing data instead of failing on a fresh machine", async () => {
    const home = mkdtempSync(join(tmpdir(), "agentbrew-metrics-empty-"));
    roots.push(home);
    const metrics = await collectUsageMetrics({ home, env: {}, nowMs: NOW, perfScript: join(home, "missing.mjs") });
    expect(metrics.agentTime.available).toBe(false);
    expect(metrics.hooks.available).toBe(false);
    expect(renderUsageText(metrics)).toContain("no data yet");
    expect(renderUsageShare(metrics, undefined)).toContain("No data.");
  });

  it("keeps only plain command words in shared step keys", () => {
    expect(shareStepKey("npm run verify")).toBe("npm run verify");
    expect(shareStepKey("python3 night_lanes.py")).toBe("python3 <arg>");
    expect(shareStepKey("<path> -m")).toBe("<path> -m");
  });
});
