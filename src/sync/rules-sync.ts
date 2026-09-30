import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import chalk from "chalk";
import { sync as writeFileSync } from "write-file-atomic";
import { undetectedAgentNames } from "../agents.js";
import type { Context } from "../core/context.js";
import { createContext } from "../core/context.js";
import { errorMessage } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import { logSkipped } from "../core/logger.js";
import type { Manifest } from "../manifest.js";
import { loadManifest, saveManifest, writeIfChanged } from "../manifest.js";
import { RULES_DIR, SHARED_RULES_PATH } from "../paths.js";
import { type DedupeResult, dedupeSharedRulesContent } from "../rules-hygiene.js";
import { requireState } from "../state.js";
import type { SyncOptions } from "../types.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { ICON_INFO, ICON_SUCCESS } from "../ui/output.js";
import { expandHome } from "../utils.js";
import { refreshCatalogTemplateRules } from "./catalog-template-rules.js";
import { compressSkillsListing, stripCursorRulesSection } from "./instructions-sync.js";
import { indexOfMarkerAtLineStart } from "./marker-utils.js";
import { delegateRulesGenerate } from "./rules-delegate.js";

const START_MARKER = "<!-- agentbrew:start -->";
const END_MARKER = "<!-- agentbrew:end -->";

/**
 * The agents whose rules go through `ai-rules generate` (rulesFile +
 * rulesDir kinds, unified by {@link getAllSyncTargets}). The 3 native
 * carve-outs (windsurf, augment, devin) plus claude-desktop transitively
 * stay on the native path — see `AGENTBREW_ONLY_RULES_RATIONALE` in
 * `src/core/rules-agent-map.ts`. If `ai-rules` is missing the delegated
 * agents skip rather than silently fall back to native content.
 *
 * Exported so {@link checkRulesDrift} in `src/drift-checks/rules.ts`
 * applies the same skip semantics.
 */
export const CANARY_DELEGATED_AGENTS: ReadonlySet<string> = new Set([
  "claude-code",
  "codex",
  "gemini-cli",
  "cursor",
  "amp",
  "cline",
  "copilot",
  "firebender",
  "goose",
  "kilo",
  "roo-code",
]);

// ── Pure types ──────────────────────────────────────────────────────────────

interface RulesTarget {
  agentName: string;
  path: string;
}

type RulesDiffAction = "updated" | "up-to-date" | "skipped";

interface RulesTargetDiff {
  agentName: string;
  action: RulesDiffAction;
  newContent?: string;
}

// ── Pure functions (no I/O, trivially testable) ─────────────────────────────

/** Carve-out: shared (diff for every carve-out + delegated bridge — windsurf /
 *  augment / devin go through `mergedRules`; agents in `CANARY_DELEGATED_AGENTS`
 *  {@link CANARY_DELEGATED_AGENTS} go through `delegated` or skip — never
 *  fall back to native content silently). */
export function computeRulesDiff(
  mergedRules: string,
  targets: Array<{ agentName: string; existingContent: string | undefined }>,
  delegated?: ReadonlyMap<string, string>,
): RulesTargetDiff[] {
  return targets.map((target) => {
    if (target.existingContent === undefined) {
      return { agentName: target.agentName, action: "skipped" as const };
    }
    const delegatedContent = delegated?.get(target.agentName);
    if (delegatedContent === undefined && CANARY_DELEGATED_AGENTS.has(target.agentName)) {
      return { agentName: target.agentName, action: "skipped" as const };
    }
    const merged = delegatedContent ?? mergedRules;
    const updated = replaceManagedSection(target.existingContent, merged);
    if (updated !== target.existingContent) {
      return { agentName: target.agentName, action: "updated" as const, newContent: updated };
    }
    return { agentName: target.agentName, action: "up-to-date" as const };
  });
}

/** Carve-out: shared (rulesFile target list with path-dedup so the
 *  claude-code / claude-desktop transitive carve-out (sharing
 *  ~/.claude/CLAUDE.md) produces a single write). */
