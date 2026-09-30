import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import chalk from "chalk";
import { undetectedAgentNames } from "../agents.js";
import { filterReadsFromAgents } from "../core/agents.js";
import type { Context } from "../core/context.js";
import { createContext } from "../core/context.js";
import type { Logger } from "../core/logger.js";
import { logSkipped } from "../core/logger.js";
import type { Manifest } from "../manifest.js";
import { contentHash, loadManifest, removeFromManifest, saveManifest, writeIfChanged } from "../manifest.js";
import { AGENTS_DIR } from "../paths.js";
import { loadState, saveState } from "../state.js";
import type { AgentBrewState, SyncOptions } from "../types.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { ICON_ERROR, ICON_SUCCESS } from "../ui/output.js";
import { expandHome } from "../utils.js";
import { migrateLegacyShellPermissionMarkdown } from "./permission-patterns.js";

interface AgentDefTarget {
  agentName: string;
  dir: string;
  /** "subdir" writes name/AGENT.md (Devin format); "flat" writes name.md (Claude Code format). */
  format: "flat" | "subdir";
}

/** Collected agent definition with source tracking for dedup. */
interface CollectedAgentDef {
  name: string;
  fileName: string;
  sourcePath: string;
  sourceLabel: string;
}

export function getAgentDefTargets(skip: ReadonlySet<string> = new Set()): AgentDefTarget[] {
  const withAgentsDir = AGENT_DEFINITIONS.filter((a) => a.agentsDir !== undefined && !skip.has(a.name));
  const detectedNames = new Set(withAgentsDir.map((a) => a.name));
  const filtered = filterReadsFromAgents(withAgentsDir, detectedNames);
  return filtered.map((a) => ({
    agentName: a.name,
    dir: a.agentsDir as string,
    format: a.agentsDirFormat ?? "flat",
  }));
}

const BUILT_IN_SOURCE_DIR = AGENTS_DIR;

/** Get all agent definition source directories: built-in + user-configured. */
export function getAgentSources(state?: AgentBrewState): Array<{ label: string; path: string }> {
  const userSources = (state?.agentSourceDirs ?? loadState()?.agentSourceDirs ?? []).map((d) => ({
    label: d.label,
    path: expandHome(d.path),
  }));

  const builtIn = { label: "agentbrew", path: expandHome(BUILT_IN_SOURCE_DIR) };

  // Built-in first (higher priority), then user sources
  return [builtIn, ...userSources];
}

/** Collect and deduplicate agent definitions from all sources (first source wins). */
export function collectAgentDefs(sources: Array<{ label: string; path: string }>): {
  agents: Map<string, CollectedAgentDef>;
  bySource: Record<string, number>;
} {
  const agents = new Map<string, CollectedAgentDef>();
  const bySource: Record<string, number> = {};

  for (const source of sources) {
    if (!existsSync(source.path)) continue;
    let files: string[];
    try {
      files = readdirSync(source.path).filter((f) => f.endsWith(".md"));
    } catch (e) {
      logSkipped("sync/agents-sync/readdirSync", e);
      continue;
    }
    for (const file of files) {
      const name = basename(file, ".md");
      if (!agents.has(name)) {
        agents.set(name, {
          name,
          fileName: file,
          sourcePath: join(source.path, file),
          sourceLabel: source.label,
        });
        bySource[source.label] = (bySource[source.label] ?? 0) + 1;
      }
    }
  }

  return { agents, bySource };
}

/**
 * Resolves the target path for a single agent definition file within a target dir,
 * accounting for the two supported storage formats:
 * - flat:   <targetDir>/reviewer.md
 * - subdir: <targetDir>/reviewer/AGENT.md
 */
export function resolveTargetPath(targetDir: string, sourceFile: string, format: "flat" | "subdir"): string {
  if (format === "subdir") {
    const agentName = basename(sourceFile, ".md");
    return join(targetDir, agentName, "AGENT.md");
  }
  return join(targetDir, sourceFile);
}

/** Check if a file was modified by the user since agentbrew last deployed it.
 *  Returns true if the file exists but isn't tracked in the manifest (user-created)
 *  or if its content doesn't match what agentbrew last wrote. */
function isUserModified(filePath: string, manifest: Manifest): boolean {
  if (!existsSync(filePath)) return false;
  const lastDeployedHash = manifest.hashes[filePath];
  if (!lastDeployedHash) return true; // File exists but not tracked — user-created, don't overwrite
  try {
    const currentContent = readFileSync(filePath, "utf-8");
    return contentHash(currentContent) !== lastDeployedHash;
  } catch (e) {
    logSkipped("sync/agents-sync/contentHash", e);
    return false;
  }
}

