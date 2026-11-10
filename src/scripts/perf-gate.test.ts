import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// scripts/perf-gate.mjs: a tracked command may not get slower than the
// merge-base. Each test builds a small git repo with one tracked script that
// sleeps, so the times are known: 100 ms at the base, 120 ms (20% more) in a
// slowed head. A timing test retries, because the wall clock of a loaded host
// can hide a 20 ms step.

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const GATE = join(REPO_ROOT, "scripts", "perf-gate.mjs");
const BUDGET = join(REPO_ROOT, "scripts", "perf-budget.tsv");
const PATHS = ["tool.sh", "new.sh", "build.sh", "scripts/perf-budget.tsv"].map((path) => `PERF_GATE_PATH=${path}`);
const TIMING = { retry: 3, timeout: 60_000 };
// A 50% step for the tests that need a slowdown but not the exact 20% one.
const SLOW = "0.15";

let dir = "";
let fix = "";
let env: NodeJS.ProcessEnv = {};

function git(...args: string[]): string {
  return execFileSync("git", ["-C", fix, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    env,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

/** Write a tracked script that sleeps that long. */
function tool(seconds: string, file = "tool.sh"): void {
  writeFileSync(join(fix, file), `#!/bin/sh\nsleep ${seconds}\n`);
}

/** Write the fixture budget file: the runtime paths plus these lines. */
function budget(...rows: string[]): void {
  writeFileSync(join(fix, "scripts", "perf-budget.tsv"), `${[...PATHS, ...rows].join("\n")}\n`);
}

function commit(message: string): void {
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", message);
}

function gate(args: string[] = [], extra: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [GATE, ...args], {
    cwd: fix,
    env: { ...env, ...extra },
    encoding: "utf-8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, all: result.stdout + result.stderr };
}

const cacheDir = () => join(dir, "cache", "agentbrew", "perf-gate.noindex");

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "agentbrew-perf-gate-")));
  fix = join(dir, "repo");
  env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    XDG_CACHE_HOME: join(dir, "cache"),
    PERF_GATE_BASE: "main",
    PERF_GATE_RUNS: "3",
    PERF_GATE_WARMUPS: "0",
    PERF_GATE_HEAVY_RUN: "0",
  };
  for (const name of ["HEAVY_RUN_SLOT", "BASH_ENV", "ENV"]) delete env[name];
  mkdirSync(join(fix, "scripts"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", fix], { env });
  tool("0.10");
  budget("tool\t2000\tsh tool.sh");
  commit("base");
  git("checkout", "-q", "-b", "work");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("perf gate verdicts", () => {
  it("fails on a seeded 20% slowdown and names the command and the fixes", TIMING, () => {
    tool("0.12");
    const result = gate([], { PERF_GATE_RUNS: "9" });
    expect(result.status, result.all).toBe(1);
    expect(result.stderr).toContain("tool got slower");
    expect(result.stdout).toMatch(/perf gate: FAIL \(1 commands, base [0-9a-f]{12}, /);
    expect(result.stderr).toMatch(
      /perf gate: base ref main \(last commit \d{4}-\d\d-\d\d\), merge-base [0-9a-f]{12}\n/,
    );
    expect(result.stderr).toContain("Make the command faster");
    expect(result.stderr).toContain("PERF_GATE_ALLOW=<name>:<reason>");
  });

  it("sees a committed slowdown too", TIMING, () => {
    tool(SLOW);
    commit("slower");
    const result = gate([], { PERF_GATE_RUNS: "5" });
    expect(result.status, result.all).toBe(1);
    expect(result.stderr).toContain("tool got slower");
  });

  it("passes when the trees are equally fast", TIMING, () => {
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nsleep 0.10\n# a comment\n");
    const result = gate();
    expect(result.status, result.all).toBe(0);
    expect(result.stdout).toContain("perf gate: pass (1 commands");
    expect(result.stdout).toMatch(/tool\s+base.*head.*ok/);
  });

  it("passes when only one lucky base run is faster: the paired runs decide, not the two minimums", () => {
    // The base tool is fast once (its first run), then as slow as the head tool.
    const lucky = '#!/bin/sh\nn=$(cat "$HOME/n" 2>/dev/null || echo 0)\necho $((n + 1)) > "$HOME/n"\n';
    writeFileSync(join(fix, "tool.sh"), `${lucky}[ "$n" = 0 ] && exec sleep 0.03\nsleep 0.10\n`);
    commit("a base with one fast run");
    git("branch", "-q", "-f", "main", "work");
    tool("0.10");
    const samples = join(dir, "samples.jsonl");
    const result = gate(["--json"], { PERF_GATE_RUNS: "5", PERF_GATE_SAMPLES: samples });
    expect(result.status, result.all).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.estimator).toBe("min-and-paired-median");
    const [row] = report.commands;
    // The minimums alone say "slower" (the old verdict); the pairs say "same".
    expect(row.ratio).toBeGreaterThan(1.5);
    expect(Math.abs(row.paired_delta_ms)).toBeLessThan(30);
    expect(row.verdict).toBe("ok");
    expect(result.stderr).toContain("tool: the fastest runs differ");
    expect(result.stderr).toContain("load noise, not a slowdown");

    const [line] = readFileSync(samples, "utf-8").trim().split("\n");
    const dump = JSON.parse(line ?? "{}");
    expect(dump.name).toBe("tool");
    expect(dump.pairs).toHaveLength(5);
    expect(dump.pairs[0]).toHaveLength(2);
  });

  it("reports the paired difference of a real slowdown", TIMING, () => {
    tool(SLOW);
    const result = gate(["--json"], { PERF_GATE_RUNS: "5" });
    expect(result.status, result.all).toBe(1);
    const [row] = JSON.parse(result.stdout).commands;
    expect(row.verdict).toBe("slower");
    expect(row.paired_delta_ms).toBeGreaterThan(30);
    expect(result.stderr).toMatch(/tool got slower: .*paired runs: \+\d/);
  });

  it("fails when the command is over its ceiling", () => {
    budget("tool\t50\tsh tool.sh");
    const result = gate();
    expect(result.status, result.all).toBe(1);
    expect(result.stderr).toContain("tool is over its ceiling");
  });

  it("gives a command that is missing at the base the ceiling check only", () => {
    tool("0.10", "new.sh");
    budget("tool\t2000\tsh tool.sh", "fresh\t2000\tsh ./new.sh");
    const pass = gate();
    expect(pass.status, pass.all).toBe(0);
    expect(pass.stdout).toMatch(/fresh\s+base\s+-.*new/);

    budget("tool\t2000\tsh tool.sh", "fresh\t50\tsh ./new.sh");
    const breach = gate();
    expect(breach.status, breach.all).toBe(1);
    expect(breach.stderr).toContain("fresh is over its ceiling");
  });

  it("lets an allow line pass an intended slowdown, for one PR only", TIMING, () => {
    tool(SLOW);
    budget("tool\t2000\tsh tool.sh", "PERF_GATE_ALLOW=tool:does more work on purpose");
    const allowed = gate([], { PERF_GATE_RUNS: "5" });
    expect(allowed.status, allowed.all).toBe(0);
    expect(allowed.stdout).toMatch(/tool.*allowed/);

    // After the merge the base has the line too: the next PR must remove it.
    commit("allow");
    git("branch", "-q", "-f", "main", "work");
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nsleep 0.12\n# touch\n");
    const stale = gate();
    expect(stale.status, stale.all).toBe(1);
    expect(stale.stderr).toContain("PERF_GATE_ALLOW=tool is already in the base budget file");
  });

  it("does not let an allow line lift the ceiling", () => {
    tool("0.12");
    budget("tool\t50\tsh tool.sh", "PERF_GATE_ALLOW=tool:on purpose");
    const result = gate();
    expect(result.status, result.all).toBe(1);
    expect(result.stderr).toContain("tool is over its ceiling");
  });

  it("fails when a command fails in this tree", () => {
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nexit 3\n");
    const result = gate();
    expect(result.status, result.all).toBe(1);
    expect(result.stderr).toContain("tool: the command failed in this tree (status 3)");
  });

  it("prints base_min, head_min, ratio, and verdict per command with --json", TIMING, () => {
    tool(SLOW);
    const result = gate(["--json"], { PERF_GATE_RUNS: "5" });
    expect(result.status, result.all).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ skipped: false, ok: false, limit_ratio: 1.1, limit_ms: 3, base_ref: "main" });
    expect(report.base_ref_date).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(report.base).toHaveLength(40);
    expect(report.commands).toHaveLength(1);
    expect(report.commands[0]).toMatchObject({ name: "tool", verdict: "slower", ceiling_ms: 2000 });
    expect(report.commands[0].base_min).toBeGreaterThanOrEqual(100);
    expect(report.commands[0].head_min).toBeGreaterThanOrEqual(150);
    expect(report.commands[0].ratio).toBeGreaterThan(1.1);
  });
});

