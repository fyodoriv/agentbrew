#!/usr/bin/env node
// <!-- scope: human-approved owner goal 2026-11-09 (tooling changes must not make tracked commands slower); this file is that gate -->
// perf-gate: fail when a tracked command got slower than the merge-base.
//
// The gate times each command in scripts/perf-budget.tsv in two trees in the
// same run: this working tree (head) and a clean checkout of the merge-base
// with the default branch (base). It needs no stored baseline, so it gives the
// same verdict on any machine.
//
// A command fails when
//   head_min > base_min * 1.10  AND  head_min - base_min > 3 ms, AND the
//   paired runs agree (see "Timing choices")                      (slower), or
//   head_min > its ceiling in the budget file, while base_min is
//   not above it in the same run                                  (over-ceiling).
// When base_min is above the ceiling too, the command passes with the verdict
// over-ceiling-at-base, and the summary line counts it.
// A command whose file does not exist at the base commit is "new": only the
// ceiling applies. Any other problem on the base side is a setup error.
//
// Usage: node scripts/perf-gate.mjs [--json] [--force]     (npm run perf:gate)
//   --json   print one JSON object (per command: base_min, head_min, ratio,
//            paired_delta_ms, over_ceiling_at_base, verdict; and problems)
//   --force  time the commands even when the diff touches no runtime path
// Exit: 0 pass or skipped, 1 a command is slower or over its ceiling, 2 setup error.
//
// Env:
//   PERF_GATE_BASE       ref to compare with (default: origin's default branch)
//   PERF_GATE_NO_BASE    1 = when no base commit resolves, check the ceilings only
//   PERF_GATE_RUNS       timed runs per tree (default 15)
//   PERF_GATE_WARMUPS    untimed runs per tree first (default 2)
//   PERF_GATE_HEAVY_RUN  0 = never call heavy-run (tests)
//   PERF_GATE_LOCK_WAIT  seconds to wait for the cache lock (default 900)
//   PERF_GATE_SAMPLES    file that gets one JSON line per command with every
//                        timed [base, head] pair in ms (to study the noise)
//
// Timing choices:
// - One node process starts every run of both trees with spawnSync and reads
//   process.hrtime.bigint() around it. Base and head runs are interleaved
//   (B H H B ...), so both see the same machine load.
// - The minimum of the runs, not the mean: noise only adds time, so the
//   minimum is the most stable estimate (Chen and Revels 2016).
// - The two minimums alone gave false alarms on a loaded machine (two clean
//   PRs failed inside `heavy-run npm run verify` at load 10 to 14): one tree
//   can get a quiet run that the other never gets. So "slower" also needs the
//   paired runs to agree. Each pass times base and head back to back; that is
//   one pair. The median of (head - base) over the pairs must be above the
//   same limit (10% of base_min, and 3 ms). Load hits both runs of a pair
//   alike, so the median difference of a clean tree stays near zero, and a
//   real slowdown shifts every pair (paired comparison: Box, Hunter and Hunter 2005).
// - A command that looks slower is timed again (up to two more rounds) and the
//   runs are merged. A real slowdown stays; a load spike does not.
// - A final confirm in `heavy-run --exclusive` is not possible from inside a
//   heavy-run slot: the exclusive run waits for every slot, and this gate
//   holds one.
// - The base is a detached git worktree under
//   ~/.cache/agentbrew/perf-gate.noindex/<commit>, built once (PERF_GATE_BUILD
//   in the budget file) under a lock. This one, the newest other one, and
//   any used in the last hour are kept. The gate removes only its own
//   worktrees.
// - No silent pass: no base commit, a base checkout at another commit, a
//   failed base build, or a command that fails at the base all exit 2.
// - The head budget file does not decide its own scope: the runtime paths are
//   the union of the base and head lists, and a row that the base has cannot
//   leave the file without an allow line.
// - A PR that changes this script needs PERF_GATE_ALLOW=perf-gate:<reason> in
//   the budget file: the changed script judges its own PR, so a reviewer must
//   see that.
// - An allow line counts when the base budget file does not have the same
//   line (same name and same reason). A line that the base has unchanged is
//   stale: the gate stops before any timing and names the line to remove.
//   The skip comes first: a diff with no runtime path still skips, with a
//   note, so a docs-only PR does not have to edit the budget file.
// - Cache cleanup never follows a symlink (it unlinks it) and removes a
//   folder only when the gate's own marker (<commit>.ready, or
//   <commit>.building of a build that did not end) says the gate made it.
// - This tree is rebuilt first when its build output is older than a build
//   input, so the gate never times a stale dist/.
// - Every run gets a small fixed environment (PATH, a scratch HOME, TMPDIR,
//   AGENTBREW_EVENTS=0, AGENTBREW_TELEMETRY=0, DO_NOT_TRACK=1, and
//   AGENTBREW_EVENTS_FILE in the scratch HOME), so no event, telemetry, or hook log
//   reaches the real HOME.
// - Timing runs through `heavy-run --exclusive` when heavy-run is on PATH.
//   Inside a heavy-run slot (HEAVY_RUN_SLOT is set, as in `heavy-run npm run
//   verify`) it runs directly: a nested exclusive run would wait for its own
//   parent forever.

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUDGET = "scripts/perf-budget.tsv";
const RATIO = 1.1;
const FLOOR_MS = 3;
const NAME = /^[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const TEST_FILE = /\.test\.[a-z]+$/;
const SELF = "scripts/perf-gate.mjs";
// The allow name for a change to this script itself.
const SELF_ALLOW = "perf-gate";
const RECENT_MS = 60 * 60 * 1000;

class SetupError extends Error {}
const fail = (message) => {
  throw new SetupError(message);
};
const words = (text) => text.trim().split(/\s+/).filter(Boolean);
const lines = (text) => text.split("\n").filter(Boolean);

// ── Budget file ───────────────────────────────────────────────────────
function applyDirective(budget, key, value, where) {
  if (key === "PATH") budget.paths.push(value);
  else if (key === "BUILD") budget.build = words(value);
  else if (key === "BUILD_DEPS") budget.deps = words(value);
  else if (key === "BUILD_OUTPUT") budget.output = value;
  else if (key === "BUILD_INPUT") budget.inputs.push(value);
  else if (key === "ALLOW") {
    const match = /^([A-Za-z0-9_.-]+):\s*(\S.*)$/.exec(value);
    if (!match) fail(`perf gate: bad line ${where} (want: PERF_GATE_ALLOW=<name>:<reason>)`);
    budget.allow[match[1]] = match[2];
  } else fail(`perf gate: bad line ${where} (unknown setting PERF_GATE_${key})`);
}

function applyRow(budget, line, where) {
  const [name, ceiling, argv, stdin] = line.split("\t");
  if (!argv?.trim() || !NAME.test(name) || !/^\d+$/.test(ceiling)) {
    fail(`perf gate: bad line ${where} (want: name<TAB>ceiling_ms<TAB>command[<TAB>stdin])`);
  }
  if (budget.commands.some((command) => command.name === name)) {
    fail(`perf gate: command ${name} is listed twice in ${where.replace(/^\d+ in /, "")}`);
  }
  budget.commands.push({ name, ceiling: Number(ceiling), argv: words(argv), stdin: stdin ?? "" });
}

function parseBudget(text, label) {
  const budget = { commands: [], allow: {}, paths: [], build: [], deps: [], output: "", inputs: [] };
  text.split("\n").forEach((line, index) => {
    if (/^\s*(#|$)/.test(line)) return;
    const where = `${index + 1} in ${label}`;
    const directive = /^PERF_GATE_([A-Z_]+)=(.*)$/.exec(line);
    if (directive) applyDirective(budget, directive[1], directive[2].trim(), where);
    else applyRow(budget, line, where);
  });
  return budget;
}

// ── Git and scope ─────────────────────────────────────────────────────
function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), raw: result.stdout ?? "" };
}

