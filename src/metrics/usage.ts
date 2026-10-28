/**
 * `agentbrew metrics`: one local report of what agentbrew does on this
 * machine. It reads three local logs that agentbrew already writes and
 * uploads nothing:
 *   - the agent perf log (perf-record hooks) through agent-perf.mjs,
 *   - the hook decision log (~/.cache/agentbrew/hook-decisions.jsonl),
 *   - the MCP health snapshot (~/.cache/agentbrew/mcp-health.json).
 *
 * `--share` renders a Markdown snapshot that a user can paste into an issue
 * or PR. It holds only aggregates: no project names, paths, session ids,
 * prompts, or hook reasons.
 */
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { homedir, platform, release } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { logSkipped } from "../core/logger.js";
import { HELPER_SCRIPTS_DIR } from "../paths.js";
import { expandHome } from "../utils.js";

const DAY_MS = 86_400_000;
/** Read at most this much of the end of the hook log; it grows to tens of MB. */
const HOOK_LOG_TAIL_BYTES = 32 * 1024 * 1024;

export interface StepStat {
  key: string;
  count: number;
  sumMs: number;
  p50Ms: number;
  failures: number;
}

export interface HookStat {
  hookId: string;
  block: number;
  warn: number;
  other: number;
}

export interface UsageMetrics {
  days: number;
  generatedAt: string;
  agentbrewVersion: string;
  platform: string;
  node: string;
  agentTime: {
    available: boolean;
    toolMs: number;
    calls: number;
    failures: number;
    blockedCalls: number;
    topSteps: StepStat[];
  };
  hooks: { available: boolean; decisions: number; blocks: number; warns: number; top: HookStat[] };
  mcp: { available: boolean; ok: number; failing: number; failingNames: string[] };
}

export interface CollectOptions {
  days?: number;
  home?: string;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  version?: string;
  /** Override where agent-perf.mjs is loaded from (tests). */
  perfScript?: string;
}

interface PerfModule {
  buildReport: (opts: Record<string, unknown>, ctx?: { dir?: string; nowMs?: number }) => Record<string, unknown>;
}

/** Where agent-perf.mjs may live: the synced helper copy, then the package's own. */
export function perfScriptCandidates(home: string): string[] {
  return [
    join(expandHome(HELPER_SCRIPTS_DIR).replace(homedir(), home), "agent-perf.mjs"),
    join(import.meta.dirname, "templates", "scripts", "agent-perf.mjs"),
    join(import.meta.dirname, "..", "templates", "scripts", "agent-perf.mjs"),
    join(import.meta.dirname, "..", "..", "templates", "scripts", "agent-perf.mjs"),
  ];
}

async function collectAgentTime(
  opts: Required<Pick<CollectOptions, "days" | "home" | "env" | "nowMs">> & CollectOptions,
) {
  const empty = { available: false, toolMs: 0, calls: 0, failures: 0, blockedCalls: 0, topSteps: [] as StepStat[] };
  const script = opts.perfScript ?? perfScriptCandidates(opts.home).find((path) => existsSync(path));
  if (!script) return empty;
  try {
    const mod = (await import(pathToFileURL(script).href)) as PerfModule;
    // Same layout as agent-perf.mjs perfDir(), but rooted at the given home.
    const stateHome = opts.env.XDG_STATE_HOME || join(opts.home, ".local", "state");
    const dir = join(stateHome, "agentbrew", "perf");
    if (!existsSync(dir)) return empty;
    const report = mod.buildReport({ all: true, days: opts.days }, { dir, nowMs: opts.nowMs });
    const keys = (report.keys as StepStat[] | undefined) ?? [];
    return {
      available: true,
      toolMs: Number(report.toolMs) || 0,
      calls: Number(report.calls) || 0,
      failures: Number(report.failures) || 0,
      blockedCalls: Number(report.blocked) || 0,
      topSteps: keys
        .slice(0, 10)
        .map(({ key, count, sumMs, p50Ms, failures }) => ({ key, count, sumMs, p50Ms, failures })),
    };
  } catch (error) {
    logSkipped("metrics/usage/collectAgentTime", error);
    return empty;
  }
}

function readTail(path: string, maxBytes: number): string {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString("utf-8");
    // Drop a partial first line when the read started mid-file.
    return length < size ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    closeSync(fd);
  }
}

interface HookRow {
  hookId: string;
  decision?: string;
}

/**
 * One hook-log line inside the window, or undefined. Rows without a
 * sessionId come from fixture runs or hook tests, not a real agent
 * session, so they are skipped.
 */
