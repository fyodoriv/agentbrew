import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("exits 2 for a path that is not a git checkout", () => {
    expect(run(scratch).status).toBe(2);
  });

  it("stays bash 3.2 safe (no lowercase or uppercase expansions)", () => {
    expect(readFileSync(openWork, "utf-8")).not.toMatch(/\$\{\w+(,,|\^\^)\}/);
  });
});