/** The base commit and its ref. No commit is a setup error unless PERF_GATE_NO_BASE=1. */
function baseCommit(root) {
  let ref = process.env.PERF_GATE_BASE || git(root, "symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD").out;
  if (!ref) ref = "origin/main";
  const sha = git(root, "merge-base", "HEAD", ref).out;
  if (SHA.test(sha)) {
    // The date shows a stale ref: fetch when it is old.
    const date = git(root, "log", "-1", "--format=%cd", "--date=short", ref).out;
    console.error(`perf gate: base ref ${ref} (last commit ${date}), merge-base ${sha.slice(0, 12)}`);
    return { ref, sha, date };
  }
  if (process.env.PERF_GATE_NO_BASE === "1") {
    console.error(`perf gate: no base commit for ${ref}; PERF_GATE_NO_BASE=1, so only the ceilings apply`);
    return { ref, sha: "", date: "" };
  }
  return fail(
    `perf gate: no base commit: cannot find the merge-base of HEAD and ${ref}\n` +
      "Fix: git fetch origin, or set PERF_GATE_BASE=<ref>. PERF_GATE_NO_BASE=1 checks the ceilings only.",
  );
}

function under(file, prefixes) {
  return prefixes.some((prefix) => file === prefix || file.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
}

/** True when the diff against the base touches a runtime path. Test files never count. */
function runtimeChange(root, sha, paths) {
  const changed = [
    ...lines(git(root, "diff", "--no-renames", "--name-only", sha).out),
    ...lines(git(root, "ls-files", "-o", "--exclude-standard").out),
  ];
  return changed.some((file) => !TEST_FILE.test(file) && under(file, paths));
}

/** The budget file at the base commit, or an empty one when the base has none. */
function baseBudget(root, sha) {
  const shown = sha ? git(root, "show", `${sha}:${BUDGET}`) : { ok: false, raw: "" };
  return parseBudget(shown.ok ? shown.raw : "", `${BUDGET} at the base`);
}

/**
 * A command is new when a repo file it names does not exist at the base
 * commit. A build product (an ignored path) is looked up in the built base tree.
 */
function isNewCommand(command, root, sha, baseDir) {
  return command.argv.some((word) => {
    if (word.startsWith("-") || !word.includes("/") || !existsSync(join(root, word))) return false;
    if (git(root, "check-ignore", "-q", "--", word).ok) return !existsSync(join(baseDir, word));
    return !git(root, "cat-file", "-e", `${sha}:${normalize(word)}`).ok;
  });
}

// ── Builds ────────────────────────────────────────────────────────────
/** Run one build step. Returns "" on success, or the cause of the failure. */
function buildStep(dir, argv) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: dir,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, AGENTBREW_EVENTS: "0" },
  });
  if (result.status === 0) return "";
  const tail = lines(`${result.stdout ?? ""}\n${result.stderr ?? ""}`).slice(-12);
  const cause = result.error ? result.error.message : `exit ${result.status}`;
  return [`\`${argv.join(" ")}\` failed (${cause}) in ${dir}`, ...tail.map((line) => `    ${line}`)].join("\n");
}