describe("perf gate scope", () => {
  it("skips a diff with no runtime change, and a test file is not one", () => {
    budget("PERF_GATE_PATH=lib/", "tool\t2000\tsh tool.sh");
    commit("scope");
    git("branch", "-q", "-f", "main", "work");
    writeFileSync(join(fix, "README.md"), "docs\n");
    mkdirSync(join(fix, "lib"));
    writeFileSync(join(fix, "lib", "x.test.ts"), "// a test\n");

    const result = gate();
    expect(result.status, result.all).toBe(0);
    expect(result.stdout).toBe("perf gate: skipped (no runtime change)\n");
    expect(existsSync(cacheDir())).toBe(false);

    const json = gate(["--json"]);
    expect(JSON.parse(json.stdout)).toEqual({ skipped: true, reason: "no runtime change" });
  });

  it("times the commands with --force when there is no runtime change", () => {
    const result = gate(["--force"]);
    expect(result.status, result.all).toBe(0);
    expect(result.stdout).toContain("perf gate: pass");
  });

  it("treats a command that is listed twice as a setup error", () => {
    budget("tool\t2000\tsh tool.sh", "tool\t2000\tsh tool.sh");
    const result = gate();
    expect(result.status, result.all).toBe(2);
    expect(result.stderr).toContain("command tool is listed twice");
  });

  it("treats a bad budget line as a setup error", () => {
    budget("tool\tfast\tsh tool.sh");
    const result = gate();
    expect(result.status, result.all).toBe(2);
    expect(result.stderr).toContain("bad line");
  });
});

