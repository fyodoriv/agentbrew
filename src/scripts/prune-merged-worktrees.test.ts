import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../../scripts/prune-merged-worktrees.sh");
const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("previews clean merges and removes only the clean merged worktree on apply", () => {
  const root = mkdtempSync(join(tmpdir(), "ab-prune-"));
  scratchRoots.push(root);
  const repo = join(root, "repo");
  const origin = join(root, "origin.git");
  const bin = join(root, "bin");
  mkdirSync(repo);
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  const env = {
    ...process.env,
    BASH_ENV: "",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    PATH: `${bin}:${process.env.PATH}`,
  };
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, env, encoding: "utf-8", stdio: "pipe", timeout: 10_000 });
  git(root, "init", "--bare", origin);
  git(repo, "init", "-b", "main");
  git(repo, "commit", "--allow-empty", "-m", "fixture");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-u", "origin", "main");

  const eligible = join(root, "eligible");
  const dirty = join(root, "dirty");
  const unpublished = join(root, "unpublished");
  const locked = join(root, "locked");
  const appManaged = join(root, ".codex", "worktrees", "demo");
  for (const [branch, path] of [
    ["eligible", eligible],
    ["dirty", dirty],
    ["unpublished", unpublished],
    ["locked", locked],
    ["app-managed", appManaged],
  ]) {
    git(repo, "worktree", "add", "-b", branch, path);
  }
  writeFileSync(join(dirty, "notes.md"), "Keep this work\n");
  git(unpublished, "commit", "--allow-empty", "-m", "local only");
  git(repo, "worktree", "lock", locked);

  const run = (...args: string[]) =>
    execFileSync("bash", [script, ...args], { cwd: repo, env, encoding: "utf-8", timeout: 15_000 });
  const preview = run();
  expect(preview).toMatch(/eligible\t[^\n]*\/eligible\tclean worktree with a verified merge/);
  expect(existsSync(eligible)).toBe(true);
  const result = run("--yes");
  expect(result).toMatch(/removed\t[^\n]*\/eligible\tclean worktree with a verified merge/);
  expect(result).toContain("uncommitted or unclassified ignored files");
  expect(result).toContain("current commit has no verified merge into origin/main");
  expect(result).toContain("locked worktree");
  expect(result).toContain("archive this worktree from Codex");
  expect([repo, dirty, unpublished, locked, appManaged].every(existsSync)).toBe(true);
  expect(existsSync(eligible)).toBe(false);
  const inventory = git(repo, "worktree", "list", "--porcelain");
  expect(inventory.match(/^worktree /gm)).toHaveLength(5);
}, 30_000);