/** Build a tree. The deps step runs for the base only; it gets this tree's root as its last argument. */
function buildTree(dir, budget, depsFrom) {
  if (budget.build.length === 0) return "";
  if (depsFrom && budget.deps.length > 0) {
    const problem = buildStep(dir, [...budget.deps, depsFrom]);
    if (problem) return problem;
  }
  return buildStep(dir, budget.build);
}

/** True when the build output is at least as new as every build input in this tree. */
function headBuildIsFresh(root, budget) {
  const output = join(root, budget.output);
  if (!existsSync(output)) return false;
  const built = statSync(output).mtimeMs;
  const inputs = budget.inputs.length > 0 ? budget.inputs : budget.paths;
  const files = lines(git(root, "ls-files", "-co", "--exclude-standard", "--", ...inputs).out);
  return files.every((file) => {
    if (TEST_FILE.test(file)) return true;
    const stat = statSync(join(root, file), { throwIfNoEntry: false });
    return !stat || stat.mtimeMs <= built;
  });
}

function buildHead(root, budget) {
  if (budget.build.length === 0 || !budget.output || headBuildIsFresh(root, budget)) return;
  console.error(`perf gate: building this tree (${budget.output} is older than its source)`);
  const problem = buildTree(root, budget, "");
  if (problem) fail(`perf gate: cannot build this tree: ${problem}`);
}

// ── Base checkout: a cached detached worktree, keyed by commit ────────
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The pid in a lock directory, or 0 while its owner has not written it yet. */
function lockPid(lock) {
  try {
    return Number(readFileSync(join(lock, "pid"), "utf-8")) || 0;
  } catch {
    return 0;
  }
}

function isGone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

/**
 * Take the lock away from an owner that is gone. The rename is atomic, so one
 * waiter wins. A lock with no pid file is never taken: its owner may be alive.
 */
function takeOverDeadLock(lock) {
  const pid = lockPid(lock);
  if (pid === 0 || !isGone(pid)) return;
  const stale = `${lock}.stale.${process.pid}`;
  try {
    renameSync(lock, stale);
  } catch {
    return;
  }
  // Another waiter took over first and this is its live lock: give it back.
  if (lockPid(stale) !== pid) renameSync(stale, lock);
  else rmSync(stale, { recursive: true, force: true });
}

/**
 * Run fn while this process holds the cache lock. The lock is a directory
 * that already holds the pid file when it is renamed into place.
 */
