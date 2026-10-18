import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
function scratchRepo(stepCommand = "bash count.sh") {
  const repo = mkdtempSync(join(tmpdir(), "agentbrew-verify-"));
  roots.push(repo);
  mkdirSync(join(repo, "scripts"));
  copyFileSync(SCRIPT, join(repo, "scripts", "verify.sh"));
  writeFileSync(join(repo, ".gitignore"), ".metrics/\n");
  writeFileSync(join(repo, "a.txt"), "one\n");
  writeFileSync(join(repo, "count.sh"), 'echo run >> "$COUNT_FILE"\n');
  writeFileSync(join(repo, "plan.txt"), `count ${stepCommand}\n`);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env: gitEnv, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init");
  const countFile = join(repo, "..", `${repo.split("/").pop()}.count`);
  roots.push(countFile);
  const run = (env: Record<string, string> = {}) =>
    spawnSync("bash", ["scripts/verify.sh"], {
      cwd: repo,
      encoding: "utf-8",
      env: { ...gitEnv, VERIFY_PLAN: join(repo, "plan.txt"), COUNT_FILE: countFile, ...env },
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
