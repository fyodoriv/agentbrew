import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { logSkipped } from "./core/logger.js";
import type { AgentConfig, SkillInfo } from "./types.js";
import { AGENT_DEFINITIONS } from "./types.js";
import { expandHome } from "./utils.js";

export function detectAgents(excludeAgents: ReadonlySet<string> = new Set()): AgentConfig[] {
  return AGENT_DEFINITIONS.map((def) => {
    if (excludeAgents.has(def.name)) {
      return { ...def, detected: false };
    }
    const skillsDir = expandHome(def.skillsDir);
    const parentDir = join(skillsDir, "..");
    const detected = existsSync(parentDir);

    return {
      ...def,
      detected,
    };
  });
}

/** Names the state marks `detected: false`: not installed, or listed in the
 *  Agentfile's `excludeAgents`. Sync must not create files for these, because
 *  a new config dir makes the next `detectAgents` call see the agent again. */
export function undetectedAgentNames(state: { agents?: AgentConfig[] } | null | undefined): Set<string> {
  return new Set((state?.agents ?? []).filter((agent) => agent.detected === false).map((agent) => agent.name));
}

function discoverSkills(agent: AgentConfig): SkillInfo[] {
  const skillsDir = expandHome(agent.skillsDir);
  if (!existsSync(skillsDir)) return [];

  const skills: SkillInfo[] = [];

  try {
    const entries = readdirSync(skillsDir);
    for (const entry of entries) {
      const entryPath = join(skillsDir, entry);
      const stat = statSync(entryPath, { throwIfNoEntry: false });
      if (!stat) continue;

      const isSkillDir = stat.isDirectory() || stat.isSymbolicLink() ? existsSync(join(entryPath, "SKILL.md")) : false;

      const isSkillFile = entry === "SKILL.md" && stat.isFile();

      if (isSkillDir) {
        skills.push({
          name: entry,
          source: `${agent.name}:${skillsDir}`,
          path: entryPath,
        });
      } else if (isSkillFile) {
        skills.push({
          name: "root",
          source: `${agent.name}:${skillsDir}`,
          path: entryPath,
        });
      }
    }
  } catch (e) {
    logSkipped("agents/push", e);
    // directory not readable
  }

  return skills;
}

export function discoverAllSkills(agents: AgentConfig[]): Map<string, SkillInfo> {
  const allSkills = new Map<string, SkillInfo>();

  for (const agent of agents) {
    if (!agent.detected) continue;
    const skills = discoverSkills(agent);
    for (const skill of skills) {
      if (!allSkills.has(skill.name)) {
        allSkills.set(skill.name, skill);
      }
    }
  }

  return allSkills;
}