function withLock(cache, fn) {
  const lock = join(cache, "lock");
  const mine = mkdtempSync(join(cache, "lock.new."));
  writeFileSync(join(mine, "pid"), String(process.pid));
  const deadline = Date.now() + count("PERF_GATE_LOCK_WAIT", 900, 0) * 1000;
  for (;;) {
    try {
      // Fails while another lock directory (never empty) is in place.
      renameSync(mine, lock);
      break;
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
      if (Date.now() > deadline) {
        rmSync(mine, { recursive: true, force: true });
        fail(`perf gate: another perf gate holds ${lock} for too long. If none runs, delete that directory.`);
      }
      sleep(200);
      takeOverDeadLock(lock);
    }
  }
  try {
    return fn();
  } finally {
    if (lockPid(lock) === process.pid) rmSync(lock, { recursive: true, force: true });
  }
}

const isSymlink = (path) => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;

/**
 * Remove one of the gate's own checkouts. Never run a repo-wide `git worktree
 * prune`: that would also drop a stale worktree of the user. A symlink is
 * unlinked, never followed. A folder is removed only when a marker of the
 * gate (<commit>.ready or <commit>.building) says the gate made it. Returns
 * false when it left the path alone.
 */
function removeCheckout(root, cache, sha) {
  if (!cache || !SHA.test(sha)) fail(`perf gate: refusing to remove ${join(cache, sha)}`);
  const dir = join(cache, sha);
  const markers = [`${dir}.ready`, `${dir}.building`];
  if (isSymlink(dir)) unlinkSync(dir);
  else if (existsSync(dir)) {
    if (!markers.some((marker) => existsSync(marker))) return false;
    git(root, "worktree", "remove", "--force", dir);
    rmSync(dir, { recursive: true, force: true });
  }
  for (const marker of markers) rmSync(marker, { force: true });
  return true;
}

/** Keep this checkout, the newest other one, and any that a gate used in the last hour. */
function pruneCheckouts(root, cache, current) {
  const recent = Date.now() - RECENT_MS;
  const others = readdirSync(cache)
    .filter((name) => SHA.test(name) && name !== current)
    .map((name) => ({ name, ready: statSync(join(cache, `${name}.ready`), { throwIfNoEntry: false })?.mtimeMs ?? 0 }))
    .sort((a, b) => b.ready - a.ready);
  for (const [index, other] of others.entries()) {
    if (other.ready !== 0 && (index === 0 || other.ready >= recent)) continue;
    if (!removeCheckout(root, cache, other.name)) {
      const path = join(cache, other.name);
      console.error(
        `perf gate: left ${path} alone: the gate did not make it (no ${path}.ready). Remove it by hand if it is old.`,
      );
    }
  }
}

function createCheckout(root, cache, sha, budget) {
  const dir = join(cache, sha);
  if (!removeCheckout(root, cache, sha)) {
    fail(
      `perf gate: ${dir} is in the way, and the gate did not make it (no ${dir}.ready). Move it away and run again.`,
    );
  }
  // The marker says "the gate made this folder" from the first moment, so a killed build can be cleaned up.
  writeFileSync(`${dir}.building`, "");
  // --force: a checkout that was deleted by hand is still registered.
  const added = git(
    root,
    "-c",
    "core.hooksPath=/dev/null",
    "worktree",
    "add",
    "--force",
    "--detach",
    "--quiet",
    dir,
    sha,
  );
  if (!added.ok) fail(`perf gate: cannot check out the base commit ${sha} at ${dir}`);
  const problem = buildTree(dir, budget, root);
  if (problem) fail(`perf gate: cannot build the base commit, so there is nothing to compare with: ${problem}`);
  writeFileSync(`${dir}.ready`, "");
  rmSync(`${dir}.building`, { force: true });
}

/** Returns the built base tree. Its HEAD must be the base commit. */
function ensureBase(root, sha, budget) {
  const cache = resolve(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "agentbrew", "perf-gate.noindex");
  const dir = join(cache, sha);
  mkdirSync(cache, { recursive: true });
  withLock(cache, () => {
    if (isSymlink(dir) || !existsSync(`${dir}.ready`)) createCheckout(root, cache, sha, budget);
    const now = new Date();
    utimesSync(`${dir}.ready`, now, now);
    pruneCheckouts(root, cache, sha);
  });
  const head = git(dir, "rev-parse", "HEAD").out;
  if (head !== sha) {
    fail(
      `perf gate: the base checkout ${dir} is at ${head || "no commit"}, not ${sha}. Delete ${dir}.ready and run again.`,
    );
  }
  return dir;
}

/**
 * An allow line counts for this PR when the base does not have the same line
 * (same name, same reason). A line that the base has unchanged is stale.
 */