describe("perf gate runs", () => {
  it("gives the commands a scratch HOME and not the caller's environment", () => {
    const check = `[ -z "\${SECRET_THING:-}" ] && [ "$DO_NOT_TRACK" = 1 ] && [ "$AGENTBREW_EVENTS" = 0 ] && [ "$AGENTBREW_TELEMETRY" = 0 ] && [ "$AGENTBREW_EVENTS_FILE" = "$HOME/events.jsonl" ] && [ "$HOME" != "${process.env.HOME}" ]`;
    writeFileSync(join(fix, "tool.sh"), `#!/bin/sh\n${check}\n`);
    const result = gate([], { SECRET_THING: "x" });
    expect(result.status, result.all).toBe(0);
  });

  it("times through heavy-run --exclusive, but not inside a heavy-run slot", () => {
    const bin = join(dir, "bin");
    const calls = join(dir, "heavy-run.calls");
    mkdirSync(bin);
    writeFileSync(join(bin, "heavy-run"), `#!/bin/sh\necho "$1" >> "${calls}"\nshift\nexec "$@"\n`);
    chmodSync(join(bin, "heavy-run"), 0o755);
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nsleep 0.10\n# touch\n");
    const withHeavyRun = { PATH: `${bin}:${process.env.PATH}`, PERF_GATE_HEAVY_RUN: "1" };

    const queued = gate([], withHeavyRun);
    expect(queued.status, queued.all).toBe(0);
    expect(readFileSync(calls, "utf-8")).toBe("--exclusive\n");

    const inSlot = gate([], { ...withHeavyRun, HEAVY_RUN_SLOT: "1" });
    expect(inSlot.status, inSlot.all).toBe(0);
    expect(inSlot.stderr).toContain("already inside a heavy-run slot");
    expect(readFileSync(calls, "utf-8")).toBe("--exclusive\n");
  });

  /** Run the gate on three merge-bases in a row; age makes the older ready markers that old first. */
  function threeBases(ageMs: number): string[] {
    const shas = [git("rev-parse", "main")];
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nsleep 0.10\n# touch\n");
    expect(gate().status).toBe(0);
    expect(existsSync(join(cacheDir(), shas[0] ?? "", "tool.sh"))).toBe(true);

    for (const step of [2, 3]) {
      commit(`step ${step}`);
      git("branch", "-q", "-f", "main", "work");
      shas.push(git("rev-parse", "main"));
      writeFileSync(join(fix, "tool.sh"), `#!/bin/sh\nsleep 0.10\n# touch ${step}\n`);
      for (const [index, sha] of shas.slice(0, -1).entries()) {
        const then = new Date(Date.now() - ageMs - (shas.length - index) * 60_000);
        if (ageMs > 0) utimesSync(join(cacheDir(), `${sha}.ready`), then, then);
      }
      const result = gate();
      expect(result.status, result.all).toBe(0);
    }
    return shas;
  }
  const checkouts = () =>
    readdirSync(cacheDir())
      .filter((name) => /^[0-9a-f]{40}$/.test(name))
      .sort();

  it("caches the base checkout by commit and keeps only two old ones", () => {
    const shas = threeBases(2 * 60 * 60 * 1000);
    expect(checkouts()).toEqual([shas[1], shas[2]].sort());
    expect(git("worktree", "list").split("\n")).toHaveLength(3);
    expect(cacheDir()).toContain("perf-gate.noindex");
  });

  it("keeps a base checkout that a gate used in the last hour", () => {
    const shas = threeBases(0);
    expect(checkouts()).toEqual([...shas].sort());
  });

  it("resolves a relative cache path, so the checkout does not depend on the working directory", () => {
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nsleep 0.10\n# touch\n");
    const result = gate([], { XDG_CACHE_HOME: "relcache" });
    expect(result.status, result.all).toBe(0);
    const checkout = join(fix, "relcache", "agentbrew", "perf-gate.noindex", git("rev-parse", "main"));
    expect(existsSync(join(checkout, "tool.sh"))).toBe(true);
    expect(git("worktree", "list")).toContain(checkout);
  });
});

