import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { registerSkillSourceDir } from "../add-source.js";
import { getStateSources, installSkillToProject } from "../agentfile.js";
import { cliError, cliNotFound } from "../core/cli-error.js";
import { detectSourceType } from "../git-source-url.js";
import { lockSource } from "../lock.js";
import { INSTALLED_SKILLS_DIR, INSTALLED_SKILLS_LABEL } from "../paths.js";
import { recordSourceSha } from "../skills/skill-versions.js";
import { loadState, saveState } from "../state.js";
import type { AgentBrewState, Source } from "../types.js";
import { ICON_SUCCESS } from "../ui/output.js";
import { expandHome } from "../utils.js";
import {
  classifyGitError,
  findSkillDirInCache,
  getSourceCachePath,
  isSourceFailed,
  scanDirectoryForSkills,
} from "./index-source.js";
import type { InstallSummary } from "./install.js";
import type { CatalogSkill } from "./types.js";

/** Destination directory where catalog-installed skills are staged for sync. */
const installedSkillsPath = expandHome(INSTALLED_SKILLS_DIR);

/** Ensures the installed-skills directory is registered as a skillSourceDir in state. */
function ensureInstalledSkillsRegistered(state: AgentBrewState): boolean {
  const dirs = state.skillSourceDirs ?? [];
  const normalizedTarget = installedSkillsPath.replace(/\/+$/, "");
  const alreadyRegistered = dirs.some((d) => expandHome(d.path).replace(/\/+$/, "") === normalizedTarget);
  if (!alreadyRegistered) {
    if (!state.skillSourceDirs) state.skillSourceDirs = [];
    state.skillSourceDirs.push({ label: INSTALLED_SKILLS_LABEL, path: INSTALLED_SKILLS_DIR });
    return true;
  }
  return false;
}

/**
 * Copies a single skill from a source repo into the installed-skills staging dir.
 * Returns the destination path on success, or undefined on failure.
 * Resolves flat layouts and nested plugin trees via findSkillDirInCache().
 */
export function copySkillFromCache(cachePath: string, skillName: string): string | undefined {
  const skillDir = findSkillDirInCache(cachePath, skillName);
  if (!skillDir) return undefined;

  const destination = join(installedSkillsPath, skillName);

  // Remove stale copy before refresh so we don't accumulate old files
  if (existsSync(destination)) {
    rmSync(destination, { recursive: true, force: true });
  }

  mkdirSync(destination, { recursive: true });
  cpSync(skillDir, destination, { recursive: true });
  return destination;
}

/** Installs a skill from a registered source. */
export async function installFromSource(
  source: Source,
  skillName: string,
  installSummary: InstallSummary,
): Promise<void> {
  // Already installed — collect for batch summary (skip the "Installing skill"
  // banner so steady-state syncs stay quiet; the summary line fires at the end).
  if (source.skillsInstalled.includes(skillName)) {
    const destination = join(installedSkillsPath, skillName);
    if (existsSync(destination)) {
      installSummary.alreadyInstalled.push(skillName);
      return;
    }
  }

  // Source already failed in this session — skip silently, count for summary
  if (isSourceFailed(source.url)) {
    const count = installSummary.failedSourceSkips.get(source.url) ?? 0;
    installSummary.failedSourceSkips.set(source.url, count + 1);
    return;
  }

  console.log(chalk.bold(`\nInstalling skill: ${skillName} from ${source.url}\n`));

  // getSourceCachePath logs "Fetching ..." only when an actual network call is made;
  // subsequent skills in the same session hit the in-process cache and stay quiet.
  const cachePath = getSourceCachePath(source);
  if (!cachePath) {
    cliError(`Failed to fetch source '${source.url}'.`, classifyGitError("", source.url));
    return;
  }

  const destination = copySkillFromCache(cachePath, skillName);
  if (!destination) {
    if (trySourceFallback(cachePath, source.url, skillName)) return;
    cliNotFound(skillName, `in ${source.url}`, "Run `agentbrew sync --pull` to refresh the source index.");
    return;
  }

  // Update state only after the copy succeeded
  const state = loadState();
  if (state) {
    const tracked = getStateSources(state).find((s) => s.url === source.url);
    if (tracked && !tracked.skillsInstalled.includes(skillName)) {
      tracked.skillsInstalled.push(skillName);
      recordSourceSha(tracked);
    }
    ensureInstalledSkillsRegistered(state);
    saveState(state);
  }

  const lockEntry = lockSource(source, [skillName]);
  if (lockEntry) {
    console.log(chalk.dim(`  Locked ${source.url} @${lockEntry.sha.slice(0, 8)}`));
  }

  console.log(`\n${ICON_SUCCESS} Skill '${skillName}' installed from ${source.url}.`);
}

