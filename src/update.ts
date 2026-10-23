import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { getStateSources, loadAgentfile } from "./agentfile.js";
import { findSkillDirInCache, getSourceCachePath, indexAllSources } from "./catalog/index-source.js";
import { refreshRecommendedCatalogRules } from "./catalog/install-other.js";
import { copySkillFromCache, isInstalledSkillCurrent } from "./catalog/install-skill.js";
import { installedSkillOwners } from "./catalog/skill-owners.js";
import { loadCatalog } from "./catalog/types.js";
import { clearSyncErrors, errorMessage, SyncError, SyncErrorCollector, saveSyncErrors } from "./core/errors.js";
import { redactUrlCredentials } from "./core/redact-url.js";
import { readLock, updateLock } from "./lock.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { recordSourceShas } from "./skills/skill-versions.js";
import { pruneDroppedAgentfileSkills, removeInstalledSkillStaging } from "./source-skill-prune.js";
import { requireState, saveState } from "./state.js";
import { syncAgentDefs } from "./sync/agents-sync.js";
import { syncCommands } from "./sync/command-sync.js";
import { syncHooks } from "./sync/hooks-sync.js";
import { syncInstructions } from "./sync/instructions-sync.js";
import { syncMcpServers } from "./sync/mcp-sync.js";
import { syncModels } from "./sync/model-sync.js";
import { syncRules } from "./sync/rules-sync.js";
import { syncSkills } from "./sync/skills-sync.js";
import type { AgentBrewState, Source } from "./types.js";
import { ICON_ERROR, ICON_SUCCESS } from "./ui/output.js";
import { expandHome } from "./utils.js";

interface UpdateOptions {
  dryRun?: boolean;
  skillName?: string;
}

type RefreshStatus = "refreshed" | "unchanged" | "skipped" | "failed";
type RefreshResult = { source: string; skill: string; status: RefreshStatus };

function refreshSkillResult(source: Source, skillName: string, cachePath: string, dryRun: boolean): RefreshResult {
  // Re-copying an unchanged skill rewrites every file for nothing.
  if (isInstalledSkillCurrent(cachePath, skillName))
    return { source: source.url, skill: skillName, status: "unchanged" };
  if (dryRun) {
    return { source: source.url, skill: skillName, status: "refreshed" };
  }
  const destination = copySkillFromCache(cachePath, skillName);
  return { source: source.url, skill: skillName, status: destination ? "refreshed" : "failed" };
}

/**
 * Cache path of each remote source with installed skills, plus the one owner
 * of every installed name (see installedSkillOwners). A source whose cache no
 * longer has the skill cannot own it, so the next source that ships it does.
 */
function refreshPlan(sources: Source[]): { cachePaths: Map<Source, string>; owners: Map<string, string> } {
  const cachePaths = new Map<Source, string>();
  for (const source of sources) {
    if (source.type === "local" || source.skillsInstalled.length === 0) continue;
    const cachePath = getSourceCachePath(source);
    if (cachePath) cachePaths.set(source, cachePath);
  }
  const owners = installedSkillOwners(sources, (source, name) => {
    const cachePath = cachePaths.get(source);
    return cachePath !== undefined && findSkillDirInCache(cachePath, name) !== undefined;
  });
  return { cachePaths, owners };
}

/**
 * Refreshes installed skill files from their source caches when the source SHA
 * has changed since the last install. This is the missing step between "pull latest
 * source" and "sync to agents" — without it, installed-skills/ contains stale copies.
 */
export function refreshInstalledSkills(sources: Source[], options?: UpdateOptions): RefreshResult[] {
  const results: RefreshResult[] = [];
  const { cachePaths, owners } = refreshPlan(sources);

  for (const [source, cachePath] of cachePaths) {
    const skillsToRefresh = options?.skillName
      ? source.skillsInstalled.filter((name) => name === options.skillName)
      : source.skillsInstalled;

    for (const skillName of skillsToRefresh) {
      const owner = owners.get(skillName);
      // Another source owns this name; copying here would overwrite its copy.
      if (owner !== undefined && owner !== source.url) {
        results.push({ source: source.url, skill: skillName, status: "skipped" });
        continue;
      }
      results.push(refreshSkillResult(source, skillName, cachePath, options?.dryRun ?? false));
    }
  }

  return results;
}

