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
//   head_min > base_min * 1.10  AND  head_min - base_min > 3 ms   (slower), or
//   head_min > its ceiling in the budget file                     (over-ceiling).
// A command whose file does not exist at the base commit is "new": only the
// ceiling applies. Any other problem on the base side is a setup error.
//
// Usage: node scripts/perf-gate.mjs [--json] [--force]     (npm run perf:gate)
//   --json   print one JSON object (per command: base_min, head_min, ratio, verdict)
//   --force  time the commands even when the diff touches no runtime path
// Exit: 0 pass or skipped, 1 a command is slower or over its ceiling, 2 setup error.
//
// Env:
//   PERF_GATE_BASE       ref to compare with (default: origin's default branch)
//   PERF_GATE_NO_BASE    1 = when no base commit resolves, check the ceilings only
//   PERF_GATE_RUNS       timed runs per tree (default 15)
//   PERF_GATE_WARMUPS    untimed runs per tree first (default 2)
//   PERF_GATE_HEAVY_RUN  0 = never call heavy-run (tests)
//
// Timing choices:
// - One node process starts every run of both trees with spawnSync and reads
//   process.hrtime.bigint() around it. Base and head runs are interleaved
//   (B H H B ...), so both see the same machine load.
// - The minimum of the runs, not the mean: noise only adds time, so the
//   minimum is the most stable estimate (Chen and Revels 2016).
// - A command that looks slower is timed again (up to two more rounds) and the
//   minimums are merged. A real slowdown stays; a load spike does not.
// - The base is a detached git worktree under
//   ~/.cache/agentbrew/perf-gate.noindex/<commit>, built once (PERF_GATE_BUILD
//   in the budget file) under a lock; the newest two are kept. The gate
//   removes only its own worktrees.
// - No silent pass: no base commit, a base checkout at another commit, a
//   failed base build, or a command that fails at the base all exit 2.
// - The head budget file does not decide its own scope: the runtime paths are
//   the union of the base and head lists, and a row that the base has cannot
//   leave the file without an allow line.
// - This tree is rebuilt first when its build output is older than a build
//   input, so the gate never times a stale dist/.
// - Every run gets a small fixed environment (PATH, a scratch HOME, TMPDIR,
//   AGENTBREW_EVENTS=0, DO_NOT_TRACK=1), so no event, telemetry, or hook log
//   reaches the real HOME.
// - Timing runs through `heavy-run --exclusive` when heavy-run is on PATH.
//   Inside a heavy-run slot (HEAVY_RUN_SLOT is set, as in `heavy-run npm run
//   verify`) it runs directly: a nested exclusive run would wait for its own
//   parent forever.

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const BUDGET = "scripts/perf-budget.tsv";
const RATIO = 1.1;
const FLOOR_MS = 3;
const NAME = /^[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const TEST_FILE = /\.test\.[a-z]+$/;
const LOCK_WAIT_MS = 15 * 60 * 1000;

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

function lockOwnerIsGone(lock) {
  try {
    process.kill(Number(readFileSync(join(lock, "pid"), "utf-8")), 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH" || error.code === "ENOENT";
  }
}

/** Run fn while this process holds the cache lock (a directory; mkdir is atomic). */
function withLock(cache, fn) {
  const lock = join(cache, "lock");
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      sleep(200);
      if (lockOwnerIsGone(lock)) rmSync(lock, { recursive: true, force: true });
      else if (Date.now() > deadline) fail(`perf gate: another perf gate holds ${lock} for too long`);
    }
  }
  try {
    writeFileSync(join(lock, "pid"), String(process.pid));
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Remove one of the gate's own checkouts. It refuses any other path. */
function removeCheckout(root, cache, sha) {
  if (!cache || !SHA.test(sha)) fail(`perf gate: refusing to remove ${join(cache, sha)}`);
  const dir = join(cache, sha);
  rmSync(`${dir}.ready`, { force: true });
  git(root, "worktree", "remove", "--force", dir);
  rmSync(dir, { recursive: true, force: true });
}

/** Keep this checkout and the newest other one. */
function pruneCheckouts(root, cache, current) {
  const others = readdirSync(cache)
    .filter((name) => SHA.test(name) && name !== current)
    .map((name) => ({ name, ready: statSync(join(cache, `${name}.ready`), { throwIfNoEntry: false })?.mtimeMs ?? 0 }))
    .sort((a, b) => b.ready - a.ready);
  for (const [index, other] of others.entries()) {
    if (index > 0 || other.ready === 0) removeCheckout(root, cache, other.name);
  }
}

function createCheckout(root, cache, sha, budget) {
  const dir = join(cache, sha);
  removeCheckout(root, cache, sha);
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
}

/** Returns the built base tree. Its HEAD must be the base commit. */
function ensureBase(root, sha, budget) {
  const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "agentbrew", "perf-gate.noindex");
  const dir = join(cache, sha);
  mkdirSync(cache, { recursive: true });
  withLock(cache, () => {
    if (!existsSync(`${dir}.ready`)) createCheckout(root, cache, sha, budget);
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

function runSide(side, timed, state, context) {
  if (state.failed !== null || state.baseFailed !== null || (side === "base" && !state.hasBase)) return;
  const { ms, status } = measure(context.command, side === "base" ? context.plan.base : context.plan.head, context.env);
  if (status !== 0) {
    if (side === "head") state.failed = status;
    else state.baseFailed = status;
    return;
  }
  if (!timed) return;
  if (side === "base") state.baseMin = Math.min(state.baseMin ?? Number.POSITIVE_INFINITY, ms);
  else {
    state.headMin = Math.min(state.headMin ?? Number.POSITIVE_INFINITY, ms);
    state.count += 1;
  }
}

function timeCommand(command, plan, env) {
  const hasBase = plan.base !== "" && !command.isNew;
  const state = { hasBase, baseMin: null, headMin: null, failed: null, baseFailed: null, count: 0 };
  const context = { command, plan, env };
  const round = (times, timed) => {
    for (let pass = 1; pass <= times; pass++) {
      // Swap the order each pass, so neither tree always runs first.
      for (const side of pass % 2 ? ["base", "head"] : ["head", "base"]) runSide(side, timed, state, context);
    }
  };
  round(plan.warmups, false);
  round(plan.runs, true);
  const again = () =>
    state.failed === null && state.baseFailed === null && hasBase && slower(state.baseMin, state.headMin);
  for (let extra = 0; extra < 2 && again(); extra++) round(plan.runs, true);
  return state;
}

function judgeSpeed(command, state, plan, row) {
  const problems = [];
  if (state.baseMin !== null && state.baseMin > 0) row.ratio = state.headMin / state.baseMin;
  if (state.baseMin !== null && slower(state.baseMin, state.headMin)) {
    const change = ((row.ratio - 1) * 100).toFixed(1);
    const allowed = command.name in plan.allow && !(command.name in plan.baseAllow);
    row.verdict = allowed ? "allowed" : "slower";
    if (!allowed) {
      problems.push(
        `${command.name} got slower: ${state.baseMin.toFixed(1)} ms -> ${state.headMin.toFixed(1)} ms (+${change}%; the limit is +10% and ${FLOOR_MS} ms)`,
      );
    }
  }
  if (state.headMin > command.ceiling) {
    row.verdict = "over-ceiling";
    problems.push(`${command.name} is over its ceiling: ${state.headMin.toFixed(1)} ms > ${command.ceiling} ms`);
  }
  return problems;
}

/** Turn the times of one command into its row, its problems, and its setup errors. */
function judge(command, state, plan) {
  const row = { name: command.name, base_min: state.baseMin, head_min: state.headMin, ratio: null };
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

function printJson(plan, rows, ok) {
  const round = (value) => (value === null ? null : Number(value.toFixed(3)));
  const commands = rows.map((row) => ({
    ...row,
    base_min: round(row.base_min),
    head_min: round(row.head_min),
    ratio: round(row.ratio),
  }));
  const base = { base: plan.sha || null, base_ref: plan.ref, base_ref_date: plan.date || null };
  console.log(JSON.stringify({ skipped: false, ok, ...base, limit_ratio: RATIO, limit_ms: FLOOR_MS, commands }));
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
  console.log(
    `perf gate: ${verdict} (${rows.length} commands, base ${plan.sha ? plan.sha.slice(0, 12) : "none"}, ${seconds.toFixed(1)} s)`,
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
  Object.assign(env, { AGENTBREW_EVENTS: "0", DO_NOT_TRACK: "1" });
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
  if (plan.json) printJson(plan, result.rows, ok);
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
    .slice(2, 26);
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

/** Problems that the two budget files show without any timing. */
function budgetProblems(head, base) {
  const headNames = new Set(head.commands.map((command) => command.name));
  const baseNames = new Set(base.commands.map((command) => command.name));
  const problems = [];
  for (const name of Object.keys(head.allow).sort()) {
    if (!headNames.has(name) && !baseNames.has(name)) {
      fail(`perf gate: PERF_GATE_ALLOW=${name} names no command of the budget file`);
    }
    // An allow line is for one PR. One that the base already has is stale.
    if (name in base.allow) {
      problems.push(
        `PERF_GATE_ALLOW=${name} is already in the base budget file: remove the line (it covers one PR only)`,
      );
    }
  }
  for (const name of [...baseNames].sort()) {
    if (!headNames.has(name) && !(name in head.allow)) {
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

  // With no base commit (PERF_GATE_NO_BASE=1) the diff is unknown, so the gate runs.
  const paths = [...new Set([...budget.paths, ...atBase.paths])];
  if (!options.force && sha && !runtimeChange(root, sha, paths)) return skip(options.json, "no runtime change");

  const base = sha ? ensureBase(root, sha, budget) : "";
  buildHead(root, budget);
  const commands = budget.commands.map((command) => ({
    ...command,
    isNew: base !== "" && isNewCommand(command, root, sha, base),
  }));
  const plan = { head: root, base, sha, ref, date, runs, warmups, json: options.json, problems };
  return runTimer({ ...plan, commands, allow: budget.allow, baseAllow: atBase.allow });
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) printHelp();
  else if (options.time) process.exitCode = timeAll(JSON.parse(process.env.PERF_GATE_PLAN ?? "{}"));
  else process.exitCode = main(options);
} catch (error) {
  if (!(error instanceof SetupError)) throw error;
  console.error(error.message);
  process.exitCode = 2;
}
