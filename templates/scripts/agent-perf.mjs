#!/usr/bin/env node
// agent-perf.mjs — read the agent perf log that the perf-record hook writes.
//
// Log: ${XDG_STATE_HOME:-~/.local/state}/agentbrew/perf/YYYY-MM.jsonl
// Tool row: {"project","ts","sid","tool","ms","ok","key","id","agent"}
// Attempt row: {"project","ts","sid","ev":"attempt","tool","key","id","agent"}
//   ("bg": true on tool and attempt rows marks a background Agent or Task
//   launch. Its completion row comes when the worker ends, often in a later
//   turn, so the launch counts as ran unless a denied row names it, and the
//   worker's run time stays out of tool time, the ranking, and human wait.)
// Denied row: {"project","ts","sid","ev":"denied","tool","key","id","agent"}
// Turn row: {"project","ts","sid","ev":"turn"}
// "id" (tool_use_id) pairs an attempt with its completion. An attempt with
// no completion is a blocked call: it never ran (permission prompt, hook
// block, denial), or it is still running.
//
// Commands:
//   report [--project NAME | --all] [--days N] [--session ID|latest] [--json]
//   brief [--project NAME]
//   statusline            (reads Claude Code status-line JSON on stdin)
//   turn --session ID [--json]
//
// Totals count main-thread rows only (agent is null). A subagent's own tool
// calls run inside its Agent call, so adding them would count time twice.
// Per-step stats include every row. Human wait (a prompt, a question, a call
// over 30 min) is kept apart from tool time. No dependencies; Node 20+.

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DAY_MS = 86_400_000;

export function perfDir(env = process.env) {
  const state = env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(state, "agentbrew", "perf");
}

function monthKey(date) {
  return date.toISOString().slice(0, 7);
}

/** Month file names that can hold rows newer than `sinceMs`. */
export function monthFilesSince(dir, sinceMs, nowMs = Date.now()) {
  if (!existsSync(dir)) return [];
  const first = monthKey(new Date(sinceMs));
  const last = monthKey(new Date(nowMs));
  return readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}\.jsonl$/.test(name))
    .filter((name) => name.slice(0, 7) >= first && name.slice(0, 7) <= last)
    .sort()
    .map((name) => join(dir, name));
}

export function parseRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === "object") rows.push(row);
    } catch {
      // A torn or foreign line is skipped, never fatal.
    }
  }
  return rows;
}

export function loadRows(dir, sinceMs, nowMs = Date.now()) {
  const rows = [];
  for (const file of monthFilesSince(dir, sinceMs, nowMs)) {
    for (const row of parseRows(readFileSync(file, "utf8"))) {
      const t = Date.parse(row.ts);
      if (Number.isFinite(t) && t >= sinceMs && t <= nowMs) rows.push(row);
    }
  }
  return rows;
}

/** Rows of one session, found by substring before JSON.parse (fast on big files). */
export function sessionRowsFromText(text, sid) {
  const needle = `"sid":"${sid}"`;
  const rows = [];
  let at = text.indexOf(needle);
  while (at !== -1) {
    const start = text.lastIndexOf("\n", at) + 1;
    let end = text.indexOf("\n", at);
    if (end === -1) end = text.length;
    try {
      rows.push(JSON.parse(text.slice(start, end)));
    } catch {
      // Skip a torn line.
    }
    at = text.indexOf(needle, end);
  }
  return rows;
}

function sessionRows(dir, sid, nowMs = Date.now()) {
  const files = monthFilesSince(dir, nowMs - 31 * DAY_MS, nowMs);
  return files.flatMap((file) => sessionRowsFromText(readFileSync(file, "utf8"), sid));
}

const isToolRow = (row) => typeof row.ms === "number" && row.ev !== "turn";
/** A background agent's completion row: its ms is the worker's run, not tool time. */
const isBackground = (row) => row.bg === true;
const isMainThread = (row) => row.agent === null || row.agent === undefined;
const hasId = (row) => typeof row.id === "string" && row.id !== "";

/**
 * A call that ran this long waited on a person: a prompt inside the tool
 * (such as a browser site approval), a sleep, or a hang. No real step in the
 * log runs this long (Bash stops at 10 min), so its time is human wait.
 */
