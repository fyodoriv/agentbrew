import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Context } from "../core/context.js";
import { createContext } from "../core/context.js";
import { errorMessage } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import { logSkipped } from "../core/logger.js";
import type { Manifest } from "../manifest.js";
import { loadManifest, saveManifest, writeIfChanged } from "../manifest.js";
import { CANONICAL_INSTRUCTIONS_PATH } from "../paths.js";
import { loadState } from "../state.js";
import type { AgentConfig, SyncOptions } from "../types.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { expandHome } from "../utils.js";
import type { HelperScriptResult } from "./helper-scripts.js";
import { syncHelperScripts } from "./helper-scripts.js";
import {
  DEFAULT_TOKEN_WARNING_THRESHOLD,
  estimateTokens,
  extractCursorRules,
  isInstructionsUpToDate,
  measureSections,
  mergeInstructionsWithManagedSection,
  usesAgentsMdStandardPath,
} from "./instructions-content.js";

// Re-export all content helpers so existing imports keep working
export {
  compressSkillsListing,
  DEFAULT_TOKEN_WARNING_THRESHOLD,
  deduplicateByHeading,
  estimateTokens,
  extractCursorRules,
  extractHeadings,
  isInstructionsUpToDate,
  measureSections,
  mergeInstructionsWithManagedSection,
  stripCursorRulesSection,
  usesAgentsMdStandardPath,
} from "./instructions-content.js";

/**
 * Resolve the agentbrew project root directory. Handles three cases:
 * - AGENTBREW_DIR env var (tests and explicit config)
 * - dist/ layout: templates/ copied alongside cli.js by tsup
 * - dev layout: two dirs up from src/sync/
 */
function resolveProjectRoot(): string {
  if (process.env.AGENTBREW_DIR) return process.env.AGENTBREW_DIR;
  const candidates = [resolve(import.meta.dirname), resolve(join(import.meta.dirname, "..", ".."))];
  return candidates.find((candidate) => existsSync(join(candidate, "templates", "AGENTS.md"))) ?? candidates[1];
}

/** Get the path to the canonical AGENTS.md instructions file. */
export function getInstructionsSourcePath(): string {
  return join(resolveProjectRoot(), "templates", "AGENTS.md");
}

/** Load the canonical AGENTS.md content. */
export function loadInstructions(): string | undefined {
  const path = getInstructionsSourcePath();
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, "utf-8");
  } catch (e) {
    logSkipped("instructions-sync/loadInstructions", e);
    return undefined;
  }
}

interface ContextFile {
  name: string;
  path: string;
  header: string;
  contentExtractor: (content: string) => string;
}

/** Get context file definitions for generated output. */
export function getContextFiles(): ContextFile[] {
  const contextDir = join(resolveProjectRoot(), "context");

  return [
    {
      name: "chatgpt",
      path: join(contextDir, "chatgpt.md"),
      header:
        "# Custom Instructions for ChatGPT\n\n> Auto-generated from AGENTS.md template. Do not edit directly.\n> Paste this into ChatGPT → Settings → Personalization → Custom Instructions\n\n",
      contentExtractor: extractCursorRules,
    },
    {
      name: "claude-desktop",
      path: join(contextDir, "claude-desktop.md"),
      header:
        "# Project Instructions for Claude\n\n> Auto-generated from AGENTS.md template. Do not edit directly.\n> Paste this into a Claude Project → Project Instructions\n\n",
      contentExtractor: extractCursorRules,
    },
  ];
}

interface InstructionsSyncResult {
  agentsUpdated: number;
  contextFilesGenerated: number;
}

interface SyncResultItem {
  name: string;
  changed: boolean;
  error?: string;
}

/** Deployed canonical instructions path (~/.config/agentbrew/AGENTS.md). */
export function getCanonicalInstructionsPath(): string {
  return expandHome(CANONICAL_INSTRUCTIONS_PATH);
}

/** True when a symlink at `linkPath` resolves to `canonicalPath`. */
function isSymlinkTo(linkPath: string, canonicalPath: string): boolean {
  if (!existsSync(linkPath)) return false;
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return false;
    const rawTarget = readlinkSync(linkPath);
    const resolved = rawTarget.startsWith("/") ? rawTarget : resolve(dirname(linkPath), rawTarget);
    return resolved === canonicalPath;
  } catch (e) {
    logSkipped("instructions-sync/isSymlinkTo", e);
    return false;
  }
}

