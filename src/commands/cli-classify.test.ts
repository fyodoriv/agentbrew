/**
 * Tests for `src/commands/cli-classify.ts` — `agentbrew classify` CLI command.
 *
 * Covers: read mode (print classification), --set mode (write override),
 * --unset mode (remove override), invalid --set value (exit 1).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetRepoClassCacheForTests } from "../repo-class.js";
import { runClassify } from "./cli-classify.js";

let testRoot: string;
let originalEnv: string | undefined;

function makeRepo(emails: readonly string[]): string {
  const repoPath = mkdtempSync(join(testRoot, "repo-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoPath });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repoPath });
  execFileSync("git", ["config", "core.hooksPath", "/dev/null"], { cwd: repoPath });
  for (let i = 0; i < emails.length; i++) {
    execFileSync("git", ["config", "user.email", emails[i]], { cwd: repoPath });
    execFileSync("git", ["config", "user.name", `User ${i}`], { cwd: repoPath });
    writeFileSync(join(repoPath, `f${i}.txt`), `c${i}\n`);
    execFileSync("git", ["add", "."], { cwd: repoPath });
    execFileSync("git", ["commit", "-q", "--no-verify", "-m", `chore: c${i}`], {
      cwd: repoPath,
    });
  }
  return repoPath;
}

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "agentbrew-cli-classify-"));
  originalEnv = process.env.AGENTBREW_REPO_CLASS_PATH;
  process.env.AGENTBREW_REPO_CLASS_PATH = join(testRoot, "repo-class.yaml");
  _resetRepoClassCacheForTests();
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.AGENTBREW_REPO_CLASS_PATH;
  } else {
    process.env.AGENTBREW_REPO_CLASS_PATH = originalEnv;
  }
  process.exitCode = undefined;
  try {
    rmSync(testRoot, { recursive: true, force: true });
  } catch {
    // Best-effort.
  }
});

// Tests in this describe spawn real `git init` + `git commit` via
// `makeRepo`, so they slow down under `npm run test:all` parallel
// load. Match the 15 s headroom used in `repo-class.test.ts` and
// `sanitize-history-script.test.ts` to avoid flaky timeouts.
describe("runClassify — read mode", { timeout: 15_000 }, () => {
  it("prints solo for a single-committer repo", () => {
    const repo = makeRepo(["alice@example.com"]);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runClassify(repo, {});
    expect(stdout).toHaveBeenCalledWith("solo\n");
    stdout.mockRestore();
  });

  it("prints shared for a multi-committer repo", () => {
    const repo = makeRepo(["alice@example.com", "bob@example.com"]);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runClassify(repo, {});
    expect(stdout).toHaveBeenCalledWith("shared\n");
    stdout.mockRestore();
  });

  it("honors --set override on read", () => {
    const repo = makeRepo(["alice@example.com"]);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runClassify(repo, { set: "shared" });
    expect(stdout).toHaveBeenCalledWith(`${repo}: shared (override)\n`);
    stdout.mockRestore();
    // Subsequent read returns the override.
    _resetRepoClassCacheForTests();
    const stdout2 = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runClassify(repo, {});
    expect(stdout2).toHaveBeenCalledWith("shared\n");
    stdout2.mockRestore();
  });
});

describe("runClassify — --set mode", { timeout: 15_000 }, () => {
  it("writes the override file", () => {
    const repo = makeRepo(["alice@example.com"]);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runClassify(repo, { set: "shared" });
    expect(stdout).toHaveBeenCalledWith(`${repo}: shared (override)\n`);
    expect(existsSync(process.env.AGENTBREW_REPO_CLASS_PATH ?? "")).toBe(true);
    stdout.mockRestore();
  });

  it("rejects invalid --set values", () => {
    const repo = mkdtempSync(join(testRoot, "no-git-"));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    runClassify(repo, { set: "private" as "solo" | "shared" });
    expect(stderr).toHaveBeenCalledWith('Invalid class: private. Must be "solo" or "shared".\n');
    expect(process.exitCode).toBe(1);
    stderr.mockRestore();
  });
});

describe("runClassify — --unset mode", { timeout: 15_000 }, () => {
  it("removes the override and prints confirmation", () => {
    const repo = makeRepo(["alice@example.com"]);
    runClassify(repo, { set: "shared" });
    _resetRepoClassCacheForTests();

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runClassify(repo, { unset: true });
    expect(stdout).toHaveBeenCalledWith(`Override removed for ${repo}\n`);
    stdout.mockRestore();

    // Read after unset reverts to auto-detect.
    _resetRepoClassCacheForTests();
    const stdout2 = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runClassify(repo, {});
    expect(stdout2).toHaveBeenCalledWith("solo\n");
    stdout2.mockRestore();
  });

  it("--unset on a path without an override is a no-op", () => {
    const repo = mkdtempSync(join(testRoot, "no-override-"));
    mkdirSync(repo, { recursive: true });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(() => runClassify(repo, { unset: true })).not.toThrow();
    expect(stdout).toHaveBeenCalledWith(`Override removed for ${repo}\n`);
    stdout.mockRestore();
  });
});
