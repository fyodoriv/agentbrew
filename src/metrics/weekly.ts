/**
 * Weekly aggregate metrics share (opt-in, issue #346).
 *
 * The provider contract: each tool writes one file per ISO week to
 * ~/.local/share/<tool>/metrics/weekly-<YYYY-Www>.json. The file matches
 * weekly-metrics.schema.json: numbers only, except tool, version, week, and a
 * random local machine_id. `agentbrew metrics share` collects every valid
 * provider file and copies it to a sink (`dir`, `git`, or `none`). The base
 * repo has no default sink; an org overlay sets AGENTBREW_METRICS_SINK.
 *
 * Lifecycle: the share config (~/.config/agentbrew/metrics-share.json) and the
 * machine id (~/.local/share/agentbrew/metrics/machine-id) are user-home
 * files. They live until the user deletes them. AGENTBREW_EVENTS=0 turns
 * every write and send off.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logSkipped } from "../core/logger.js";

const DAY_MS = 86_400_000;
const TOOL = /^[a-z][a-z0-9-]{0,40}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,40}$/;
const WEEK = /^[0-9]{4}-W[0-9]{2}$/;
const MACHINE_ID = /^[0-9a-f]{32}$/;
const METRIC_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const FIELDS = ["tool", "version", "week", "machine_id", "metrics"];

export interface WeeklyMetrics {
  tool: string;
  version: string;
  week: string;
  machine_id: string;
  metrics: Record<string, number>;
}

export type Sink = { kind: "dir"; path: string } | { kind: "git"; path: string } | { kind: "none" };

export interface ShareConfig {
  /** Sink spec: `dir:<path>`, `git:<path>`, or `none`. */
  sink?: string;
  schedule?: "weekly" | "off";
  /** True after the user saw one dry run. */
  reviewed?: boolean;
  /** Last ISO week the schedule sent. */
  lastWeek?: string;
}

export interface ShareContext {
  home?: string;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  version?: string;
}

function validateMetricsMap(metrics: unknown): string[] {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return ["bad metrics"];
  const errors: string[] = [];
  for (const [name, n] of Object.entries(metrics)) {
    if (!METRIC_NAME.test(name)) errors.push(`bad metric name ${name.slice(0, 20)}`);
    if (typeof n !== "number" || !Number.isFinite(n)) errors.push(`metric ${name.slice(0, 20)} is not a number`);
  }
  return errors;
}

/** Errors for one candidate provider file; empty when it matches the schema. */
export function validateWeeklyMetrics(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["not an object"];
  const v = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(v)) if (!FIELDS.includes(key)) errors.push(`unknown field ${key}`);
  const check = (key: string, re: RegExp) => {
    if (typeof v[key] !== "string" || !re.test(v[key] as string)) errors.push(`bad ${key}`);
  };
  check("tool", TOOL);
  check("version", VERSION);
  check("week", WEEK);
  check("machine_id", MACHINE_ID);
  errors.push(...validateMetricsMap(v.metrics));
  return errors;
}