/** Pick existing file content to seed the canonical merge (canonical first, then any target). */
function readExistingForCanonicalMerge(
  canonicalPath: string,
  targets: ReadonlyArray<Omit<AgentConfig, "detected">>,
): string | undefined {
  if (existsSync(canonicalPath)) {
    try {
      return readFileSync(canonicalPath, "utf-8");
    } catch (e) {
      logSkipped("instructions-sync/readCanonical", e);
    }
  }
  for (const agent of targets) {
    const targetPath = expandHome(agent.rulesFile ?? "");
    if (!existsSync(targetPath) || isSymlinkTo(targetPath, canonicalPath)) continue;
    try {
      if (!lstatSync(targetPath).isFile()) continue;
      return readFileSync(targetPath, "utf-8");
    } catch (e) {
      logSkipped(`instructions-sync/readExisting/${agent.name}`, e);
    }
  }
  return undefined;
}

function syncCanonicalInstructions(
  content: string,
  targets: ReadonlyArray<Omit<AgentConfig, "detected">>,
  dryRun: boolean,
  manifest: Manifest,
): SyncResultItem {
  const canonicalPath = getCanonicalInstructionsPath();
  try {
    const existing = readExistingForCanonicalMerge(canonicalPath, targets);
    const merged = mergeInstructionsWithManagedSection(content, existing);

    if (dryRun) {
      const onDisk = existsSync(canonicalPath) ? readFileSync(canonicalPath, "utf-8") : undefined;
      const changed = onDisk === undefined || !isInstructionsUpToDate(onDisk, content);
      return { name: "canonical", changed };
    }

    const written = writeIfChanged(canonicalPath, merged, manifest);
    return { name: "canonical", changed: written };
  } catch (err) {
    return { name: "canonical", changed: false, error: errorMessage(err) };
  }
}

/** Proprietary instruction filenames — copy+merge instead of symlink (see plan carve-out table). */
function syncProprietaryAgent(
  agent: Omit<AgentConfig, "detected">,
  content: string,
  dryRun: boolean,
  manifest: Manifest,
): SyncResultItem {
  try {
    const targetPath = expandHome(agent.rulesFile ?? "");
    const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf-8") : undefined;
    const merged = mergeInstructionsWithManagedSection(content, existing);

    if (dryRun) {
      const changed = existing === undefined || !isInstructionsUpToDate(existing, content);
      return { name: agent.name, changed };
    }

    const written = writeIfChanged(targetPath, merged, manifest);
    return { name: agent.name, changed: written };
  } catch (err) {
    return { name: agent.name, changed: false, error: errorMessage(err) };
  }
}