export const LONG_CALL_MS = 30 * 60_000;
/**
 * A gap this long from the attempt row to the start of the run is a
 * permission prompt or a question. duration_ms leaves this gap out. Shorter
 * gaps are other hooks and queued parallel calls.
 */
export const PROMPT_WAIT_MS = 60_000;

const isLongCall = (row) => row.ms >= LONG_CALL_MS;

/**
 * Calls that waited on a person, kept apart from tool time. "prompt": the
 * run started PROMPT_WAIT_MS or more after the attempt row; the wait was
 * never in duration_ms. "over 30 min": the call ran LONG_CALL_MS or more;
 * summarize() takes its whole time out of tool time and the step ranking.
 * Counts every row, subagent rows too.
 */
export function humanWaits(rows) {
  const triedAt = new Map();
  for (const row of rows) {
    if (row.ev !== "attempt" || !hasId(row)) continue;
    const call = `${row.sid}\u0000${row.id}`;
    const t = Date.parse(row.ts);
    if (Number.isFinite(t) && !triedAt.has(call)) triedAt.set(call, t);
  }
  const waits = [];
  for (const row of rows) {
    if (!isToolRow(row) || isBackground(row)) continue;
    const start = hasId(row) ? triedAt.get(`${row.sid}\u0000${row.id}`) : undefined;
    const end = Date.parse(row.ts);
    const gap = start === undefined || !Number.isFinite(end) ? 0 : end - row.ms - start;
    const prompt = gap >= PROMPT_WAIT_MS;
    const long = isLongCall(row);
    if (!prompt && !long) continue;
    waits.push({
      ts: row.ts,
      key: row.key || row.tool || "unknown",
      ms: (prompt ? gap : 0) + (long ? row.ms : 0),
      reason: [prompt && "prompt", long && "over 30 min"].filter(Boolean).join(" + "),
      project: row.project,
      sid: row.sid,
      agent: row.agent ?? null,
    });
  }
  waits.sort((a, b) => b.ms - a.ms);
  return {
    calls: waits.length,
    ms: waits.reduce((total, w) => total + w.ms, 0),
    promptCalls: waits.filter((w) => w.reason.includes("prompt")).length,
    longCalls: waits.filter((w) => w.reason.includes("over 30 min")).length,
    longest: waits.slice(0, 10),
  };
}

/**
 * Pair attempt rows with completion rows by session and id.
 * attempts: calls with an attempt or denied row. callsWithId: calls with any
 * row that has an id. blocked: attempts with no
 * completion row. captureRate: share of calls with an id (any row) that have
 * an attempt row; null when no row has an id. Rows without an id (written
 * before ids existed) take no part.
 * `pairRows` (default `rows`) is where the other half of a call is looked
 * up. A Bash `cd <other repo> && …` writes its attempt row under one project
 * and its completion row under another, so a per-project view passes every
 * loaded row here; each call still counts under the project of its own row.
 */
