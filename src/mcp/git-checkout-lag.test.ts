import { execFileSync, type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { knownGitCheckoutLag } from "./git-checkout-lag.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

type ProbeExit = Pick<SpawnSyncReturns<unknown>, "error" | "signal" | "status">;

function probeReceipt(args: readonly string[], result: ProbeExit): string {
  const operation = args[0] === "rev-parse" ? "resolve tracking" : "count lag";
  if (result.error) {
    const timedOut = "code" in result.error && result.error.code === "ETIMEDOUT";
    return `${operation}: ${timedOut ? "timeout" : "spawn error"}`;
  }
  if (result.signal) return `${operation}: signal`;
  return `${operation}: exit ${result.status}`;
}

it("classifies Git probe failures without exposing child details", () => {
  const privateValue = "synthetic probe input canary";
  const args = ["rev-parse", privateValue];
  const successful = { status: 0, signal: null };
  expect(probeReceipt(args, successful)).toBe("resolve tracking: exit 0");
  expect(probeReceipt(["--no-replace-objects", privateValue], { ...successful, status: 128 })).toBe(
    "count lag: exit 128",
  );
  const failed = { status: null, signal: null };
  const timeout = Object.assign(new Error(privateValue), { code: "ETIMEDOUT" });
  expect(probeReceipt(args, { ...failed, error: timeout })).toBe("resolve tracking: timeout");
  expect(probeReceipt(args, { ...failed, error: new Error(privateValue) })).toBe("resolve tracking: spawn error");
  expect(probeReceipt(args, { ...failed, signal: "SIGTERM" })).toBe("resolve tracking: signal");
});

it("leaves lag unknown when the production Git probe times out", () => {
  const root = mkdtempSync(join(tmpdir(), "git-checkout-lag-timeout-"));
  const checkout = join(root, "checkout");
  const observed = vi.mocked(spawnSync);
  try {
    mkdirSync(join(checkout, ".git"), { recursive: true });
    observed.mockClear();
    observed.mockReturnValueOnce({
      pid: 0,
      status: null,
      signal: null,
      output: [],
      stdout: "",
      stderr: "",
      error: Object.assign(new Error("synthetic tracking timeout"), { code: "ETIMEDOUT" }),
    });

    expect(knownGitCheckoutLag(root)).toEqual([]);
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--symbolic-full-name", "HEAD", "@{upstream}"],
      expect.objectContaining({ cwd: checkout, timeout: 1_000 }),
    );
  } finally {
    observed.mockReset();
    rmSync(root, { recursive: true, force: true });
  }
});

it("reports only a known behind checkout and leaves its contents and refs alone", async () => {
  const { spawnSync: realSpawn } = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const observed = vi.mocked(spawnSync);
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

  function checkout(
    parent: string,
    name: string,
    position: "behind" | "current" | "diverged" | "detached" | "untracked",
  ) {
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
    const repos = { behind, current, diverged, detached, untracked, localUpstream, foreign };
    const roles = new Map(Object.entries({ ...repos, shared }).map(([role, cwd]) => [cwd, role]));
    const snapshot = () =>
      Object.values(repos).map((repo) => [git(repo, "show-ref"), readFileSync(join(repo, "draft.txt"), "utf8")]);
    const before = snapshot();
    mkdirSync(probeBin);
    const probe = join(probeBin, "git");
    writeFileSync(probe, '#!/bin/bash\nprintf "%s\\n" "$*" >> "$HOME/probe-args"\nexec /usr/bin/git "$@"\n');
    chmodSync(probe, 0o755);
    vi.stubEnv("HOME", root);
    vi.stubEnv("PATH", `${probeBin}:${process.env.PATH ?? ""}`);
    vi.stubEnv("GIT_TRACE", trace);

    observed.mockClear();
    // The real Git fixture uses a separate deadline. Check the caller's production budget below.
    observed.mockImplementation((command, args, options) => realSpawn(command, args, { ...options, timeout: 5_000 }));
    const lag = knownGitCheckoutLag(cache);
    const receipts = observed.mock.results.map((result, index) => {
      const [, args = [], options] = observed.mock.calls[index] ?? [];
      const role = typeof options?.cwd === "string" ? (roles.get(options.cwd) ?? "unrecognized") : "unrecognized";
      const outcome = result.type === "return" ? probeReceipt(args, result.value) : "spawn threw";
      return { role, text: `${index + 1}. ${role} ${outcome}` };
    });
    const behindCalls = receipts.filter(({ role }) => role === "behind");
    const missing = behindCalls.length ? "" : " No probe ran for the behind fixture.";
    expect(lag, `Git probe outcomes: ${receipts.map(({ text }) => text).join("; ")}.${missing}`).toEqual([
      { name: "behind", behind: 1 },
    ]);
    expect(snapshot()).toEqual(before);
    const operations = readFileSync(join(root, "probe-args"), "utf8");
    expect(operations.match(/^rev-parse /gm)).toHaveLength(6);
    expect(operations.match(/^--no-replace-objects rev-list /gm)).toHaveLength(3);
    expect(receipts).toHaveLength(9);
    expect(observed.mock.calls.every(([, , options]) => options?.timeout === 1_000)).toBe(true);
    expect(receipts.some(({ role }) => role === "unrecognized")).toBe(false);
    expect(behindCalls).toHaveLength(2);
    expect(operations).not.toMatch(/\b(?:fetch|checkout|pull|ssh)\b/u);
    expect(operations).not.toContain("fixture.example.com");
    expect(existsSync(trace)).toBe(false);
  } finally {
    observed.mockReset();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
