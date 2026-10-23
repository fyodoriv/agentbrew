import type { Source } from "../types.js";

/** One installed skill name that more than one source ships. */
export interface InstalledSkillClash {
  skill: string;
  /** The source whose copy is installed. */
  owner: string;
  /** Sources that also ship the name; their copy is not installed. */
  skipped: string[];
}

/** Whether `source` can supply skill `name` (default: it lists the name). */
export type ShipsSkill = (source: Source, name: string) => boolean;

/**
 * Map each installed skill name to the source that owns its single
 * `installed-skills/<name>` folder. When two remote sources ship the same
 * name, the source listed later in state wins: a newer source that ships an
 * existing name is usually a deliberate replacement, such as an absorbed fork.
 * The rule is deterministic, so the copy no longer flips on each sync. Local
 * sources deploy from their own folder, never from `installed-skills/`, so
 * they take no part. `ships` lets a caller skip a source whose cache no longer
 * has the skill, so the next source that ships it takes over.
 */
export function installedSkillOwners(sources: Source[], ships: ShipsSkill = () => true): Map<string, string> {
  const owners = new Map<string, string>();
  for (const source of sources) {
    if (source.type === "local") continue;
    for (const name of source.skillsInstalled) {
      if (ships(source, name)) owners.set(name, source.url);
    }
  }
  return owners;
}

/** Every installed skill name that more than one remote source ships, with its owner. */
export function installedSkillClashes(sources: Source[]): InstalledSkillClash[] {
  const owners = installedSkillOwners(sources);
  const shippers = new Map<string, Set<string>>();
  for (const source of sources) {
    if (source.type === "local") continue;
    for (const name of source.skillsInstalled) shippers.set(name, (shippers.get(name) ?? new Set()).add(source.url));
  }
  return [...shippers.entries()]
    .filter(([, urls]) => urls.size > 1)
    .map(([skill, urls]) => {
      const owner = owners.get(skill) as string;
      return { skill, owner, skipped: [...urls].filter((url) => url !== owner) };
    })
    .sort((a, b) => a.skill.localeCompare(b.skill));
}
