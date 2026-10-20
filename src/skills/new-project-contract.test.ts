import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";

const skillRoot = join(process.cwd(), "skill-plugins", "workflow", "new-project");
const scaffold = join(skillRoot, "scripts", "scaffold.sh");
const checkSetup = join(skillRoot, "scripts", "check-setup.sh");
const scratch = mkdtempSync(join(tmpdir(), "new-project-"));
// The copy fallback is the default here; the Copier tests below opt in.
const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", NEW_PROJECT_NO_COPIER: "1" };
// The gate's own NO_CACHE=1 run must not leak into the cache test below.
delete env.NO_CACHE;
const gitEnv = {
  ...env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const copierEnv: NodeJS.ProcessEnv = { ...gitEnv, NEW_PROJECT_NO_COPIER: "" };
// Copier runs from PATH or through uvx (which may need the network once).
const copierCmd = ["copier", "uvx copier@9.19.1"].find(
  (cmd) => spawnSync("bash", ["-c", `${cmd} --version`], { env: copierEnv, encoding: "utf-8" }).status === 0,
);
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

  it("fails an app whose checkup does not list open PRs and branches first", () => {
    const dir = join(scratch, "no-open-work");
    scaffoldInto(dir, "side-project", "none");
    const label = "FAIL [checkup] scripts/checkup.sh lists open PRs and branches first";
    expect(score(dir, "side-project").out).not.toContain(label);
    writeFileSync(join(dir, "scripts", "checkup.sh"), "#!/usr/bin/env bash\nscripts/doctor.sh\n");
    const result = score(dir, "side-project");
    expect(result.out).toContain(label);
    expect(result.status).toBe(1);
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

  it("fails check-docs when a story test does not name its story id", () => {
    const dir = join(scratch, "story-id");
    scaffoldInto(dir, "tool", "none");
    const test = join(dir, "tests", "e2e", "us-01-setup.sh");
    writeFileSync(test, readFileSync(test, "utf-8").replaceAll("US-01", "story one"));
    const result = spawnSync("/bin/bash", [join(dir, "scripts", "check-docs.sh")], {
      cwd: dir,
      encoding: "utf-8",
      env,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("does not name its story US-01");
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

  it("records an audit run in a linked worktree under the repo's name, not the worktree's", () => {
    const repo = join(scratch, "main-repo");
    const tree = join(scratch, "checkup-20261018");
    mkdirSync(repo, { recursive: true });
    const git = (...args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf-8", env });
    git("init", "-q");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init");
    expect(git("worktree", "add", "-q", tree).status).toBe(0);
    const stateEnv = { ...env, XDG_STATE_HOME: join(scratch, "state-worktree") };
    const run = (dir: string, ...flags: string[]) =>
      spawnSync("/bin/bash", [join(skillRoot, "scripts", "audit-due.sh"), dir, ...flags], {
        encoding: "utf-8",
        env: stateEnv,
      });
    expect(run(tree, "--record").stdout).toContain("main-repo.last");
    expect(run(repo).stdout).toContain("not due");
  });

  it("tracks every template file in git, so a global gitignore cannot drop one", () => {
    const onDisk = execFileSync("find", [join(skillRoot, "templates"), "(", "-type", "f", "-o", "-type", "l", ")"], {
      encoding: "utf-8",
    })
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
    const assistant = (dir: string) => `{% if PROFILE == 'assistant' %}${dir}{% endif %}`;
    yaml.load(readFileSync(join(skillRoot, "templates", assistant("config"), "models.yaml"), "utf-8"));
    yaml.loadAll(
      readFileSync(join(skillRoot, "templates", assistant("evals"), "cases", "001-start-session.yaml"), "utf-8"),
    );
    const evals = JSON.parse(readFileSync(join(skillRoot, "evals", "evals.json"), "utf-8"));
    expect(evals.skill_name).toBe("new-project");
    expect(JSON.stringify(evals)).toMatch(/interview prep/);
  });

  describe.skipIf(!copierCmd)("with Copier (skips when neither copier nor uvx copier@9.19.1 runs)", () => {
    const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf-8" });
    const files = (dir: string) =>
      execFileSync("bash", ["-c", "find . \\( -type f -o -type l \\) ! -path './.git/*' | sort"], {
        cwd: dir,
        encoding: "utf-8",
      });

    it.each(profiles)("writes the same $profile files as the copy fallback, plus the answers file", ({
      profile,
      stack,
    }) => {
      const viaCopy = join(scratch, `copy-${profile}`);
      const viaCopier = join(scratch, `copier-${profile}`);
      const args = ["--profile", profile, "--name", "same", "--stack", stack, "--owner", "Ann", "--description", "D."];
      execFileSync("/bin/bash", [scaffold, viaCopy, ...args], { env });
      execFileSync("/bin/bash", [scaffold, viaCopier, ...args], { env: copierEnv });
      rmSync(join(viaCopier, ".copier-answers.yml"));
      expect(files(viaCopier)).toBe(files(viaCopy));
      const diff = spawnSync("diff", ["-r", "--no-dereference", "-x", ".git", viaCopy, viaCopier], {
        encoding: "utf-8",
      });
      expect(diff.stdout + diff.stderr).toBe("");
    });

    it("brings a template fix into an older repo and keeps the repo's own edits", () => {
      // A versioned template: the skill files in their own git repo.
      const tpl = join(scratch, "template-repo");
      for (const part of ["copier.yml", "templates", "scripts"]) {
        cpSync(join(skillRoot, part), join(tpl, part), { recursive: true, verbatimSymlinks: true });
      }
      git(tpl, "init", "-q", "-b", "main");
      git(tpl, "add", "-A");
      git(tpl, "commit", "-qm", "template v1");

      const repo = join(scratch, "updated");
      const out = execFileSync(
        "/bin/bash",
        [join(tpl, "scripts", "scaffold.sh"), repo, "--profile", "tool", "--name", "u", "--stack", "ts"],
        {
          env: copierEnv,
          encoding: "utf-8",
        },
      );
      expect(out).toContain("created .copier-answers.yml");
      expect(readFileSync(join(repo, ".copier-answers.yml"), "utf-8")).toMatch(/_commit: \S+/);
      appendFileSync(join(repo, "README.md"), "Local note kept by the repo.\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-qm", "scaffold plus a local edit");

      appendFileSync(join(tpl, "templates", "docs", "learnings.md"), "- Template fix line from v2.\n");
      git(tpl, "commit", "-qam", "template v2");

      const update = spawnSync("bash", ["-c", `${copierCmd} update --defaults --quiet --vcs-ref HEAD`], {
        cwd: repo,
        env: copierEnv,
        encoding: "utf-8",
      });
      expect(update.status, update.stderr).toBe(0);
      expect(readFileSync(join(repo, "docs", "learnings.md"), "utf-8")).toContain("- Template fix line from v2.");
      expect(readFileSync(join(repo, "README.md"), "utf-8")).toContain("Local note kept by the repo.");
      expect(git(repo, "status", "--porcelain")).not.toContain(".rej");
      const result = score(repo, "tool");
      expect(result.status, result.out).toBe(0);
      expect(result.pass).toBe(result.total);
    });
  });
});