export function pairCalls(rows, pairRows = rows) {
  const tried = new Map();
  const seen = new Set();
  for (const row of rows) {
    if (!hasId(row)) continue;
    const call = `${row.sid}\u0000${row.id}`;
    if (row.ev === "attempt" || row.ev === "denied") {
      seen.add(call);
      const prev = tried.get(call);
      tried.set(call, { key: prev?.key ?? row.key ?? row.tool ?? "unknown" });
    } else if (isToolRow(row)) {
      seen.add(call);
    }
  }
  const done = new Set();
  const attempted = new Set();
  const launched = new Set();
  const denied = new Set();
  for (const row of pairRows) {
    if (!hasId(row)) continue;
    const call = `${row.sid}\u0000${row.id}`;
    if (row.ev === "attempt") {
      attempted.add(call);
      if (row.bg === true) launched.add(call);
    } else if (row.ev === "denied") denied.add(call);
    else if (isToolRow(row)) done.add(call);
  }
  // A background launch ran unless it was denied.
  for (const call of launched) if (!denied.has(call)) done.add(call);
  const byKey = new Map();
  let blocked = 0;
  let recorded = 0;
  for (const call of seen) if (attempted.has(call)) recorded += 1;
  for (const [call, { key }] of tried) {
    if (done.has(call)) continue;
    blocked += 1;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  const blockedKeys = [...byKey.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return {
    attempts: tried.size,
    callsWithId: seen.size,
    blocked,
    blockedKeys,
    captureRate: seen.size === 0 ? null : recorded / seen.size,
  };
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function formatMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 10) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

/**
 * Aggregate rows: totals (main thread), per-key stats, slowest calls,
 * failures, human wait. `pairRows` goes to pairCalls.
 */
export function summarize(rows, pairRows = rows) {
  // A call over 30 min is human wait, not tool time (see humanWaits).
  const tools = rows.filter((row) => isToolRow(row) && !isLongCall(row) && !isBackground(row));
  const main = tools.filter(isMainThread);
  const byKey = new Map();
  for (const row of tools) {
    const key = row.key || row.tool || "unknown";
    const entry = byKey.get(key) ?? { key, durations: [], failures: 0 };
    entry.durations.push(row.ms);
    if (row.ok === false) entry.failures += 1;
    byKey.set(key, entry);
  }
  const keys = [...byKey.values()].map(({ key, durations, failures }) => {
    durations.sort((a, b) => a - b);
    const sum = durations.reduce((total, ms) => total + ms, 0);
    return {
      key,
      count: durations.length,
      sumMs: sum,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      maxMs: durations[durations.length - 1],
      failures,
    };
  });
  keys.sort((a, b) => b.sumMs - a.sumMs || a.key.localeCompare(b.key));
  const slowest = [...tools]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 10)
    .map((row) => ({ ts: row.ts, key: row.key, ms: row.ms, project: row.project, sid: row.sid, ok: row.ok !== false }));
  return {
    toolMs: main.reduce((total, row) => total + row.ms, 0),
    calls: main.length,
    subagentCalls: tools.length - main.length,
    failures: main.filter((row) => row.ok === false).length,
    keys,
    topKeys: keys.slice(0, 5),
    slowest,
    failuresByKey: keys.filter((k) => k.failures > 0).map((k) => ({ key: k.key, failures: k.failures, count: k.count })),
    humanWait: humanWaits(rows),
    ...pairCalls(rows, pairRows),
  };
}

function pctChange(now, before) {
  if (!before) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

/** Project name for a directory: git repo name, with a linked worktree mapped to its main repo. */
export function projectForDir(cwd) {
  let dir = cwd;
  while (dir && dir !== "/" && dir !== ".") {
    const git = join(dir, ".git");
    try {
      const st = statSync(git);
      if (st.isDirectory()) return sanitizeProject(basename(dir));
      const line = readFileSync(git, "utf8").split("\n")[0].replace(/^gitdir: /, "");
      const marker = line.indexOf("/.git/worktrees/");
      return sanitizeProject(basename(marker === -1 ? dir : line.slice(0, marker)));
    } catch {
      // No .git here; go up.
    }
    dir = dirname(dir);
  }
  return sanitizeProject(basename(cwd));
}

function sanitizeProject(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, "_") || "unknown";
}

export function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json" || arg === "--all") opts[arg.slice(2)] = true;
    else if (["--project", "--days", "--session", "--cwd"].includes(arg)) opts[arg.slice(2)] = argv[++i];
    else opts._.push(arg);
  }
  return opts;
}