describe("perf gate builds", () => {
  const BUILD = [
    "PERF_GATE_BUILD=sh build.sh",
    "PERF_GATE_BUILD_OUTPUT=out/tool.sh",
    "PERF_GATE_BUILD_INPUT=tool.sh",
    "tool\t2000\tsh out/tool.sh",
  ];

  /** A repo whose tracked command is a build product (out/ is ignored). */
  function buildRepo(baseBuild: string): string {
    const builds = join(dir, "builds");
    writeFileSync(join(fix, ".gitignore"), "out/\n");
    writeFileSync(join(fix, "build.sh"), baseBuild);
    budget(...BUILD);
    commit("build");
    git("branch", "-q", "-f", "main", "work");
    return builds;
  }
  const GOOD_BUILD = 'mkdir -p out && cp tool.sh out/tool.sh && echo "$PWD" >> "$BUILD_LOG"\n';

  it("builds the base once per commit, and this tree when its output is stale", () => {
    const builds = buildRepo(GOOD_BUILD);
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nsleep 0.10\n# touch\n");
    const first = gate([], { BUILD_LOG: builds });
    expect(first.status, first.all).toBe(0);
    expect(first.stderr).toContain("perf gate: building this tree");
    expect(first.stdout).toMatch(/tool\s+base\s+\d.*head.*ok/);
    const base = join(cacheDir(), git("rev-parse", "main"));
    expect(readFileSync(builds, "utf-8").split("\n").filter(Boolean).sort()).toEqual([base, fix].sort());

    // Warm: neither tree is built again.
    const second = gate([], { BUILD_LOG: builds });
    expect(second.status, second.all).toBe(0);
    expect(second.stderr).not.toContain("building this tree");
    expect(readFileSync(builds, "utf-8").split("\n").filter(Boolean)).toHaveLength(2);

    // An edited build input makes the output stale.
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nsleep 0.10\n# touch again\n");
    const third = gate([], { BUILD_LOG: builds });
    expect(third.status, third.all).toBe(0);
    expect(readFileSync(builds, "utf-8").split("\n").filter(Boolean)).toHaveLength(3);
    expect(readFileSync(join(fix, "out", "tool.sh"), "utf-8")).toContain("touch again");
  });

  it("exits 2 when the base build fails: no base is not a pass", () => {
    const builds = buildRepo('echo "no compiler here" >&2\nexit 7\n');
    writeFileSync(join(fix, "build.sh"), GOOD_BUILD);
    const result = gate([], { BUILD_LOG: builds });
    expect(result.status, result.all).toBe(2);
    expect(result.stderr).toContain("perf gate: cannot build the base commit");
    expect(result.stderr).toContain("`sh build.sh` failed (exit 7)");
    expect(result.stderr).toContain("no compiler here");
    expect(result.stdout).toBe("");
    expect(readdirSync(cacheDir()).filter((name) => name.endsWith(".ready"))).toEqual([]);
  });

  it("fails as a setup error when this tree does not build", () => {
    const builds = buildRepo(GOOD_BUILD);
    writeFileSync(join(fix, "build.sh"), "exit 9\n");
    const result = gate([], { BUILD_LOG: builds });
    expect(result.status, result.all).toBe(2);
    expect(result.stderr).toContain("perf gate: cannot build this tree");
  });
});

