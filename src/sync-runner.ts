import chalk from "chalk";
import type { ApplyAgentfileResult } from "./agentfile.js";
import { applyAgentfile } from "./agentfile.js";
import { clearSyncErrors, errorMessage, SyncError, SyncErrorCollector, saveSyncErrors } from "./core/errors.js";
import { logSkipped } from "./core/logger.js";
import { collectDrift, formatDriftSummary } from "./drift.js";
import type { Manifest } from "./manifest.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { maybeMeasureContextBudgetAfterSync } from "./measure/context-budget.js";
import { snapshotAgentConfigs } from "./ops.js";
import { loadState, withStateOverride } from "./state.js";
import { syncAgentDefs } from "./sync/agents-sync.js";
import { syncCommands } from "./sync/command-sync.js";
import { syncHooks } from "./sync/hooks-sync.js";
import { syncInstructions } from "./sync/instructions-sync.js";
import { syncMcpServers } from "./sync/mcp-sync.js";
import { syncModels } from "./sync/model-sync.js";
import { syncRules } from "./sync/rules-sync.js";
import { syncSkills } from "./sync/skills-sync.js";
import {
  formatSoftUpdateSummary,
  isAgentbrewProvidedSkillSource,
  softUpdateStaleOverlaySources,
} from "./sync/soft-update.js";
import type { AgentBrewState } from "./types.js";
import { refreshInstalledSkills } from "./update.js";
import { expandHome } from "./utils.js";

export type SyncModule = { name: string; fn: (shared?: { manifest?: Manifest }) => Promise<unknown> };

interface SyncRunnerOptions {
  skipGlobalAgentfile?: boolean;
  compact?: boolean;
  installAgentfileItems?: boolean;
  dryRun?: boolean;
  agentfilePath?: string;
}

interface PreparedSync {
  virtualState?: AgentBrewState;
}

/** Install skills and recommended items requested by one or more Agentfile apply results. */
async function handleAgentfileInstalls(...results: Array<ApplyAgentfileResult | undefined>): Promise<void> {
  const skillsToInstall = new Set<string>();
  let recommendedRequested = false;
  for (const result of results) {
    if (!result) continue;
    for (const skillName of result.skillsToInstall) skillsToInstall.add(skillName);
    if (result.recommendedRequested) recommendedRequested = true;
  }
  if (skillsToInstall.size === 0 && !recommendedRequested) return;

  const { install, flushInstallSummary, installSkills } = await import("./catalog/install.js");
  if (recommendedRequested) {
    await install(undefined, { recommended: true });
  }
  await installSkills([...skillsToInstall]);
  flushInstallSummary();
}

function snapshotBeforeSync(dryRun: boolean): void {
  if (dryRun) return;
  try {
    snapshotAgentConfigs();
  } catch (e) {
    logSkipped("sync-runner/snapshotAgentConfigs", e);
    /* non-fatal */
  }
}

function softUpdateOverlaySourcesBeforeSync(dryRun: boolean): void {
  if (dryRun) return;
  try {
    const softUpdate = softUpdateStaleOverlaySources();
    const summary = formatSoftUpdateSummary(softUpdate);
    if (summary) console.log(chalk.dim(`  ${summary}`));
  } catch (e) {
    logSkipped("sync-runner/softUpdateStaleOverlaySources", e);
    /* non-fatal — offline or auth failures must never abort sync */
  }
}

/** Re-copy installed skill files from refreshed caches for agentbrew-provided sources. */
function refreshManagedInstalledSkillsBeforeSync(dryRun: boolean): void {
  if (dryRun) return;
  try {
    const state = loadState();
    const managedSources = state?.sources?.filter(isAgentbrewProvidedSkillSource) ?? [];
    if (managedSources.length === 0) return;
    refreshInstalledSkills(managedSources);
  } catch (e) {
    logSkipped("sync-runner/refreshManagedInstalledSkills", e);
    /* non-fatal — stale installed copies must never abort sync */
  }
}

function cloneStateForDryRun(state: AgentBrewState | undefined): AgentBrewState | undefined {
  if (!state) return undefined;
  return JSON.parse(JSON.stringify(state)) as AgentBrewState;
}

