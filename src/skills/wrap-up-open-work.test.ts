import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const skillRoot = join(process.cwd(), "skill-plugins", "workflow", "wrap-up");
const openWork = join(skillRoot, "scripts", "open-work.sh");
const scratch = mkdtempSync(join(tmpdir(), "wrap-up-"));
const env: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  OPEN_WORK_NO_GH: "1",
};

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf-8" });
}

/** A clone of a bare remote whose `main` holds one commit. */
function repo(name: string): string {
  const remote = join(scratch, `${name}.git`);
  const work = join(scratch, name);
  git(scratch, "init", "-q", "--bare", "-b", "main", remote);
  git(scratch, "clone", "-q", remote, work);
  git(work, "checkout", "-q", "-b", "main");
  writeFileSync(join(work, "a.txt"), "a\n");
  git(work, "add", "a.txt");
  git(work, "commit", "-q", "-m", "init");
  git(work, "push", "-q", "-u", "origin", "main");
  git(work, "remote", "set-head", "origin", "main");
  return work;
}

function run(...repos: string[]) {
  const r = spawnSync("bash", [openWork, ...repos], { env, encoding: "utf-8" });
  return { status: r.status, out: r.stdout };
}

describe("wrap-up open-work.sh", () => {
  it("prints none and exits 0 for a clean, pushed repo", () => {
    const work = repo("clean");
    const r = run(work);
    expect(r.out).toContain("none");
    expect(r.status).toBe(0);
  });

  it("lists dirty files, unpushed commits, and unmerged branches", () => {
    const work = repo("busy");
    git(work, "checkout", "-q", "-b", "feat/x");
    writeFileSync(join(work, "b.txt"), "b\n");
    git(work, "add", "b.txt");
    git(work, "commit", "-q", "-m", "feat: b");
    writeFileSync(join(work, "c.txt"), "c\n");
    const r = run(work);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/dirty\s+1 uncommitted/);
    expect(r.out).toMatch(/unpushed\s+1 commit\(s\) on feat\/x/);
    expect(r.out).toMatch(/branch\s+feat\/x: 1 commit\(s\) not on main/);
  });

  it("skips a branch whose change was squash-merged", () => {
    const work = repo("squashed");
    git(work, "checkout", "-q", "-b", "feat/done");
    writeFileSync(join(work, "d.txt"), "d\n");
    git(work, "add", "d.txt");
    git(work, "commit", "-q", "-m", "feat: d");
    git(work, "push", "-q", "-u", "origin", "feat/done");
    git(work, "checkout", "-q", "main");
    git(work, "merge", "-q", "--squash", "feat/done");
    git(work, "commit", "-q", "-m", "feat: d (#1)");
    git(work, "push", "-q", "origin", "main");
    const r = run(work);
    expect(r.out).not.toContain("feat/done");
    expect(r.status).toBe(0);
  });

  it("asks the remote for its default branch when origin/HEAD is not set", () => {
    const work = repo("trunk");
    git(work, "checkout", "-q", "-b", "trunk");
    git(work, "push", "-q", "-u", "origin", "trunk");
    git(join(scratch, "trunk.git"), "symbolic-ref", "HEAD", "refs/heads/trunk");
    git(work, "remote", "set-head", "origin", "-d");
    git(work, "checkout", "-q", "-b", "feat/y");
    writeFileSync(join(work, "y.txt"), "y\n");
    git(work, "add", "y.txt");
    git(work, "commit", "-q", "-m", "feat: y");
    expect(run(work).out).toMatch(/branch\s+feat\/y: 1 commit\(s\) not on trunk/);
  });

  it("flags secrets and private data as do-not-stage, never prints contents, and spares .env.example", () => {
    const work = repo("risky");
    const canary = "CANARY-SECRET-5531";
    writeFileSync(join(work, ".env"), `TOKEN=${canary}\n`);
    writeFileSync(join(work, ".env.example"), "TOKEN=\n");
    mkdirSync(join(work, "private"));
    writeFileSync(join(work, "private", "rows.csv"), `${canary}\n`);
    const r = run(work);
    expect(r.out).toMatch(/do-not-stage\s+\.env$/m);
    expect(r.out).toMatch(/do-not-stage\s+private\/rows\.csv/);
    expect(r.out).not.toMatch(/do-not-stage\s+\.env\.example/);
    expect(r.out).not.toContain(canary);
  });

  it("does not flag a tracked file that a gitignore lists, such as TASKS.md", () => {
    const work = repo("tracked-ignored");
    writeFileSync(join(work, "TASKS.md"), "# Tasks\n");
    git(work, "add", "-f", "TASKS.md");
    git(work, "commit", "-q", "-m", "docs: tasks");
    writeFileSync(join(work, ".gitignore"), "TASKS.md\n");
    git(work, "add", ".gitignore");
    git(work, "commit", "-q", "-m", "chore: ignore");
    git(work, "push", "-q", "origin", "main");
    expect(run(work).out).not.toContain("do-not-stage");
  });

  it("lists extra worktrees with commits, and skips data and bot branches", () => {
    const work = repo("trees");
    const wt = join(scratch, "trees-wt");
    git(work, "worktree", "add", "-q", "-b", "feat/wt", wt);
    writeFileSync(join(wt, "w.txt"), "w\n");
    git(wt, "add", "w.txt");
    git(wt, "commit", "-q", "-m", "feat: w");
    for (const b of ["tasks-claims", "dependabot/npm/foo"]) {
      git(work, "checkout", "-q", "-b", b, "main");
      writeFileSync(join(work, `${b.replaceAll("/", "-")}.txt`), "x\n");
      git(work, "add", ".");
      git(work, "commit", "-q", "-m", "data");
    }
    git(work, "checkout", "-q", "main");
    const r = run(work);
    expect(r.out).toMatch(/worktree\s+\S*trees-wt \[feat\/wt\]: 1 commit\(s\) not on main/);
    expect(r.out).not.toContain("tasks-claims");
    expect(r.out).not.toContain("dependabot/");
  });

  it("finds every seeded situation of unfinished work (recall metric)", () => {
    const work = repo("all");
    const wt = join(scratch, "all-wt");
    git(work, "worktree", "add", "-q", "-b", "feat/wt", wt);
    writeFileSync(join(wt, "w.txt"), "w\n");
    git(wt, "add", "w.txt");
    git(wt, "commit", "-q", "-m", "feat: w");
    git(work, "checkout", "-q", "-b", "feat/local");
    writeFileSync(join(work, "l.txt"), "l\n");
    git(work, "add", "l.txt");
    git(work, "commit", "-q", "-m", "feat: l");
    writeFileSync(join(work, "a.txt"), "stashed\n");
    git(work, "stash", "push", "-q", "-m", "wip");
    writeFileSync(join(work, "a.txt"), "dirty\n");
    writeFileSync(join(work, "notes.txt"), "n\n");
    writeFileSync(join(work, ".env"), "TOKEN=x\n");
    const bin = join(scratch, "bin-all");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "gh"),
      "#!/bin/sh\nprintf '7\\tdraft\\tfeat/draft\\tMERGEABLE\\tgreen\\tParked\\n8\\tready\\tfeat/open\\tMERGEABLE\\tred\\tReady\\n'\n",
    );
    chmodSync(join(bin, "gh"), 0o755);
    const ghEnv: NodeJS.ProcessEnv = { ...env, OPEN_WORK_NO_GH: "0", PATH: `${bin}:${process.env.PATH}` };
    // A BASH_ENV startup file can put another `gh` ahead of the fake one on PATH.
    delete ghEnv.BASH_ENV;
    delete ghEnv.ENV;
    const out = spawnSync("bash", [openWork, work], { env: ghEnv, encoding: "utf-8" }).stdout;
    const seen = {
      "dirty tracked": /dirty\s+3 uncommitted/.test(out),
      untracked: /dirty\s+3 uncommitted/.test(out),
      unpushed: /unpushed\s+1 commit\(s\) on feat\/local/.test(out),
      branch: /branch\s+feat\/local: 1 commit/.test(out),
      worktree: /worktree\s+\S*all-wt \[feat\/wt\]/.test(out),
      stash: /stash\s+1 stash/.test(out),
      pr: /pr\s+#8 ready, checks red/.test(out),
      "draft pr": /pr\s+#7 draft, checks green/.test(out),
      "do-not-stage": /do-not-stage\s+\.env$/m.test(out),
    };
    const found = Object.values(seen).filter(Boolean).length;
    console.log(`open-work recall: ${found}/${Object.keys(seen).length}`);
    expect(seen, out).toEqual(Object.fromEntries(Object.keys(seen).map((k) => [k, true])));
  });

  it("exits 2 for a path that is not a git checkout", () => {
    expect(run(scratch).status).toBe(2);
  });

  it("stays bash 3.2 safe (no lowercase or uppercase expansions)", () => {
    expect(readFileSync(openWork, "utf-8")).not.toMatch(/\$\{\w+(,,|\^\^)\}/);
  });
});
