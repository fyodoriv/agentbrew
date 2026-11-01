import { basename, resolve } from "node:path";
import type { AgentBrewState, SkillSourceDir } from "./types.js";
import { expandHome } from "./utils.js";

export const LOCAL_SKILL_DIRECTORY_ORIGIN = "agentfile-local-skills";

export function mergeStateSkillDirectories(
  declared: string[] | undefined,
  state: AgentBrewState,
  baseDir: string,
  prune: boolean,
): boolean {
  const merged = mergeSkillDirectories(declared, state.skillSourceDirs, baseDir, prune);
  if (merged.changed) state.skillSourceDirs = merged.dirs;
  return merged.changed;
}

/** Declaration state belongs to one Agentfile directory and survives missing source files. */
export function mergeSkillDirectories(
  declared: string[] | undefined,
  existing: SkillSourceDir[] | undefined,
  baseDir: string,
  prune: boolean,
): { dirs: SkillSourceDir[]; changed: boolean } {
  const paths = [...new Set((declared ?? []).map((path) => resolve(baseDir, expandHome(path))))];
  const previous = existing ?? [];
  const dirs = previous.filter(
    (entry) =>
      !prune ||
      entry.origin !== LOCAL_SKILL_DIRECTORY_ORIGIN ||
      entry.agentfile !== baseDir ||
      paths.includes(entry.path),
  );
  for (const path of paths) {
    if (
      dirs.some(
        (entry) => entry.path === path && entry.origin === LOCAL_SKILL_DIRECTORY_ORIGIN && entry.agentfile === baseDir,
      )
    )
      continue;
    dirs.push({ label: basename(baseDir), path, origin: LOCAL_SKILL_DIRECTORY_ORIGIN, agentfile: baseDir });
  }
  return { dirs, changed: JSON.stringify(previous) !== JSON.stringify(dirs) };
}
