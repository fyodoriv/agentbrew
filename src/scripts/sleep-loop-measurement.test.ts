import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — the deployed helper is pure ESM JavaScript.
import { buildReport, formatReport, summarize } from "../../templates/scripts/agent-perf.mjs";

const hook = resolve(import.meta.dirname, "../../hooks/checks/perf-record.sh");
const privateValue = "ghp_FIXTUREprivate12345678901234567890";
const privatePath = "/fixture/private/customer-payload.txt";
const loop = `until test -f ${privatePath}; do sleep 3; done`;
const cases = [
  { name: "foreground", command: loop, flag: false, signal: "until-while-sleep-v1", mode: "foreground" },
  { name: "background", command: loop, flag: true, signal: "until-while-sleep-v1", mode: "background" },
  { name: "missing mode", command: loop, signal: "until-while-sleep-v1", mode: "unknown" },
  {
    name: "for sleep",
    command: "for n in 1 2; do heavy-run --status; sleep 3; done",
    signal: "for-sleep-v1",
    mode: "unknown",
  },
  {
    name: "for without sleep",
    command: "for n in 1 2; do echo ready; done",
    signal: "not-observed-v1",
    mode: "unknown",
  },
  {
    name: "quoted",
    command: `echo 'until ${privateValue}; do sleep 3; done'`,
    signal: "not-observed-v1",
    mode: "unknown",
  },
  {
    name: "comment",
    command: `true # until ${privateValue}; do sleep 3; done`,
    signal: "not-observed-v1",
    mode: "unknown",
  },
  {
    name: "heredoc",
    command: `cat <<'EOF'\nuntil ${privateValue}; do sleep 3; done\nEOF\ntrue`,
    signal: "not-observed-v1",
    mode: "unknown",
  },
  { name: "missing command", signal: "unknown-v1", mode: "unknown" },
  {
    name: "quoted shell argument",
    command: `bash -c 'until ${privateValue}; do sleep 3; done'`,
    signal: "not-observed-v1",
    mode: "unknown",
  },
];

describe("sleep-loop syntax recorder", () => {
  it.each(cases)("labels $name without retaining private inputs", ({ command, flag, signal, mode }) => {
    const state = mkdtempSync(join(tmpdir(), "sleep-loop-recorder-"));
    try {
      const payload = {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        session_id: "fixture",
        tool_use_id: "call1",
        cwd: "/fixture/project",
        duration_ms: 123,
        tool_input: { command, run_in_background: flag, description: privateValue },
      };
      const result = spawnSync("bash", [hook], {
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: { ...process.env, XDG_STATE_HOME: state },
      });
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).toBe("");
      const dir = join(state, "agentbrew/perf");
      const raw = readFileSync(join(dir, readdirSync(dir)[0]), "utf8");
      expect(raw).not.toContain(privateValue);
      expect(raw).not.toContain(privatePath);
      expect(JSON.parse(raw)).toMatchObject({ sleepLoop: signal, shellMode: mode });
    } finally {
      rmSync(state, { recursive: true });
    }
  });
});

const base = { project: "fixture", ts: "2026-11-01T12:00:00Z", sid: "fixture", tool: "Bash", agent: null };
const observations = [
  {
    name: "foreground",
    id: "fg",
    ms: 100,
    ok: true,
    shellMode: "foreground",
    sleepLoop: "until-while-sleep-v1",
    paired: true,
  },
  {
    name: "background",
    id: "bg",
    ms: 200,
    ok: false,
    shellMode: "background",
    sleepLoop: "until-while-sleep-v1",
    paired: true,
  },
  {
    name: "unknown mode",
    id: "mode",
    ms: 300,
    ok: true,
    shellMode: "unknown",
    sleepLoop: "until-while-sleep-v1",
    paired: true,
  },
  { name: "for sleep", id: "for", ms: 350, ok: true, shellMode: "foreground", sleepLoop: "for-sleep-v1", paired: true },
  { name: "missing id", ms: 400, ok: true, shellMode: "foreground", sleepLoop: "until-while-sleep-v1", paired: false },
  {
    name: "missing duration",
    id: "duration",
    ms: null,
    ok: true,
    shellMode: "foreground",
    sleepLoop: "until-while-sleep-v1",
    paired: true,
  },
  {
    name: "missing attempt",
    id: "attempt",
    ms: 600,
    ok: true,
    shellMode: "foreground",
    sleepLoop: "until-while-sleep-v1",
    paired: false,
  },
  { name: "historical", id: "old", ms: 700, ok: true, paired: true },
];

function rowsFor(item: (typeof observations)[number]) {
  const { name: _name, paired, ...fields } = item;
  const completion = { ...base, ...fields, key: "until <arg>" };
  return paired ? [{ ...completion, ev: "attempt", ms: undefined, ok: undefined }, completion] : [completion];
}

describe("sleep-loop report evidence", () => {
  it.each(observations)("preserves $name evidence and unknowns", (item) => {
    const coverage = summarize(rowsFor(item)).sleepLoops;
    const tagged = "sleepLoop" in item;
    const measured = tagged && item.paired && item.id !== undefined && item.ms !== null;
    expect(coverage).toMatchObject({
      completionRows: 1,
      taggedRows: tagged ? 1 : 0,
      unknownRows: tagged ? 0 : 1,
      observedSyntaxRows: tagged ? 1 : 0,
      pairedTimedRows: measured ? 1 : 0,
      unresolvedObservedRows: tagged && !measured ? 1 : 0,
      behaviorCoverage: null,
    });
    expect(coverage.groups).toEqual(
      measured
        ? [
            {
              signal: item.sleepLoop,
              mode: item.shellMode,
              rows: 1,
              sumMs: item.ms,
              failures: item.ok === false ? 1 : 0,
            },
          ]
        : [],
    );
  });

  it("reports aggregate coverage without rewriting historical rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "sleep-loop-report-"));
    try {
      const rows = observations.flatMap(rowsFor);
      const file = join(dir, "2026-11.jsonl");
      const raw = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
      writeFileSync(file, raw);
      const report = buildReport({ all: true, days: 7 }, { dir, nowMs: Date.parse("2026-11-01T13:00:00Z") });
      expect(report.sleepLoops).toMatchObject({
        completionRows: 8,
        taggedRows: 7,
        unknownRows: 1,
        observedSyntaxRows: 7,
        pairedTimedRows: 4,
        unresolvedObservedRows: 3,
        behaviorCoverage: null,
      });
      const text = formatReport(report);
      expect(text).toContain("Sleep-loop syntax");
      expect(text).toContain("behavior coverage unknown");
      expect(JSON.stringify(report) + text).not.toContain(privateValue);
      expect(JSON.stringify(report) + text).not.toContain(privatePath);
      expect(readFileSync(file, "utf8")).toBe(raw);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
