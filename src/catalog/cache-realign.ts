import { execFileSync } from "node:child_process";
import { errorMessage } from "../core/errors.js";
import { gitExec } from "../core/git-retry.js";

export type RealignResult =
  | { status: "realigned"; upstream: string; salvageBranch?: string; kept: number }
  | { status: "failed"; reason: string };

function git(cachePath: string, args: string[]): string {
  return execFileSync("git", args, { cwd: cachePath, stdio: "pipe", timeout: 30_000, encoding: "utf-8" }).trim();
}

function resolveUpstream(cachePath: string): string {
  try {
    return git(cachePath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  } catch {
    return git(cachePath, ["rev-parse", "--abbrev-ref", "origin/HEAD"]);
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
  try {
    gitExec(["fetch", "origin", "--quiet"], { cwd: cachePath, timeout: 30_000, network: true });
    const upstream = resolveUpstream(cachePath);
    const kept = Number(git(cachePath, ["rev-list", "--count", `${upstream}..HEAD`]));
    let salvageBranch: string | undefined;
    if (kept > 0) {
      const shortSha = git(cachePath, ["rev-parse", "--short", "HEAD"]);
      salvageBranch = `salvage/${now.toISOString().slice(0, 10)}-${shortSha}`;
      git(cachePath, ["branch", "-f", salvageBranch, "HEAD"]);
    }
    git(cachePath, ["reset", "--hard", "--quiet", upstream]);
    return { status: "realigned", upstream, salvageBranch, kept };
  } catch (error) {
    return { status: "failed", reason: errorMessage(error).split("\n")[0] ?? "unknown" };
  }
}
