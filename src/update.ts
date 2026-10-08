import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { getStateSources } from "./agentfile.js";
import { getSourceCachePath, indexAllSources } from "./catalog/index-source.js";
import { refreshRecommendedCatalogRules } from "./catalog/install-other.js";
import { copySkillFromCache } from "./catalog/install-skill.js";
import { loadCatalog } from "./catalog/types.js";
import { clearSyncErrors, errorMessage, SyncError, SyncErrorCollector, saveSyncErrors } from "./core/errors.js";
import { readLock, updateLock } from "./lock.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { recordSourceSha } from "./skills/skill-versions.js";
import { requireState, saveState } from "./state.js";
import { syncAgentDefs } from "./sync/agents-sync.js";
import { syncCommands } from "./sync/command-sync.js";
import { syncInstructions } from "./sync/instructions-sync.js";
import { syncMcpServers } from "./sync/mcp-sync.js";
import { syncRules } from "./sync/rules-sync.js";
import { syncSkills } from "./sync/skills-sync.js";
import type { AgentBrewState, Source } from "./types.js";
import { ICON_ERROR, ICON_SUCCESS } from "./ui/output.js";

interface UpdateOptions {
  dryRun?: boolean;
  skillName?: string;
}

type RefreshStatus = "refreshed" | "skipped" | "failed";
type RefreshResult = { source: string; skill: string; status: RefreshStatus };

function refreshSkillResult(source: Source, skillName: string, cachePath: string, dryRun: boolean): RefreshResult {
  if (dryRun) {
    return { source: source.url, skill: skillName, status: "refreshed" };
  }
  const destination = copySkillFromCache(cachePath, skillName);
  return { source: source.url, skill: skillName, status: destination ? "refreshed" : "failed" };
}

/**
 * Refreshes installed skill files from their source caches when the source SHA
 * has changed since the last install. This is the missing step between "pull latest
 * source" and "sync to agents" — without it, installed-skills/ contains stale copies.
 */
export function refreshInstalledSkills(sources: Source[], options?: UpdateOptions): RefreshResult[] {
  const results: RefreshResult[] = [];

  for (const source of sources) {
    if (source.type === "local") continue;
    if (source.skillsInstalled.length === 0) continue;

    const cachePath = getSourceCachePath(source);
    if (!cachePath) continue;

    const skillsToRefresh = options?.skillName
      ? source.skillsInstalled.filter((name) => name === options.skillName)
      : source.skillsInstalled;

    for (const skillName of skillsToRefresh) {
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

async function reindexSourcesAndRecord(sources: Source[], state: AgentBrewState): Promise<void> {
  console.log(chalk.bold("\nSources"));
  await indexAllSources(sources);
  // Record latest SHAs
  for (const source of sources) {
    recordSourceSha(source);
  }
  saveState(state);
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

function printLockResults(sources: Source[]): void {
  const lock = readLock();
  if (lock.locked.length > 0) {
    console.log(chalk.bold("\nLock file"));
    const results = updateLock(sources);
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

async function reindexSourcesIfNeeded(sources: Source[], state: AgentBrewState, isDryRun: boolean): Promise<void> {
  if (sources.length > 0 && !isDryRun) await reindexSourcesAndRecord(sources, state);
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

  // 2. Re-index all sources (pulls latest via git)
  const sources = getStateSources(state);
  await reindexSourcesIfNeeded(sources, state, isDryRun);

  // 3. Refresh installed skill files from updated caches (skip writes in dry-run)
  printInstalledSkillUpdates(sources, options, prefix, isDryRun);

  // 4. Update lock file with latest SHAs (skip in dry-run)
  if (!isDryRun) {
    printLockResults(sources);
  }

  // 5. Refresh slimmed catalog rule bodies into shared-rules.md before deploy
  // (`sync --pull` exits before installRecommended; regular sync runs refresh there).
  refreshCatalogRulesIfNeeded(isDryRun);

  // 6. Re-sync all engines to all agents (skip in dry-run)
  if (!isDryRun && !(await syncAllEngines())) {
    console.log(chalk.bold.yellow("\n⚠ Update finished with sync errors — run `agentbrew status` for details.\n"));
    return;
  }

  console.log(chalk.bold(`\n${prefix}✓ Update complete.\n`));
}
