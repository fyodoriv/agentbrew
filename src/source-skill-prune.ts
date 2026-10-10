import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getStateSources } from "./agentfile.js";
import { INSTALLED_SKILLS_DIR } from "./paths.js";
import type { AgentBrewState } from "./types.js";
import { expandHome } from "./utils.js";

interface PruneDeps {
  /** Remove the skill's folder from the installed-skills staging dir. */
  removeStaging: (name: string) => void;
}

function isTeamOwned(source: { origin?: string }): boolean {
  return typeof source.origin === "string" && source.origin.startsWith("team:");
}

/**
 * Prune source-installed skills that the authoritative Agentfile dropped.
 *
 * `state.agentfileSkills` records the skill list of the last applied
 * authoritative Agentfile. Only a skill that was on that list and is not on
 * the new list is pruned, so a skill installed by hand is never touched. The
 * first run records the list and prunes nothing. Without this, a dropped skill
 * stayed in `skillsInstalled` and `sync --pull` copied it back.
 */
export function pruneDroppedAgentfileSkills(
  agentfile: { skills?: string[] },
  state: AgentBrewState,
  deps: PruneDeps,
): string[] {
  if (!agentfile.skills) return [];
  const current = [...new Set(agentfile.skills)].sort();
  const previous = state.agentfileSkills;
  state.agentfileSkills = current;
  if (!previous) return [];

  const currentSet = new Set(current);
  const pruned: string[] = [];
  for (const name of previous.filter((skill) => !currentSet.has(skill))) {
    let found = false;
    for (const source of getStateSources(state)) {
      if (isTeamOwned(source)) continue;
      const index = source.skillsInstalled.indexOf(name);
      if (index === -1) continue;
      source.skillsInstalled.splice(index, 1);
      found = true;
    }
    if (found) {
      deps.removeStaging(name);
      pruned.push(name);
    }
  }
  return pruned;
}

/** Remove one skill folder from the installed-skills staging dir. No-op in dry-run. */
export function removeInstalledSkillStaging(name: string, dryRun: boolean): void {
  const skillDir = join(expandHome(INSTALLED_SKILLS_DIR), name);
  if (dryRun || !existsSync(skillDir)) return;
  rmSync(skillDir, { recursive: true });
}