/** Build the `report` object. */
export function buildReport(opts, { dir = perfDir(), nowMs = Date.now(), cwd = process.cwd() } = {}) {
  const days = Number(opts.days) > 0 ? Number(opts.days) : 7;
  const project = opts.all ? null : opts.project || projectForDir(opts.cwd || cwd);
  const filterProject = (rows) => (project ? rows.filter((row) => row.project === project) : rows);

  // Pair calls on every loaded row, not only this project's (see pairCalls).
  if (opts.session) {
    const loaded = loadRows(dir, nowMs - Math.max(days, 31) * DAY_MS, nowMs);
    const scan = filterProject(loaded);
    let sid = opts.session;
    if (sid === "latest") {
      const last = [...scan].reverse().find((row) => row.sid);
      sid = last?.sid ?? null;
    }
    const rows = sid ? scan.filter((row) => row.sid === sid) : [];
    const pairRows = sid ? loaded.filter((row) => row.sid === sid) : [];
    return { scope: { project: project ?? "all", session: sid, days: null }, ...summarize(rows, pairRows) };
  }

  const sinceMs = nowMs - days * DAY_MS;
  const loaded = loadRows(dir, sinceMs - days * DAY_MS, nowMs);
  const all = filterProject(loaded);
  const current = all.filter((row) => Date.parse(row.ts) >= sinceMs);
  const previous = all.filter((row) => Date.parse(row.ts) < sinceMs);
  const now = summarize(current, loaded);
  const before = summarize(previous, loaded);
  const beforeByKey = new Map(before.keys.map((k) => [k.key, k]));
  return {
    scope: { project: project ?? "all", session: null, days, since: new Date(sinceMs).toISOString() },
    ...now,
    previous: {
      toolMs: before.toolMs,
      calls: before.calls,
      toolMsChangePct: pctChange(now.toolMs, before.toolMs),
      callsChangePct: pctChange(now.calls, before.calls),
    },
    topKeys: now.topKeys.map((k) => ({
      ...k,
      previousSumMs: beforeByKey.get(k.key)?.sumMs ?? 0,
      sumChangePct: pctChange(k.sumMs, beforeByKey.get(k.key)?.sumMs ?? 0),
    })),
  };
}

function signed(pct) {
  return pct === null ? "new" : `${pct > 0 ? "+" : ""}${pct}%`;
}

export function formatReport(report) {
  const { scope } = report;
  // Session mode has days: null. "latest" resolves to no session id when no row is in scope.
  const where = scope.days === null ? `session ${scope.session ?? "latest (none found)"}` : `last ${scope.days}d`;
  const lines = [`Agent time — ${scope.project}, ${where}`];
  const wait = report.humanWait ?? { calls: 0 };
  if (report.calls === 0 && report.keys.length === 0 && !report.attempts && !wait.calls) {
    lines.push("No tool rows yet.");
    return lines.join("\n");
  }
  lines.push(
    `Tool time: ${formatMs(report.toolMs)} over ${report.calls} main-thread calls (${report.failures} failed, ${report.subagentCalls} subagent calls).`,
  );
  if (report.previous) {
    lines.push(
      `Previous ${scope.days}d: ${formatMs(report.previous.toolMs)} over ${report.previous.calls} calls (time ${signed(report.previous.toolMsChangePct)}).`,
    );
  }
  if (report.attempts > 0) {
    const capture = report.captureRate === null ? "n/a" : `${Math.round(report.captureRate * 1000) / 10}%`;
    lines.push(
      `Blocked: ${report.blocked} of ${report.attempts} attempted calls never ran (capture ${capture} of ${report.callsWithId} calls with an id).`,
    );
  }
  if (wait.calls > 0) {
    lines.push(
      `Human wait: ${formatMs(wait.ms)} in ${wait.calls} ${wait.calls === 1 ? "call" : "calls"}, not in tool time or the step ranking (${wait.promptCalls} waited on a prompt before the run, ${wait.longCalls} ran over 30 min).`,
    );
  }
  lines.push("", "Top steps by total time:");
  for (const k of report.topKeys) {
    const change = k.sumChangePct === undefined ? "" : ` (${signed(k.sumChangePct)})`;
    lines.push(`  ${k.key}: ${formatMs(k.sumMs)} total, ${k.count}x, p50 ${formatMs(k.p50Ms)}, p95 ${formatMs(k.p95Ms)}${change}`);
  }
  lines.push("", "Slowest calls:");
  for (const row of report.slowest) {
    lines.push(`  ${formatMs(row.ms)}  ${row.key}  ${row.project ?? ""} ${row.ts ?? ""}${row.ok ? "" : " (failed)"}`);
  }
  if (wait.calls > 0) {
    lines.push("", "Human-wait calls (not in tool time):");
    for (const w of wait.longest) {
      lines.push(`  ${formatMs(w.ms)}  ${w.key}  ${w.reason}  ${w.project ?? ""} ${w.ts ?? ""}${w.agent ? ` (${w.agent})` : ""}`);
    }
  }
  if (report.blockedKeys?.length > 0) {
    lines.push("", "Blocked calls by step (no completion row):");
    for (const b of report.blockedKeys) lines.push(`  ${b.key}: ${b.count}`);
  }
  if (report.failuresByKey.length > 0) {
    lines.push("", "Failures by step:");
    for (const f of report.failuresByKey) lines.push(`  ${f.key}: ${f.failures} of ${f.count}`);
  }
  lines.push("", "All steps (count, total, p50, p95, max):");
  for (const k of report.keys) {
    lines.push(`  ${k.key}: ${k.count}, ${formatMs(k.sumMs)}, ${formatMs(k.p50Ms)}, ${formatMs(k.p95Ms)}, ${formatMs(k.maxMs)}`);
  }
  return lines.join("\n");
}