const freshAllow = (name, allow, baseAllow) => name in allow && baseAllow[name] !== allow[name];

// ── Timing (runs in a child process, inside the heavy-run slot) ───────
const slower = (base, head) => head > base * RATIO && head - base > FLOOR_MS;

/** Run the command once in a tree. Returns the wall time and the exit status. */
function measure(command, dir, env) {
  const stdin = openSync(command.stdinFile, "r");
  const start = process.hrtime.bigint();
  const result = spawnSync(command.argv[0], command.argv.slice(1), {
    cwd: dir,
    env,
    stdio: [stdin, "ignore", "ignore"],
  });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  closeSync(stdin);
  return { ms, status: result.status ?? 127 };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The median of (head - base) over the pairs: what a typical back-to-back run costs more. */
const pairedDelta = (pairs) => (pairs.length > 0 ? median(pairs.map(([base, head]) => head - base)) : null);

/**
 * Slower: the two minimums say so, and the paired runs agree. It reads only
 * baseMin, headMin, and pairs. Exported so a test can pin the limit.
 */
export function looksSlower(state) {
  if (state.baseMin === null || !slower(state.baseMin, state.headMin)) return false;
  const delta = pairedDelta(state.pairs);
  return delta === null || delta > Math.max(FLOOR_MS, state.baseMin * (RATIO - 1));
}

/** Run the command in one tree. Returns its wall time, or null when the run did not count. */
function runSide(side, state, context) {
  if (state.failed !== null || state.baseFailed !== null || (side === "base" && !state.hasBase)) return null;
  const { ms, status } = measure(context.command, side === "base" ? context.plan.base : context.plan.head, context.env);
  if (status === 0) return ms;
  if (side === "head") state.failed = status;
  else state.baseFailed = status;
  return null;
}

/** One pass: both trees back to back. Swap the order each pass, so neither tree always runs first. */
function runPass(pass, timed, state, context) {
  const first = pass % 2 ? "base" : "head";
  const times = { base: null, head: null };
  times[first] = runSide(first, state, context);
  const second = first === "base" ? "head" : "base";
  times[second] = runSide(second, state, context);
  if (!timed || times.head === null) return;
  state.headMin = Math.min(state.headMin ?? Number.POSITIVE_INFINITY, times.head);
  state.count += 1;
  if (times.base === null) return;
  state.baseMin = Math.min(state.baseMin ?? Number.POSITIVE_INFINITY, times.base);
  state.pairs.push([times.base, times.head]);
}

function timeCommand(command, plan, env) {
  const hasBase = plan.base !== "" && !command.isNew;
  const state = { hasBase, baseMin: null, headMin: null, failed: null, baseFailed: null, count: 0, pairs: [] };
  const context = { command, plan, env };
  const round = (times, timed) => {
    for (let pass = 1; pass <= times; pass++) runPass(pass, timed, state, context);
  };
  round(plan.warmups, false);
  round(plan.runs, true);
  const again = () => state.failed === null && state.baseFailed === null && looksSlower(state);
  for (let extra = 0; extra < 2 && again(); extra++) round(plan.runs, true);
  if (process.env.PERF_GATE_SAMPLES) {
    const pairs = state.pairs.map((pair) => pair.map((ms) => Number(ms.toFixed(3))));
    appendFileSync(process.env.PERF_GATE_SAMPLES, `${JSON.stringify({ name: command.name, pairs })}\n`);
  }
  return state;
}

/** The ceiling check. A ceiling that the base breaks too in this run is not this tree's fault. */
function judgeCeiling(command, state, row) {
  if (state.headMin <= command.ceiling) return [];
  const over = `${command.name} is over its ceiling: ${state.headMin.toFixed(1)} ms > ${command.ceiling} ms`;
  if (state.baseMin !== null && state.baseMin > command.ceiling) {
    console.error(
      `perf gate: ${over}, but so is the base (${state.baseMin.toFixed(1)} ms): this machine is slow now, or the ceiling is too low. Not counted against this tree.`,
    );
    row.over_ceiling_at_base = true;
    if (row.verdict === "ok") row.verdict = "over-ceiling-at-base";
    return [];
  }
  row.verdict = "over-ceiling";
  return [over];
}

function judgeSpeed(command, state, plan, row) {
  const problems = [];
  if (state.baseMin !== null && state.baseMin > 0) row.ratio = state.headMin / state.baseMin;
  row.paired_delta_ms = pairedDelta(state.pairs);
  const change = row.ratio === null ? "" : ((row.ratio - 1) * 100).toFixed(1);
  const paired =
    row.paired_delta_ms === null ? "" : `${row.paired_delta_ms >= 0 ? "+" : ""}${row.paired_delta_ms.toFixed(1)} ms`;
  if (looksSlower(state)) {
    const allowed = freshAllow(command.name, plan.allow, plan.baseAllow);
    row.verdict = allowed ? "allowed" : "slower";
    if (!allowed) {
      problems.push(
        `${command.name} got slower: ${state.baseMin.toFixed(1)} ms -> ${state.headMin.toFixed(1)} ms (+${change}%; the limit is +10% and ${FLOOR_MS} ms; paired runs: ${paired})`,
      );
    }
  } else if (state.baseMin !== null && slower(state.baseMin, state.headMin)) {
    console.error(
      `perf gate: ${command.name}: the fastest runs differ by +${change}%, but the paired runs do not (median difference ${paired}): load noise, not a slowdown`,
    );
  }
  problems.push(...judgeCeiling(command, state, row));
  return problems;
}

/** Turn the times of one command into its row, its problems, and its setup errors. */
function judge(command, state, plan) {
  const row = { name: command.name, base_min: state.baseMin, head_min: state.headMin, ratio: null };
  Object.assign(row, { paired_delta_ms: null, over_ceiling_at_base: false });
  Object.assign(row, { ceiling_ms: command.ceiling, runs: state.count, verdict: "error" });
  const text = `(status ${state.failed ?? state.baseFailed}): ${command.argv.join(" ")}`;
  if (state.failed !== null) {
    return { row, problems: [`${command.name}: the command failed in this tree ${text}`], errors: [] };
  }
  if (state.baseFailed !== null) {
    row.base_min = null;
    return { row, problems: [], errors: [`${command.name} failed in the base checkout ${text}`] };
  }
  row.verdict = state.baseMin === null ? "new" : "ok";
  return { row, problems: judgeSpeed(command, state, plan, row), errors: [] };
}

const atBaseCount = (rows) => rows.filter((row) => row.over_ceiling_at_base).length;

function printJson(plan, rows, ok, problems) {
  const round = (value) => (value === null ? null : Number(value.toFixed(3)));
  const commands = rows.map((row) => ({
    ...row,
    base_min: round(row.base_min),
    head_min: round(row.head_min),
    ratio: round(row.ratio),
    paired_delta_ms: round(row.paired_delta_ms),
  }));
  const base = { base: plan.sha || null, base_ref: plan.ref, base_ref_date: plan.date || null };
  const limits = { limit_ratio: RATIO, limit_ms: FLOOR_MS, estimator: "min-and-paired-median" };
  const totals = { over_ceiling_at_base: atBaseCount(rows), problems };
  console.log(JSON.stringify({ skipped: false, ok, ...base, ...limits, ...totals, commands }));
}

function printTable(plan, rows, ok, seconds) {
  const width = Math.max(24, ...rows.map((row) => row.name.length));
  const ms = (value) => (value === null ? "         -" : `${value.toFixed(1).padStart(7)} ms`);
  for (const row of rows) {
    const sign = row.ratio !== null && row.ratio >= 1 ? "+" : "";
    const change = row.ratio === null ? "      -" : `${`${sign}${((row.ratio - 1) * 100).toFixed(1)}`.padStart(6)}%`;
    console.log(
      `  ${row.name.padEnd(width)} base ${ms(row.base_min)}  head ${ms(row.head_min)}  ${change}  ${row.verdict}`,
    );
  }
  const verdict = ok ? "pass" : "FAIL";
  const atBase = atBaseCount(rows) > 0 ? `; ${atBaseCount(rows)} over its ceiling at the base too` : "";
  console.log(
    `perf gate: ${verdict} (${rows.length} commands, base ${plan.sha ? plan.sha.slice(0, 12) : "none"}, ${seconds.toFixed(1)} s${atBase})`,
  );
}

function printProblems(problems) {
  for (const problem of problems) console.error(`perf gate: ${problem}`);
  console.error(
    [
      "Fix, one of:",
      "  1. Make the command faster.",
      `  2. If the new cost is intended and worth it: raise its ceiling in ${BUDGET} and say why in the PR.`,
      "     For a step over 10% in one PR, also add a line PERF_GATE_ALLOW=<name>:<reason> to that file;",
      "     the next PR removes the line.",
    ].join("\n"),
  );
}

function timeRows(plan, scratch) {
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: join(scratch, "home"), TMPDIR: tmpdir() };
  // No event and no telemetry in a timed run. If a switch ever fails, the log stays in the scratch HOME.
  const eventLog = join(env.HOME, "events.jsonl");
  Object.assign(env, { AGENTBREW_EVENTS: "0", AGENTBREW_TELEMETRY: "0", DO_NOT_TRACK: "1" });
  Object.assign(env, { AGENTBREW_EVENTS_FILE: eventLog });
  mkdirSync(env.HOME);
  const result = { rows: [], problems: [...plan.problems], errors: [] };
  plan.commands.forEach((command, index) => {
    command.stdinFile = "/dev/null";
    if (command.stdin !== "") {
      command.stdinFile = join(scratch, `stdin.${index}`);
      writeFileSync(command.stdinFile, `${command.stdin}\n`);
    }
    const verdict = judge(command, timeCommand(command, plan, env), plan);
    result.rows.push(verdict.row);
    result.problems.push(...verdict.problems);
    result.errors.push(...verdict.errors);
  });
  return result;
}

