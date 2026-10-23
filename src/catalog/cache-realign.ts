import { execFileSync } from "node:child_process";
import { errorMessage } from "../core/errors.js";
import { gitExec } from "../core/git-retry.js";
import { cacheGitEnv } from "../mcp/git-ref.js";

export type RealignResult =
  | { status: "realigned"; upstream: string; salvageBranch?: string; kept: number }
  | { status: "failed"; reason: string };

// Every git call here runs with repo-pointing variables (GIT_DIR, GIT_WORK_TREE,
// ...) dropped, so a sync started from a git hook resets the cache, never the
// hook's repo.
function git(cachePath: string, args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, { cwd: cachePath, env, stdio: "pipe", timeout: 30_000, encoding: "utf-8" }).trim();
}

function resolveUpstream(cachePath: string, env: NodeJS.ProcessEnv): string {
  try {
    return git(cachePath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], env);
  } catch {
    return git(cachePath, ["rev-parse", "--abbrev-ref", "origin/HEAD"], env);
  }
}

/**
 * Realign a source cache that cannot fast-forward, for example after the
 * upstream history was rewritten. The cache is disposable, so it is reset to
 * its upstream branch. Commits that exist only in the cache are kept on a
 * `salvage/<date>-<sha>` branch first. Returns `failed` when the remote cannot
 * be fetched (offline); the caller then keeps the cached data and warns.
 */
export function realignDivergedCache(cachePath: string, now: Date = new Date()): RealignResult {
  const env = cacheGitEnv();
  try {
    gitExec(["fetch", "origin", "--quiet"], { cwd: cachePath, env, timeout: 30_000, network: true });
    const upstream = resolveUpstream(cachePath, env);
    const kept = Number(git(cachePath, ["rev-list", "--count", `${upstream}..HEAD`], env));
    let salvageBranch: string | undefined;
    if (kept > 0) {
      const shortSha = git(cachePath, ["rev-parse", "--short", "HEAD"], env);
      salvageBranch = `salvage/${now.toISOString().slice(0, 10)}-${shortSha}`;
      git(cachePath, ["branch", "-f", salvageBranch, "HEAD"], env);
    }
    git(cachePath, ["reset", "--hard", "--quiet", upstream], env);
    return { status: "realigned", upstream, salvageBranch, kept };
  } catch (error) {
    return { status: "failed", reason: errorMessage(error).split("\n")[0] ?? "unknown" };
  }
}