export function getRulesTargets(): RulesTarget[] {
  const seen = new Set<string>();
  const result: RulesTarget[] = [];
  for (const a of AGENT_DEFINITIONS) {
    if (a.rulesFile === undefined || seen.has(a.rulesFile)) continue;
    seen.add(a.rulesFile);
    result.push({ agentName: a.name, path: a.rulesFile });
  }
  return result;
}

/** Carve-out: shared (managed-section markers wrap every carve-out's rules file). */
export function wrapManaged(content: string): string {
  return `${START_MARKER}\n${content}\n${END_MARKER}`;
}

/** Carve-out: shared (extracts the agentbrew-managed slice from any carve-out's
 *  existing rules file; preserves user content outside the markers). */
export function extractManagedSection(fileContent: string): string | undefined {
  const startIdx = indexOfMarkerAtLineStart(fileContent, START_MARKER);
  const endIdx = indexOfMarkerAtLineStart(fileContent, END_MARKER);
  if (startIdx === -1 || endIdx === -1) return undefined;
  return fileContent.slice(startIdx + START_MARKER.length + 1, endIdx - 1);
}

/** Carve-out: shared (every carve-out's rules-file write goes through this —
 *  rebuilds the managed slice while leaving user content untouched). */
export function replaceManagedSection(fileContent: string, newManaged: string): string {
  const startIdx = indexOfMarkerAtLineStart(fileContent, START_MARKER);
  const endIdx = indexOfMarkerAtLineStart(fileContent, END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    // No markers — append managed section at the end
    return `${fileContent.trimEnd()}\n\n${wrapManaged(newManaged)}\n`;
  }

  const before = fileContent.slice(0, startIdx);
  const after = fileContent.slice(endIdx + END_MARKER.length);
  return before + wrapManaged(newManaged) + after;
}

/** Carve-out: shared (single source-of-truth path used by every carve-out + the bridge). */
export function getSharedRulesPath(): string {
  return expandHome(SHARED_RULES_PATH);
}

/** Carve-out: shared (single read; result fans out to every carve-out + bridge). */
export function loadSharedRules(): string | undefined {
  const path = getSharedRulesPath();
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, "utf-8");
  } catch (e) {
    logSkipped("rules-sync/loadSharedRules", e);
    return undefined;
  }
}