function timeAll(plan) {
  const scratch = mkdtempSync(join(tmpdir(), "perf-gate."));
  const started = process.hrtime.bigint();
  let result;
  try {
    result = timeRows(plan, scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const ok = result.problems.length === 0 && result.errors.length === 0;
  if (plan.json) printJson(plan, result.rows, ok, [...result.problems, ...result.errors]);
  else printTable(plan, result.rows, ok, Number(process.hrtime.bigint() - started) / 1e9);
  for (const error of result.errors) console.error(`perf gate: ${error}`);
  if (result.problems.length > 0) printProblems(result.problems);
  if (result.errors.length > 0) return 2;
  return ok ? 0 : 1;
}

// ── Main ──────────────────────────────────────────────────────────────
function onPath(name) {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => dir && existsSync(join(dir, name)));
}

/** Start the timing child: through heavy-run --exclusive when it is safe to. */
function runTimer(plan) {
  const child = [process.execPath, fileURLToPath(import.meta.url), "--time"];
  let argv = child;
  if (process.env.PERF_GATE_HEAVY_RUN === "0") argv = child;
  else if (process.env.HEAVY_RUN_SLOT) {
    console.error("perf gate: already inside a heavy-run slot; timing runs directly");
  } else if (onPath("heavy-run")) argv = ["heavy-run", "--exclusive", ...child];
  else {
    console.error("perf gate: heavy-run not found; timing runs directly (other work on this machine can add noise)");
  }
  const result = spawnSync(argv[0], argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, PERF_GATE_PLAN: JSON.stringify(plan) },
  });
  return result.status ?? 2;
}