interface TargetSyncResult {
  agentName: string;
  synced: number;
  pruned: number;
  skipped: number;
}

function warnNoAgents(quiet: boolean, verbose: boolean, log: Logger): void {
  if (quiet || !verbose) return;
  const builtInDir = expandHome(BUILT_IN_SOURCE_DIR);
  if (!existsSync(builtInDir)) {
    if (!quiet) {
      log.warn("No agent definitions directory found.");
      log.log(`Create agent definitions in: ${builtInDir}`);
      log.log("Or run `agentbrew agents init` to set up.");
    }
  } else if (!quiet) {
    log.warn("No agent definitions found.");
    log.log(`Add .md files to: ${builtInDir}`);
  }
}

interface DeployAgentOpts {
  agent: CollectedAgentDef;
  targetDir: string;
  target: AgentDefTarget;
  manifest: Manifest;
  dryRun: boolean;
  quiet: boolean;
  log: Logger;
}

type DeployAgentResult = { synced: boolean; skipped: boolean };

function readAgentContent(agent: CollectedAgentDef, log: Logger): string | undefined {
  try {
    return migrateLegacyShellPermissionMarkdown(readFileSync(agent.sourcePath, "utf-8"));
  } catch (e) {
    logSkipped("sync/agents-sync/readFileSync", e);
    log.warn(`agents-sync: ${agent.fileName} — unreadable, skipping`);
    return undefined;
  }
}

function handleUserModifiedAgent(opts: {
  agent: CollectedAgentDef;
  targetPath: string;
  targetAgentName: string;
  manifest: Manifest;
  quiet: boolean;
  log: Logger;
}): DeployAgentResult | undefined {
  const { agent, targetPath, targetAgentName, manifest, quiet, log } = opts;
  if (!isUserModified(targetPath, manifest)) return undefined;
  try {
    const currentContent = readFileSync(targetPath, "utf-8");
    const migratedContent = migrateLegacyShellPermissionMarkdown(currentContent);
    if (migratedContent !== currentContent) {
      const synced = writeIfChanged(targetPath, migratedContent, manifest);
      if (synced && !quiet) {
        log.log(`  ↻ ${targetAgentName}: migrated permission patterns in user-modified ${agent.name}`);
      }
      return { synced, skipped: false };
    }
  } catch (e) {
    logSkipped("sync/agents-sync/inPlacePermissionMigration", e);
  }
  if (!quiet) log.log(`  ⚠ ${targetAgentName}: skipping ${agent.name} (user-modified)`);
  return { synced: false, skipped: true };
}

function deployAgentToTarget(opts: DeployAgentOpts): DeployAgentResult {
  const { agent, targetDir, target, manifest, dryRun, quiet, log } = opts;
  const content = readAgentContent(agent, log);
  if (content === undefined) return { synced: false, skipped: false };
  const targetPath = resolveTargetPath(targetDir, agent.fileName, target.format);

  if (dryRun) {
    const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf-8") : undefined;
    return { synced: existing !== content, skipped: false };
  }

  const userModifiedResult = handleUserModifiedAgent({
    agent,
    targetPath,
    targetAgentName: target.agentName,
    manifest,
    quiet,
    log,
  });
  if (userModifiedResult) return userModifiedResult;
  if (target.format === "subdir") {
    mkdirSync(join(targetDir, agent.name), { recursive: true });
  }
  return { synced: writeIfChanged(targetPath, content, manifest), skipped: false };
}

function pruneSubdirEntries(
  targetDir: string,
  sourceNameSet: Set<string>,
  manifest: Manifest,
  dryRun: boolean,
): number {
  const subdirs = readdirSync(targetDir).filter((entry) => existsSync(join(targetDir, entry, "AGENT.md")));
  let pruned = 0;
  for (const subdir of subdirs) {
    if (sourceNameSet.has(subdir)) continue;
    const agentMdPath = join(targetDir, subdir, "AGENT.md");
    if (!manifest.hashes[agentMdPath]) continue;
    if (!dryRun) {
      unlinkSync(agentMdPath);
      removeFromManifest(agentMdPath, manifest);
      rmSync(join(targetDir, subdir), { recursive: true, force: true });
    }
    pruned++;
  }
  return pruned;
}

function pruneFlatEntries(targetDir: string, sourceNameSet: Set<string>, manifest: Manifest, dryRun: boolean): number {
  const targetFiles = readdirSync(targetDir).filter((f) => f.endsWith(".md"));
  let pruned = 0;
  for (const file of targetFiles) {
    if (sourceNameSet.has(basename(file, ".md"))) continue;
    const filePath = join(targetDir, file);
    if (!manifest.hashes[filePath]) continue;
    if (!dryRun) {
      unlinkSync(filePath);
      removeFromManifest(filePath, manifest);
    }
    pruned++;
  }
  return pruned;
}