/** Carve-out: shared (single write to the canonical shared-rules path). */
export function saveSharedRules(content: string): void {
  const path = getSharedRulesPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

export function dedupeSharedRulesFile(options?: { dryRun?: boolean }): DedupeResult | undefined {
  const content = loadSharedRules();
  if (content === undefined) return undefined;

  const result = dedupeSharedRulesContent(content);
  if (result.removedCount > 0 && !options?.dryRun) saveSharedRules(result.content);
  return result;
}

/** Discriminated unified target. `"file"` = agent rulesFile (skipped if
 *  absent); `"dir"` = `<rulesDir>/agentbrew.md` (created on demand). */
interface DiffTarget {
  agentName: string;
  expandedPath: string;
  kind: "file" | "dir";
  existingContent: string | undefined;
}

interface RuleDiff {
  agentName: string;
  action: string;
  newContent?: string;
}

/** Carve-out: shared (per-target diff dispatcher; called for every carve-out
 *  and every delegated agent's diff entry). */
function processRuleDiff(
  diff: RuleDiff,
  target: DiffTarget,
  manifest: Manifest,
  log: Logger,
  options: { quiet: boolean; verbose: boolean; dryRun: boolean },
): { synced: number; errors: number; missingFile: number } {
  if (diff.action === "skipped") {
    // Per-agent "skipped (file not found)" lines are spammy in the common
    // case (many agents detected, most without an agent rules file yet).
    // Verbose mode keeps the detail; non-verbose shows a single collapsed
    // summary line in logRulesSyncSummary.
    if (!options.quiet && options.verbose) log.log(log.dim(`  - ${diff.agentName} — skipped (file not found)`));
    return { synced: 0, errors: 0, missingFile: 1 };
  }
  if (diff.action !== "updated") {
    if (options.verbose) log.log(`  ${log.green("✓")} ${diff.agentName} — up to date`);
    return { synced: 0, errors: 0, missingFile: 0 };
  }
  const result = writeRuleDiff(diff, target, manifest, log, options);
  return { ...result, missingFile: 0 };
}

/** Carve-out: shared (per-target writer; "file" kind writes carve-out rulesFile,
 *  "dir" kind writes the rulesDir/agentbrew.md consolidated file used by the
 *  delegated bridge). */
function writeRuleDiff(
  diff: RuleDiff,
  target: DiffTarget,
  manifest: Manifest,
  log: Logger,
  options: { quiet: boolean; dryRun: boolean },
): { synced: number; errors: number } {
  try {
    if (!options.dryRun) {
      if (target.kind === "dir") mkdirSync(dirname(target.expandedPath), { recursive: true });
      writeIfChanged(target.expandedPath, diff.newContent ?? "", manifest);
    }
    const icon = options.dryRun ? log.blue("~") : log.green("✓");
    if (!options.quiet) log.log(`  ${icon} ${diff.agentName} — ${options.dryRun ? "would update" : "updated"}`);
    return { synced: 1, errors: 0 };
  } catch (err) {
    const message = errorMessage(err);
    if (!options.quiet) log.log(`  ${log.red("✗")} ${diff.agentName} — ${log.red(message)}`);
    return { synced: 0, errors: 1 };
  }
}

/** Carve-out: shared (drives writes for every carve-out + every delegated agent
 *  in one pass after Slice 4b unified the two target lists). */
function applyRuleDiffs(
  diffs: RuleDiff[],
  targetInputs: DiffTarget[],
  manifest: Manifest,
  log: Logger,
  options: { quiet: boolean; verbose: boolean; dryRun: boolean },
): { synced: number; errors: number; missingFile: number } {
  let synced = 0;
  let errors = 0;
  let missingFile = 0;
  for (let i = 0; i < diffs.length; i++) {
    const result = processRuleDiff(diffs[i], targetInputs[i], manifest, log, options);
    synced += result.synced;
    errors += result.errors;
    missingFile += result.missingFile;
  }
  return { synced, errors, missingFile };
}

/** When multiple agents symlink to the same physical rules file (e.g. devin +
 *  codex → ~/.config/agentbrew/AGENTS.md), apply only one write. Delegated
 *  agents (ai-rules content) win over native carve-outs so a later devin
 *  pass cannot clobber codex's managed section. Mirrors drift dedup in
 *  `src/drift-checks/rules.ts`. */
export function dedupeRulesWritesByResolvedPath(
  diffs: RuleDiff[],
  targetInputs: DiffTarget[],
): { diffs: RuleDiff[]; targetInputs: DiffTarget[] } {
  const byResolved = new Map<string, { diff: RuleDiff; target: DiffTarget }>();
  for (let i = 0; i < diffs.length; i++) {
    const target = targetInputs[i];
    const expanded = target.expandedPath;
    let resolved = expanded;
    try {
      if (existsSync(expanded)) resolved = realpathSync(expanded);
    } catch (e) {
      logSkipped("sync/rules-sync/dedupeRealpath", e);
    }
    const existing = byResolved.get(resolved);
    if (!existing) {
      byResolved.set(resolved, { diff: diffs[i], target });
      continue;
    }
    if (CANARY_DELEGATED_AGENTS.has(target.agentName) && !CANARY_DELEGATED_AGENTS.has(existing.target.agentName)) {
      byResolved.set(resolved, { diff: diffs[i], target });
    }
  }
  const entries = [...byResolved.values()];
  return { diffs: entries.map((e) => e.diff), targetInputs: entries.map((e) => e.target) };
}

interface SyncRuleFileOpts {
  file: string;
  rulesSourceDir: string;
  targetDir: string;
  agentName: string;
  manifest: Manifest;
  log: Logger;
  dryRun: boolean;
}

/** Carve-out: shared (per-file copy of rules/*.md into a rulesDir agent's dir;
 *  e.g. the cursor / windsurf / kilo rulesDir entries). */
function syncSingleRuleFile(opts: SyncRuleFileOpts): { synced: number; errors: number } {
  const { file, rulesSourceDir, targetDir, agentName, manifest, log, dryRun } = opts;
  try {
    const sourceContent = readFileSync(join(rulesSourceDir, file), "utf-8");
    const targetPath = join(targetDir, file);
    if (dryRun && !existsSync(targetPath)) {
      log.log(`  ${log.blue("~")} ${agentName}: would add rule ${log.cyan(basename(file, ".md"))}`);
      return { synced: 1, errors: 0 };
    }
    if (!dryRun) {
      const written = writeIfChanged(targetPath, sourceContent, manifest);
      return { synced: written ? 1 : 0, errors: 0 };
    }
    return { synced: 0, errors: 0 };
  } catch (err) {
    const message = errorMessage(err);
    log.warn(`${agentName}: failed to sync rule ${file} — ${message}`);
    return { synced: 0, errors: 1 };
  }
}

/** Carve-out: shared (per-file rules sync — copies ~/.config/agentbrew/rules/*.md
 *  into every detected rulesDir-bearing agent's dir, distinct from the consolidated
 *  agentbrew.md write that the delegated bridge produces). */
function syncPerFileRules(
  manifest: Manifest,
  log: Logger,
  dryRun: boolean,
  skip: ReadonlySet<string>,
): { synced: number; errors: number } {
  let synced = 0;
  let errors = 0;
  const rulesSourceDir = expandHome(RULES_DIR);
  if (!existsSync(rulesSourceDir)) return { synced, errors };

  const ruleFiles = readdirSync(rulesSourceDir).filter((f) => f.endsWith(".md") || f.endsWith(".mdc"));
  if (ruleFiles.length === 0) return { synced, errors };

  const rulesTargets = AGENT_DEFINITIONS.filter((a) => a.rulesDir !== undefined && !skip.has(a.name)).map((a) => ({
    agent: a.name,
    dir: a.rulesDir ?? "",
  }));

  for (const target of rulesTargets) {
    const targetDir = expandHome(target.dir);
    if (!dryRun) mkdirSync(targetDir, { recursive: true });

    for (const file of ruleFiles) {
      const result = syncSingleRuleFile({
        file,
        rulesSourceDir,
        targetDir,
        agentName: target.agent,
        manifest,
        log,
        dryRun,
      });
      synced += result.synced;
      errors += result.errors;
    }
  }
  return { synced, errors };
}

/** Carve-out: shared (reads each carve-out's existing file content for the diff;
 *  rulesDir kind treats absent as empty so the create-on-demand path triggers). */
function buildTargetInput(target: { agentName: string; expandedPath: string; kind: "file" | "dir" }): DiffTarget {
  const { expandedPath } = target;
  let existingContent: string | undefined;
  if (existsSync(expandedPath)) {
    try {
      existingContent = readFileSync(expandedPath, "utf-8");
    } catch (e) {
      logSkipped("sync/rules-sync/buildTargetInput", e);
    }
  } else if (target.kind === "dir") {
    existingContent = "";
  }
  return { agentName: target.agentName, expandedPath, kind: target.kind, existingContent };
}

/** Carve-out: shared (final summary line covering carve-outs + delegated bridge). */
function logRulesSyncSummary(
  log: Logger,
  synced: number,
  errors: number,
  dryRun: boolean,
  missingFile: number = 0,
): void {
  const parts = [`${synced} agent(s) ${dryRun ? "would be updated" : "updated"}`];
  if (errors > 0) parts.push(log.red(`${errors} failed`));
  const verb = dryRun ? "Would update:" : "Done.";
  log.log(`${log.bold(`\n${verb}`)} ${parts.join(", ")}.\n`);
  if (missingFile > 0) {
    const noun = missingFile === 1 ? "agent has" : "agents have";
    log.log(
      log.dim(
        `  ℹ ${missingFile} ${noun} no rules file yet — agentbrew creates it on first sync after the agent is opened (run with --verbose to list).`,
      ),
    );
  }
}

/** Carve-out: shared (sync-section header covering every carve-out + delegated agent). */
function logRulesHeader(log: Logger, dryRun: boolean): void {
  const label = dryRun ? "Dry run — shared rules" : "Syncing shared rules...";
  log.log(log.bold(`\n${label}\n`));
}

/** Carve-out: bridge (ai-rules-delegated diagnostic — silent for native
 *  carve-outs; warns once when every canary agent is missing from the
 *  delegation map, the signature of `ai-rules` being absent or failing). */
function warnWhenDelegationEmpty(
  delegated: ReadonlyMap<string, string>,
  allTargets: ReadonlyArray<{ agentName: string }>,
  log: Logger,
): void {
  const canaryTargets = allTargets.filter((t) => CANARY_DELEGATED_AGENTS.has(t.agentName));
  if (canaryTargets.length === 0) return;
  const anyDelegated = canaryTargets.some((t) => delegated.has(t.agentName));
  if (anyDelegated) return;
  log.warn(
    `ai-rules produced no output for the ${canaryTargets.length} delegated agent(s) — ` +
      "these will skip. Install ai-rules (https://github.com/block/ai-rules) " +
      "or they will stay out of sync.",
  );
}

/** Carve-out: shared (sync-options unpacker; runs once per `syncRules` invocation). */
function parseSyncOpts(options?: SyncOptions, ctx?: Partial<Context>) {
  const quiet = options?.quiet ?? false;
  const verbose = options?.verbose ?? false;
  const dryRun = options?.dryRun ?? false;
  const log = ctx?.logger ?? createContext({ quiet, compact: options?.compact }).logger;
  return { quiet, verbose, dryRun, log };
}

/**
 * Carve-out: bridge (ai-rules-delegated agents only — NOT a native carve-out).
 * Returns the delegated-content map; native carve-outs go through
 * {@link computeRulesDiff}'s `mergedRules` branch instead. Empty Map when
 * `ai-rules` is missing or no canary is in `targets` (see
 * {@link delegateRulesGenerate} contract).
 *
 * Exported so `src/drift-checks/rules.ts` can compute the SAME per-target
 * content `syncRules` writes — otherwise drift falsely reports delegated
 * agents as out-of-date right after a successful sync.
 */
export function collectCanaryDelegation(
  targets: ReadonlyArray<{ agentName: string }>,
  deployRules: string | undefined,
): ReadonlyMap<string, string> {
  if (!deployRules) return new Map();
  const canaryAgents = targets.map((t) => t.agentName).filter((name) => CANARY_DELEGATED_AGENTS.has(name));
  if (canaryAgents.length === 0) return new Map();
  return delegateRulesGenerate({ agents: canaryAgents, sharedRules: deployRules });
}

/** Carve-out: shared (combined target list — rulesFile agents get
 *  `kind: "file"`; rulesDir canary agents get `kind: "dir"` pointing at
 *  `<rulesDir>/agentbrew.md`. Both shapes share `applyRuleDiffs`).
 *
 *  Used by `syncRules` only — external callers (initRules, showRules,
 *  drift) iterate rulesFile-only via {@link getRulesTargets}. */
function getAllSyncTargets(
  skip: ReadonlySet<string>,
): Array<{ agentName: string; expandedPath: string; kind: "file" | "dir" }> {
  const fileTargets = getRulesTargets().map((t) => ({
    agentName: t.agentName,
    expandedPath: expandHome(t.path),
    kind: "file" as const,
  }));
  const dirTargets = AGENT_DEFINITIONS.filter(
    (a) => a.rulesDir !== undefined && CANARY_DELEGATED_AGENTS.has(a.name),
  ).map((a) => ({
    agentName: a.name,
    expandedPath: join(expandHome(a.rulesDir ?? ""), "agentbrew.md"),
    kind: "dir" as const,
  }));
  return [...fileTargets, ...dirTargets].filter((target) => !skip.has(target.agentName));
}

function maybeDedupeSharedRules(dryRun: boolean): void {
  if (dryRun) return;
  try {
    dedupeSharedRulesFile();
  } catch (e) {
    logSkipped("sync/rules-sync/dedupeSharedRulesFile", e);
  }
}

function loadDeployRules(quiet: boolean, log: Logger): string | undefined {
  const userRules = loadSharedRules();
  if (!userRules) {
    if (!quiet) log.warn("No shared rules file found.");
    return undefined;
  }
  return stripCursorRulesSection(compressSkillsListing(userRules));
}

function refreshRulesSafely(manifest: Manifest, dryRun: boolean): void {
  try {
    refreshCatalogTemplateRules({ manifest, dryRun });
  } catch (e) {
    logSkipped("sync/rules-sync/refreshCatalogTemplateRules", e);
  }
}

function syncPerFileRulesSafely(
  manifest: Manifest,
  log: Logger,
  dryRun: boolean,
  skip: ReadonlySet<string>,
): { synced: number; errors: number } {
  try {
    return syncPerFileRules(manifest, log, dryRun, skip);
  } catch (e) {
    logSkipped("sync/rules-sync/syncPerFileRules", e);
    return { synced: 0, errors: 0 };
  }
}

/** Carve-out: shared (entry-point orchestrator — runs the same diff/apply
 *  pipeline for every carve-out + the delegated bridge in one pass).
 *
 *  `deployRules` = shared rules + compressed skills listing + Cursor-section
 *  strip. Used as ai-rules input AND as carve-out native-path content.
 *  Slice 4: delegated agents no longer fall back to native content silently;
 *  they skip when the delegation map is empty (see {@link computeRulesDiff}).
 *
 *  Slice 4b: one target list (file + dir kinds), one delegation call, one
 *  apply pass — kind discriminant chooses create-on-demand vs skip-if-missing. */
export async function syncRules(options?: SyncOptions, ctx?: Partial<Context>): Promise<void> {
  const { quiet, verbose, dryRun, log } = parseSyncOpts(options, ctx);
  const state = ctx?.state?.require({ quiet }) ?? requireState({ quiet });
  if (!state) return;

  // `applyAgentfile` runs earlier in the same sync and re-emits every source's
  // rule list, so the house rules every repo declares — commit convention,
  // test-before-commit — land in shared-rules once per Agentfile. Deduping here
  // rather than only in `status --fix` is what makes the saving stick: without
  // it sync deploys the duplicates to every agent and the next drift check
  // reports the file dirty again, on every run.
  maybeDedupeSharedRules(dryRun);
  const deployRules = loadDeployRules(quiet, log);
  if (deployRules === undefined) return;

  // Never write rules for an agent the state marks not detected.
  const skip = undetectedAgentNames(state);
  const targets = getAllSyncTargets(skip);
  const targetInputs = targets.map(buildTargetInput);
  const delegated = collectCanaryDelegation(targets, deployRules);
  const diffs = computeRulesDiff(deployRules ?? "", targetInputs, delegated);
  const deduped = dedupeRulesWritesByResolvedPath(diffs, targetInputs);

  if (!quiet) warnWhenDelegationEmpty(delegated, targets, log);
  if (!quiet) logRulesHeader(log, dryRun);

  const sharedManifest = ctx?.manifest !== undefined;
  const manifest = ctx?.manifest ?? loadManifest();
  const diffResult = applyRuleDiffs(deduped.diffs, deduped.targetInputs, manifest, log, { quiet, verbose, dryRun });

  // Refresh catalog-owned per-file rules from repo templates before deploy.
  refreshRulesSafely(manifest, dryRun);

  // Per-file rules sync — copies ~/.config/agentbrew/rules/*.md verbatim into
  // each rulesDir-bearing agent's dir. Distinct from the consolidated
  // <rulesDir>/agentbrew.md write above (that holds shared rules).
  const perFileResult = syncPerFileRulesSafely(manifest, log, dryRun, skip);

  if (!dryRun && !sharedManifest) saveManifest(manifest);
  if (!quiet)
    logRulesSyncSummary(
      log,
      diffResult.synced + perFileResult.synced,
      diffResult.errors + perFileResult.errors,
      dryRun,
      diffResult.missingFile,
    );
}

/** Carve-out: shared (one-time bootstrap — extracts existing rules content from
 *  whichever carve-out has it on disk, or seeds a starter file). */
export async function initRules(): Promise<void> {
  const existing = loadSharedRules();
  if (existing) {
    console.log(chalk.yellow(`Shared rules already exist at ${getSharedRulesPath()}`));
    console.log("Edit it directly or use `agentbrew sync --only rules` to deploy.");
    return;
  }

  // Try to extract from first agent that has rules
  const targets = getRulesTargets();
  let extracted: string | undefined;
  let extractedFrom: string | undefined;

  for (const target of targets) {
    const expanded = expandHome(target.path);
    if (!existsSync(expanded)) continue;

    try {
      const content = readFileSync(expanded, "utf-8");

      // Check if it already has managed markers
      const managed = extractManagedSection(content);
      if (managed) {
        extracted = managed;
        extractedFrom = target.agentName;
        break;
      }

      // Otherwise use the full file content as the initial shared rules
      extracted = content;
      extractedFrom = target.agentName;
      break;
    } catch (e) {
      logSkipped("sync/rules-sync/extractManagedSection", e);
      // Fall through to next candidate
    }
  }

  if (extracted) {
    saveSharedRules(extracted);
    console.log(`${ICON_SUCCESS} Shared rules created from ${extractedFrom}: ${getSharedRulesPath()}`);
    console.log("\nEdit the file, then run `agentbrew sync --only rules` to deploy to all agents.");
  } else {
    const starter =
      "# Shared Agent Rules\n\nRules here are synced to all AI coding agents by agentbrew.\n\n## Code Style\n\n- Use conventional commits: feat:, fix:, docs:, refactor:, test:\n- Run tests before committing\n";
    saveSharedRules(starter);
    console.log(`${ICON_SUCCESS} Starter rules created: ${getSharedRulesPath()}`);
    console.log("\nEdit the file, then run `agentbrew sync --only rules` to deploy.");
  }
}

/** Carve-out: shared (status entry-point — iterates every carve-out's rulesFile
 *  and reports managed-section presence; reads only, no writes). */
export async function showRules(): Promise<void> {
  const rules = loadSharedRules();
  if (!rules) {
    console.error(chalk.yellow("No shared rules file found."));
    console.log("Run `agentbrew rules init` to create one.");
    return;
  }

  console.log(chalk.bold("\nShared rules") + chalk.dim(` (${getSharedRulesPath()})\n`));
  console.log(rules);

  console.log(chalk.bold("Deployment status:\n"));
  const targets = getRulesTargets();
  for (const target of targets) {
    const expanded = expandHome(target.path);
    if (!existsSync(expanded)) {
      console.log(chalk.dim(`  - ${target.agentName} — not found`));
      continue;
    }

    let content: string;
    try {
      content = readFileSync(expanded, "utf-8");
    } catch (e) {
      logSkipped("sync/rules-sync/readFileSync", e);
      console.log(chalk.dim(`  - ${target.agentName} — could not read`));
      continue;
    }
    const hasMarkers = content.includes(START_MARKER);
    if (hasMarkers) {
      console.log(`  ${ICON_SUCCESS} ${target.agentName} — has managed section`);
    } else {
      console.log(`  ${ICON_INFO} ${target.agentName} — no managed section yet`);
    }
  }
  console.log();
}
