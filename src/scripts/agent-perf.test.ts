// Behavior tests for templates/scripts/agent-perf.mjs (the perf log reader)
// and for the step keys that hooks/checks/perf-record.sh writes.

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildBrief,
  buildReport,
  buildTurn,
  formatMs,
  formatReport,
  formatStatusline,
  projectForDir,
  sessionStats,
  summarize,
  // @ts-expect-error — pure-ESM .mjs helper; vitest resolves it via Node ESM.
} from "../../templates/scripts/agent-perf.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const HELPER = join(REPO_ROOT, "templates", "scripts", "agent-perf.mjs");
const HOOK = join(REPO_ROOT, "hooks", "checks", "perf-record.sh");
const NOW = Date.parse("2026-10-15T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface Row {
  project?: string;
  ts: string;
  sid: string;
  tool?: string;
  ms?: number | null;
  ok?: boolean;
  key?: string;
  agent?: string | null;
  ev?: "turn" | "attempt" | "denied";
  id?: string;
}

let base: string;
let dir: string;

function at(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function tool(key: string, ms: number, extra: Partial<Row> = {}): Row {
  return { project: "alpha", ts: at(HOUR), sid: "s1", tool: "Bash", ms, ok: true, key, agent: null, ...extra };
}

function writeRows(rows: Row[], month = "2026-10"): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${month}.jsonl`), rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

function attempt(key: string, id: string, extra: Partial<Row> = {}): Row {
  return { project: "alpha", ts: at(HOUR), sid: "s1", ev: "attempt", tool: "Bash", key, id, agent: null, ...extra };
}

const ctx = () => ({ dir, nowMs: NOW, cwd: "/nowhere/alpha" });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "agent-perf-"));
  dir = join(base, "state", "agentbrew", "perf");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("summarize", () => {
  it("computes per-key count, sum, nearest-rank p50/p95, max, and failures", () => {
    const rows = [1000, 2000, 3000, 4000, 100_000].map((ms) => tool("npm run verify", ms));
    rows.push(tool("git push", 500, { ok: false }));

    const summary = summarize(rows);

    expect(summary.keys[0]).toEqual({
      key: "npm run verify",
      count: 5,
      sumMs: 110_000,
      p50Ms: 3000,
      p95Ms: 100_000,
      maxMs: 100_000,
      failures: 0,
    });
    expect(summary.failuresByKey).toEqual([{ key: "git push", failures: 1, count: 1 }]);
    expect(summary.slowest[0]).toMatchObject({ key: "npm run verify", ms: 100_000 });
    expect(summary.calls).toBe(6);
    expect(summary.failures).toBe(1);
  });

  it("leaves subagent calls and turn rows out of the totals", () => {
    const summary = summarize([
      tool("agent:Explore", 60_000),
      tool("rg foo", 59_000, { agent: "Explore" }),
      { ts: at(HOUR), sid: "s1", ev: "turn" },
      tool("no duration", Number.NaN, { ms: null }),
    ]);

    expect(summary.toolMs).toBe(60_000);
    expect(summary.calls).toBe(1);
    expect(summary.subagentCalls).toBe(1);
    expect(summary.keys.map((k: { key: string }) => k.key)).toEqual(["agent:Explore", "rg foo"]);
  });
});

describe("attempts and blocked calls", () => {
  it("pairs attempts with completions by session and id", () => {
    const summary = summarize([
      attempt("npm test", "a1"),
      tool("npm test", 1000, { id: "a1" }),
      attempt("cd <path>", "a2"),
      attempt("cd <path>", "a3"),
      { ...attempt("cd <path>", "a3"), ev: "denied" },
      attempt("Edit:ts", "a4"),
      // The same id in another session does not complete a1's twin there.
      attempt("git push", "a1", { sid: "s2" }),
      // A completion row without an attempt row (the attempt hook missed it).
      tool("rg <arg>", 5, { id: "a5" }),
      // Rows written before ids existed take no part in pairing.
      tool("old row", 7),
    ]);

    expect(summary.attempts).toBe(5);
    expect(summary.blocked).toBe(4);
    expect(summary.blockedKeys).toEqual([
      { key: "cd <path>", count: 2 },
      { key: "Edit:ts", count: 1 },
      { key: "git push", count: 1 },
    ]);
    // 5 of the 6 calls with an id have an attempt row (a5 has only a completion).
    expect(summary.captureRate).toBeCloseTo(5 / 6, 5);
    expect(summary.calls).toBe(3);
  });

  it("reports null capture and zero blocked without id rows", () => {
    const summary = summarize([tool("npm test", 1000)]);
    expect(summary).toMatchObject({ attempts: 0, blocked: 0, blockedKeys: [], captureRate: null });
  });

  it("shows blocked calls in the text report and the brief", () => {
    writeRows([
      ...[50_000, 60_000, 70_000].flatMap((ms, i) => [
        attempt("npm run verify", `v${i}`),
        tool("npm run verify", ms, { id: `v${i}` }),
      ]),
      attempt("cd <path>", "b1"),
      attempt("cd <path>", "b2"),
      attempt("Edit:ts", "b3"),
    ]);

    const text = formatReport(buildReport({}, ctx()));
    expect(text).toContain("Blocked: 3 of 6 attempted calls never ran (capture 100% of 6 calls with an id).");
    expect(text).toContain("  cd <path>: 2");

    const brief = buildBrief({}, ctx());
    expect(brief.split("\n").length).toBeLessThanOrEqual(5);
    expect(brief).toContain("Blocked calls: 3 never ran (top: cd <path> 2x)");
  });

  it("pairs a call whose completion row landed in another project (a cd into another repo)", () => {
    writeRows([
      // `cd ~/beta && rg …` starts in alpha; the completion row is written under beta.
      attempt("cd <path>", "x1"),
      tool("cd <path>", 800, { id: "x1", project: "beta" }),
      // The same before the 7-day window, completed after its edge.
      attempt("cd <path>", "x2", { ts: at(7 * DAY + HOUR) }),
      tool("cd <path>", 900, { id: "x2", project: "beta", ts: at(7 * DAY - HOUR) }),
      // A call that never ran anywhere stays blocked.
      attempt("Edit:ts", "x3"),
    ]);

    const alpha = buildReport({}, ctx());
    expect(alpha).toMatchObject({ attempts: 2, blocked: 1, blockedKeys: [{ key: "Edit:ts", count: 1 }] });
    // Session mode scans 31 days, so it sees x2 too.
    expect(buildReport({ session: "s1" }, ctx())).toMatchObject({ attempts: 3, blocked: 1 });
    expect(buildBrief({}, ctx())).toContain("Blocked calls: 1 never ran (top: Edit:ts 1x)");

    // beta's completions (x1, x2) have their attempt rows in alpha, so the attempt hook did capture them.
    const beta = buildReport({ project: "beta" }, ctx());
    expect(beta).toMatchObject({ attempts: 0, blocked: 0, callsWithId: 2, captureRate: 1 });

    const all = buildReport({ all: true }, ctx());
    expect(all).toMatchObject({ attempts: 2, blocked: 1 });
    expect(alpha.blocked).toBeLessThanOrEqual(all.blocked);
  });
});

describe("background agent launches", () => {
  const base = {
    project: "p",
    ts: "2026-10-15T12:00:00Z",
    sid: "s",
    tool: "Agent",
    key: "agent:general-purpose",
    agent: null,
  };
  const attempt = (id: string) => ({ ...base, ev: "attempt", id, bg: true });
  const done = (id: string, ms: number) => ({ ...base, ms, ok: true, id, bg: true });

  it("count as ran with no completion row yet, and once when the row arrives", () => {
    expect(summarize([attempt("a")])).toMatchObject({ attempts: 1, blocked: 0 });
    expect(summarize([attempt("a"), done("a", 918_013)])).toMatchObject({ attempts: 1, blocked: 0 });
  });

  it("still count as never ran when a denied row names them", () => {
    const denied = { ...base, ev: "denied", id: "b" };
    expect(summarize([attempt("b"), denied])).toMatchObject({
      blocked: 1,
      blockedKeys: [{ key: "agent:general-purpose", count: 1 }],
    });
  });

  it("leave the worker's run time out of tool time, the step ranking, and human wait", () => {
    const summary = summarize([done("a", 918_013), done("c", 2_400_000)]);
    expect(summary.toolMs).toBe(0);
    expect(summary.keys).toEqual([]);
    expect(summary.humanWait.calls).toBe(0);
  });
});

describe("human wait", () => {
  const NAV = "mcp__Claude_Browser__navigate";

  it("moves a long call (LONG_CALL_MS or more) from tool time to human wait", () => {
    const summary = summarize([
      // A site-approval prompt inside the tool: duration_ms holds the whole wait.
      tool(NAV, 8 * HOUR + 45 * 60_000, { agent: "general-purpose" }),
      ...[900, 1000, 23_000].map((ms) => tool(NAV, ms, { agent: "general-purpose" })),
      tool("git status", 36 * 60_000),
      tool("until <arg>", 10 * 60_000),
      tool("until <arg>", 9 * 60_000),
    ]);

    expect(summary.toolMs).toBe(19 * 60_000);
    expect(summary.calls).toBe(2);
    expect(summary.keys[0]).toMatchObject({ key: "until <arg>", sumMs: 19 * 60_000 });
    expect(summary.keys.find((k: { key: string }) => k.key === NAV)).toMatchObject({
      count: 3,
      sumMs: 24_900,
      maxMs: 23_000,
    });
    expect(summary.keys.find((k: { key: string }) => k.key === "git status")).toBeUndefined();
    expect(summary.slowest[0]).toMatchObject({ key: "until <arg>", ms: 10 * 60_000 });
    expect(summary.humanWait).toMatchObject({
      calls: 2,
      ms: 8 * HOUR + 45 * 60_000 + 36 * 60_000,
      promptCalls: 0,
      longCalls: 2,
    });
    expect(summary.humanWait.longest.map((w: { key: string; reason: string }) => [w.key, w.reason])).toEqual([
      [NAV, "over 30 min"],
      ["git status", "over 30 min"],
    ]);
  });

  it("counts a wait of a minute or more before the run as a prompt wait, apart from tool time", () => {
    const summary = summarize([
      // Attempt 5 min before the completion row, ran 2 s: 4m58s on a permission prompt.
      attempt("cargo test", "p1", { ts: at(HOUR + 5 * 60_000) }),
      tool("cargo test", 2000, { id: "p1" }),
      // 30 s from attempt to run: other hooks and queueing, not a person.
      attempt("npm test", "q1", { ts: at(HOUR + 31_000) }),
      tool("npm test", 1000, { id: "q1" }),
      // A question waits for its answer before it "runs" (duration_ms 0).
      attempt("AskUserQuestion", "u1", { ts: at(HOUR + 20 * 60_000), tool: "AskUserQuestion" }),
      tool("AskUserQuestion", 0, { id: "u1", tool: "AskUserQuestion" }),
    ]);

    expect(summary.toolMs).toBe(3000);
    expect(summary.calls).toBe(3);
    expect(summary.humanWait).toMatchObject({ calls: 2, ms: 20 * 60_000 + 298_000, promptCalls: 2, longCalls: 0 });
    expect(summary.humanWait.longest[0]).toMatchObject({ key: "AskUserQuestion", ms: 20 * 60_000, reason: "prompt" });
    expect(summary.humanWait.longest[1]).toMatchObject({ key: "cargo test", ms: 298_000, reason: "prompt" });
  });

  it("lists human-wait calls in the text report and keeps them out of the brief", () => {
    writeRows([tool(NAV, 8 * HOUR + 45 * 60_000), ...[50_000, 60_000, 70_000].map((ms) => tool("npm run verify", ms))]);

    const text = formatReport(buildReport({}, ctx()));
    expect(text).toContain("Tool time: 3m00s over 3 main-thread calls");
    expect(text).toContain(
      "Human wait: 8h45m in 1 call, not in tool time or the step ranking (0 waited on a prompt before the run, 1 ran over 30 min).",
    );
    expect(text).toContain("Human-wait calls (not in tool time):");
    expect(text).toMatch(/8h45m {2}mcp__Claude_Browser__navigate {2}over 30 min/);
    expect(text).not.toMatch(/Top steps by total time:\n {2}mcp__Claude_Browser__navigate/);
    expect(buildBrief({}, ctx())).toContain("Slowest single step: npm run verify 1m10s.");
  });

  it("leaves a long call (LONG_CALL_MS or more) out of the status line tool time", () => {
    writeRows([tool("npm run verify", 5000), tool(NAV, 31 * 60_000)]);
    expect(sessionStats("s1", { dir, nowMs: NOW })).toEqual({ toolMs: 5000, slowKey: "npm run verify", slowMs: 5000 });
  });
});

describe("report", () => {
  it("filters by project and window and compares with the previous window", () => {
    writeRows([
      tool("npm run verify", 120_000, { ts: at(9 * DAY) }),
      tool("npm run verify", 60_000, { ts: at(2 * DAY) }),
      tool("npm run verify", 120_000, { ts: at(DAY) }),
      tool("bats <path>", 30_000),
      tool("make check", 999_000, { project: "beta" }),
      tool("too old", 1, { ts: at(20 * DAY) }),
    ]);

    const report = buildReport({ days: "7" }, ctx());

    expect(report.scope).toMatchObject({ project: "alpha", days: 7 });
    expect(report.toolMs).toBe(210_000);
    expect(report.calls).toBe(3);
    expect(report.previous).toEqual({ toolMs: 120_000, calls: 1, toolMsChangePct: 75, callsChangePct: 200 });
    expect(report.topKeys[0]).toMatchObject({
      key: "npm run verify",
      sumMs: 180_000,
      previousSumMs: 120_000,
      sumChangePct: 50,
    });
    expect(report.topKeys[1]).toMatchObject({ key: "bats <path>", sumChangePct: null });

    const all = buildReport({ all: true, days: "7" }, ctx());
    expect(all.scope.project).toBe("all");
    expect(all.toolMs).toBe(1_209_000);
  });

  it("reports one session, and resolves latest to the newest row in scope", () => {
    writeRows([
      tool("npm run verify", 1000, { sid: "old", ts: at(3 * HOUR) }),
      tool("git push", 2000, { sid: "new", ts: at(2 * HOUR) }),
      tool("make check", 3000, { sid: "other-project", project: "beta", ts: at(HOUR) }),
    ]);

    const latest = buildReport({ session: "latest" }, ctx());
    expect(latest.scope.session).toBe("new");
    expect(latest.keys.map((k: { key: string }) => k.key)).toEqual(["git push"]);
    expect(latest.previous).toBeUndefined();

    expect(buildReport({ session: "old" }, ctx()).toolMs).toBe(1000);
  });

  it("names the session scope, not a day window, when latest finds no rows", () => {
    writeRows([tool("make check", 3000, { sid: "other-project", project: "beta", ts: at(HOUR) })]);

    const empty = buildReport({ session: "latest" }, ctx());
    expect(empty.scope.session).toBeNull();
    const text = formatReport(empty);
    expect(text).not.toContain("null");
    expect(text.split("\n")[0]).toBe("Agent time — alpha, session latest (none found)");
    expect(text).toContain("No tool rows yet.");
  });

  it("prints valid JSON from the CLI and survives a torn line", () => {
    writeRows([tool("npm run verify", 5000)]);
    appendFileSync(join(dir, "2026-10.jsonl"), '{"project":"alpha","ts":"2026-');

    const result = spawnSync("node", [HELPER, "report", "--all", "--days", "3650", "--json"], {
      encoding: "utf8",
      env: { ...process.env, XDG_STATE_HOME: join(base, "state") },
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ calls: 1, toolMs: 5000 });
  });
});

describe("brief", () => {
  it("is empty without data and stays within the line budget with data", () => {
    expect(buildBrief({}, ctx())).toBe("");

    writeRows([
      ...[50_000, 60_000, 70_000].map((ms) => tool("npm run verify", ms)),
      tool("bats <path>", 200_000),
      tool("git push", 4000),
    ]);
    const brief = buildBrief({}, ctx());
    const lines = brief.split("\n");

    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines[0]).toContain("alpha");
    expect(lines[1]).toBe(
      "Top steps: bats <path> 3m20s (1x, p50 3m20s) · npm run verify 3m00s (3x, p50 1m00s) · git push 4s (1x, p50 4s).",
    );
    expect(brief).toContain("Slowest single step: bats <path> 3m20s.");
    expect(brief).toContain("Speedup candidate: npm run verify ran 3x at p50 1m00s");
  });
});

describe("turn", () => {
  it("counts only rows after the last turn row of the session", () => {
    writeRows([
      tool("before", 999_000),
      { project: "alpha", ts: at(HOUR), sid: "s1", ev: "turn" },
      tool("npm run verify", 200_000),
      tool("git push", 150_000),
      tool("other session", 1, { sid: "s2" }),
      tool("ls <path>", 10),
    ]);

    const turn = buildTurn("s1", { dir, nowMs: NOW });

    expect(turn.toolMs).toBe(350_010);
    expect(turn.calls).toBe(3);
    expect(turn.slowest.map((s: { key: string }) => s.key)).toEqual(["npm run verify", "git push", "ls <path>"]);
    expect(turn).toMatchObject({ attempts: 0, blocked: 0, blockedKeys: [] });
  });

  it("lists this turn's blocked calls only", () => {
    writeRows([
      attempt("before", "x0"),
      { project: "alpha", ts: at(HOUR), sid: "s1", ev: "turn" },
      attempt("cd <path>", "x1"),
      attempt("cd <path>", "x2"),
      attempt("npm test", "x3"),
      tool("npm test", 100, { id: "x3" }),
    ]);

    const turn = buildTurn("s1", { dir, nowMs: NOW });

    expect(turn).toMatchObject({ attempts: 3, blocked: 2, blockedKeys: [{ key: "cd <path>", count: 2 }] });
  });
});

describe("statusline", () => {
  it("formats model, wall time, api and tool time, slowest step, and context", () => {
    const line = formatStatusline(
      {
        model: { display_name: "Opus 5.5" },
        cost: { total_duration_ms: 42 * 60_000, total_api_duration_ms: 18 * 60_000 },
        context_window: { used_percentage: 38.4 },
      },
      { toolMs: 15 * 60_000, slowKey: "npm run verify", slowMs: 372_000 },
    );

    expect(line).toBe("Opus 5.5 · 42m (api 18m · tools 15m) · slowest: npm run verify 6m12s · ctx 38%");
    expect(formatStatusline({}, { toolMs: 0, slowKey: null, slowMs: 0 })).toBe("");
  });

  it("reads new rows incrementally and waits for a half-written row", () => {
    writeRows([tool("npm run verify", 5000)]);
    expect(sessionStats("s1", { dir, nowMs: NOW })).toEqual({ toolMs: 5000, slowKey: "npm run verify", slowMs: 5000 });

    writeRows([tool("bats <path>", 9000)]);
    const half = JSON.stringify(tool("git push", 1000));
    appendFileSync(join(dir, "2026-10.jsonl"), half.slice(0, 20));
    expect(sessionStats("s1", { dir, nowMs: NOW })).toEqual({ toolMs: 14_000, slowKey: "bats <path>", slowMs: 9000 });

    appendFileSync(join(dir, "2026-10.jsonl"), `${half.slice(20)}\n`);
    expect(sessionStats("s1", { dir, nowMs: NOW }).toolMs).toBe(15_000);
  });

  it("stays fast with 200k rows on disk", () => {
    mkdirSync(dir, { recursive: true });
    const lines: string[] = [];
    for (let i = 0; i < 200_000; i++) {
      lines.push(JSON.stringify(tool(i % 7 === 0 ? "npm run verify" : "rg <arg>", i % 1000, { sid: `s${i % 50}` })));
    }
    writeFileSync(join(dir, "2026-10.jsonl"), `${lines.join("\n")}\n`);

    const coldStart = performance.now();
    const cold = sessionStats("s7", { dir, nowMs: NOW });
    const coldMs = performance.now() - coldStart;
    const warm: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      sessionStats("s7", { dir, nowMs: NOW });
      warm.push(performance.now() - start);
    }
    warm.sort((a, b) => a - b);

    expect(cold.toolMs).toBeGreaterThan(0);
    // Generous bounds keep this stable under a loaded test run; the PR measures the CLI p95.
    expect(coldMs).toBeLessThan(500);
    expect(warm[47]).toBeLessThan(50);
  });
});

describe("helpers", () => {
  it("formats durations", () => {
    expect([450, 12_400, 372_000, 42 * 60_000, 3 * HOUR + 120_000].map(formatMs)).toEqual([
      "450ms",
      "12s",
      "6m12s",
      "42m",
      "3h02m",
    ]);
  });

  it("maps a linked worktree to its main repo name", () => {
    const root = base;
    mkdirSync(join(root, "main-repo", ".git"), { recursive: true });
    mkdirSync(join(root, "wt", "feature", "src"), { recursive: true });
    writeFileSync(join(root, "wt", "feature", ".git"), `gitdir: ${root}/main-repo/.git/worktrees/feature\n`);

    expect(projectForDir(join(root, "wt", "feature", "src"))).toBe("main-repo");
    expect(projectForDir(join(root, "main-repo"))).toBe("main-repo");
  });
});

const hasJq = spawnSync("jq", ["--version"]).status === 0;

describe.skipIf(!hasJq)("perf-record step keys (privacy)", () => {
  function record(payload: object): Row {
    const state = join(base, "hook-state");
    const result = spawnSync("/bin/bash", [HOOK], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, XDG_STATE_HOME: state },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    const month = new Date().toISOString().slice(0, 7);
    const lines = readFileSync(join(state, "agentbrew", "perf", `${month}.jsonl`), "utf8")
      .trim()
      .split("\n");
    return JSON.parse(lines[lines.length - 1]);
  }

  const bash = (command: string) => ({
    hook_event_name: "PostToolUse",
    session_id: "s1",
    cwd: "/nowhere/alpha",
    tool_name: "Bash",
    tool_input: { command },
    duration_ms: 7,
  });

  it.each([
    ["npm run verify", "npm run verify"],
    ["cd /a/b && FOO=1 env -u X nice -n 5 npm run test:all -- --x", "npm run test:all"],
    ["timeout 60 bats tests/a.bats", "bats <path>"],
    ["git push origin feat/x", "git push"],
    ["bash scripts/run-hook-fixtures.sh", "bash run-hook-fixtures.sh"],
    ["echo 'quoted words'", "echo <arg>"],
    ["", "Bash"],
    // Compound commands key the dominant command, not the cheap prefix.
    ["pgrep -lf foo ; make check", "make check"],
    ["git status && npm run verify", "npm run verify"],
    ["ps aux | grep node", "ps aux"],
    ["git add a.ts && git commit -m 'x; y'", "git commit"],
    ["npm run build 2>&1 | tail -5", "npm run build"],
    // Subshells, quoted command words, and loops name a real command.
    ["$(npm bin)/vitest run", "vitest run"],
    ['"$HOME/x.sh" arg', "x.sh arg"],
    ["until [ -f done ]; do sleep 1; done", "until sleep 1"],
    ["for f in a b; do npm test; done", "for npm test"],
    ["$(git rev-parse --show-toplevel)", "git rev-parse"],
  ])("keys %j as %j", (command, key) => {
    expect(record(bash(command)).key).toBe(key);
  });

  it("never writes a token-like argument, a path, or the prompt", () => {
    const token = "ghp_FAKEexampleTOKEN1234567890abcd";
    const row = record(bash(`GH_TOKEN=${token} gh api -H "Authorization: token ${token}" /user`));
    const deploy = record(bash(`deploy ${token}`));
    const edit = record({
      hook_event_name: "PostToolUse",
      session_id: "s1",
      cwd: "/nowhere/alpha",
      tool_name: "Write",
      tool_input: { file_path: "/srv/team-x/private/plan.md", content: token },
      duration_ms: 3,
    });
    const turn = record({ hook_event_name: "UserPromptSubmit", session_id: "s1", cwd: "/x", prompt: token });
    const tried = record({
      hook_event_name: "PreToolUse",
      session_id: "s1",
      cwd: "/nowhere/alpha",
      tool_name: "Bash",
      tool_input: { command: `cd /srv/team-x && TOKEN=${token} ./deploy.sh ${token}`, description: "plan.md" },
      tool_use_id: "toolu_01abc",
    });

    expect(row.key).toBe("gh api");
    expect(deploy.key).toBe("deploy <redacted>");
    expect(edit.key).toBe("Write:md");
    expect(turn).toEqual({ project: "x", ts: expect.any(String), sid: "s1", ev: "turn" });
    expect(tried).toEqual({
      project: "alpha",
      ts: expect.any(String),
      sid: "s1",
      ev: "attempt",
      tool: "Bash",
      key: "deploy.sh <redacted>",
      id: "toolu_01abc",
      agent: null,
    });
    const log = readFileSync(
      join(base, "hook-state", "agentbrew", "perf", `${new Date().toISOString().slice(0, 7)}.jsonl`),
      "utf8",
    );
    expect(log).not.toContain(token);
    expect(log).not.toContain("/srv/team-x");
    expect(log).not.toContain("plan.md");
  });
});
