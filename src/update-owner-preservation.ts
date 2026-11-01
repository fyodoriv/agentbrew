import { lstatSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadCatalog } from "./catalog/types.js";
import { loadManifest } from "./manifest.js";
import type { AgentBrewState } from "./types.js";
import { AGENT_DEFINITIONS, VENDOR_NEUTRAL_SKILLS_DIR } from "./types.js";
import { expandHome } from "./utils.js";

function present(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
}

/** Read-only catalog owner discovery across known host roots. Native sync uses
 * selected provider provenance; a pull can also supply its not-yet-installed requests. */
export function existingCatalogOwnerPaths(
  state: AgentBrewState | undefined,
  requestedSkills: readonly string[] = [],
): Set<string> {
  const requested = new Set(requestedSkills);
  const names = loadCatalog()
    .skills.filter((skill) => skill.preserveExisting === true)
    .filter(
      (skill) =>
        requested.has(skill.name) ||
        state?.sources?.some((source) => source.url === skill.source && source.skillsInstalled.includes(skill.name)),
    )
    .map((skill) => skill.name);
  const roots = new Set([
    VENDOR_NEUTRAL_SKILLS_DIR,
    ...AGENT_DEFINITIONS.map((agent) => agent.skillsDir),
    ...(state?.agents ?? []).map((agent) => agent.skillsDir),
  ]);
  return new Set(names.flatMap((name) => [...roots].map((root) => join(expandHome(root), name))).filter(present));
}

/** Read-only ownership snapshot for one update invocation. The external updater
 * is global, so excluded hosts and retained owner conflicts still protect it. */
export function hasProtectedSkillOwner(state: AgentBrewState, requestedSkills: readonly string[] = []): boolean {
  const manifest = loadManifest();
  if ((manifest.localSkillConflicts ?? []).some(present)) return true;
  for (const [dest, source] of Object.entries(manifest.localSkillLinks ?? {})) {
    const entry = lstatSync(dest, { throwIfNoEntry: false });
    if (entry && (!entry.isSymbolicLink() || resolve(dirname(dest), readlinkSync(dest)) !== resolve(source)))
      return true;
  }
  return existingCatalogOwnerPaths(state, [...requestedSkills, ...(state.agentfileSkills ?? [])]).size > 0;
}

/** Owner protection before a first install succeeds must not change an active winner's policy. */
export function dormantCatalogOwnerPaths(
  state: AgentBrewState | undefined,
  desired: ReadonlyMap<string, string>,
  requests: readonly string[] = [],
): string[] {
  return [...existingCatalogOwnerPaths(state, [...requests, ...(state?.agentfileSkills ?? [])])].filter(
    (path) => !desired.has(path),
  );
}