function parseHookRow(line: string, sinceMs: number): HookRow | undefined {
  if (!line) return undefined;
  try {
    const row = JSON.parse(line) as { timestamp?: string; hookId?: string; decision?: string; sessionId?: string };
    const ts = Date.parse(row.timestamp ?? "");
    if (!row.hookId || !row.sessionId || Number.isNaN(ts) || ts < sinceMs) return undefined;
    return { hookId: row.hookId, decision: row.decision };
  } catch {
    return undefined;
  }
}

export function collectHookStats(path: string, sinceMs: number): UsageMetrics["hooks"] {
  if (!existsSync(path)) return { available: false, decisions: 0, blocks: 0, warns: 0, top: [] };
  const byHook = new Map<string, HookStat>();
  let decisions = 0;
  for (const line of readTail(path, HOOK_LOG_TAIL_BYTES).split("\n")) {
    const row = parseHookRow(line, sinceMs);
    if (!row) continue;
    decisions += 1;
    const stat = byHook.get(row.hookId) ?? { hookId: row.hookId, block: 0, warn: 0, other: 0 };
    if (row.decision === "block") stat.block += 1;
    else if (row.decision === "warn") stat.warn += 1;
    else stat.other += 1;
    byHook.set(row.hookId, stat);
  }
  const stats = [...byHook.values()];
  const top = stats
    .filter((s) => s.block + s.warn > 0)
    .sort((a, b) => b.block - a.block || b.warn - a.warn || a.hookId.localeCompare(b.hookId))
    .slice(0, 10);
  return {
    available: true,
    decisions,
    blocks: stats.reduce((n, s) => n + s.block, 0),
    warns: stats.reduce((n, s) => n + s.warn, 0),
    top,
  };
}

export function collectMcpHealth(path: string): UsageMetrics["mcp"] {
  if (!existsSync(path)) return { available: false, ok: 0, failing: 0, failingNames: [] };
  try {
    const snapshot = JSON.parse(readFileSync(path, "utf-8")) as { servers?: { name: string; status: string }[] };
    const servers = snapshot.servers ?? [];
    const failing = servers.filter((s) => s.status !== "ok");
    return {
      available: true,
      ok: servers.length - failing.length,
      failing: failing.length,
      failingNames: [...new Set(failing.map((s) => s.name))].sort(),
    };
  } catch (error) {
    logSkipped("metrics/usage/collectMcpHealth", error);
    return { available: false, ok: 0, failing: 0, failingNames: [] };
  }
}

