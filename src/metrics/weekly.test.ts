import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAgentbrewWeekly,
  collectProviderFiles,
  isoWeek,
  loadShareConfig,
  machineId,
  maybeScheduledShare,
  parseSink,
  runShare,
  validateWeeklyMetrics,
  type WeeklyMetrics,
  writeProviderFile,
} from "./weekly.js";

const schema = JSON.parse(readFileSync(join(import.meta.dirname, "weekly-metrics.schema.json"), "utf-8")) as {
  required: string[];
  properties: Record<string, { type: string }>;
  additionalProperties: boolean;
};

const NOW = Date.parse("2026-10-20T12:00:00Z");
let home: string;
let env: NodeJS.ProcessEnv;

function eventsFile(): string {
  return join(home, ".local", "share", "agentbrew", "logs", "events.jsonl");
}

function writeEvents(rows: Record<string, unknown>[]): void {
  mkdirSync(join(home, ".local", "share", "agentbrew", "logs"), { recursive: true });
  writeFileSync(eventsFile(), rows.map((r) => JSON.stringify(r)).join("\n"));
}

function collectStrings(value: unknown, path: string, out: string[]): void {
  if (typeof value === "string") out.push(path);
  else if (Array.isArray(value))
    value.forEach((v, i) => {
      collectStrings(v, `${path}[${i}]`, out);
    });
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectStrings(v, path ? `${path}.${k}` : k, out);
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ab-weekly-"));
  env = { HOME: home };
});

afterEach(() => {
  delete process.env.AGENTBREW_EVENTS;
});

describe("schema", () => {
  it("allows strings only in tool, version, week, and machine_id", () => {
    const stringKeys = Object.entries(schema.properties)
      .filter(([, p]) => p.type === "string")
      .map(([k]) => k)
      .sort();
    expect(stringKeys).toEqual(["machine_id", "tool", "version", "week"]);
    expect(schema.additionalProperties).toBe(false);
    expect(
      (schema.properties.metrics as unknown as { additionalProperties: { type: string } }).additionalProperties,
    ).toEqual({ type: "number" });
  });

  it("rejects a string metric, an unknown field, and a bad id", () => {
    const good: WeeklyMetrics = {
      tool: "agentbrew",
      version: "0.4.0",
      week: "2026-W43",
      machine_id: "0".repeat(32),
      metrics: { sync_runs: 3 },
    };
    expect(validateWeeklyMetrics(good)).toEqual([]);
    expect(validateWeeklyMetrics({ ...good, metrics: { sync_runs: "3" } })).not.toEqual([]);
    expect(validateWeeklyMetrics({ ...good, project: "x" })).not.toEqual([]);
    expect(validateWeeklyMetrics({ ...good, machine_id: "host.example.com" })).not.toEqual([]);
    expect(validateWeeklyMetrics({ ...good, week: "2026-43" })).not.toEqual([]);
    expect(validateWeeklyMetrics({ ...good, metrics: { "Bad Name": 1 } })).not.toEqual([]);
  });
});