function isCliNotInstalled(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ("code" in error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
  return error.message.includes("not found") || error.message.includes("cannot find");
}

function updateBuiltinSkills(): void {
  try {
    const output = execFileSync("npx", ["skills", "check"], {
      stdio: "pipe",
      timeout: 60_000,
      encoding: "utf-8",
    });
    const trimmed = output.trim();
    if (trimmed === "" || trimmed.includes("up to date")) {
      console.log(`  ${ICON_SUCCESS} All skills up to date`);
    } else if (trimmed.includes("outdated") || trimmed.includes("update available")) {
      console.log(output);
      console.log(chalk.dim("  Updating..."));
      execFileSync("npx", ["skills", "update"], { stdio: "inherit", timeout: 120_000 });
      console.log(`  ${ICON_SUCCESS} Skills updated`);
    } else {
      // Unrecognized output — print verbatim so the user can verify manually
      console.log(chalk.dim("  npx skills check output (unrecognized format):"));
      console.log(chalk.dim(trimmed));
    }
  } catch (error) {
    // Distinguish "not installed" (ENOENT / exit code 1) from genuine failures
    if (isCliNotInstalled(error)) {
      console.log(chalk.dim("  skills CLI not found — skipping skill updates"));
      console.log(chalk.dim("  Install: npm i -g skills"));
    } else {
      console.error(chalk.yellow(`  skills check failed: ${errorMessage(error)}`));
    }
  }
}

async function reindexSourcesAndRecord(sources: Source[], state: AgentBrewState): Promise<Map<string, string>> {
  console.log(chalk.bold("\nSources"));
  await indexAllSources(sources);
  // Record latest SHAs, in parallel; the lock update below reuses them.
  const shas = await recordSourceShas(sources);
  saveState(state);
  return shas;
}

/**
 * Reset the bridge's "attempted but mcpm couldn't resolve" cache so the
 * next `agentbrew sync` retries every state server. Called from
 * `agentbrew sync --pull` because that's the user's explicit signal that
 * external sources (including mcpm's registry) may have moved on.
 *
 * Without this clear, a server that wasn't in mcpm's registry at the
 * time it was added would stay perma-cached as "missing" — the user
 * couldn't retry without manually editing the manifest. See
 * `bridgeStateMcpToMcpm` in src/sync/mcp-sync.ts and the
 * `mcpmBridgeAttemptedMissing` field in src/manifest.ts.
 */
export function clearMcpmBridgeAttemptedMissing(): void {
  const manifest = loadManifest();
  if (!manifest.mcpmBridgeAttemptedMissing || manifest.mcpmBridgeAttemptedMissing.length === 0) return;
  manifest.mcpmBridgeAttemptedMissing = [];
  saveManifest(manifest);
}

function printRefreshResults(refreshResults: RefreshResult[]): void {
  let refreshedCount = 0;
  for (const result of refreshResults) {
    if (result.status === "refreshed") {
      refreshedCount++;
      console.log(`  ${chalk.yellow("↑")} ${result.skill} ${chalk.dim(`from ${result.source}`)}`);
    } else if (result.status === "failed") {
      console.error(`  ${ICON_ERROR} ${result.skill} ${chalk.dim(`not found in ${result.source}`)}`);
    }
  }
  if (refreshedCount === 0 && refreshResults.length > 0) {
    console.log(`  ${ICON_SUCCESS} All installed skills up to date`);
  } else if (refreshResults.length === 0) {
    console.log(chalk.dim("  No installed skills from remote sources"));
  }
}

function printLockResults(sources: Source[], knownShas: ReadonlyMap<string, string>): void {
  const lock = readLock();
  if (lock.locked.length > 0) {
    console.log(chalk.bold("\nLock file"));
    const results = updateLock(sources, undefined, knownShas);
    for (const result of results) {
      if (result.status === "updated") {
        console.log(
          `  ${chalk.yellow("↑")} ${result.source} — ${chalk.dim(`${result.oldSha?.slice(0, 8)} → ${result.sha?.slice(0, 8)}`)}`,
        );
      } else if (result.status === "up-to-date") {
        console.log(`  ${ICON_SUCCESS} ${result.source} — ${chalk.dim("up to date")}`);
      } else if (result.status === "pruned") {
        console.log(`  ${chalk.dim("−")} ${result.source} — ${chalk.dim("source removed, entry pruned")}`);
      } else if (result.status === "error") {
        console.log(`  ${chalk.yellow("?")} ${result.source} — ${chalk.dim("could not resolve SHA")}`);
      }
    }
  }
}

const SYNC_ENGINES: ReadonlyArray<{ name: string; label: string; run: () => Promise<unknown> }> = [
  { name: "mcp", label: "\nMCP Servers", run: () => syncMcpServers() },
  { name: "rules", label: "Rules", run: () => syncRules() },
  { name: "skills", label: "Skills", run: () => syncSkills() },
  { name: "commands", label: "Commands", run: () => syncCommands() },
  { name: "agents", label: "Agents", run: () => syncAgentDefs() },
  // Keep in step with buildSyncModules (src/sync-runner.ts): a module left out
  // here is skipped by `sync --pull` (hook scripts once stayed stale this way).
  { name: "hooks", label: "Hooks", run: () => syncHooks() },
  { name: "models", label: "Models", run: () => syncModels() },
  { name: "instructions", label: "Instructions", run: () => syncInstructions() },
];

/** Runs every engine even when one fails, and records the result for `agentbrew status`. */
async function syncAllEngines(): Promise<boolean> {
  const collector = new SyncErrorCollector();
  for (const engine of SYNC_ENGINES) {
    console.log(chalk.bold(engine.label));
    try {
      await engine.run();
    } catch (error) {
      collector.add(new SyncError(engine.name, errorMessage(error), { cause: error }));
    }
  }
  if (collector.hasErrors) {
    saveSyncErrors(collector);
    console.error(chalk.yellow(`\n  ⚠ ${collector.count} sync error(s):`));
    console.log(collector.summary());
    process.exitCode = 1;
    return false;
  }
  clearSyncErrors();
  return true;
}

function updateBuiltinSkillsIfNeeded(options: UpdateOptions | undefined, isDryRun: boolean): void {
  if (!isDryRun && !options?.skillName) {
    console.log(chalk.bold("Skills"));
    updateBuiltinSkills();
  }
}

async function reindexSourcesIfNeeded(
  sources: Source[],
  state: AgentBrewState,
  isDryRun: boolean,
): Promise<Map<string, string>> {
  if (sources.length > 0 && !isDryRun) return reindexSourcesAndRecord(sources, state);
  return new Map();
}

function printSourcePullPlan(sources: Source[], prefix: string): void {
  const remote = sources.filter((source) => source.type !== "local");
  if (remote.length === 0) return;
  console.log(chalk.bold(`\n${prefix}Sources`));
  for (const source of remote) console.log(`  Would pull ${redactUrlCredentials(source.url)}`);
}

function printInstalledSkillUpdates(
  sources: Source[],
  options: UpdateOptions | undefined,
  prefix: string,
  isDryRun: boolean,
): void {
  if (sources.length === 0) return;
  console.log(chalk.bold(`\n${prefix}Installed skills`));
  if (isDryRun) console.log(chalk.dim("  Skipped (dry-run)"));
  printRefreshResults(refreshInstalledSkills(sources, options));
}

function refreshCatalogRulesIfNeeded(isDryRun: boolean): void {
  if (isDryRun) return;
  const { refreshed } = refreshRecommendedCatalogRules(loadCatalog().rules);
  if (refreshed.length > 0) {
    console.log(
      chalk.dim(`\n  Refreshed ${refreshed.length} catalog rule(s) from catalog.yaml: ${refreshed.join(", ")}\n`),
    );
  }
}

/** Apply the dropped-skill prune from the global Agentfile before skills are refreshed. */
function pruneDroppedGlobalAgentfileSkills(state: AgentBrewState, dryRun: boolean): void {
  if (dryRun) return;
  const agentfile = loadAgentfile(expandHome("~/.config/agentbrew"));
  if (!agentfile) return;
  const pruned = pruneDroppedAgentfileSkills(agentfile, state, {
    removeStaging: (name) => removeInstalledSkillStaging(name, false),
  });
  saveState(state);
  if (pruned.length > 0) {
    console.log(chalk.dim(`  Pruned skills the Agentfile no longer lists: ${pruned.join(", ")}`));
  }
}

export async function update(options?: UpdateOptions): Promise<void> {
  const state = requireState();
  if (!state) return;

  const isDryRun = options?.dryRun ?? false;
  const prefix = isDryRun ? chalk.dim("[dry-run] ") : "";

  console.log(chalk.bold(`\n${prefix}Checking for updates...\n`));

  // 1. Update skills via npx skills update (skip in dry-run and single-skill modes)
  updateBuiltinSkillsIfNeeded(options, isDryRun);

  // Clear the mcpm-bridge attempted-missing cache so the next sync
  // retries every state server. mcpm's registry may have grown since
  // last attempt; --pull is the user's explicit "refresh external
  // sources" signal so we treat the cache as stale.
  if (!isDryRun) {
    clearMcpmBridgeAttemptedMissing();
  }

  // 2. Prune skills the global Agentfile dropped, so step 3 does not copy them back
  pruneDroppedGlobalAgentfileSkills(state, isDryRun);

  // 3. Re-index all sources (pulls latest via git)
  const sources = getStateSources(state);
  if (isDryRun) printSourcePullPlan(sources, prefix);
  const knownShas = await reindexSourcesIfNeeded(sources, state, isDryRun);

  // 4. Refresh installed skill files from updated caches (skip writes in dry-run)
  printInstalledSkillUpdates(sources, options, prefix, isDryRun);

  // 5. Update lock file with latest SHAs (skip in dry-run)
  if (!isDryRun) {
    printLockResults(sources, knownShas);
  }

  // 6. Refresh slimmed catalog rule bodies into shared-rules.md before deploy
  // (`sync --pull` exits before installRecommended; regular sync runs refresh there).
  refreshCatalogRulesIfNeeded(isDryRun);

  // 7. Re-sync all engines to all agents (skip in dry-run)
  if (!isDryRun && !(await syncAllEngines())) {
    console.log(chalk.bold.yellow("\n⚠ Update finished with sync errors — run `agentbrew status` for details.\n"));
    return;
  }

  console.log(chalk.bold(`\n${prefix}✓ Update complete.\n`));
}