/** At most five lines for an agent at session start. Empty when there is no data. */
export function buildBrief(opts, ctx = {}) {
  const report = buildReport({ ...opts, days: 7, all: false }, ctx);
  if (report.keys.length === 0 && !report.attempts) return "";
  const top = report.topKeys.slice(0, 3).map((k) => `${k.key} ${formatMs(k.sumMs)} (${k.count}x, p50 ${formatMs(k.p50Ms)})`);
  const slow = report.slowest[0];
  const lines = [
    `Agent time, ${report.scope.project}, last 7 days: ${formatMs(report.toolMs)} of tool time over ${report.calls} calls.`,
    `Top steps: ${top.join(" · ")}.`,
  ];
  if (slow) lines.push(`Slowest single step: ${slow.key} ${formatMs(slow.ms)}.`);
  if (report.blocked > 0) {
    const top = report.blockedKeys[0];
    lines.push(
      `Blocked calls: ${report.blocked} never ran (top: ${top.key} ${top.count}x); split compound Bash commands and meet hook gates first to save a round trip each.`,
    );
  }
  // Keys are sorted by total time, so the first repeat that costs a minute is the best target.
  const candidate = report.keys.find((k) => k.count >= 3 && k.sumMs >= 60_000);
  if (candidate) {
    lines.push(
      `Speedup candidate: ${candidate.key} ran ${candidate.count}x at p50 ${formatMs(candidate.p50Ms)}; run a narrower or cached form while you iterate, and the full one once at the end.`,
    );
  }
  return lines.slice(0, 5).join("\n");
}

/** Tool time and slowest steps since the last turn row of one session. */
export function buildTurn(sid, { dir = perfDir(), nowMs = Date.now() } = {}) {
  const rows = sessionRows(dir, sid, nowMs);
  let lastTurn = -1;
  rows.forEach((row, index) => {
    if (row.ev === "turn") lastTurn = index;
  });
  const turnRows = rows.slice(lastTurn + 1);
  const summary = summarize(turnRows);
  return {
    session: sid,
    since: lastTurn >= 0 ? rows[lastTurn].ts : null,
    toolMs: summary.toolMs,
    calls: summary.calls,
    slowest: summary.slowest.slice(0, 3).map(({ key, ms, ok }) => ({ key, ms, ok })),
    topKeys: summary.topKeys.slice(0, 3).map(({ key, sumMs, count }) => ({ key, sumMs, count })),
    attempts: summary.attempts,
    blocked: summary.blocked,
    blockedKeys: summary.blockedKeys.slice(0, 5),
  };
}

// ── statusline: per-session cache so each refresh reads only new bytes ──

function readFrom(file, offset) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    if (size <= offset) return { text: "" };
    const buffer = Buffer.alloc(size - offset);
    readSync(fd, buffer, 0, buffer.length, offset);
    return { text: buffer.toString("utf8") };
  } finally {
    closeSync(fd);
  }
}

