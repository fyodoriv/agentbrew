import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { realignDivergedCache } from "./cache-realign.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, stdio: "pipe", encoding: "utf-8" },
  ).trim();
}

function commit(dir: string, file: string, text: string): string {
  writeFileSync(join(dir, file), text);
  git(dir, "add", file);
  git(dir, "commit", "-q", "-m", `chore: edit ${file}`);
  return git(dir, "rev-parse", "HEAD");
}

/** origin with history A; a cache clone with one local-only commit; origin rewritten to B. */
function divergedCache(): { cache: string; originHead: string; localSha: string } {
  const root = mkdtempSync(join(tmpdir(), "cache-realign-"));
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const work = join(root, "work");
  git(root, "clone", "-q", origin, work);
  commit(work, "a.txt", "a");
  git(work, "push", "-q", "origin", "HEAD:main");

  const cache = join(root, "cache");
  git(root, "clone", "-q", origin, cache);
  const localSha = commit(cache, "local.txt", "local only");

  // Rewrite upstream history (orphan root), like a public-history rewrite.
  git(work, "checkout", "-q", "--orphan", "fresh");
  git(work, "rm", "-q", "-rf", ".");
  commit(work, "b.txt", "b");
  git(work, "push", "-q", "-f", "origin", "fresh:main");
  const originHead = git(work, "rev-parse", "HEAD");
  return { cache, originHead, localSha };
}

describe("realignDivergedCache", () => {
  it("resets a diverged cache to upstream and keeps local commits on a salvage branch", () => {
    const { cache, originHead, localSha } = divergedCache();
    expect(() => git(cache, "pull", "--ff-only", "-q")).toThrow();

    const result = realignDivergedCache(cache, new Date("2026-10-10T00:00:00Z"));

    expect(result.status).toBe("realigned");
    expect(git(cache, "rev-parse", "HEAD")).toBe(originHead);
    if (result.status !== "realigned") return;
    expect(result.salvageBranch).toMatch(/^salvage\/2026-10-10-/);
    expect(git(cache, "rev-parse", result.salvageBranch ?? "")).toBe(localSha);
  });

  it("reports failure when the remote cannot be reached, so callers keep warning", () => {
    const { cache } = divergedCache();
    git(cache, "remote", "set-url", "origin", join(tmpdir(), "does-not-exist.git"));

    expect(realignDivergedCache(cache).status).toBe("failed");
  });
});