/** Updates state sources after a catalog skill is successfully installed. */
function updateStateAfterSkillInstall(
  state: NonNullable<ReturnType<typeof loadState>>,
  source: Source,
  skillName: string,
  skillSource: string,
): void {
  const tracked = getStateSources(state).find((s) => s.url === skillSource);
  if (tracked) {
    if (!tracked.skillsInstalled.includes(skillName)) {
      tracked.skillsInstalled.push(skillName);
    }
    recordSourceSha(tracked);
  } else {
    source.skillsInstalled = [skillName];
    recordSourceSha(source);
    if (!state.sources) state.sources = [];
    state.sources.push(source);
  }
  saveState(state);
}

/** Resolves the source object and cache path for a catalog skill. Returns undefined if resolution fails. */
function resolveSkillSource(
  skill: CatalogSkill,
  installSummary: InstallSummary,
): { source: Source; cachePath: string } | undefined {
  const state = loadState();
  const existingSource = (state?.sources ?? []).find((s) => s.url === skill.source);

  const source: Source = existingSource ?? {
    url: skill.source,
    type: detectSourceType(skill.source),
    skillsInstalled: [],
    availableItems: [],
    addedAt: new Date().toISOString(),
    origin: "user",
  };

  if (isSourceFailed(source.url)) {
    const count = installSummary.failedSourceSkips.get(source.url) ?? 0;
    installSummary.failedSourceSkips.set(source.url, count + 1);
    return undefined;
  }

  // getSourceCachePath logs "Fetching ..." only when an actual network call is made;
  // subsequent skills in the same session hit the in-process cache and stay quiet.
  const cachePath = getSourceCachePath(source);
  if (!cachePath) {
    cliError(`Failed to fetch '${skill.source}'.`, classifyGitError("", source.url));
    return undefined;
  }

  return { source, cachePath };
}

/** Finds the skill directory in the cache, including nested plugin layouts. */
function findSkillInCache(cachePath: string, skillName: string): string | undefined {
  return findSkillDirInCache(cachePath, skillName);
}

/**
 * In-process set of source URLs for which the full "Registered source" banner
 * has been printed in this session. Subsequent calls for the same source (e.g.
 * installing multiple skills from one source repo) emit a short per-skill line
 * instead of repeating the banner.
 */
const sourceFallbackAnnounced = new Set<string>();

/** Reset the source-fallback announcement cache (exported for tests). */
export function resetSourceFallbackAnnounced(): void {
  sourceFallbackAnnounced.clear();
}

/**
 * Source-fallback: when a specific skill isn't found in cache, check if the source
 * contains skills and register the entire source as a skill source directory.
 * Handles sources that are skill registries (many skills in one repo).
 * Returns true if the fallback succeeded and the caller should return.
 *
 * Messaging contract:
 * - First skill per source URL in a session prints a full "Registered source"
 *   banner with the source URL and available-skill count.
 * - Subsequent skills from the same source print a short "also selected: <name>"
 *   line so the user can still see each skill getting installed without the
 *   banner repeating N times.
 * - When `loadState()` returns undefined (agentbrew not initialized / state
 *   file missing / parse error) registration is a no-op. Emit a single warning
 *   and return true — the caller already tried to install and we don't want
 *   the misleading "not found" error to follow a stale scan hit. The user's
 *   action is `agentbrew init`, not `agentbrew sync --pull`.
 */