export async function collectUsageMetrics(options: CollectOptions = {}): Promise<UsageMetrics> {
  const days = options.days && options.days > 0 ? options.days : 7;
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const cacheDir = join(home, ".cache", "agentbrew");
  return {
    days,
    generatedAt: new Date(nowMs).toISOString(),
    agentbrewVersion: options.version ?? "unknown",
    platform: `${platform()} ${release()}`,
    node: process.versions.node,
    agentTime: await collectAgentTime({ ...options, days, home, env, nowMs }),
    hooks: collectHookStats(join(cacheDir, "hook-decisions.jsonl"), nowMs - days * DAY_MS),
    mcp: collectMcpHealth(join(cacheDir, "mcp-health.json")),
  };
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

/** Plain-text report for the terminal. */
export function renderUsageText(m: UsageMetrics): string {
  const lines = [`agentbrew metrics — last ${m.days} days (local only, nothing is uploaded)`, ""];
  if (m.agentTime.available) {
    lines.push(
      `Agent tool time: ${fmtDuration(m.agentTime.toolMs)} over ${m.agentTime.calls} calls` +
        ` (${m.agentTime.failures} failed, ${m.agentTime.blockedCalls} never ran)`,
    );
    for (const step of m.agentTime.topSteps.slice(0, 5)) {
      lines.push(`  ${step.key}: ${fmtDuration(step.sumMs)} (${step.count}x, p50 ${fmtDuration(step.p50Ms)})`);
    }
  } else {
    lines.push("Agent tool time: no data yet (the perf-record hooks write it; run `agentbrew sync`).");
  }
  lines.push("");
  if (m.hooks.available) {
    lines.push(`Hook decisions: ${m.hooks.decisions} (${m.hooks.blocks} blocked, ${m.hooks.warns} warned)`);
    for (const hook of m.hooks.top.slice(0, 5)) {
      lines.push(`  ${hook.hookId}: ${hook.block} blocked, ${hook.warn} warned`);
    }
  } else {
    lines.push("Hook decisions: no data yet.");
  }
  lines.push("");
  if (m.mcp.available) {
    lines.push(
      `MCP servers: ${m.mcp.ok} healthy, ${m.mcp.failing} failing` +
        (m.mcp.failingNames.length ? ` (${m.mcp.failingNames.join(", ")})` : ""),
    );
  } else {
    lines.push("MCP servers: no health snapshot yet (`agentbrew status` writes one).");
  }
  lines.push("", "Share a privacy-safe snapshot: agentbrew metrics --share metrics.md");
  return lines.join("\n");
}

/**
 * Step key for the share snapshot. The perf hook already turns arguments into
 * `<arg>`/`<path>`, but a script or file name can still name a private
 * project, so keep only plain command words (at most three).
 */
export function shareStepKey(key: string): string {
  const words: string[] = [];
  for (const token of key.split(/\s+/).slice(0, 3)) {
    words.push(/^(<arg>|<path>|-{0,2}[a-z][a-z0-9-]*)$/.test(token) ? token : "<arg>");
  }
  return words.join(" ") || "<arg>";
}

function shareSteps(steps: StepStat[]): StepStat[] {
  const merged = new Map<string, StepStat>();
  for (const step of steps) {
    const key = shareStepKey(step.key);
    const entry = merged.get(key) ?? { key, count: 0, sumMs: 0, p50Ms: 0, failures: 0 };
    entry.count += step.count;
    entry.sumMs += step.sumMs;
    entry.failures += step.failures;
    merged.set(key, entry);
  }
  return [...merged.values()].sort((a, b) => b.sumMs - a.sumMs);
}

/** Hook ids from agentbrew's canonical manifest; other ids may be private overlay hooks. */
export function loadPublicHookIds(): Set<string> | undefined {
  for (const root of [join(import.meta.dirname, ".."), join(import.meta.dirname, "..", "..")]) {
    const path = join(root, "hooks", "manifest.yaml");
    if (!existsSync(path)) continue;
    const ids = [...readFileSync(path, "utf-8").matchAll(/^\s+- id:\s*([a-z0-9-]+)\s*$/gm)].map((m) => m[1]);
    if (ids.length) return new Set(ids);
  }
  return undefined;
}

/**
 * Markdown snapshot for an issue or PR. Aggregates only. It never includes a
 * project name, path, session id, prompt, hook reason, MCP server name, or a
 * hook id outside agentbrew's own manifest (an org overlay may name private
 * systems).
 */
export function renderUsageShare(
  m: UsageMetrics,
  publicHookIds: Set<string> | undefined = loadPublicHookIds(),
): string {
  const lines = [
    `## agentbrew metrics snapshot (${m.days} days)`,
    "",
    `- agentbrew ${m.agentbrewVersion}, node ${m.node}, ${m.platform}`,
    `- Generated ${m.generatedAt.slice(0, 10)}`,
    "",
    "### Agent tool time",
    "",
  ];
  if (m.agentTime.available) {
    lines.push(
      `${fmtDuration(m.agentTime.toolMs)} over ${m.agentTime.calls} calls; ${m.agentTime.failures} failed; ${m.agentTime.blockedCalls} never ran.`,
      "",
      "| Step | Calls | Total | Failed |",
      "|---|---|---|---|",
      ...shareSteps(m.agentTime.topSteps).map(
        (s) => `| \`${s.key}\` | ${s.count} | ${fmtDuration(s.sumMs)} | ${s.failures} |`,
      ),
    );
  } else {
    lines.push("No data.");
  }
  lines.push("", "### Hooks", "");
  if (m.hooks.available) {
    lines.push(
      `${m.hooks.decisions} decisions; ${m.hooks.blocks} blocked; ${m.hooks.warns} warned.`,
      "",
      "| Hook | Blocked | Warned |",
      "|---|---|---|",
      ...shareHooks(m.hooks.top, publicHookIds).map((h) => `| \`${h.hookId}\` | ${h.block} | ${h.warn} |`),
    );
  } else {
    lines.push("No data.");
  }
  lines.push("", "### MCP servers", "");
  lines.push(m.mcp.available ? `${m.mcp.ok} healthy; ${m.mcp.failing} failing.` : "No data.");
  return `${lines.join("\n")}\n`;
}

function shareHooks(top: HookStat[], publicIds: Set<string> | undefined): HookStat[] {
  const out: HookStat[] = [];
  const other: HookStat = { hookId: "(other hooks)", block: 0, warn: 0, other: 0 };
  for (const hook of top) {
    if (publicIds?.has(hook.hookId)) out.push(hook);
    else {
      other.block += hook.block;
      other.warn += hook.warn;
    }
  }
  if (other.block + other.warn > 0) out.push(other);
  return out;
}