/** ISO-8601 week, such as 2026-W43. */
export function isoWeek(ms: number): string {
  const d = new Date(ms);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function metricsDir(home: string, tool = "agentbrew"): string {
  return join(home, ".local", "share", tool, "metrics");
}

function configPath(home: string): string {
  return join(home, ".config", "agentbrew", "metrics-share.json");
}

/** Random id, made once on this machine. Not derived from hardware or account. */
export function machineId(home: string): string {
  const file = join(metricsDir(home), "machine-id");
  if (existsSync(file)) {
    const id = readFileSync(file, "utf-8").trim();
    if (MACHINE_ID.test(id)) return id;
  }
  mkdirSync(metricsDir(home), { recursive: true });
  const id = randomBytes(16).toString("hex");
  writeFileSync(file, `${id}\n`, { mode: 0o600 });
  return id;
}

export function loadShareConfig(home: string): ShareConfig {
  try {
    return JSON.parse(readFileSync(configPath(home), "utf-8")) as ShareConfig;
  } catch {
    return {};
  }
}

function saveShareConfig(home: string, config: ShareConfig): void {
  mkdirSync(join(home, ".config", "agentbrew"), { recursive: true });
  writeFileSync(configPath(home), `${JSON.stringify(config, null, 2)}\n`);
}

export function parseSink(spec: string | undefined): Sink | undefined {
  if (!spec) return undefined;
  if (spec === "none") return { kind: "none" };
  const match = /^(dir|git):(.+)$/.exec(spec);
  if (!match) return undefined;
  return { kind: match[1] as "dir" | "git", path: match[2] };
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

interface Tally {
  syncMs: number[];
  syncOk: number;
  repairRuns: number;
  driftRepaired: number;
  commands: number;
  errors: Record<string, number>;
}

function parseEventRow(line: string, since: number, nowMs: number): Record<string, unknown> | undefined {
  try {
    const row = JSON.parse(line) as Record<string, unknown>;
    const ts = Date.parse(String(row.ts));
    return Number.isNaN(ts) || ts < since || ts > nowMs ? undefined : row;
  } catch {
    return undefined;
  }
}

function tallyEvent(t: Tally, row: Record<string, unknown>): void {
  switch (row.event) {
    case "sync":
      t.syncMs.push(Number(row.ms) || 0);
      if (row.ok === true) t.syncOk += 1;
      break;
    case "repair":
      t.repairRuns += 1;
      t.driftRepaired += Number(row.repaired) || 0;
      break;
    case "command":
      t.commands += 1;
      break;
    case "error":
      if (typeof row.story === "string" && /^US\d{2}$/.test(row.story)) {
        const key = `errors_${row.story.toLowerCase()}`;
        t.errors[key] = (t.errors[key] ?? 0) + 1;
      }
      break;
  }
}

/** agentbrew's own provider file, from the last 7 days of the event log. */
export function buildAgentbrewWeekly(ctx: ShareContext = {}): WeeklyMetrics {
  const home = ctx.home ?? homedir();
  const env = ctx.env ?? process.env;
  const nowMs = ctx.nowMs ?? Date.now();
  const file = env.AGENTBREW_EVENTS_FILE || join(home, ".local", "share", "agentbrew", "logs", "events.jsonl");
  const since = nowMs - 7 * DAY_MS;
  const t: Tally = { syncMs: [], syncOk: 0, repairRuns: 0, driftRepaired: 0, commands: 0, errors: {} };
  const lines = existsSync(file) ? readFileSync(file, "utf-8").split("\n") : [];
  for (const line of lines) {
    const row = parseEventRow(line, since, nowMs);
    if (row) tallyEvent(t, row);
  }
  const errorsTotal = Object.values(t.errors).reduce((x, y) => x + y, 0);
  const version = ctx.version && VERSION.test(ctx.version) ? ctx.version : "0.0.0";
  return {
    tool: "agentbrew",
    version,
    week: isoWeek(nowMs),
    machine_id: machineId(home),
    metrics: {
      sync_runs: t.syncMs.length,
      sync_ok_rate: t.syncMs.length ? Math.round((t.syncOk / t.syncMs.length) * 1000) / 1000 : 0,
      sync_p95_ms: p95(t.syncMs),
      repair_runs: t.repairRuns,
      drift_repaired: t.driftRepaired,
      commands_run: t.commands,
      errors_total: errorsTotal,
      ...t.errors,
    },
  };
}

export function writeProviderFile(data: WeeklyMetrics, home: string): string {
  const dir = metricsDir(home, data.tool);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `weekly-${data.week}.json`);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return undefined;
  }
}

function providerPaths(share: string): string[] {
  const paths: string[] = [];
  for (const tool of readdirSync(share)) {
    const dir = join(share, tool, "metrics");
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (/^weekly-[0-9]{4}-W[0-9]{2}\.json$/.test(name)) paths.push(join(dir, name));
    }
  }
  return paths;
}

/** Every provider file under ~/.local/share/<tool>/metrics/. Invalid files are never sent. */
export function collectProviderFiles(home: string): {
  valid: { path: string; data: WeeklyMetrics }[];
  invalid: { path: string; errors: string[] }[];
} {
  const valid: { path: string; data: WeeklyMetrics }[] = [];
  const invalid: { path: string; errors: string[] }[] = [];
  const share = join(home, ".local", "share");
  if (!existsSync(share)) return { valid, invalid };
  for (const path of providerPaths(share)) {
    const data = readJson(path);
    const errors = data === undefined ? ["not JSON"] : validateWeeklyMetrics(data);
    if (errors.length) invalid.push({ path, errors });
    else valid.push({ path, data: data as WeeklyMetrics });
  }
  return { valid, invalid };
}

