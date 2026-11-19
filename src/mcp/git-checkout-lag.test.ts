import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { knownGitCheckoutLag } from "./git-checkout-lag.js";

it("reports only a known behind checkout and leaves its contents and refs alone", () => {
  const root = mkdtempSync(join(tmpdir(), "git-checkout-lag-"));
  const cache = join(root, "cache");
  const trace = join(root, "git-trace");
  const probeBin = join(root, "probe-bin");
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Agentbrew fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_COMMITTER_NAME: "Agentbrew fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
  };
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: "pipe" }).trim();

  function checkout(parent: string, name: string, position: "behind" | "current" | "diverged" | "detached" | "untracked") {
    const dir = join(parent, name);
    mkdirSync(dir);
    git(dir, "init", "--template=", "-b", "main", "--quiet");
    writeFileSync(join(dir, "draft.txt"), "fixture bytes\n");
    git(dir, "add", "draft.txt");
    git(dir, "commit", "--quiet", "-m", "base");
    if (position === "untracked") return dir;
    const base = git(dir, "rev-parse", "HEAD");
    git(dir, "remote", "add", "origin", "https://fixture.example.com/cache.git");
    git(dir, "switch", "--detach", "--quiet", base);
    git(dir, "commit", "--allow-empty", "--quiet", "-m", "upstream");
    const upstream = git(dir, "rev-parse", "HEAD");
    git(dir, "update-ref", "refs/remotes/origin/main", upstream);
    git(dir, "config", "branch.main.remote", "origin");
    git(dir, "config", "branch.main.merge", "refs/heads/main");
    if (position === "detached") return dir;
    if (position === "current") git(dir, "update-ref", "refs/heads/main", upstream);
    git(dir, "switch", "--quiet", "main");
    if (position === "diverged") git(dir, "commit", "--allow-empty", "--quiet", "-m", "local");
    return dir;
  }

  try {
    mkdirSync(cache);
    const behind = checkout(cache, "behind", "behind");
    const current = checkout(cache, "current", "current");
    const diverged = checkout(cache, "diverged", "diverged");
    const detached = checkout(cache, "detached", "detached");
    const untracked = checkout(cache, "untracked", "untracked");
    const localUpstream = checkout(cache, "local-upstream", "behind");
    git(localUpstream, "update-ref", "refs/heads/local-upstream", "refs/remotes/origin/main");
    git(localUpstream, "config", "branch.main.remote", ".");
    git(localUpstream, "config", "branch.main.merge", "refs/heads/local-upstream");
    const foreign = checkout(root, "foreign", "behind");
    symlinkSync(foreign, join(cache, "linked"), "dir");
    const shared = checkout(cache, "shared", "behind");
    writeFileSync(join(shared, ".git", "commondir"), `${join(foreign, ".git")}\n`);
    const repos = [behind, current, diverged, detached, untracked, localUpstream, foreign];
    const snapshot = () => repos.map((repo) => [git(repo, "show-ref"), readFileSync(join(repo, "draft.txt"), "utf8")]);
    const before = snapshot();
    mkdirSync(probeBin);
    const probe = join(probeBin, "git");
    writeFileSync(probe, '#!/bin/bash\nprintf "%s\\n" "$*" >> "$HOME/probe-args"\nexec /usr/bin/git "$@"\n');
    chmodSync(probe, 0o755);
    vi.stubEnv("HOME", root);
    vi.stubEnv("PATH", `${probeBin}:${process.env.PATH ?? ""}`);
    vi.stubEnv("GIT_TRACE", trace);

    expect(knownGitCheckoutLag(cache)).toEqual([{ name: "behind", behind: 1 }]);
    expect(snapshot()).toEqual(before);
    const operations = readFileSync(join(root, "probe-args"), "utf8");
    expect(operations.match(/^rev-parse /gm)).toHaveLength(6);
    expect(operations.match(/^--no-replace-objects rev-list /gm)).toHaveLength(3);
    expect(operations).not.toMatch(/\b(?:fetch|checkout|pull|ssh)\b/u);
    expect(operations).not.toContain("fixture.example.com");
    expect(existsSync(trace)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