function ensureInstructionsSymlink(
  agent: Omit<AgentConfig, "detected">,
  canonicalPath: string,
  dryRun: boolean,
): SyncResultItem {
  const targetPath = expandHome(agent.rulesFile ?? "");
  try {
    if (isSymlinkTo(targetPath, canonicalPath)) {
      return { name: agent.name, changed: false };
    }

    if (dryRun) {
      return { name: agent.name, changed: true };
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    if (existsSync(targetPath)) {
      unlinkSync(targetPath);
    }
    symlinkSync(canonicalPath, targetPath);
    return { name: agent.name, changed: true };
  } catch (err) {
    return { name: agent.name, changed: false, error: errorMessage(err) };
  }
}

function syncSingleAgent(
  agent: Omit<AgentConfig, "detected">,
  content: string,
  canonicalPath: string,
  dryRun: boolean,
  manifest: Manifest,
): SyncResultItem {
  if (!usesAgentsMdStandardPath(agent.rulesFile ?? "")) {
    return syncProprietaryAgent(agent, content, dryRun, manifest);
  }
  return ensureInstructionsSymlink(agent, canonicalPath, dryRun);
}

function syncSingleContextFile(
  ctxFile: ContextFile,
  content: string,
  dryRun: boolean,
  manifest: Manifest,
): SyncResultItem {
  try {
    const extracted = ctxFile.contentExtractor(content);
    const output = ctxFile.header + extracted;

    if (dryRun) {
      const existing = existsSync(ctxFile.path) ? readFileSync(ctxFile.path, "utf-8") : undefined;
      const changed = existing !== output;
      return { name: ctxFile.name, changed };
    }

    const written = writeIfChanged(ctxFile.path, output, manifest);
    return { name: ctxFile.name, changed: written };
  } catch (err) {
    const message = errorMessage(err);
    return { name: ctxFile.name, changed: false, error: message };
  }
}

interface ReportOptions {
  quiet: boolean;
  verbose: boolean;
  dryRun: boolean;
  activeVerb: string;
  dryVerb: string;
}

function logSyncResult(
  result: SyncResultItem,
  log: Logger,
  options: ReportOptions,
): { countDelta: number; errorDelta: number } {
  if (result.error) {
    if (!options.quiet) log.log(`  ${log.red("✗")} ${result.name} — ${log.red(result.error)}`);
    return { countDelta: 0, errorDelta: 1 };
  }
  if (result.changed) {
    const icon = options.dryRun ? log.blue("~") : log.green("✓");
    const verb = options.dryRun ? options.dryVerb : options.activeVerb;
    if (!options.quiet) log.log(`  ${icon} ${result.name} — ${verb}`);
    return { countDelta: 1, errorDelta: 0 };
  }
  if (options.verbose) {
    log.log(`  ${log.green("✓")} ${result.name} — up to date`);
  }
  return { countDelta: 0, errorDelta: 0 };
}

function reportSyncResults(
  results: SyncResultItem[],
  log: Logger,
  options: ReportOptions,
): { count: number; errors: number } {
  let count = 0;
  let errors = 0;
  for (const result of results) {
    const delta = logSyncResult(result, log, options);
    count += delta.countDelta;
    errors += delta.errorDelta;
  }
  return { count, errors };
}

const HELPER_SCRIPT_VERBS = {
  installed: { active: "installed", dry: "would install" },
  updated: { active: "updated", dry: "would update" },
} as const;

type HelperScriptReportOptions = Pick<ReportOptions, "quiet" | "verbose" | "dryRun">;

/** One report line for a helper-script result, or undefined when there is nothing to say. */
function describeHelperScript(
  result: HelperScriptResult,
  log: Logger,
  options: HelperScriptReportOptions,
): string | undefined {
  const label = `scripts/${result.name}`;
  if (result.error) return `  ${log.red("✗")} ${label} — ${log.red(result.error)}`;
  if (result.action === "kept-user-file") return `  ${log.dim("-")} ${label} — kept (not written by agentbrew)`;
  if (result.action === "unchanged") return options.verbose ? `  ${log.green("✓")} ${label} — up to date` : undefined;
  const verbs = HELPER_SCRIPT_VERBS[result.action];
  return options.dryRun
    ? `  ${log.blue("~")} ${label} — ${verbs.dry}`
    : `  ${log.green("✓")} ${label} — ${verbs.active}`;
}

/** Install the helper scripts and report each one; a kept user-owned file is info, not an error. */
function syncAndReportHelperScripts(
  manifest: Manifest,
  log: Logger,
  options: HelperScriptReportOptions,
): { summaryParts: string[]; errors: number } {
  const results = syncHelperScripts({ projectRoot: resolveProjectRoot(), manifest, dryRun: options.dryRun });
  for (const result of results) {
    const line = describeHelperScript(result, log, options);
    if (line && !options.quiet) log.log(line);
  }
  const written = results.filter((r) => !r.error && (r.action === "installed" || r.action === "updated")).length;
  return {
    summaryParts: results.length > 0 ? [`${written} helper script(s)`] : [],
    errors: results.filter((r) => r.error).length,
  };
}

/** Emit a warning if the deployed instructions file exceeds the token budget. */
function warnIfOverTokenBudget(
  targets: ReadonlyArray<Omit<AgentConfig, "detected">>,
  fallbackContent: string,
  log: Logger,
): void {
  const threshold = DEFAULT_TOKEN_WARNING_THRESHOLD;
  const firstTarget = targets[0];
  if (!firstTarget) return;

  const canonicalPath = getCanonicalInstructionsPath();
  const deployed = existsSync(canonicalPath)
    ? readFileSync(canonicalPath, "utf-8")
    : existsSync(expandHome(firstTarget.rulesFile ?? ""))
      ? readFileSync(expandHome(firstTarget.rulesFile ?? ""), "utf-8")
      : fallbackContent;
  if (deployed.length <= threshold) return;

  const tokens = estimateTokens(deployed);
  const thresholdTokens = estimateTokens(threshold);
  const sections = measureSections(deployed).slice(0, 3);
  const sectionLines = sections
    .map((s) => `    ${s.heading.padEnd(35)} ~${estimateTokens(s.chars).toLocaleString()} tokens`)
    .join("\n");
  log.warn(
    `\n⚠ Instructions file is ~${tokens.toLocaleString()} tokens (target: <${thresholdTokens.toLocaleString()})\n` +
      `  Largest sections:\n${sectionLines}\n` +
      "  Run: agentbrew rules edit  (trim shared rules)\n",
  );
}

/**
 * Resolve the set of agents whose rulesFile should receive an instructions
 * write. `sync-and-drift-honor-detected-agents` (TASKS.md): only DETECTED
 * agents get writes. Writing the AGENTS.md template to undetected agents
 * creates orphan files the user doesn't use, and `checkRulesDrift` (which
 * also filters by detection now) would otherwise report false-positive
 * "no managed section — rules not deployed" items for those orphans.
 *
 * Deduplicate by rulesFile path so agents sharing the same file (e.g.
 * claude-code + claude-desktop both write to ~/.claude/CLAUDE.md) produce
 * exactly one write.
 */
function getInstructionsTargets(): Array<Omit<AgentConfig, "detected">> {
  const state = loadState();
  const detectedNames: ReadonlySet<string> = state
    ? new Set(state.agents.filter((a) => a.detected).map((a) => a.name))
    : new Set();

  const allTargets = AGENT_DEFINITIONS.filter((a) => a.rulesFile !== undefined && detectedNames.has(a.name));
  const seenPaths = new Set<string>();
  return allTargets.filter((a) => {
    const p = a.rulesFile ?? "";
    if (seenPaths.has(p)) return false;
    seenPaths.add(p);
    return true;
  });
}

/** Deploy AGENTS.md to all agent instruction files, generate context files, and install the helper scripts AGENTS.md calls. */
export async function syncInstructions(options?: SyncOptions, ctx?: Partial<Context>): Promise<InstructionsSyncResult> {
  const quiet = options?.quiet ?? false;
  const verbose = options?.verbose ?? false;
  const dryRun = options?.dryRun ?? false;
  const log = ctx?.logger ?? createContext({ quiet, compact: options?.compact }).logger;

  const content = loadInstructions();
  if (!content) {
    if (!quiet) {
      log.warn(`No AGENTS.md found at ${getInstructionsSourcePath()}`);
    }
    return { agentsUpdated: 0, contextFilesGenerated: 0 };
  }

  if (!quiet) log.log(log.bold("\nInstructions sync\n"));

  const targets = getInstructionsTargets();
  const contextFiles = getContextFiles();
  const sharedManifest = ctx?.manifest !== undefined;
  const manifest = ctx?.manifest ?? loadManifest();

  const canonicalPath = getCanonicalInstructionsPath();
  const standardTargets = targets.filter((a) => usesAgentsMdStandardPath(a.rulesFile ?? ""));
  const proprietaryTargets = targets.filter((a) => !usesAgentsMdStandardPath(a.rulesFile ?? ""));

  const canonicalResult = syncCanonicalInstructions(content, targets, dryRun, manifest);
  const symlinkResults = standardTargets.map((agent) =>
    syncSingleAgent(agent, content, canonicalPath, dryRun, manifest),
  );
  const proprietaryResults = proprietaryTargets.map((agent) =>
    syncSingleAgent(agent, content, canonicalPath, dryRun, manifest),
  );

  const agentResults = [canonicalResult, ...symlinkResults, ...proprietaryResults];
  const contextResults = await Promise.all(
    contextFiles.map((ctxFile) => syncSingleContextFile(ctxFile, content, dryRun, manifest)),
  );

  const agentReport = reportSyncResults(agentResults, log, {
    quiet,
    verbose,
    dryRun,
    activeVerb: "updated",
    dryVerb: "would update",
  });
  const contextReport = reportSyncResults(contextResults, log, {
    quiet,
    verbose,
    dryRun,
    activeVerb: "generated",
    dryVerb: "would generate",
  });
  const scriptReport = syncAndReportHelperScripts(manifest, log, { quiet, verbose, dryRun });

  if (!sharedManifest) saveManifest(manifest);

  if (!quiet) {
    const totalErrors = agentReport.errors + contextReport.errors + scriptReport.errors;
    const parts = [`${agentReport.count} agent(s)`, `${contextReport.count} context file(s)`];
    parts.push(...scriptReport.summaryParts);
    if (totalErrors > 0) parts.push(log.red(`${totalErrors} failed`));
    const verb = dryRun ? "Would update" : "Updated";
    log.log(`\n${log.green("✓")} ${verb} ${parts.join(", ")}\n`);

    // Token budget warning — check the first deployed agent's merged content
    warnIfOverTokenBudget(targets, content, log);
  }

  return { agentsUpdated: agentReport.count, contextFilesGenerated: contextReport.count };
}

// `instructionsSyncStatus()` was removed 2026-05-03 alongside the hidden
// `instructions status` subcommand (delete-instructions-and-hooks).
// The same per-agent freshness signal is printed by `agentbrew status
// --verbose` via `printVerboseInstructionsSection()` in `src/status.ts`, so
// the dedicated helper had no remaining caller.