/** Apply global and project Agentfiles, install requested skills, and snapshot configs. */
async function prepareSync(options?: SyncRunnerOptions): Promise<PreparedSync> {
  const installAgentfileItems = options?.installAgentfileItems ?? true;
  const dryRun = options?.dryRun ?? false;
  const virtualState = dryRun ? cloneStateForDryRun(loadState()) : undefined;
  // Apply global Agentfile (~/.config/agentbrew/Agentfile) — authoritative
  // Skipped when --agentfile was used (the explicit path already applied as the source of truth)
  const globalDir = expandHome("~/.config/agentbrew");
  let globalResult: ApplyAgentfileResult | undefined;
  if (dryRun && options?.agentfilePath) {
    try {
      globalResult = applyAgentfile(options.agentfilePath, {
        quiet: true,
        authoritative: true,
        includeSkillInstallReport: installAgentfileItems,
        dryRun,
        stateOverride: virtualState,
      });
    } catch (e) {
      logSkipped("sync-runner/applyAgentfile", e);
      /* non-fatal */
    }
  } else if (!options?.skipGlobalAgentfile) {
    try {
      globalResult = applyAgentfile(globalDir, {
        quiet: true,
        authoritative: true,
        includeSkillInstallReport: installAgentfileItems,
        dryRun,
        stateOverride: virtualState,
      });
    } catch (e) {
      logSkipped("sync-runner/applyAgentfile", e);
      /* non-fatal */
    }
  }

  // Apply project Agentfile from cwd — additive only
  let projectResult: ApplyAgentfileResult | undefined;
  try {
    projectResult = applyAgentfile(process.cwd(), {
      quiet: false,
      includeSkillInstallReport: installAgentfileItems,
      dryRun,
      stateOverride: virtualState,
    });
  } catch (e) {
    logSkipped("sync-runner/applyAgentfile", e);
    /* non-fatal — Agentfile is optional */
  }

  // Install skills/recommended requested by Agentfiles
  try {
    if (installAgentfileItems && !dryRun) {
      await handleAgentfileInstalls(globalResult, projectResult);
    }
  } catch (e) {
    logSkipped("sync-runner/handleAgentfileInstalls", e);
    /* non-fatal */
  }

  // Snapshot agent config files before sync so rollback is possible
  snapshotBeforeSync(dryRun);

  // Soft-update stale agentbrew-provided skill sources (catalog, team overlay,
  // global Agentfile) so managed skills stay current without `sync --pull`.
  // Within the cache TTL (30 min) this is a cheap state scan + no network.
  // See `src/sync/soft-update.ts` for the TTL and origin filter.
  softUpdateOverlaySourcesBeforeSync(dryRun);
  refreshManagedInstalledSkillsBeforeSync(dryRun);

  return { virtualState };
}

async function runWithPreparedState<T>(options: SyncRunnerOptions | undefined, fn: () => Promise<T>): Promise<T> {
  const { virtualState } = await prepareSync(options);
  return withStateOverride(virtualState, fn);
}

async function collectParallelResults(modules: SyncModule[], sharedManifest: Manifest): Promise<SyncErrorCollector> {
  const collector = new SyncErrorCollector();
  // "models" shares target files with parallel modules (~/.claude/settings.json
  // with hooks, ~/.codex/config.toml with mcp carve-outs), so it runs in
  // the sequential phase where no concurrent read-modify-write can interleave.
  const fileShareNames = new Set(["instructions", "rules", "models"]);
  const parallelModules = modules.filter((m) => !fileShareNames.has(m.name));

  const parallelResults = await Promise.allSettled(parallelModules.map((m) => m.fn({ manifest: sharedManifest })));
  for (const [i, result] of parallelResults.entries()) {
    if (result.status === "rejected") {
      collector.add(new SyncError(parallelModules[i].name, errorMessage(result.reason), { cause: result.reason }));
    }
  }

  return collector;
}

