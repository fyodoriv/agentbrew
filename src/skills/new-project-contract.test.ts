import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";

const skillRoot = join(process.cwd(), "skill-plugins", "workflow", "new-project");
const scaffold = join(skillRoot, "scripts", "scaffold.sh");
const checkSetup = join(skillRoot, "scripts", "check-setup.sh");
const scratch = mkdtempSync(join(tmpdir(), "new-project-"));
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
const profiles = [
  { profile: "tool", stack: "ts" },
  { profile: "assistant", stack: "python" },
  { profile: "side-project", stack: "rust" },
] as const;
const required = [
  "vision",
  "metrics",
  "observability",
  "user-stories",
  "setup",
  "e2e",
  "self-improving",
  "tasks",
  "checkup",
  "caching",
];

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function score(dir: string, profile: string, ...flags: string[]) {
  const run = spawnSync("/bin/bash", [checkSetup, dir, "--profile", profile, ...flags], { encoding: "utf-8", env });
  const match = /score: (\d+)\/(\d+)/.exec(run.stdout);
  expect(match, run.stdout + run.stderr).not.toBeNull();
  return { status: run.status, pass: Number(match?.[1]), total: Number(match?.[2]), out: run.stdout };
}

function scaffoldInto(dir: string, profile: string, stack: string) {
  return execFileSync(
    "/bin/bash",
    [scaffold, dir, "--profile", profile, "--name", `demo-${profile}`, "--stack", stack],
    {
      encoding: "utf-8",
      env,
    },
  );
}

