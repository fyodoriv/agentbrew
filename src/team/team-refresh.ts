/**
 * `sync --pull` refresh of the team overlay checkout (#331).
 *
 * Fast-forward only: the checkout moves to its upstream when that is a
 * plain fast-forward, then the lock pin, `state.team.commitSha`, and the
 * merged overlay entries follow. A force-pushed or diverged upstream is
 * refused and the old pin stays, so the overlay never drifts silently.
 */
import { execFileSync } from "node:child_process";
import { gitHeadOf, lockTeam } from "../lock.js";
import { saveState } from "../state.js";
import type { AgentBrewState } from "../types.js";
import { loadTeamAgentfile, mergeTeamAgentfile } from "./commands/cli-team.js";

export interface TeamRefreshResult {
  status: "skipped" | "up-to-date" | "updated" | "failed";
  message?: string;
  sha?: string;
}

function git(dir: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "pipe", timeout: 120_000 });
}

export function refreshTeamOverlay(state: AgentBrewState): TeamRefreshResult {
  const team = state.team;
  if (!team?.path) return { status: "skipped" };
  const before = gitHeadOf(team.path);
  try {
    git(team.path, "fetch", "--quiet", "origin");
    git(team.path, "merge", "--ff-only", "--quiet", "@{upstream}");
  } catch (e) {
    const detail = (e as { stderr?: Buffer }).stderr?.toString().trim() ?? String(e);
    return {
      status: "failed",
      message: `Team overlay ${team.url} cannot fast-forward (force-pushed or diverged); kept pin ${before?.slice(0, 8)}. Review it, then run \`agentbrew team set ${team.url}\` to re-pin. ${detail}`,
    };
  }
  const after = gitHeadOf(team.path);
  if (!after || after === before) return { status: "up-to-date", sha: before };

  const agentfile = loadTeamAgentfile(team.path);
  const now = new Date().toISOString();
  if (agentfile) mergeTeamAgentfile(state, agentfile, team.label, now, team.path);
  team.commitSha = after;
  team.lastSyncedAt = now;
  lockTeam(team.url, after);
  saveState(state);
  return { status: "updated", sha: after };
}