describe("isoWeek", () => {
  it("uses ISO-8601 weeks", () => {
    expect(isoWeek(Date.parse("2026-10-20T12:00:00Z"))).toBe("2026-W43");
    expect(isoWeek(Date.parse("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(isoWeek(Date.parse("2025-12-29T12:00:00Z"))).toBe("2026-W01");
  });
});

describe("machineId", () => {
  it("is random, local, stable, and private", () => {
    const id = machineId(home);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(machineId(home)).toBe(id);
    const file = join(home, ".local", "share", "agentbrew", "metrics", "machine-id");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const other = mkdtempSync(join(tmpdir(), "ab-weekly-"));
    expect(machineId(other)).not.toBe(id);
  });
});

describe("buildAgentbrewWeekly", () => {
  it("aggregates the last 7 days of events into numbers only", () => {
    writeEvents([
      { ts: "2026-10-19T10:00:00Z", event: "sync", story: "US08", ok: true, ms: 100 },
      { ts: "2026-10-19T11:00:00Z", event: "sync", story: "US08", ok: false, ms: 300 },
      { ts: "2026-10-19T12:00:00Z", event: "repair", story: "US06", ok: true, ms: 50, repaired: 2 },
      { ts: "2026-10-19T13:00:00Z", event: "error", story: "US03", ok: false, code: "SYNC_ERROR", module: "mcp" },
      { ts: "2026-10-19T13:00:00Z", event: "command", story: "US25", ok: true, ms: 10 },
      { ts: "2026-09-01T10:00:00Z", event: "sync", story: "US08", ok: true, ms: 999 },
    ]);
    const weekly = buildAgentbrewWeekly({ home, env, nowMs: NOW, version: "0.4.0" });
    expect(validateWeeklyMetrics(weekly)).toEqual([]);
    expect(weekly.week).toBe("2026-W43");
    expect(weekly.metrics).toMatchObject({
      sync_runs: 2,
      sync_ok_rate: 0.5,
      sync_p95_ms: 300,
      repair_runs: 1,
      drift_repaired: 2,
      errors_total: 1,
      errors_us03: 1,
      commands_run: 1,
    });
    const strings: string[] = [];
    collectStrings(weekly, "", strings);
    expect(strings.sort()).toEqual(["machine_id", "tool", "version", "week"]);
  });
});

describe("provider files", () => {
  it("writes and collects valid files from every tool, and skips invalid ones", () => {
    const weekly = buildAgentbrewWeekly({ home, env, nowMs: NOW, version: "0.4.0" });
    const path = writeProviderFile(weekly, home);
    expect(path).toBe(join(home, ".local", "share", "agentbrew", "metrics", "weekly-2026-W43.json"));
    const dotDir = join(home, ".local", "share", "dotfiles", "metrics");
    mkdirSync(dotDir, { recursive: true });
    writeFileSync(join(dotDir, "weekly-2026-W43.json"), JSON.stringify({ ...weekly, tool: "dotfiles" }));
    writeFileSync(join(dotDir, "weekly-2026-W42.json"), JSON.stringify({ ...weekly, metrics: { leak: "/x" } }));
    const { valid, invalid } = collectProviderFiles(home);
    expect(valid.map((v) => v.data.tool).sort()).toEqual(["agentbrew", "dotfiles"]);
    expect(invalid).toHaveLength(1);
  });
});

describe("parseSink", () => {
  it("parses dir, git, and none; rejects others", () => {
    expect(parseSink("dir:/tmp/x")).toEqual({ kind: "dir", path: "/tmp/x" });
    expect(parseSink("git:/tmp/y")).toEqual({ kind: "git", path: "/tmp/y" });
    expect(parseSink("none")).toEqual({ kind: "none" });
    expect(parseSink("https://example.com")).toBeUndefined();
    expect(parseSink(undefined)).toBeUndefined();
  });
});

describe("runShare", () => {
  it("is a dry run the first time, then sends to a dir sink", () => {
    const out = join(home, "share-out");
    const first = runShare({ home, env, nowMs: NOW, version: "0.4.0", sink: `dir:${out}` });
    expect(first.dryRun).toBe(true);
    expect(first.payload).toHaveLength(1);
    expect(existsSync(out)).toBe(false);
    expect(loadShareConfig(home).reviewed).toBe(true);

    const second = runShare({ home, env, nowMs: NOW, version: "0.4.0", sink: `dir:${out}` });
    expect(second.dryRun).toBe(false);
    const id = machineId(home);
    const sent = join(out, "agentbrew", id, "weekly-2026-W43.json");
    expect(validateWeeklyMetrics(JSON.parse(readFileSync(sent, "utf-8")))).toEqual([]);
  });

  it("does not send without a sink; the base repo has no default", () => {
    runShare({ home, env, nowMs: NOW, version: "0.4.0", dryRun: true });
    const result = runShare({ home, env, nowMs: NOW, version: "0.4.0" });
    expect(result.sent).toBe(0);
    expect(result.message).toMatch(/no sink/i);
  });

  it("takes the sink from AGENTBREW_METRICS_SINK (set by an org overlay)", () => {
    const out = join(home, "overlay-out");
    runShare({ home, env, nowMs: NOW, version: "0.4.0", dryRun: true });
    const result = runShare({ home, env: { ...env, AGENTBREW_METRICS_SINK: `dir:${out}` }, nowMs: NOW, version: "1" });
    expect(result.sent).toBe(1);
  });

  it("commits to a git sink", () => {
    const repo = join(home, "metrics-repo");
    mkdirSync(repo);
    const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
    execFileSync("git", ["init", "-q", repo], { env: gitEnv });
    runShare({ home, env, nowMs: NOW, version: "0.4.0", dryRun: true });
    const result = runShare({ home, env: { ...env, ...gitEnv }, nowMs: NOW, version: "0.4.0", sink: `git:${repo}` });
    expect(result.sent).toBe(1);
    const log = execFileSync("git", ["-C", repo, "log", "--oneline"], { env: gitEnv, encoding: "utf-8" });
    expect(log).toMatch(/metrics: agentbrew weekly share 2026-W43/);
  });

  it("does nothing when AGENTBREW_EVENTS=0", () => {
    const out = join(home, "off-out");
    const result = runShare({
      home,
      env: { ...env, AGENTBREW_EVENTS: "0" },
      nowMs: NOW,
      version: "1",
      sink: `dir:${out}`,
      dryRun: false,
    });
    expect(result.message).toMatch(/AGENTBREW_EVENTS=0/);
    expect(existsSync(join(home, ".local", "share", "agentbrew", "metrics"))).toBe(false);
    expect(existsSync(out)).toBe(false);
  });
});

describe("maybeScheduledShare", () => {
  it("is off by default", () => {
    expect(maybeScheduledShare({ home, env, nowMs: NOW, version: "1" })).toBe("off");
  });

  it("sends once per week when opted in", () => {
    const out = join(home, "sched-out");
    runShare({ home, env, nowMs: NOW, version: "1", sink: `dir:${out}`, schedule: "weekly", dryRun: true });
    expect(maybeScheduledShare({ home, env, nowMs: NOW, version: "1" })).toBe("sent");
    expect(maybeScheduledShare({ home, env, nowMs: NOW, version: "1" })).toBe("already-sent");
    expect(
      maybeScheduledShare({ home, env: { ...env, AGENTBREW_EVENTS: "0" }, nowMs: NOW + 8 * 86_400_000, version: "1" }),
    ).toBe("off");
  });
});