function count(name, fallback, min) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw) || Number(raw) < min) fail(`perf gate: ${name} must be a number of ${min} or more`);
  return Number(raw);
}

function parseArgs(args) {
  const options = { json: false, force: false, help: false, time: false };
  for (const arg of args) {
    if (arg === "--json") options.json = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--time") options.time = true;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else fail(`perf gate: unknown argument ${arg} (try --help)`);
  }
  return options;
}

function printHelp() {
  const header = readFileSync(fileURLToPath(import.meta.url), "utf-8")
    .split("\n")
    .slice(2, 34);
  console.log(header.map((line) => line.replace(/^\/\/ ?/, "")).join("\n"));
}

function skip(json, reason) {
  console.log(json ? JSON.stringify({ skipped: true, reason }) : `perf gate: skipped (${reason})`);
  return 0;
}

/** The head budget file. It must list a command and a runtime path. */
function headBudget(root) {
  const file = join(root, BUDGET);
  if (!existsSync(file)) fail(`perf gate: ${file} is missing`);
  const budget = parseBudget(readFileSync(file, "utf-8"), file);
  if (budget.commands.length === 0) fail(`perf gate: ${file} lists no command`);
  if (budget.paths.length === 0) fail(`perf gate: ${file} lists no runtime path (PERF_GATE_PATH=<path>)`);
  return budget;
}

/**
 * This script judges the PR that changes it. So a change to it must show in
 * the budget file, where a reviewer looks: without the allow line, exit 2.
 */
function checkSelfChange(root, sha, head, base) {
  if (!sha || !git(root, "cat-file", "-e", `${sha}:${SELF}`).ok) return;
  if (git(root, "diff", "--no-renames", "--quiet", sha, "--", SELF).ok) return;
  if (freshAllow(SELF_ALLOW, head.allow, base.allow)) return;
  const same =
    SELF_ALLOW in head.allow ? "\nThe line there now is the same as in the base: write this PR's own reason." : "";
  fail(
    `perf gate: ${SELF} differs from the base, and it judges its own PR.\n` +
      `Add PERF_GATE_ALLOW=${SELF_ALLOW}:<reason> to ${BUDGET} so the review sees it.${same}`,
  );
}