/** Session tool time and slowest step, read incrementally via a cache. */
export function sessionStats(sid, { dir = perfDir(), nowMs = Date.now() } = {}) {
  const safeSid = String(sid).replace(/[^A-Za-z0-9_-]/g, "");
  const empty = { toolMs: 0, slowKey: null, slowMs: 0 };
  if (!safeSid || !existsSync(dir)) return empty;
  const cacheDir = join(dir, ".cache");
  const cacheFile = join(cacheDir, `statusline-${safeSid}.json`);
  let cache = { files: {}, toolMs: 0, slowKey: null, slowMs: 0 };
  try {
    cache = { ...cache, ...JSON.parse(readFileSync(cacheFile, "utf8")) };
  } catch {
    // First refresh for this session.
  }
  for (const file of monthFilesSince(dir, nowMs - 31 * DAY_MS, nowMs)) {
    const name = basename(file);
    let from = cache.files[name] ?? 0;
    if (statSync(file).size < from) from = 0;
    const { text } = readFrom(file, from);
    // Only consume whole lines; a half-written row waits for the next refresh.
    const cut = text.lastIndexOf("\n") + 1;
    for (const row of sessionRowsFromText(text.slice(0, cut), safeSid)) {
      if (!isToolRow(row) || isLongCall(row) || isBackground(row)) continue;
      if (isMainThread(row)) cache.toolMs += row.ms;
      if (row.ms > cache.slowMs) {
        cache.slowMs = row.ms;
        cache.slowKey = row.key;
      }
    }
    cache.files[name] = from + Buffer.byteLength(text.slice(0, cut));
  }
  try {
    mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    writeFileSync(cacheFile, JSON.stringify(cache), { mode: 0o600 });
  } catch {
    // A read-only state dir only costs speed.
  }
  return { toolMs: cache.toolMs, slowKey: cache.slowKey, slowMs: cache.slowMs };
}

export function formatStatusline(input, stats) {
  const parts = [];
  const model = input?.model?.display_name;
  if (model) parts.push(model);
  const total = input?.cost?.total_duration_ms;
  const api = input?.cost?.total_api_duration_ms;
  if (typeof total === "number") {
    const inner = [];
    if (typeof api === "number") inner.push(`api ${formatMs(api)}`);
    inner.push(`tools ${formatMs(stats.toolMs)}`);
    parts.push(`${formatMs(total)} (${inner.join(" · ")})`);
  } else if (stats.toolMs > 0) {
    parts.push(`tools ${formatMs(stats.toolMs)}`);
  }
  if (stats.slowKey) parts.push(`slowest: ${stats.slowKey} ${formatMs(stats.slowMs)}`);
  const ctx = input?.context_window?.used_percentage;
  if (typeof ctx === "number") parts.push(`ctx ${Math.round(ctx)}%`);
  return parts.join(" · ");
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const USAGE = `Usage: agent-perf.mjs <command> [options]
  report [--project NAME | --all] [--days N] [--session ID|latest] [--json]
  brief [--project NAME]
  statusline              (reads Claude Code status-line JSON on stdin)
  turn --session ID [--json]`;

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const command = opts._[0];
  if (command === "report") {
    const report = buildReport(opts);
    process.stdout.write(`${opts.json ? JSON.stringify(report, null, 2) : formatReport(report)}\n`);
    return 0;
  }
  if (command === "brief") {
    const brief = buildBrief(opts);
    if (brief) process.stdout.write(`${brief}\n`);
    return 0;
  }
  if (command === "statusline") {
    let input = {};
    try {
      input = JSON.parse(readStdin() || "{}");
    } catch {
      input = {};
    }
    let stats = { toolMs: 0, slowKey: null, slowMs: 0 };
    try {
      if (input.session_id) stats = sessionStats(input.session_id);
    } catch {
      // The status line must always print something.
    }
    process.stdout.write(`${formatStatusline(input, stats)}\n`);
    return 0;
  }
  if (command === "turn") {
    if (!opts.session) {
      process.stderr.write("turn needs --session ID\n");
      return 2;
    }
    const turn = buildTurn(opts.session);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(turn)}\n`);
    } else {
      const steps = turn.slowest.map((s) => `${s.key} ${formatMs(s.ms)}`).join(", ") || "none";
      process.stdout.write(`This turn: ${formatMs(turn.toolMs)} of tool time over ${turn.calls} calls. Slowest: ${steps}.\n`);
    }
    return 0;
  }
  process.stderr.write(`${USAGE}\n`);
  return command === undefined || command === "help" || command === "--help" ? 0 : 2;
}

function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = main();
}