describe("new-project skill", () => {
  it.each(profiles)("scaffolds a $profile repo that scores 100%", ({ profile, stack }) => {
    const dir = join(scratch, profile);
    scaffoldInto(dir, profile, stack);
    const result = score(dir, profile);
    expect(result.out).not.toContain("FAIL");
    expect(result.status).toBe(0);
    expect(readlinkSync(join(dir, "CLAUDE.md"))).toBe("AGENTS.md");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it.each(profiles)("strict mode fails a fresh $profile scaffold until FILL: markers are replaced", ({ profile }) => {
    const dir = join(scratch, profile);
    expect(score(dir, profile, "--strict").status).toBe(1);
    execFileSync("bash", ["-c", "grep -rIlw 'FILL' --exclude-dir=.git . | xargs perl -pi -e 's/\\bFILL\\b/Filled/g'"], {
      cwd: dir,
    });
    expect(score(dir, profile, "--strict").status).toBe(0);
  });

  it.each(profiles)("enforces every required area for $profile", ({ profile }) => {
    const areas =
      /areas: (.*)/
        .exec(score(join(scratch, profile), profile).out)?.[1]
        .trim()
        .split(" ") ?? [];
    for (const area of required) expect(areas, area).toContain(area);
  });

  it("runs the one-line setup, e2e, docs check, and speed report in a fresh scaffold", () => {
    const dir = join(scratch, "run");
    scaffoldInto(dir, "side-project", "none");
    const run = (script: string) =>
      execFileSync("bash", [join(dir, "scripts", script)], { cwd: dir, encoding: "utf-8", env });
    expect(run("setup.sh")).toContain("doctor: all checks passed");
    expect(run("e2e.sh")).toContain("ok US-01 setup");
    expect(run("check-docs.sh")).toContain("docs match the code");
    writeFileSync(
      join(dir, ".metrics", "events.jsonl"),
      '{"ts":"t","event":"check.step","name":"unit","seconds":3,"ok":true}\n',
    );
    expect(run("metrics.sh")).toMatch(/unit\s+1\s+3\.0/);
  });

  it("keeps check-docs and e2e right with prose, helpers, and required env keys", () => {
    const dir = join(scratch, "edge");
    scaffoldInto(dir, "tool", "none");
    const stories = join(dir, "docs", "user-stories.md");
    writeFileSync(stories, `${readFileSync(stories, "utf-8")}\nSee tests/e2e/us-01-setup.sh.\n`);
    mkdirSync(join(dir, "tests", "e2e", "fixtures"), { recursive: true });
    writeFileSync(join(dir, "tests", "e2e", "lib.sh"), "exit 1\n");
    writeFileSync(join(dir, ".env.example"), "API_KEY=  # required\n");
    const run = (script: string) =>
      execFileSync("/bin/bash", [join(dir, "scripts", script)], { cwd: dir, encoding: "utf-8", env });
    expect(run("check-docs.sh")).toContain("docs match the code");
    expect(run("e2e.sh")).toContain("e2e: 1 file(s) passed");
  });

  it("lets an existing repo map an area to its own files or waive it with a reason", () => {
    const dir = join(scratch, "mapped");
    scaffoldInto(dir, "tool", "none");
    renameSync(join(dir, "docs", "VISION.md"), join(dir, "VISION.md"));
    expect(score(dir, "tool").status).toBe(1);
    mkdirSync(join(dir, ".agents"), { recursive: true });
    writeFileSync(
      join(dir, ".agents", "requirements.yaml"),
      "map.vision: VISION.md\nwaive.e2e: spec-only repo; the CLI package owns the e2e\n",
    );
    const mapped = score(dir, "tool");
    expect(mapped.status).toBe(0);
    expect(mapped.out).toContain("PASS [vision] mapped to VISION.md");
    expect(mapped.out).toContain("WAIVED [e2e]");
    expect(mapped.out).toContain("waived: 1");
    writeFileSync(join(dir, ".agents", "requirements.yaml"), "map.vision: MISSING.md\n");
    expect(score(dir, "tool").out).toContain("FAIL [vision] mapped to MISSING.md");
  });

  it("caches gate steps by input hash and re-runs them after any change", () => {
    const dir = join(scratch, "cached");
    scaffoldInto(dir, "tool", "none");
    const gitEnv = { ...env, CHECK_OFFLINE: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com" };
    execFileSync("git", ["add", "-A"], { cwd: dir, env: gitEnv });
    const check = (extra: Record<string, string> = {}) =>
      execFileSync("/bin/bash", [join(dir, "scripts", "check.sh"), "fast"], {
        cwd: dir,
        encoding: "utf-8",
        env: { ...gitEnv, ...extra },
      });
    expect(check()).not.toContain("cached");
    expect(check()).toContain("docs cached (inputs unchanged)");
    writeFileSync(join(dir, "docs", "plans", "note.md"), "a change\n");
    expect(check()).not.toContain("cached");
    expect(check({ NO_CACHE: "1" })).not.toContain("cached");
    expect(readFileSync(join(dir, ".metrics", "events.jsonl"), "utf-8")).toContain('"cached":true');
  });

  it("says when the monthly audit is due and records a run", () => {
    const repo = join(scratch, "audited");
    mkdirSync(repo, { recursive: true });
    const stateEnv = { ...env, XDG_STATE_HOME: join(scratch, "state") };
    const due = (...flags: string[]) =>
      spawnSync("/bin/bash", [join(skillRoot, "scripts", "audit-due.sh"), repo, ...flags], {
        encoding: "utf-8",
        env: stateEnv,
      });
    expect(due().stdout).toContain("due (never run)");
    expect(due("--record").status).toBe(0);
    const after = due();
    expect(after.status).toBe(1);
    expect(after.stdout).toContain("not due");
    expect(due("--days", "0").status).toBe(0);
  });

  it("tracks every template file in git, so a global gitignore cannot drop one", () => {
    const onDisk = execFileSync("find", [join(skillRoot, "templates"), "-type", "f"], { encoding: "utf-8" })
      .trim()
      .split("\n").length;
    const tracked = execFileSync("git", ["ls-files", join(skillRoot, "templates")], { encoding: "utf-8" })
      .trim()
      .split("\n").length;
    expect(tracked).toBe(onDisk);
  });

  it.each(profiles)("scores an empty dir at 20% or less for $profile", ({ profile }) => {
    const empty = join(scratch, `empty-${profile}`);
    mkdirSync(empty, { recursive: true });
    const result = score(empty, profile);
    expect(result.status).toBe(1);
    expect(result.pass / result.total).toBeLessThanOrEqual(0.2);
  });

  it("never overwrites an existing file", () => {
    const dir = join(scratch, "keep");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README.md"), "mine\n");
    const out = scaffoldInto(dir, "tool", "none");
    expect(out).toContain("kept    README.md");
    expect(readFileSync(join(dir, "README.md"), "utf-8")).toBe("mine\n");
  });

  it("ships valid YAML templates and a valid evals file", () => {
    yaml.load(readFileSync(join(skillRoot, "templates", "assistant", "config", "models.yaml"), "utf-8"));
    yaml.loadAll(
      readFileSync(join(skillRoot, "templates", "assistant", "evals", "cases", "001-start-session.yaml"), "utf-8"),
    );
    const evals = JSON.parse(readFileSync(join(skillRoot, "evals", "evals.json"), "utf-8"));
    expect(evals.skill_name).toBe("new-project");
    expect(JSON.stringify(evals)).toMatch(/interview prep/);
  });
});
