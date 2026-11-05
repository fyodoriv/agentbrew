import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// scripts/verify.sh: a step that passed on the same inputs is skipped; an
// edit to any tracked or untracked file re-runs it; NO_CACHE=1 runs all; a
// failed step is never cached; each run lands in .metrics/gate-timings.jsonl.

const SCRIPT = resolve(import.meta.dirname, "..", "..", "scripts", "verify.sh");
const INSTALLED_PAYLOAD_CHECK = 'test "$(cat node_modules/fixture-leaf/payload)" = baseline';
const INSTALLED_COUNT_SCRIPT = `echo run >> "$COUNT_FILE"\n${INSTALLED_PAYLOAD_CHECK}\n`;
const roots: string[] = [];
const gitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  BASH_ENV: "",
  ENV: "",
  NODE_OPTIONS: "",
  NODE_PATH: "",
  HOOK_FIXTURES_HOST_ENV: "",
  HOOK_FIXTURE_BASH: "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
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
      const { repo, run, runs } = scratchRepo("bash count.sh", childEnv);
      writeFileSync(join(repo, "count.sh"), INSTALLED_COUNT_SCRIPT);
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
      const counterfactual = spawnSync("bash", ["-c", INSTALLED_PAYLOAD_CHECK], {
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

describe("installed dependency cache admission", () => {
  const independent = [
    "lint-security bash scripts/lint-security.sh",
    "lint-artifacts bash scripts/lint-repo-artifacts.sh",
    "hook-fixtures bash scripts/run-hook-fixtures.sh",
    "lint-tasks node scripts/lint-tasks-stability.mjs TASKS.md",
  ];

  function installFixture(repo: string) {
    writeFileSync(join(repo, ".gitignore"), ".metrics/\nnode_modules/\n");
    mkdirSync(join(repo, "node_modules", "fixture-leaf"), { recursive: true });
    const payload = join(repo, "node_modules", "fixture-leaf", "payload");
    writeFileSync(payload, "baseline\n");
    return payload;
  }

  function independentScripts(repo: string) {
    for (const step of independent) {
      const [, , script] = step.split(" ");
      copyFileSync(resolve(dirname(SCRIPT), "..", script), join(repo, script));
    }
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "fixture.ts"), "export {};\n");
    mkdirSync(join(repo, "hooks", "checks"), { recursive: true });
    mkdirSync(join(repo, "hooks", "lib"));
    writeFileSync(join(repo, "hooks", "checks", "fixture.sh"), "true\n");
    writeFileSync(join(repo, "hooks", "checks", "fixture.test.sh"), "true\n");
    writeFileSync(join(repo, "TASKS.md"), "# Tasks\n\n## P1\n");
  }

  function installShim(repo: string, tool: string, external: string): string {
    const bin = join(repo, "node_modules", ".bin");
    mkdirSync(bin);
    writeFileSync(join(bin, tool), `#!/bin/sh\nexec ${external} "$@"\n`, { mode: 0o755 });
    return `${bin}:${gitEnv.PATH}`;
  }

  it("retains four actual independent warm hits and executes the changed installed input", () => {
    const { repo, run, runs } = scratchRepo();
    const payload = installFixture(repo);
    independentScripts(repo);
    writeFileSync(join(repo, "count.sh"), INSTALLED_COUNT_SCRIPT);
    writeFileSync(join(repo, "plan.txt"), `${independent.join("\n")}\ncount bash count.sh\n`);

    const cold = run();
    expect(cold.status, cold.stderr).toBe(0);
    expect(cold.stdout).toContain("Hook fixture tests: all passed");
    expect(cold.stdout).toContain("tasks-stability: OK");
    const warm = run();
    writeFileSync(payload, "changed\n");
    const drift = run();

    expect(warm.status).toBe(0);
    for (const step of independent) {
      const name = step.split(" ")[0];
      expect(warm.stdout).toContain(`${name}: cached`);
      expect(drift.stdout).toContain(`${name}: cached`);
    }
    expect(warm.stdout).toContain("4 of 5 steps from cache");
    expect(drift.stdout).not.toContain("count: cached");
    expect(drift.status).toBe(1);
    expect(runs()).toBe(3);
    console.info("LOCKED_INSTALL_N4_WARM independent=4/4 dependency_sensitive=0/1 drift=refused");
  });

  it("does not trust the name of an independent step with a different command", () => {
    const { repo, run, runs } = scratchRepo();
    installFixture(repo);
    writeFileSync(join(repo, "plan.txt"), "lint-artifacts bash count.sh\n");
    expect(run().status).toBe(0);
    const warm = run();
    expect(warm.status).toBe(0);
    expect(warm.stdout).not.toContain("lint-artifacts: cached");
    expect(runs()).toBe(2);
  });

  it("does not reuse a pass with a dangling installation link", () => {
    const { repo, run, runs } = scratchRepo();
    writeFileSync(join(repo, ".gitignore"), ".metrics/\nnode_modules\n");
    symlinkSync(join(repo, "absent-install"), join(repo, "node_modules"), "dir");
    expect(run().status).toBe(0);
    const warm = run();
    expect(warm.status).toBe(0);
    expect(warm.stdout).not.toContain("count: cached");
    expect(runs()).toBe(2);
  });

  it("does not cache an independent step when an installed shim can launch it", () => {
    const { repo, run } = scratchRepo();
    installFixture(repo);
    independentScripts(repo);
    writeFileSync(join(repo, "plan.txt"), "lint-security bash scripts/lint-security.sh\n");
    const path = installShim(repo, "bash", "/bin/bash");
    expect(run({ PATH: path }).status).toBe(0);
    const warm = run({ PATH: path });
    expect(warm.status).toBe(0);
    expect(warm.stdout).not.toContain("lint-security: cached");
  });

  it.each([
    ["hook-fixtures bash scripts/run-hook-fixtures.sh", "env", "Hook fixture tests: all passed"],
    ["lint-artifacts bash scripts/lint-repo-artifacts.sh", "sort", "Repo artifact lint: no root =... files"],
  ])("does not cache %s when the installed %s helper is selected", (step, tool, output) => {
    const { repo, run } = scratchRepo();
    installFixture(repo);
    independentScripts(repo);
    writeFileSync(join(repo, "plan.txt"), `${step}\n`);
    const path = installShim(repo, tool, `/usr/bin/${tool}`);
    expect(run({ PATH: path }).stdout).toContain(output);
    const warm = run({ PATH: path });
    expect(warm.status, warm.stderr).toBe(0);
    expect(warm.stdout).toContain(output);
    expect(warm.stdout).not.toContain(`${step.split(" ")[0]}: cached`);
  });

  it("does not fall through to the no-install fixture cache with an ambient loader", () => {
    const { repo, run, runs } = scratchRepo();
    const loader = join(repo, "loader.sh");
    writeFileSync(loader, "true\n");
    expect(run({ BASH_ENV: loader }).status).toBe(0);
    const warm = run({ BASH_ENV: loader });
    expect(warm.status).toBe(0);
    expect(warm.stdout).not.toContain("count: cached");
    expect(runs()).toBe(2);
  });

  it.each([true, false])("runs artifact lint after an ignored root file appears (install %s)", (withInstall) => {
    const { repo, run } = scratchRepo();
    if (withInstall) installFixture(repo);
    independentScripts(repo);
    const ignore = join(repo, ".gitignore");
    writeFileSync(ignore, `${readFileSync(ignore, "utf8")}=fixture.log\n`);
    writeFileSync(join(repo, "plan.txt"), "lint-artifacts bash scripts/lint-repo-artifacts.sh\n");
    expect(run().status).toBe(0);
    expect(run().stdout).toContain("lint-artifacts: cached");

    writeFileSync(join(repo, "=fixture.log"), "fixture only\n");
    execFileSync("git", ["check-ignore", "--quiet", "--", "=fixture.log"], { cwd: repo, env: gitEnv });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("lint-artifacts: cached");
    expect(result.stderr).toContain("=fixture.log");
  });
});
