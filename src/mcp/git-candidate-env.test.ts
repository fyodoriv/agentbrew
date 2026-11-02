import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { allocateCandidate, inspectRuntime } from "./git-candidate.js";
import * as gitRef from "./git-ref.js";

let fixtureRoot = "";
let source = "";
let candidate = "";
let expectedCommit = "";
const previousGit = new Map<string, string>();

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "mcp-git-env-counter-"));
  const config = join(fixtureRoot, "empty.gitconfig");
  writeFileSync(config, "");
  for (const key of Object.keys(process.env).filter((name) => name.startsWith("GIT_"))) {
    const value = process.env[key];
    if (value !== undefined) previousGit.set(key, value);
    delete process.env[key];
  }
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "agentbrew fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_COMMITTER_NAME: "agentbrew fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
  });
  source = join(fixtureRoot, "source");
  mkdirSync(source);
  git(source, "init", "--quiet", "-b", "main", "--template=");
  writeFileSync(join(source, "index.js"), "// synthetic tracked entry\n");
  git(source, "add", "index.js");
  git(source, "commit", "--quiet", "-m", "fixture");
  expectedCommit = git(source, "rev-parse", "HEAD");
  candidate = allocateCandidate(source, "env-counter", undefined, true);
});

afterAll(() => {
  for (const key of Object.keys(process.env).filter((name) => name.startsWith("GIT_"))) delete process.env[key];
  for (const [key, value] of previousGit) process.env[key] = value;
  previousGit.clear();
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

it("one branch inspection resolves Git environment once", () => {
  const original = gitRef.cacheGitEnv;
  const spy = vi.spyOn(gitRef, "cacheGitEnv");
  let metadata: ReturnType<typeof inspectRuntime> | undefined;
  let returned = false;
  let calls = 0;
  let elapsedMs = 0;
  const start = performance.now();
  try {
    metadata = inspectRuntime(candidate, source, true);
    returned = true;
  } catch {
    returned = false;
  } finally {
    elapsedMs = performance.now() - start;
    calls = spy.mock.calls.length;
    spy.mockClear();
    spy.mockRestore();
  }
  const proof = {
    calls,
    elapsedMs,
    returned,
    commitMatches: metadata?.commit === expectedCommit,
    branchMatches: metadata?.branch === "main",
    originMatches: metadata?.origin === source,
    restored: gitRef.cacheGitEnv === original,
  };
  console.info("MCP_GIT_ENV_PHASE", JSON.stringify(proof));
  expect(proof.returned, "qualification: synchronous inspection completed").toBe(true);
  expect(proof.commitMatches, "qualification: expected commit").toBe(true);
  expect(proof.branchMatches, "qualification: tracked main branch").toBe(true);
  expect(proof.originMatches, "qualification: exact source origin").toBe(true);
  expect(proof.restored, "qualification: original imported binding restored").toBe(true);
  expect(Number.isFinite(elapsedMs) && elapsedMs >= 0, "qualification: monotonic duration").toBe(true);
  expect(elapsedMs, "qualification: completed metadata phase stays inside five seconds").toBeLessThan(5000);
  expect(calls > 0, "qualification: imported call-through spy intercepted the phase").toBe(true);
  expect(calls, "Git environment computations in one qualified branch inspection").toBe(1);
}, 5000);