async function runSequentialFileShareModules(
  modules: SyncModule[],
  sharedManifest: Manifest,
  collector: SyncErrorCollector,
): Promise<void> {
  const sequentialModules = [
    modules.find((m) => m.name === "rules"),
    modules.find((m) => m.name === "instructions"),
    modules.find((m) => m.name === "models"),
  ].filter((m) => m !== undefined);

  for (const mod of sequentialModules) {
    try {
      await mod.fn({ manifest: sharedManifest });
    } catch (err) {
      collector.add(new SyncError(mod.name, errorMessage(err), { cause: err }));
    }
  }
}

/**
 * Drift item types that are NOT actionable by `agentbrew sync` and must be
 * filtered out of the post-sync drift report. These show under their own
 * `User additions` section in `agentbrew status` (informational, not drift)
 * — including them in the post-sync "drift issue(s) remain" line is the bug
 * referenced by sync-idempotent-and-complete issue 4 + criterion (c).
 *
 * Mirrors the split in `health.ts` where `userAddedDrift` is reported in a
 * separate section from `syncDrift` and never feeds the auto-repair loop.
 */
const NON_DRIFT_TYPES: ReadonlySet<string> = new Set(["skills-user-added", "commands-user-added", "mcp-user-added"]);

/** Report any remaining drift after a successful sync. */
function reportPostSyncDrift(): void {
  try {
    // Filter out user-additions before counting — those are informational and
    // belong in `agentbrew status`'s `User additions` section, not in the
    // post-sync drift footer that prompts users to run `agentbrew status --fix`.
    const drift = collectDrift().filter((d) => !NON_DRIFT_TYPES.has(d.type));
    if (drift.length > 0) {
      const breakdown = formatDriftSummary(drift);
      console.log(chalk.yellow(`\n  ⚠ ${drift.length} drift issue(s) remain after sync ${breakdown}`));
      console.log(chalk.dim(`  Run ${chalk.white("agentbrew status --fix")} for details.\n`));
    }
  } catch (e) {
    logSkipped("sync-runner/log", e);
    // drift check is non-fatal
  }
}

/**
 * Emit the single consolidated summary line that replaces all per-module
 * output in compact mode. Modules ran with `compact: true` so they emitted
 * no headers or per-target detail; the runner is the sole producer of
 * positive sync output.
 *
 * Format: `✓ Synced (Xs) — N agents` (or `Synced in Ys` for slow runs).
 *
 * Counts come from state.yaml's `agents` array — that's the durable answer
 * to "what did sync touch?" without having to plumb per-module SyncSummary
 * objects through the full sync pipeline. Per-module breakdown stays available via
 * `agentbrew sync --verbose` and `agentbrew status`. The user-facing
 * contract: ≤5 lines on a fully-converged no-op sync.
 */
function reportPostSyncCompactSummary(elapsedMs: number): void {
  try {
    const state = loadState();
    const detected = state?.agents.filter((a) => a.detected).length ?? 0;
    const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
    const agentsLabel = detected === 1 ? "1 agent" : `${detected} agents`;
    console.log(chalk.green(`  ✓ Synced (${elapsedSeconds}s) — ${agentsLabel}`));
  } catch (e) {
    logSkipped("sync-runner/reportPostSyncCompactSummary", e);
    // best-effort summary — never block sync on it
  }
}

/**
 * Runs a list of sync modules sequentially, collecting errors so one failure
 * does not abort the rest. Persists errors so `agentbrew status` can report them.
 */
export async function runSyncWithErrorCollection(modules: SyncModule[], options?: SyncRunnerOptions): Promise<void> {
  const startedAt = Date.now();
  await runWithPreparedState(options, async () => {
    const collector = new SyncErrorCollector();
    for (const { name, fn } of modules) {
      try {
        await fn();
      } catch (error) {
        collector.add(new SyncError(name, errorMessage(error), { cause: error }));
      }
    }
    saveSyncErrors(collector);
    if (collector.hasErrors) {
      console.error(chalk.yellow(`  ⚠ ${collector.count} sync error(s) — run \`agentbrew status\` for details`));
      process.exitCode = 1;
    }

    if (!collector.hasErrors) {
      if (options?.compact) reportPostSyncCompactSummary(Date.now() - startedAt);
      reportPostSyncDrift();
      maybeMeasureContextBudgetAfterSync();
    }
  });
}