function pruneStaleAgents(
  target: AgentDefTarget,
  targetDir: string,
  sourceNameSet: Set<string>,
  manifest: Manifest,
  dryRun: boolean,
): number {
  if (target.format === "subdir") {
    return pruneSubdirEntries(targetDir, sourceNameSet, manifest, dryRun);
  }
  return pruneFlatEntries(targetDir, sourceNameSet, manifest, dryRun);
}

function logTargetResult(result: TargetSyncResult, dryRun: boolean, verbose: boolean, log: Logger): void {
  const changes: string[] = [];
  if (result.synced > 0) changes.push(`${result.synced} updated`);
  if (result.skipped > 0) changes.push(`${result.skipped} user-modified`);
  if (result.pruned > 0) changes.push(log.red(`${result.pruned} pruned`));
  if (!verbose && changes.length === 0) return;
  const summary = changes.length > 0 ? changes.join(", ") : "up to date";
  const icon = dryRun ? log.blue("~") : log.green("✓");
  log.log(`  ${icon} ${result.agentName} — ${summary}`);
}

function logSyncSummary(
  totals: { synced: number; pruned: number; skipped: number },
  bySource: Record<string, number>,
  dryRun: boolean,
  log: Logger,
): void {
  const sourceBreakdown = Object.entries(bySource)
    .map(([sourceLabel, count]) => `${count} from ${sourceLabel}`)
    .join(", ");
  const parts = [`${totals.synced} written`];
  if (totals.skipped > 0) parts.push(`${totals.skipped} user-modified (skipped)`);
  if (totals.pruned > 0) parts.push(`${totals.pruned} pruned`);
  if (sourceBreakdown) parts.push(`(${sourceBreakdown})`);
  log.log(`${log.bold(dryRun ? "\nWould apply:" : "\nDone.")} ${parts.join(", ")}.\n`);
}

function resolveSyncOptions(options?: SyncOptions): {
  quiet: boolean;
  verbose: boolean;
  dryRun: boolean;
  prune: boolean;
} {
  return {
    quiet: options?.quiet ?? false,
    verbose: options?.verbose ?? false,
    dryRun: options?.dryRun ?? false,
    prune: options?.prune ?? false,
  };
}

/** Deploy agent definitions from all sources to all detected agent directories. */
export async function syncAgentDefs(options?: SyncOptions, ctx?: Partial<Context>): Promise<void> {
  const { quiet, verbose, dryRun, prune } = resolveSyncOptions(options);
  const log = ctx?.logger ?? createContext({ quiet, compact: options?.compact }).logger;

  const sources = getAgentSources();
  const { agents: allAgents, bySource } = collectAgentDefs(sources);

  if (allAgents.size === 0 && !prune) {
    warnNoAgents(quiet, verbose, log);
    return;
  }

  if (!quiet) {
    const label = dryRun ? "Dry run — agent definitions" : `Syncing ${allAgents.size} agent definitions...`;
    log.log(log.bold(`\n${label}\n`));
  }

  // Never create an agents dir for an agent the state marks not detected.
  const targets = getAgentDefTargets(undetectedAgentNames(loadState()));
  const sourceNameSet = new Set(allAgents.keys());
  const sharedManifest = ctx?.manifest !== undefined;
  const manifest = ctx?.manifest ?? loadManifest();

  const targetResults = await Promise.all(
    targets.map(async (target) => {
      const targetDir = expandHome(target.dir);
      if (!dryRun) mkdirSync(targetDir, { recursive: true });

      let synced = 0;
      let skipped = 0;
      for (const [, agent] of allAgents) {
        const result = deployAgentToTarget({ agent, targetDir, target, manifest, dryRun, quiet, log });
        if (result.synced) synced++;
        if (result.skipped) skipped++;
      }

      const pruned = prune ? pruneStaleAgents(target, targetDir, sourceNameSet, manifest, dryRun) : 0;
      return { agentName: target.agentName, synced, pruned, skipped };
    }),
  );

  const totals = { synced: 0, pruned: 0, skipped: 0 };
  for (const result of targetResults) {
    totals.synced += result.synced;
    totals.pruned += result.pruned;
    totals.skipped += result.skipped;
    if (!quiet) logTargetResult(result, dryRun, verbose, log);
  }

  if (!dryRun && !sharedManifest) saveManifest(manifest);
  if (!quiet) logSyncSummary(totals, bySource, dryRun, log);
}