function deliver(sink: Sink, payload: WeeklyMetrics[], env: NodeJS.ProcessEnv, week: string): number {
  if (sink.kind === "none") return 0;
  const written: string[] = [];
  for (const data of payload) {
    const dir = join(sink.path, data.tool, data.machine_id);
    mkdirSync(dir, { recursive: true });
    const rel = join(data.tool, data.machine_id, `weekly-${data.week}.json`);
    writeFileSync(join(sink.path, rel), `${JSON.stringify(data, null, 2)}\n`);
    written.push(rel);
  }
  if (sink.kind === "git" && written.length) {
    const opts = { cwd: sink.path, env: { ...process.env, ...env }, stdio: "pipe" as const };
    execFileSync("git", ["add", "--", ...written], opts);
    execFileSync(
      "git",
      [
        "-c",
        "user.name=agentbrew",
        "-c",
        "user.email=agentbrew@users.noreply.github.com",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        `metrics: agentbrew weekly share ${week}`,
      ],
      opts,
    );
  }
  return written.length;
}

export interface ShareOptions extends ShareContext {
  /** Sink spec; wins over AGENTBREW_METRICS_SINK and the saved config. Saved when given. */
  sink?: string;
  /** Force (true) or skip (false) the dry run. Default: dry run until reviewed. */
  dryRun?: boolean;
  /** Save a schedule: `weekly` or `off`. */
  schedule?: "weekly" | "off";
}

export interface ShareResult {
  dryRun: boolean;
  payload: WeeklyMetrics[];
  invalid: { path: string; errors: string[] }[];
  sent: number;
  sink?: Sink;
  message: string;
}

export function runShare(options: ShareOptions = {}): ShareResult {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  if (env.AGENTBREW_EVENTS === "0") {
    return { dryRun: true, payload: [], invalid: [], sent: 0, message: "Metrics are off (AGENTBREW_EVENTS=0)." };
  }
  const config = loadShareConfig(home);
  if (options.sink !== undefined) {
    if (!parseSink(options.sink))
      throw new Error(`Unknown sink "${options.sink}". Use dir:<path>, git:<path>, or none.`);
    config.sink = options.sink;
  }
  if (options.schedule) config.schedule = options.schedule;
  const dryRun = options.dryRun ?? !config.reviewed;

  writeProviderFile(buildAgentbrewWeekly({ home, env, nowMs, version: options.version }), home);
  const { valid, invalid } = collectProviderFiles(home);
  const payload = valid.map((v) => v.data);
  const sink = parseSink(config.sink) ?? parseSink(env.AGENTBREW_METRICS_SINK);

  if (dryRun) {
    config.reviewed = true;
    saveShareConfig(home, config);
    return { dryRun, payload, invalid, sent: 0, sink, message: "Dry run: nothing left this machine." };
  }
  saveShareConfig(home, config);
  if (!sink) {
    return {
      dryRun,
      payload,
      invalid,
      sent: 0,
      message: "No sink is set. Pass --sink dir:<path> or git:<path>, or set AGENTBREW_METRICS_SINK.",
    };
  }
  const sent = deliver(sink, payload, env, isoWeek(nowMs));
  return { dryRun, payload, invalid, sent, sink, message: `Sent ${sent} file(s) to the ${sink.kind} sink.` };
}

/**
 * Called by the scheduled `agentbrew fix`. Sends at most once per ISO week,
 * and only after the user opted in (`--schedule weekly`) and saw a dry run.
 */
export function maybeScheduledShare(ctx: ShareContext = {}): "off" | "already-sent" | "sent" | "failed" {
  const home = ctx.home ?? homedir();
  const env = ctx.env ?? process.env;
  if (env.AGENTBREW_EVENTS === "0") return "off";
  const config = loadShareConfig(home);
  if (config.schedule !== "weekly" || !config.reviewed) return "off";
  const week = isoWeek(ctx.nowMs ?? Date.now());
  if (config.lastWeek === week) return "already-sent";
  try {
    const result = runShare({ ...ctx, home, env, dryRun: false });
    if (!result.sink) return "failed";
    saveShareConfig(home, { ...loadShareConfig(home), lastWeek: week });
    return "sent";
  } catch (error) {
    logSkipped("metrics/weekly/maybeScheduledShare", error);
    return "failed";
  }
}
