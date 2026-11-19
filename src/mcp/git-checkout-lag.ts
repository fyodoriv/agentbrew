import { spawnSync } from "node:child_process";
import { type Dirent, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MCP_GIT_REPOS_PATH } from "../paths.js";
import { expandHome } from "../utils.js";

export function knownGitCheckoutLag(cacheRoot = expandHome(MCP_GIT_REPOS_PATH)): Array<{ name: string; behind: number }> {
  let checkouts: Dirent[];
  try {
    if (!lstatSync(cacheRoot).isDirectory()) return [];
    checkouts = readdirSync(cacheRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }

  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ALLOW_PROTOCOL: "",
    GIT_NO_LAZY_FETCH: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
  const result: Array<{ name: string; behind: number }> = [];
  for (const { name } of checkouts) {
    const cwd = join(cacheRoot, name);
    const gitDir = join(cwd, ".git");
    try {
      if (!lstatSync(gitDir).isDirectory()) continue;
      if (lstatSync(join(gitDir, "commondir"), { throwIfNoEntry: false })) continue;
      if (lstatSync(join(gitDir, "objects", "info", "alternates"), { throwIfNoEntry: false })) continue;
    } catch {
      continue;
    }
    const git = (...args: string[]) => spawnSync("git", args, {
      cwd,
      env,
      encoding: "utf8" as const,
      timeout: 1000,
    });
    const tracked = git("rev-parse", "--symbolic-full-name", "HEAD", "@{upstream}");
    if (tracked.status !== 0) continue;
    const [branch, upstream] = tracked.stdout.trim().split("\n");
    if (!branch?.startsWith("refs/heads/") || !upstream?.startsWith("refs/remotes/")) continue;
    const counts = git("--no-replace-objects", "rev-list", "--left-right", "--count", `${branch}...${upstream}`);
    if (counts.status !== 0) continue;
    const behind = Number(/^0\s+(\d+)$/u.exec(counts.stdout.trim())?.[1]);
    if (Number.isSafeInteger(behind) && behind > 0) result.push({ name, behind });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