/** The allow lines that the base has unchanged, each as "remove this line from <file>: <line>". */
function staleAllowLines(head, base) {
  return Object.keys(head.allow)
    .sort()
    .filter((name) => !freshAllow(name, head.allow, base.allow))
    .map((name) => `remove this line from ${BUDGET}: PERF_GATE_ALLOW=${name}:${head.allow[name]}`);
}

/**
 * A stale allow line stops the gate before any timing. The fix is to remove
 * the line, not to make a command faster. With --json, stdout still gets JSON.
 */
function failStale(stale, json) {
  console.error("perf gate: an allow line covers one PR, and the base budget file already has this one.");
  for (const line of stale) console.error(line);
  console.error("(If this PR needs the allow again, write the line with this PR's own reason.)");
  if (json) {
    const problems = stale.map((line) => `stale allow line: ${line}`);
    console.log(JSON.stringify({ skipped: false, ok: false, problems }));
  }
  return 1;
}

/** A diff with no runtime path skips, stale line or not: a docs-only PR must not have to edit the budget file. */
function skipUnchanged(stale, json) {
  if (stale.length > 0) {
    console.error(`perf gate: note: ${BUDGET} has an allow line that the base has unchanged (stale).`);
    console.error("This diff changes no runtime path, so the gate still skips;");
    console.error("the next PR that changes a runtime path must remove this line:");
    for (const line of stale) console.error(`  ${line.replace(/^remove this line from \S+: /, "")}`);
  }
  return skip(json, "no runtime change");
}

/** Problems that the two budget files show without any timing. */
function budgetProblems(head, base) {
  const headNames = new Set(head.commands.map((command) => command.name));
  const baseNames = new Set(base.commands.map((command) => command.name));
  const problems = [];
  for (const name of Object.keys(head.allow).sort()) {
    if (name !== SELF_ALLOW && !headNames.has(name) && !baseNames.has(name)) {
      fail(`perf gate: PERF_GATE_ALLOW=${name} names no command of the budget file`);
    }
  }
  for (const name of [...baseNames].sort()) {
    if (!headNames.has(name) && !freshAllow(name, head.allow, base.allow)) {
      problems.push(
        `${name} is in the base budget file but not in this one: put the row back, or add PERF_GATE_ALLOW=${name}:<reason>`,
      );
    }
  }
  return problems;
}

function main(options) {
  const runs = count("PERF_GATE_RUNS", 15, 1);
  const warmups = count("PERF_GATE_WARMUPS", 2, 0);
  const top = git(process.cwd(), "rev-parse", "--show-toplevel");
  if (!top.ok) fail("perf gate: not in a git repository");
  const root = top.out;
  const budget = headBudget(root);
  const { ref, sha, date } = baseCommit(root);
  const atBase = baseBudget(root, sha);
  const problems = budgetProblems(budget, atBase);
  checkSelfChange(root, sha, budget, atBase);
  const stale = staleAllowLines(budget, atBase);

  // With no base commit (PERF_GATE_NO_BASE=1) the diff is unknown, so the gate runs.
  const paths = [...new Set([...budget.paths, ...atBase.paths])];
  if (!options.force && sha && !runtimeChange(root, sha, paths)) return skipUnchanged(stale, options.json);
  if (stale.length > 0) return failStale(stale, options.json);

  const base = sha ? ensureBase(root, sha, budget) : "";
  buildHead(root, budget);
  const commands = budget.commands.map((command) => ({
    ...command,
    isNew: base !== "" && isNewCommand(command, root, sha, base),
  }));
  const plan = { head: root, base, sha, ref, date, runs, warmups, json: options.json, problems };
  return runTimer({ ...plan, commands, allow: budget.allow, baseAllow: atBase.allow });
}

/** True when node runs this file as the program; false when a test imports it. */
function isProgram() {
  return (
    process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  );
}

if (isProgram()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) printHelp();
    else if (options.time) process.exitCode = timeAll(JSON.parse(process.env.PERF_GATE_PLAN ?? "{}"));
    else process.exitCode = main(options);
  } catch (error) {
    // Only a measured slowdown or a ceiling breach is exit 1.
    console.error(
      error instanceof SetupError ? error.message : `perf gate: unexpected error: ${error?.stack ?? error}`,
    );
    process.exitCode = 2;
  }
}