function trySourceFallback(cachePath: string, sourceUrl: string, skillName: string): boolean {
  const sourceSkills = scanDirectoryForSkills(cachePath);
  if (sourceSkills.length === 0) return false;

  const state = loadState();
  if (!state) {
    console.error(
      chalk.yellow(
        `  ⚠ ${sourceUrl} contains ${sourceSkills.length} skill(s) but agentbrew state is unavailable — nothing was registered.`,
      ),
    );
    console.log(chalk.dim("  Run `agentbrew init` to initialize state, then retry."));
    return true;
  }

  const sourceItems = sourceSkills.map((s) => ({ ...s, type: "skill" as const }));
  registerSkillSourceDir(state, sourceUrl, sourceItems);
  const tracked = getStateSources(state).find((s) => s.url === sourceUrl);
  if (tracked) {
    tracked.availableItems = sourceItems;
    tracked.indexedAt = new Date().toISOString();
    if (!tracked.skillsInstalled.includes(skillName)) {
      tracked.skillsInstalled.push(skillName);
    }
  }
  ensureInstalledSkillsRegistered(state);
  saveState(state);

  if (sourceFallbackAnnounced.has(sourceUrl)) {
    console.log(`  ${ICON_SUCCESS} also selected: ${skillName}`);
  } else {
    sourceFallbackAnnounced.add(sourceUrl);
    console.log(
      `\n${ICON_SUCCESS} Registered source ${sourceUrl} (${sourceSkills.length} skills available; selected: ${skillName})`,
    );
    console.log(chalk.dim("  Run `agentbrew sync` to deploy skills to all agents."));
  }
  return true;
}

/** Check if a catalog skill is already installed globally.
 *  Built-in skills (source === "built-in") are deployed via skill-plugins
 *  at build time, so they are always "installed" from the installer's
 *  perspective — no fetch, no state record needed. */
export function isAlreadyInstalled(skill: CatalogSkill): boolean {
  if (skill.source === "built-in") return true;
  const state = loadState();
  const existingSource = (state?.sources ?? []).find((s) => s.url === skill.source);
  return Boolean(
    existingSource?.skillsInstalled.includes(skill.name) && existsSync(join(installedSkillsPath, skill.name)),
  );
}

/** Install a catalog skill — fetch from source, copy to staging, update state. */
export async function installSkill(
  skill: CatalogSkill,
  installSummary: InstallSummary,
  localDir?: string,
): Promise<void> {
  if (skill.source === "built-in") {
    installSummary.alreadyInstalled.push(skill.name);
    return;
  }

  // Already installed globally — skip unless installing locally. No "Installing"
  // banner so steady-state syncs stay quiet; the summary line fires at the end.
  if (!localDir && isAlreadyInstalled(skill)) {
    installSummary.alreadyInstalled.push(skill.name);
    return;
  }

  console.log(chalk.bold(`\nInstalling skill: ${skill.name}${localDir ? " (local)" : ""}\n`));

  const resolved = resolveSkillSource(skill, installSummary);
  if (!resolved) return;

  // For local installs, copy to project directory instead of global staging
  if (localDir) {
    const skillDir = findSkillInCache(resolved.cachePath, skill.name);
    if (!skillDir) {
      cliNotFound(skill.name, `in ${skill.source}`, "Run `agentbrew sync --pull` to refresh the source index.");
      return;
    }
    installSkillToProject(localDir, skill.name, skillDir);
    return;
  }

  const destination = copySkillFromCache(resolved.cachePath, skill.name);
  if (!destination) {
    if (trySourceFallback(resolved.cachePath, skill.source, skill.name)) return;
    cliNotFound(skill.name, `in ${skill.source}`, "Run `agentbrew sync --pull` to refresh the source index.");
    return;
  }

  // Update state only after the copy succeeded
  const state = loadState();
  if (state) {
    ensureInstalledSkillsRegistered(state);
    updateStateAfterSkillInstall(state, resolved.source, skill.name, skill.source);
  }

  const lockEntry = lockSource(resolved.source, [skill.name]);
  if (lockEntry) {
    console.log(chalk.dim(`  Locked ${skill.source} @${lockEntry.sha.slice(0, 8)}`));
  }

  console.log(`\n${ICON_SUCCESS} Skill '${skill.name}' installed.`);
}