export async function initAgentDefs(): Promise<void> {
  const sourceDir = expandHome(BUILT_IN_SOURCE_DIR);

  if (existsSync(sourceDir) && readdirSync(sourceDir).length > 0) {
    const count = readdirSync(sourceDir).filter((f) => f.endsWith(".md")).length;
    console.log(chalk.yellow(`Agent definitions directory already exists with ${count} definition(s).`));
    console.log(`  ${sourceDir}`);
    return;
  }

  mkdirSync(sourceDir, { recursive: true });
  console.log(`${ICON_SUCCESS} Agent definitions directory created: ${sourceDir}`);
  console.log("  Add .md files there, then run `agentbrew sync --only agents`.");
}

function printAgentEntry(agent: CollectedAgentDef): void {
  let content: string;
  try {
    content = readFileSync(agent.sourcePath, "utf-8");
  } catch (e) {
    logSkipped("sync/agents-sync/readFileSync", e);
    console.error(`${ICON_ERROR} agents-sync: ${agent.fileName} — unreadable, skipping`);
    return;
  }
  const nameMatch = content.match(/^---\n[\s\S]*?name:\s*(.+)\n[\s\S]*?---/);
  const displayName = nameMatch?.[1] ?? agent.name;
  const modelMatch = content.match(/^---\n[\s\S]*?model:\s*(.+)\n[\s\S]*?---/);
  const model = modelMatch?.[1];
  const sourceTag = agent.sourceLabel !== "agentbrew" ? chalk.dim(` [${agent.sourceLabel}]`) : "";
  const modelTag = model ? chalk.dim(` (${model})`) : "";
  console.log(`  ${chalk.cyan(displayName)}${modelTag}${sourceTag}`);
}

function printDeployTargets(): void {
  const targets = getAgentDefTargets();
  console.log(chalk.bold("\nDeployed to:\n"));
  for (const target of targets) {
    const dir = expandHome(target.dir);
    if (existsSync(dir)) {
      console.log(`  ${ICON_SUCCESS} ${target.agentName} (${target.dir})`);
    } else {
      console.log(chalk.dim(`  - ${target.agentName} (not found)`));
    }
  }
  console.log();
}

function warnNoAgentsFound(): void {
  const builtInDir = expandHome(BUILT_IN_SOURCE_DIR);
  if (!existsSync(builtInDir)) {
    console.error(chalk.yellow("No agent definitions directory found."));
    console.log("Run `agentbrew agents init` to set up.");
  } else {
    console.error(chalk.yellow("No agent definitions found."));
    console.log(`Add .md files to: ${builtInDir}`);
  }
}

/** List all agent definitions from all sources, showing source labels. */
export async function listAgentDefs(): Promise<void> {
  const sources = getAgentSources();
  const { agents: allAgents } = collectAgentDefs(sources);

  if (allAgents.size === 0) {
    warnNoAgentsFound();
    return;
  }

  console.log(chalk.bold(`\nAgent Definitions (${allAgents.size})\n`));
  for (const [, agent] of allAgents) {
    printAgentEntry(agent);
  }

  const activeSources = sources.filter((s) => existsSync(s.path));
  if (activeSources.length > 1) {
    console.log(chalk.dim(`\n  Sources: ${activeSources.map((s) => `${s.label} (${s.path})`).join(", ")}`));
  } else if (activeSources.length === 1) {
    console.log(chalk.dim(`\n  Dir: ${activeSources[0].path}`));
  }

  printDeployTargets();
}

/** Register a new agent source directory in state. */
export async function addAgentSource(label: string, path: string): Promise<void> {
  const state = loadState();
  if (!state) {
    console.error(chalk.red("No agentbrew state found. Run `agentbrew init` first."));
    return;
  }

  const expandedPath = expandHome(path);
  if (!existsSync(expandedPath)) {
    console.error(chalk.red(`Path not found: ${expandedPath}`));
    return;
  }

  state.agentSourceDirs = state.agentSourceDirs ?? [];
  const alreadyTracked = state.agentSourceDirs.some((d) => expandHome(d.path) === expandedPath);
  if (alreadyTracked) {
    console.log(chalk.yellow(`Source already tracked: ${path}`));
    return;
  }

  state.agentSourceDirs.push({ label, path });
  saveState(state);

  const files = readdirSync(expandedPath).filter((f) => f.endsWith(".md"));
  console.log(`${ICON_SUCCESS} Agent source registered: ${label} (${path}) — ${files.length} definitions`);
  console.log(chalk.dim("  Run `agentbrew sync --only agents` to deploy."));
}