describe("perf gate has no silent pass", () => {
  it("exits 2 when the command fails at the base", () => {
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nexit 4\n");
    commit("broken base");
    git("branch", "-q", "-f", "main", "work");
    tool("0.10");
    const result = gate();
    expect(result.status, result.all).toBe(2);
    expect(result.stderr).toContain("tool failed in the base checkout (status 4)");
    expect(result.stdout).not.toContain("perf gate: pass");
  });

  it("exits 2 when the base checkout is at another commit", () => {
    const base = git("rev-parse", "main");
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nsleep 0.10\n# touch\n");
    expect(gate().status).toBe(0);
    commit("another commit");
    execFileSync("git", ["-C", join(cacheDir(), base), "checkout", "-q", "--detach", git("rev-parse", "work")], {
      env,
    });
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nsleep 0.10\n# touch 2\n");
    const result = gate();
    expect(result.status, result.all).toBe(2);
    expect(result.stderr).toContain(`not ${base}`);
  });

  it("exits 2 with no base commit, unless PERF_GATE_NO_BASE=1 asks for ceilings only", () => {
    const result = gate([], { PERF_GATE_BASE: "no-such-ref" });
    expect(result.status, result.all).toBe(2);
    expect(result.stderr).toContain("cannot find the merge-base of HEAD and no-such-ref");

    const optOut = gate([], { PERF_GATE_BASE: "no-such-ref", PERF_GATE_NO_BASE: "1" });
    expect(optOut.status, optOut.all).toBe(0);
    expect(optOut.stdout).toMatch(/tool\s+base\s+-.*new/);
    expect(optOut.stdout).toContain("base none");
    expect(optOut.stderr).toContain("no base commit for no-such-ref; PERF_GATE_NO_BASE=1, so only the ceilings apply");
  });

  it("exits 2 when the budget file lists no runtime path or no command", () => {
    writeFileSync(join(fix, "scripts", "perf-budget.tsv"), "tool\t2000\tsh tool.sh\n");
    const noPath = gate();
    expect(noPath.status, noPath.all).toBe(2);
    expect(noPath.stderr).toContain("lists no runtime path");

    writeFileSync(join(fix, "scripts", "perf-budget.tsv"), `${PATHS.join("\n")}\n`);
    const noCommand = gate();
    expect(noCommand.status, noCommand.all).toBe(2);
    expect(noCommand.stderr).toContain("lists no command");
  });

  it("keeps the base runtime paths when the head budget file drops them", TIMING, () => {
    writeFileSync(join(fix, "scripts", "perf-budget.tsv"), "PERF_GATE_PATH=nothing/\ntool\t2000\tsh tool.sh\n");
    commit("narrow the scope");
    tool(SLOW);
    const result = gate([], { PERF_GATE_RUNS: "5" });
    expect(result.status, result.all).toBe(1);
    expect(result.stderr).toContain("tool got slower");
  });

  it("sees a renamed runtime file as a runtime change", () => {
    git("mv", "tool.sh", "renamed.sh");
    commit("rename");
    const result = gate();
    expect(result.stdout).not.toContain("skipped");
    expect(result.status, result.all).toBe(1);
    expect(result.stderr).toContain("the command failed in this tree");
  });

  it("fails when a tracked row leaves the budget file without an allow line", () => {
    tool("0.10", "new.sh");
    budget("fresh\t2000\tsh ./new.sh");
    const removed = gate();
    expect(removed.status, removed.all).toBe(1);
    expect(removed.stderr).toContain("tool is in the base budget file but not in this one");

    budget("fresh\t2000\tsh ./new.sh", "PERF_GATE_ALLOW=tool:the command is gone");
    const allowed = gate();
    expect(allowed.status, allowed.all).toBe(0);
  });

  it("rejects an allow line that names an unknown command", () => {
    budget("tool\t2000\tsh tool.sh", "PERF_GATE_ALLOW=toool:a typo");
    const result = gate();
    expect(result.status, result.all).toBe(2);
    expect(result.stderr).toContain("PERF_GATE_ALLOW=toool names no command of the budget file");
  });

  it("takes over a lock whose owner is gone, and releases its own", () => {
    mkdirSync(join(cacheDir(), "lock"), { recursive: true });
    writeFileSync(join(cacheDir(), "lock", "pid"), "999999");
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nsleep 0.10\n# touch\n");
    const result = gate();
    expect(result.status, result.all).toBe(0);
    expect(existsSync(join(cacheDir(), "lock"))).toBe(false);
  });

  it("waits for a lock with no pid in it or a live owner, and exits 2 when the wait ends", () => {
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nsleep 0.10\n# touch\n");
    mkdirSync(join(cacheDir(), "lock"), { recursive: true });
    writeFileSync(join(cacheDir(), "lock", "pid"), "");
    const noPid = gate([], { PERF_GATE_LOCK_WAIT: "1" });
    expect(noPid.status, noPid.all).toBe(2);
    expect(noPid.stderr).toContain("another perf gate holds");
    expect(existsSync(join(cacheDir(), "lock"))).toBe(true);

    writeFileSync(join(cacheDir(), "lock", "pid"), String(process.pid));
    const live = gate([], { PERF_GATE_LOCK_WAIT: "1" });
    expect(live.status, live.all).toBe(2);
    expect(readFileSync(join(cacheDir(), "lock", "pid"), "utf-8")).toBe(String(process.pid));
    expect(readdirSync(cacheDir())).toEqual(["lock"]);
  });

  it("exits 2 on an unexpected error: exit 1 is only for a measured result", () => {
    const result = gate(["--time"], { PERF_GATE_PLAN: "{not json" });
    expect(result.status, result.all).toBe(2);
    expect(result.stderr).toContain("perf gate: unexpected error");
  });

  it("needs an allow line when the gate script itself differs from the base", () => {
    const self = join(fix, "scripts", "perf-gate.mjs");
    // No gate script at the base (the PR that adds the gate): no allow line is needed.
    writeFileSync(self, "// the gate\n");
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nsleep 0.10\n# touch\n");
    const added = gate();
    expect(added.status, added.all).toBe(0);

    commit("add the gate script");
    git("branch", "-q", "-f", "main", "work");
    writeFileSync(self, "// the gate, with a wider limit\n");
    const changed = gate();
    expect(changed.status, changed.all).toBe(2);
    expect(changed.stderr).toContain("scripts/perf-gate.mjs differs from the base");
    expect(changed.stderr).toContain("PERF_GATE_ALLOW=perf-gate:<reason>");
    expect(changed.stdout).toBe("");

    budget("tool\t2000\tsh tool.sh", "PERF_GATE_ALLOW=perf-gate:new estimator");
    const allowed = gate();
    expect(allowed.status, allowed.all).toBe(0);
  });

  it("removes only its own worktrees: a stale worktree of the user stays registered", () => {
    const other = join(dir, "user-worktree");
    git("worktree", "add", "-q", "--detach", other, "main");
    rmSync(other, { recursive: true, force: true });
    writeFileSync(join(fix, "tool.sh"), "#!/bin/sh\nsleep 0.10\n# touch\n");
    expect(gate().status).toBe(0);
    expect(git("worktree", "list")).toContain(other);
  });
});

