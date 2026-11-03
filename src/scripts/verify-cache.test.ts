import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// scripts/verify.sh: a step that passed on the same inputs is skipped; an
// edit to any tracked or untracked file re-runs it; NO_CACHE=1 runs all; a
// failed step is never cached; each run lands in .metrics/gate-timings.jsonl.

const SCRIPT = resolve(import.meta.dirname, "..", "..", "scripts", "verify.sh");
const roots: string[] = [];
const gitEnv: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
// The gate's own NO_CACHE=1 run must not leak into these cache tests.
delete gitEnv.NO_CACHE;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A scratch git repo with verify.sh, a tracked file, and a plan whose step counts its runs. */
function scratchRepo(stepCommand = "bash count.sh", childEnv = gitEnv) {
  const repo = mkdtempSync(join(tmpdir(), "agentbrew-verify-"));
  roots.push(repo);
  mkdirSync(join(repo, "scripts"));
  copyFileSync(SCRIPT, join(repo, "scripts", "verify.sh"));
  writeFileSync(join(repo, ".gitignore"), ".metrics/\n");
  writeFileSync(join(repo, "a.txt"), "one\n");
  writeFileSync(join(repo, "count.sh"), 'echo run >> "$COUNT_FILE"\n');
  writeFileSync(join(repo, "plan.txt"), `count ${stepCommand}\n`);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env: childEnv, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init");
  const countFile = join(repo, "..", `${repo.split("/").pop()}.count`);
  roots.push(countFile);
  const run = (env: Record<string, string> = {}) =>
    spawnSync("bash", ["scripts/verify.sh"], {
      cwd: repo,
      encoding: "utf-8",
      env: { ...childEnv, VERIFY_PLAN: join(repo, "plan.txt"), COUNT_FILE: countFile, ...env },
    });
  const runs = () => {
    try {
      return readFileSync(countFile, "utf-8").trim().split("\n").length;
    } catch {
      return 0;
    }
  };
  return { repo, run, runs };
}