/**
 * Runs parallel sync across all categories, collecting errors without aborting.
 * Loads a shared manifest once before all modules run and saves it once after
 * they complete — prevents parallel modules from overwriting each other's hashes.
 */
export async function runSyncParallel(modules: SyncModule[], options?: SyncRunnerOptions): Promise<void> {
  const startedAt = Date.now();
  await runWithPreparedState(options, async () => {
    // Load manifest once — all modules share this in-memory object.
    // Since Node.js is single-threaded, synchronous mutations to the object
    // from concurrent async modules are safe (no torn reads/writes).
    const sharedManifest = loadManifest();

    // Issue 3 of `sync-idempotent-and-complete` (TASKS.md): rules MUST run
    // before instructions. instructions-sync uses `deduplicateByHeading` to
    // strip template sections whose headings also appear in the managed
    // rules block. If instructions runs first the managed section isn't yet
    // in the file, dedup can't fire, and the deployed instructions stay
    // un-deduped. Then rules appends managed and `checkInstructionsDrift`
    // (which dedupes the EXPECTED content against the now-present managed)
    // reports false-positive drift after a successful single sync. Running
    // rules first lets instructions see the managed section and dedup
    // consistently — a single `agentbrew sync` reaches drift=0 instead of
    // requiring the user to run sync twice. Mirrors the sequential-mode
    // ordering already used by `runSyncWithErrorCollection` (which iterates
    // `buildSyncModules` output where rules sits at index 1 and
    // instructions at index 6).
    const collector = await collectParallelResults(modules, sharedManifest);

    // Run rules before instructions so instructions-sync's `deduplicateByHeading`
    // can fire against the managed section rules-sync just wrote.
    await runSequentialFileShareModules(modules, sharedManifest, collector);

    // Save manifest once after all modules complete
    saveManifest(sharedManifest);

    saveSyncErrors(collector);
    if (collector.hasErrors) {
      console.error(chalk.yellow(`\n  ⚠ ${collector.count} sync error(s):`));
      console.log(collector.summary());
      process.exitCode = 1;
    } else {
      clearSyncErrors();
    }

    if (!collector.hasErrors) {
      if (options?.compact) reportPostSyncCompactSummary(Date.now() - startedAt);
      reportPostSyncDrift();
      maybeMeasureContextBudgetAfterSync();
    }
  });
}

/**
 * Builds the full list of sync modules for a given set of options.
 * Shared between `sync` command and `autoSync`.
 */
export function buildSyncModules(options: {
  dryRun?: boolean;
  prune?: boolean;
  quiet?: boolean;
  discover?: boolean;
  verbose?: boolean;
  compact?: boolean;
}): SyncModule[] {
  // Each module fn receives an optional shared context from the parallel runner.
  // When running in parallel, the runner pre-loads a shared manifest and passes it
  // so all modules read/write the same in-memory object instead of each loading
  // from disk (which causes last-write-wins data loss).
  return [
    { name: "mcp", fn: (shared) => syncMcpServers(options, shared) },
    { name: "rules", fn: (shared) => syncRules(options, shared) },
    { name: "commands", fn: (shared) => syncCommands(options, shared) },
    { name: "agents", fn: (shared) => syncAgentDefs(options, shared) },
    { name: "skills", fn: (shared) => syncSkills(options, shared) },
    { name: "hooks", fn: (shared) => syncHooks(options, shared) },
    { name: "models", fn: (shared) => syncModels(options, shared) },
    { name: "instructions", fn: (shared) => syncInstructions(options, shared) },
  ];
}

/**
 * Post-mutation auto-sync: runs all sync categories quietly after state changes
 * (e.g. install, add, remove) so all agents stay in sync automatically.
 */
export async function autoSync(): Promise<void> {
  console.log(chalk.dim("\n  Syncing to all agents..."));
  await runSyncWithErrorCollection(buildSyncModules({ quiet: true }));
  console.log(chalk.dim("  ✓ Synced."));
}