describe("the committed perf budget", () => {
  const rows = readFileSync(BUDGET, "utf-8")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"));

  it("lists real files, ceilings, and the runtime paths", () => {
    const commands = rows.filter((line) => !line.startsWith("PERF_GATE_")).map((line) => line.split("\t"));
    expect(commands.map((command) => command[0])).toEqual(
      expect.arrayContaining(["cli-version", "cli-help", "cli-actions-json", "hook-perf-record"]),
    );
    for (const [name, ceiling, argv] of commands) {
      expect(ceiling, name).toMatch(/^\d+$/);
      const script = (argv ?? "").split(" ").find((word) => word.startsWith("hooks/"));
      if (script) expect(existsSync(join(REPO_ROOT, script)), script).toBe(true);
    }
    for (const path of ["src/", "hooks/", "templates/scripts/", "package.json", "tsup.config.ts"]) {
      expect(rows).toContain(`PERF_GATE_PATH=${path}`);
    }
    for (const path of ["tsconfig.json", "scripts/build-source.sh", "native/", "rust/"]) {
      expect(rows).toContain(`PERF_GATE_PATH=${path}`);
      expect(rows).toContain(`PERF_GATE_BUILD_INPUT=${path}`);
    }
    expect(rows).toContain("PERF_GATE_BUILD_INPUT=package-lock.json");
    expect(rows).toContain("PERF_GATE_BUILD=npm run build");
  });

  it("is a step of both gates and an npm script", () => {
    const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf-8");
    expect(read("scripts/verify.sh")).toMatch(/^perf-gate node scripts\/perf-gate\.mjs$/m);
    expect(read("scripts/verify-changed.sh")).toMatch(
      /^step env PERF_GATE_BASE="\$base_ref" node scripts\/perf-gate\.mjs$/m,
    );
    expect(JSON.parse(read("package.json")).scripts["perf:gate"]).toBe("node scripts/perf-gate.mjs");
  });
});