describe("scripts/verify.sh cache", () => {
  it("skips a step whose inputs did not change", () => {
    const { run, runs } = scratchRepo();
    expect(run().status).toBe(0);
    const second = run();
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("count: cached");
    expect(runs()).toBe(1);
  });

  it("re-runs after an edit to one tracked file", () => {
    const { repo, run, runs } = scratchRepo();
    run();
    writeFileSync(join(repo, "a.txt"), "two\n");
    run();
    expect(runs()).toBe(2);
  });

  it("re-runs after a new untracked file", () => {
    const { repo, run, runs } = scratchRepo();
    run();
    writeFileSync(join(repo, "b.txt"), "new\n");
    run();
    expect(runs()).toBe(2);
  });

  it("runs every step with NO_CACHE=1", () => {
    const { run, runs } = scratchRepo();
    run();
    run({ NO_CACHE: "1" });
    expect(runs()).toBe(2);
  });

  it("never caches a failed step, and stops the gate with its exit code", () => {
    const { run: failing, runs } = scratchRepo("bash missing-script.sh");
    expect(failing().status).not.toBe(0);
    const again = failing();
    expect(again.status).not.toBe(0);
    expect(again.stdout).not.toContain("cached");
    expect(runs()).toBe(0);
  });

  it("keys the lockfile-sync step on the package files only", () => {
    const { repo, run, runs } = scratchRepo();
    writeFileSync(join(repo, "plan.txt"), "lockfile-sync bash count.sh\n");
    writeFileSync(join(repo, "package.json"), '{"name":"p"}\n');
    writeFileSync(join(repo, "package-lock.json"), '{"lockfileVersion":3}\n');
    run();
    writeFileSync(join(repo, "a.txt"), "two\n");
    expect(run().stdout).toContain("lockfile-sync: cached");
    expect(runs()).toBe(1);
    writeFileSync(join(repo, "package.json"), '{"name":"p","dependencies":{"x":"1"}}\n');
    run();
    expect(runs()).toBe(2);
  });

  it("keys the hook-fixtures step on the files the fixtures run", () => {
    const { repo, run, runs } = scratchRepo();
    writeFileSync(join(repo, "plan.txt"), "hook-fixtures bash count.sh\n");
    mkdirSync(join(repo, "hooks"));
    writeFileSync(join(repo, "hooks", "a.sh"), "true\n");
    run();
    writeFileSync(join(repo, "a.txt"), "two\n");
    expect(run().stdout).toContain("hook-fixtures: cached");
    expect(runs()).toBe(1);
    writeFileSync(join(repo, "hooks", "a.sh"), "false\n");
    run();
    expect(runs()).toBe(2);
  });

  it("lists every repo path that a hook fixture reaches outside hooks/", () => {
    const inputs = (readFileSync(SCRIPT, "utf-8").match(/^\s*hook-fixtures\) echo "([^"]+)"/m)?.[1] ?? "").split(" ");
    expect(inputs).toContain("hooks");
    const hooksDir = resolve(import.meta.dirname, "..", "..", "hooks");
    const reached = new Set<string>();
    for (const dir of ["checks", "lib"]) {
      for (const name of readdirSync(join(hooksDir, dir))) {
        if (!name.endsWith(".sh")) continue;
        // Comment lines may name paths in other repos (shellcheck source=).
        const text = readFileSync(join(hooksDir, dir, name), "utf-8")
          .split("\n")
          .filter((line) => !line.trim().startsWith("#"))
          .join("\n");
        for (const m of text.matchAll(/\.\.\/\.\.\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/g)) reached.add(m[1]);
        for (const m of text.matchAll(/\.\.\/\.\." && pwd\)\/([A-Za-z0-9_./-]+)/g)) reached.add(m[1]);
      }
    }
    expect(reached.size).toBeGreaterThan(0);
    for (const path of reached) {
      expect(
        inputs.some((input) => path === input || path.startsWith(`${input}/`)),
        `${path} is not in the hook-fixtures inputs`,
      ).toBe(true);
    }
  });

  it("shares the cache with the other worktrees of the repo", () => {
    const { repo, run, runs } = scratchRepo();
    expect(run().status).toBe(0);
    const worktree = `${repo}-wt`;
    roots.push(worktree);
    execFileSync("git", ["worktree", "add", "-q", "--detach", worktree], { cwd: repo, env: gitEnv, stdio: "pipe" });
    const second = spawnSync("bash", ["scripts/verify.sh"], {
      cwd: worktree,
      encoding: "utf-8",
      env: {
        ...gitEnv,
        VERIFY_PLAN: join(repo, "plan.txt"),
        COUNT_FILE: join(repo, "..", `${repo.split("/").pop()}.count`),
      },
    });
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("count: cached");
    expect(runs()).toBe(1);
  });

  it("logs each step and the gate to .metrics/gate-timings.jsonl", () => {
    const { repo, run } = scratchRepo();
    run();
    run();
    const events = readFileSync(join(repo, ".metrics", "gate-timings.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.filter((e) => e.event === "step")).toEqual([
      expect.objectContaining({ step: "count", ok: true, cached: false }),
      expect.objectContaining({ step: "count", ok: true, cached: true }),
    ]);
    expect(events.filter((e) => e.event === "gate").map((e) => e.cached_steps)).toEqual([0, 1]);
  });
});

describe("locked-install cache observation calibration", () => {
  function classify(complete: boolean, actualExit: number | null, counterfactualExit: number | null, reused: boolean) {
    if (!complete || actualExit === null || counterfactualExit === null) return "inconclusive";
    if (counterfactualExit !== 0 && (reused || actualExit === 0)) return "unsafe-permit";
    if (actualExit === 1 && !reused && counterfactualExit === 1) return "refused";
    return actualExit === 0 ? "supported" : "inconclusive";
  }

  it.each([
    { complete: true, actualExit: 0, counterfactualExit: 1, reused: true, expected: "unsafe-permit" },
    { complete: true, actualExit: 1, counterfactualExit: 1, reused: false, expected: "refused" },
    { complete: true, actualExit: 1, counterfactualExit: 1, reused: true, expected: "unsafe-permit" },
    { complete: true, actualExit: 2, counterfactualExit: 1, reused: false, expected: "inconclusive" },
    { complete: true, actualExit: 0, counterfactualExit: 0, reused: false, expected: "supported" },
    { complete: false, actualExit: 0, counterfactualExit: 1, reused: true, expected: "inconclusive" },
    { complete: true, actualExit: 0, counterfactualExit: null, reused: true, expected: "inconclusive" },
  ])("preserves sealed cache decision $expected ($complete, $actualExit, $counterfactualExit)", (sample) => {
    expect(classify(sample.complete, sample.actualExit, sample.counterfactualExit, sample.reused)).toBe(
      sample.expected,
    );
  });

  describe.runIf(process.env.LOCKED_INSTALL_OBSERVATION === "1")("qualified cache boundary", () => {
    it("N4 records ignored installed-payload drift without blessing stale cache reuse", () => {
      const command = 'bash count.sh && test "$(cat node_modules/fixture-leaf/payload)" = baseline';
      const template = mkdtempSync(join(tmpdir(), "agentbrew-observation-template-"));
      roots.push(template);
      const childEnv: NodeJS.ProcessEnv = { ...process.env };
      for (const key of Object.keys(childEnv)) {
        if (
          /^(GIT_|AGENTBREW_)/u.test(key) ||
          ["BASH_ENV", "ENV", "NODE_OPTIONS", "NODE_PATH", "NO_CACHE", "VERIFY_PLAN", "COUNT_FILE"].includes(key)
        )
          delete childEnv[key];
      }
      Object.assign(childEnv, {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TEMPLATE_DIR: template,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.hooksPath",
        GIT_CONFIG_VALUE_0: "/dev/null",
        PATH: [dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"),
      });
      const { repo, run, runs } = scratchRepo(command, childEnv);
      writeFileSync(join(repo, ".gitignore"), ".metrics/\nnode_modules/\n");
      const leaf = join(repo, "node_modules", "fixture-leaf");
      mkdirSync(leaf, { recursive: true });
      const payload = join(leaf, "payload");
      writeFileSync(payload, "baseline\n");
      const sourceIdentity = () =>
        execFileSync("git", ["diff", "HEAD", "--", "."], { cwd: repo, env: childEnv, encoding: "utf8" });
      const beforeSource = sourceIdentity();
      const first = run({ BASH_ENV: "", ENV: "" });
      const firstExecutions = runs();
      writeFileSync(payload, "changed\n");
      const counterfactual = spawnSync("bash", ["-c", 'test "$(cat node_modules/fixture-leaf/payload)" = baseline'], {
        cwd: repo,
        env: childEnv,
        encoding: "utf8",
        timeout: 10_000,
      });
      const second = run({ BASH_ENV: "", ENV: "" });
      const secondExecutions = runs();
      const unchangedSource = sourceIdentity() === beforeSource;
      const reused = second.stdout.includes("count: cached");
      const complete =
        !first.error &&
        !second.error &&
        !counterfactual.error &&
        first.status === 0 &&
        firstExecutions === 1 &&
        counterfactual.status === 1 &&
        unchangedSource &&
        secondExecutions === (reused ? 1 : 2) &&
        typeof second.status === "number";
      const classification = classify(complete, second.status, counterfactual.status, reused);
      const decisionComplete = complete && classification !== "inconclusive";
      const observation = {
        scenario: "N4",
        boundary: "gate-cache",
        firstExit: first.status,
        actualExit: second.status,
        counterfactualExit: counterfactual.status,
        firstExecutions,
        secondExecutions,
        cacheReused: reused,
        trackedSourceUnchanged: unchangedSource,
        complete: decisionComplete,
        classification,
        meetsRequiredDecision: decisionComplete && classification === "refused",
      };
      console.info(`LOCKED_INSTALL_OBSERVATION ${JSON.stringify(observation)}`);
      expect(decisionComplete, "N4 observation is incomplete; it is not zero unsafe permits").toBe(true);
    });
  });
});
