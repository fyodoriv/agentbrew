/**
 * Tests for `src/repo-class.ts` — per-repo solo/shared classifier.
 *
 * Covers: override-wins-over-detection, single-committer-detected-as-solo,
 * multi-committer-detected-as-shared, unlisted-with-no-git-defaults-to-solo
 * (per the documented behavior), set/unset write paths, cache behavior.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetRepoClassCacheForTests,
  getRepoClass,
  getRepoClassDetailed,
  setRepoClass,
  unsetRepoClass,
} from "./repo-class.js";

let testRoot: string;
let originalEnv: string | undefined;

function makeRepoWithCommitters(emails: readonly string[]): string {
  const repoPath = mkdtempSync(join(testRoot, "repo-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoPath });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repoPath });
  // Override the global hooksPath so the user's pre-commit / commit-msg /
  // pre-push hooks (conventional-commits enforcement, branch naming,
  // attribution stripping, etc.) don't run on these throwaway test
  // repos. Same reason real-e2e/scenario-fixture.ts unsets `core.hooksPath`.
  execFileSync("git", ["config", "core.hooksPath", "/dev/null"], { cwd: repoPath });
  // Seed one commit per unique email so `git log --format=%aE` returns the
  // expected count. Each commit touches a different file so they don't
  // collide on identical content hashes.
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    execFileSync("git", ["config", "user.email", email], { cwd: repoPath });
    execFileSync("git", ["config", "user.name", `User ${i}`], { cwd: repoPath });
    writeFileSync(join(repoPath, `f${i}.txt`), `commit ${i}\n`);
    execFileSync("git", ["add", "."], { cwd: repoPath });
    execFileSync("git", ["commit", "-q", "--no-verify", "-m", `chore: seed commit ${i}`], {
      cwd: repoPath,
    });
  }
  return repoPath;
}

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "agentbrew-repo-class-"));
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
  try {
    rmSync(testRoot, { recursive: true, force: true });
  } catch {
    // Test cleanup is best-effort.
  }
});

// Tests in this file spawn `git init` + `git commit` per repo via
// `execFileSync`, so they're I/O-heavy and slow under the parallel-test
// load `npm run test:all` produces. The default 5 s test timeout is
// fine in isolation but flakes when the full vitest suite races for git,
// disk, and CPU. Use a 15 s per-describe timeout — same headroom the
// existing 15_000 timeout in `sanitize-history-script.test.ts` uses.
describe("repo-class — auto-detection", { timeout: 15_000 }, () => {
  it("classifies a repo with one committer as solo", () => {
    const repo = makeRepoWithCommitters(["alice@example.com"]);
    expect(getRepoClass(repo)).toBe("solo");
  });

  it("classifies a repo with two committers as shared", () => {
    const repo = makeRepoWithCommitters(["alice@example.com", "bob@example.com"]);
    expect(getRepoClass(repo)).toBe("shared");
  });

  it("classifies a repo with three+ committers as shared", () => {
    const repo = makeRepoWithCommitters(["alice@example.com", "bob@example.com", "carol@example.com"]);
    expect(getRepoClass(repo)).toBe("shared");
  });

  it("treats committer email casing as identical (Alice@ vs alice@)", () => {
    const repo = makeRepoWithCommitters(["Alice@example.com", "alice@example.com", "ALICE@example.com"]);
    // All three are the same email — should classify as solo.
    expect(getRepoClass(repo)).toBe("solo");
  });

  it("returns solo for a non-git directory (no shared-master surface)", () => {
    const dir = join(testRoot, "no-git");
    mkdirSync(dir);
    expect(getRepoClass(dir)).toBe("solo");
  });

  it("returns unknown for a non-git directory via getRepoClassDetailed", () => {
    const dir = join(testRoot, "no-git-detailed");
    mkdirSync(dir);
    expect(getRepoClassDetailed(dir)).toBe("unknown");
  });
});

describe("repo-class — override file", { timeout: 15_000 }, () => {
  it("override wins over auto-detection (single-committer flipped to shared)", () => {
    const repo = makeRepoWithCommitters(["alice@example.com"]);
    expect(getRepoClass(repo)).toBe("solo"); // auto-detect
    setRepoClass(repo, "shared");
    _resetRepoClassCacheForTests(); // simulate a fresh process
    expect(getRepoClass(repo)).toBe("shared"); // override wins
  });

  it("override wins over auto-detection (multi-committer flipped to solo)", () => {
    const repo = makeRepoWithCommitters(["alice@example.com", "bob@example.com"]);
    expect(getRepoClass(repo)).toBe("shared"); // auto-detect
    setRepoClass(repo, "solo");
    _resetRepoClassCacheForTests();
    expect(getRepoClass(repo)).toBe("solo"); // override wins
  });

  it("unset removes the override and reverts to auto-detection", () => {
    const repo = makeRepoWithCommitters(["alice@example.com"]);
    setRepoClass(repo, "shared");
    _resetRepoClassCacheForTests();
    expect(getRepoClass(repo)).toBe("shared");
    unsetRepoClass(repo);
    _resetRepoClassCacheForTests();
    expect(getRepoClass(repo)).toBe("solo"); // back to auto-detect
  });

  it("set writes to the YAML override file (sorted by absolute path)", () => {
    const repoA = makeRepoWithCommitters(["a@example.com"]);
    const repoB = makeRepoWithCommitters(["b@example.com"]);
    // Set in reverse-sorted order so we can verify sorted output.
    setRepoClass(repoB, "shared");
    setRepoClass(repoA, "shared");
    const overridePath = process.env.AGENTBREW_REPO_CLASS_PATH ?? "";
    expect(existsSync(overridePath)).toBe(true);
    const raw = readFileSync(overridePath, "utf-8");
    const parsed = yaml.load(raw) as Record<string, string>;
    expect(parsed[repoA]).toBe("shared");
    expect(parsed[repoB]).toBe("shared");
    // Keys appear in sorted order in the rendered file.
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort());
  });

  it("malformed YAML in override file does not crash the lookup", () => {
    const repo = makeRepoWithCommitters(["alice@example.com"]);
    const overridePath = process.env.AGENTBREW_REPO_CLASS_PATH ?? "";
    mkdirSync(join(overridePath, "..").replace(/\/[^/]+$/, ""), { recursive: true });
    writeFileSync(overridePath, "::not valid yaml\n  -- :: garbage", "utf-8");
    // Should fall back to auto-detect, not throw.
    expect(getRepoClass(repo)).toBe("solo");
  });

  it("ignores invalid override values (not 'solo' or 'shared')", () => {
    const repo = makeRepoWithCommitters(["alice@example.com"]);
    const overridePath = process.env.AGENTBREW_REPO_CLASS_PATH ?? "";
    mkdirSync(join(overridePath, "..").replace(/\/[^/]+$/, ""), { recursive: true });
    const yamlContent = yaml.dump({ [repo]: "private" }); // invalid value
    writeFileSync(overridePath, yamlContent, "utf-8");
    // Invalid value should be silently dropped — auto-detect kicks in.
    expect(getRepoClass(repo)).toBe("solo");
  });

  it("unset on a path without an override is a no-op", () => {
    const repo = makeRepoWithCommitters(["alice@example.com"]);
    expect(() => unsetRepoClass(repo)).not.toThrow();
    expect(getRepoClass(repo)).toBe("solo");
  });
});

describe("repo-class — caching", () => {
  it("caches the classification per-process (second call doesn't re-run git)", () => {
    const repo = makeRepoWithCommitters(["alice@example.com"]);
    expect(getRepoClass(repo)).toBe("solo");
    // Even if we mutate the override file directly (no setRepoClass), the
    // cached answer stays — this is the documented behavior.
    const overridePath = process.env.AGENTBREW_REPO_CLASS_PATH ?? "";
    const yamlContent = yaml.dump({ [repo]: "shared" });
    writeFileSync(overridePath, yamlContent, "utf-8");
    expect(getRepoClass(repo)).toBe("solo"); // cached
    _resetRepoClassCacheForTests();
    expect(getRepoClass(repo)).toBe("shared"); // re-read after cache reset
  });

  it("setRepoClass updates the cache so subsequent reads see the new value", () => {
    const repo = makeRepoWithCommitters(["alice@example.com"]);
    expect(getRepoClass(repo)).toBe("solo");
    setRepoClass(repo, "shared");
    expect(getRepoClass(repo)).toBe("shared"); // cache updated synchronously
  });

  it("unsetRepoClass evicts the cache entry", () => {
    const repo = makeRepoWithCommitters(["alice@example.com"]);
    setRepoClass(repo, "shared");
    expect(getRepoClass(repo)).toBe("shared");
    unsetRepoClass(repo);
    // Next read re-derives via auto-detect (cache evicted).
    expect(getRepoClass(repo)).toBe("solo");
  });
});
