import { existsSync, lstatSync, readdirSync, readlinkSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { getStateSources } from "../agentfile.js";
import { filterReadsFromAgents } from "../core/agents.js";
import { logSkipped } from "../core/logger.js";
import { validateAllSkills } from "../skills/validate.js";
import { loadState } from "../state.js";
import { AGENT_DEFINITIONS, VENDOR_NEUTRAL_SKILLS_DIR } from "../types.js";
import { expandHome } from "../utils.js";
import type { DriftItem } from "./types.js";

export function checkSkillsDrift(): DriftItem[] {
  const state = loadState();
  if (!state) return [];

  const drift: DriftItem[] = [];

  // Only check local sources — remote (github/url) sources are managed by the skills CLI
  // and are always-fresh; there is no local snapshot to drift-check against.
  const localSources = getStateSources(state).filter((s) => s.type === "local");
  const installedSkills = localSources.flatMap((s) => s.skillsInstalled);
  if (installedSkills.length === 0) return drift;

  const detectedAgents = state.agents.filter((agent) => agent.detected);
  const checkedAgents = filterReadsFromAgents(detectedAgents, new Set(detectedAgents.map((agent) => agent.name)));

  for (const agent of checkedAgents) {
    const skillsDir = expandHome(agent.skillsDir);
    const missing: string[] = [];
    for (const skillName of installedSkills) {
      const skillPath = `${skillsDir}/${skillName}/SKILL.md`;
      if (!existsSync(skillPath)) {
        missing.push(skillName);
      }
    }
    if (missing.length > 0) {
      drift.push({
        agent: agent.name,
        type: "skills",
        detail: `missing skill${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
        diff: { added: missing },
      });
    }
  }

  return drift;
}

/** True when the given symlink's target cannot be found.
 *  Relative link targets are resolved against the symlink's parent dir
 *  (NOT cwd) so valid relative symlinks like `../../.agents/skills/foo`
 *  do not produce false positives. See regression test in drift.test.ts. */
function isBrokenSymlinkEntry(entryPath: string, parentDir: string): boolean {
  if (!lstatSync(entryPath).isSymbolicLink()) return false;
  const linkTarget = readlinkSync(entryPath);
  const resolvedTarget = isAbsolute(linkTarget) ? resolve(linkTarget) : resolve(join(parentDir, linkTarget));
  return !existsSync(resolvedTarget);
}

/** Scan a single agent's skills dir for broken symlinks. Non-readable
 *  entries / unreadable dirs are logged-and-skipped, never thrown. */
function scanDirForBrokenSymlinks(target: { agent: string; skillsDir: string }): DriftItem[] {
  const items: DriftItem[] = [];
  try {
    for (const entry of readdirSync(target.skillsDir)) {
      const entryPath = join(target.skillsDir, entry);
      try {
        if (isBrokenSymlinkEntry(entryPath, target.skillsDir)) {
          items.push({ agent: target.agent, type: "skills", detail: `broken symlink: ${entry}` });
        }
      } catch (e) {
        logSkipped("drift/checkBrokenSymlinks/lstat", e);
      }
    }
  } catch (e) {
    logSkipped("drift/checkBrokenSymlinks/readdir", e);
  }
  return items;
}

export function checkBrokenSymlinks(): DriftItem[] {
  const targets = AGENT_DEFINITIONS.filter((a) => existsSync(expandHome(a.skillsDir))).map((a) => ({
    agent: a.name,
    skillsDir: expandHome(a.skillsDir),
  }));

  const vendorNeutral = expandHome(VENDOR_NEUTRAL_SKILLS_DIR);
  if (existsSync(vendorNeutral)) {
    targets.push({ agent: ".agents", skillsDir: vendorNeutral });
  }

  return targets.flatMap(scanDirForBrokenSymlinks);
}

export function checkSkillsValidity(): DriftItem[] {
  const drift: DriftItem[] = [];

  try {
    const summary = validateAllSkills();
    for (const result of summary.results) {
      const errors = result.issues.filter((i) => i.severity === "error");
      if (errors.length > 0) {
        drift.push({
          agent: result.sourceLabel,
          type: "skill-validity",
          detail: `${result.name}: ${errors.map((e) => e.message).join("; ")} — Run: agentbrew skills validate`,
        });
      }
    }
  } catch (e) {
    logSkipped("drift/map", e);
    // validation unavailable — skip
  }

  return drift;
}

/** Detect non-symlink skill directories in agent skill dirs.
 *  These are skills users created directly instead of through agentbrew. */
export function checkUserCreatedSkills(): DriftItem[] {
  const drift: DriftItem[] = [];
  const seen = new Set<string>();

  const targets = AGENT_DEFINITIONS.filter((a) => existsSync(expandHome(a.skillsDir))).map((a) => ({
    agent: a.name,
    skillsDir: expandHome(a.skillsDir),
  }));

  for (const target of targets) {
    try {
      for (const entry of readdirSync(target.skillsDir)) {
        const entryPath = join(target.skillsDir, entry);
        try {
          const stat = lstatSync(entryPath);
          if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
          if (seen.has(entry)) continue;
          seen.add(entry);
          drift.push({
            agent: target.agent,
            type: "skills-user-added",
            detail: `user-created skill: ${entry}`,
          });
        } catch (e) {
          logSkipped("drift/checkUserCreatedSkills/lstat", e);
          // skip unreadable entries
        }
      }
    } catch (e) {
      logSkipped("drift/checkUserCreatedSkills/readdir", e);
      // dir not readable
    }
  }

  return drift;
}
