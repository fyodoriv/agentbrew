import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getGitHeadSha, recordSourceShas } from "./skill-versions.js";

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const tempDirs: string[] = [];

function repoWithCommit(prefix: string): { dir: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env: GIT_ENV, encoding: "utf-8" }).trim();
  git("init", "-q");
  writeFileSync(join(dir, "f.txt"), prefix);
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", prefix);
  return { dir, head: git("rev-parse", "HEAD") };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("local source SHA under a git hook's GIT_DIR", () => {
  it("records the local source's own HEAD, not the hook repo's", async () => {
    const local = repoWithCommit("local-source-");
    const victim = repoWithCommit("hook-repo-");
    vi.stubEnv("GIT_DIR", join(victim.dir, ".git"));
    const source = {
      url: local.dir,
      type: "local" as const,
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    expect(getGitHeadSha(source)).toBe(local.head);
    expect((await recordSourceShas([source])).get(local.dir)).toBe(local.head);
  });
});
