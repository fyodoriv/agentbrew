import { existsSync, lstatSync, readdirSync, readlinkSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { getStateSources } from "../agentfile.js";
import { filterReadsFromAgents } from "../core/agents.js";
import { logSkipped } from "../core/logger.js";
import { validateAllSkills } from "../skills/validate.js";
import { loadState } from "../state.js";
import { findSkillCopies, type SkillCopy } from "../sync/skills-sync.js";
import { AGENT_DEFINITIONS, VENDOR_NEUTRAL_SKILLS_DIR } from "../types.js";
import { expandHome } from "../utils.js";
import type { DriftItem } from "./types.js";

/** Skills drift: installed skills missing from an agent, and skill copies
 *  that stand where sync puts the managed symlink (#366). */
export function checkSkillsDrift(): DriftItem[] {
  return [...checkMissingSkills(), ...checkSkillCopies()];
}

/** Skill copies, or none when the scan fails: a drift check never stops `status`. */
function skillCopies(): SkillCopy[] {
  try {
    return findSkillCopies();
  } catch (e) {
    logSkipped("drift/skillCopies", e);
    return [];
  }
}

/** A real directory with a SKILL.md where sync puts a managed symlink hides
 *  the source: agents keep loading the copy. `agentbrew sync` backs it up and
 *  links the source. */
function checkSkillCopies(): DriftItem[] {
  return skillCopies().map((copy) => ({
    agent: copy.label,
    type: "skills" as const,
    detail: `skill ${copy.name} is a copy, not the managed link: ${copy.path}`,
  }));
}

function checkMissingSkills(): DriftItem[] {
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

/** True when `entryPath` is a real skill folder a user made (not a link or a managed copy). */
function isUserSkillDir(entryPath: string, copies: Set<string>): boolean {
  try {
    const stat = lstatSync(entryPath);
    return !stat.isSymbolicLink() && stat.isDirectory() && !copies.has(resolve(entryPath));
  } catch (e) {
    logSkipped("drift/checkUserCreatedSkills/lstat", e);
    return false;
  }
}

/** Entries of one agent's skills folder, or none when it cannot be read. */
function skillDirEntries(skillsDir: string): string[] {
  try {
    return readdirSync(skillsDir);
  } catch (e) {
    logSkipped("drift/checkUserCreatedSkills/readdir", e);
    return [];
  }
}

/** Detect non-symlink skill directories in agent skill dirs.
 *  These are skills users created directly instead of through agentbrew.
 *  `dedupe: false` reports a name once per agent (for `audit-skills`). */
export function checkUserCreatedSkills(options: { dedupe?: boolean } = {}): DriftItem[] {
  const dedupe = options.dedupe ?? true;
  const drift: DriftItem[] = [];
  const seen = new Set<string>();
  // A copy of a managed skill is skills drift (checkSkillCopies), not a user addition.
  const copies = new Set(skillCopies().map((copy) => resolve(copy.path)));

  for (const agent of AGENT_DEFINITIONS) {
    const skillsDir = expandHome(agent.skillsDir);
    if (!existsSync(skillsDir)) continue;
    for (const entry of skillDirEntries(skillsDir)) {
      if (!isUserSkillDir(join(skillsDir, entry), copies)) continue;
      if (dedupe && seen.has(entry)) continue;
      seen.add(entry);
      drift.push({ agent: agent.name, type: "skills-user-added", detail: `user-created skill: ${entry}` });
    }
  }

  return drift;
}
