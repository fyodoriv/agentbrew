import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { logSkipped } from "../core/logger.js";
import { lint, validateConfig } from "../lint.js";
import {
  CONTEXT_BUDGET_LATEST_PATH,
  CONTEXT_BUDGET_MANUAL_SNAPSHOTS_DIR,
  CONTEXT_BUDGET_METRICS_DIR,
  SHARED_RULES_PATH,
} from "../paths.js";
import { DEPLOYED_RULES_FILE_CHAR_BUDGET, findSharedRulesBloat, projectedDeployedRulesSize } from "../rules-hygiene.js";
import { collectStatusData } from "../status.js";
import {
  compressSkillsListing,
  DEFAULT_TOKEN_WARNING_THRESHOLD,
  estimateTokens,
  measureSections,
  stripCursorRulesSection,
} from "../sync/instructions-content.js";
import { getInstructionsSourcePath } from "../sync/instructions-sync.js";
import { ICON_ERROR, ICON_SUCCESS, ICON_WARNING } from "../ui/output.js";
import { expandHome } from "../utils.js";
import { buildContextBudgetAlerts, formatContextBudgetAlertLines } from "./context-budget-alerts.js";
import {
  extractRuntimeTodayFromCcusage,
  type OpenusageRuntimeResult,
  type RuntimeTodayRollup,
  type TokscaleRuntimeResult,
  tryOpenusageDaily,
  tryTokscaleToday,
} from "./context-budget-runtime.js";
import { CONTEXT_BUDGET_POST_SYNC_INTERVAL_MS, shouldMeasureContextBudget } from "./context-budget-throttle.js";
import { type CursorMdcInventory, collectCursorMdcInventory } from "./cursor-mdc-inventory.js";

export const CONTEXT_BUDGET_SCHEMA_VERSION = 1 as const;

export interface ContextBudgetSection {
  heading: string;
  chars: number;
  tokens: number;
}

export interface ContextBudgetAlert {
  severity: "warn" | "error";
  code: "low-soft-headroom" | "over-soft-threshold" | "over-hard-budget" | "lint-failed";
  message: string;
}

export interface ContextBudgetSnapshot {
  schemaVersion: typeof CONTEXT_BUDGET_SCHEMA_VERSION;
  measuredAt: string;
  static: {
    sharedRulesBytes: number;
    sharedRulesLines: number;
    projectedDeployedChars: number;
    projectedDeployedTokens: number;
    softCharThreshold: number;
    softTokenHeadroom: number;
    hardCharBudget: number;
    overSoftThreshold: boolean;
    overHardBudget: boolean;
    topSections: ContextBudgetSection[];
    bloatFindingCount: number;
    lintPassed: boolean;
    lintErrors: number;
    lintWarnings: number;
  };
  inventory: {
    cursorMdc?: CursorMdcInventory;
    agentCount: number;
    detectedAgentCount: number;
    mcpServerCount: number;
    skillCount: number;
    commandCount: number;
  };
  runtime: {
    ccusage: {
      available: boolean;
      skippedReason?: string;
      daily?: unknown;
      today?: RuntimeTodayRollup;
    };
    tokscale?: TokscaleRuntimeResult;
    openusage?: OpenusageRuntimeResult;
  };
  alerts: ContextBudgetAlert[];
  cursorRing: {
    automated: false;
    manualSnapshotDir: string;
    note: string;
  };
  sources: string[];
}

export interface MeasureContextBudgetOptions {
  /** Write JSON only — skip human summary. */
  json?: boolean;
  /** Do not persist snapshot files (tests). */
  dryRun?: boolean;
  /** Skip ccusage subprocess (tests / faster runs). */
  skipCcusage?: boolean;
  /** Skip tokscale subprocess (tests / faster runs). */
  skipTokscale?: boolean;
  /** Skip full `lint()` console output during background post-sync capture. */
  quiet?: boolean;
  /** Skip capture when latest.json measuredAt is newer than this interval (ms). */
  ifStaleMs?: number;
}

export interface MeasureContextBudgetResult {
  snapshot?: ContextBudgetSnapshot;
  writtenPaths: string[];
  exitCode: number;
  skipped?: boolean;
  skippedReason?: string;
}

const CURSOR_RING_NOTE =
  "Cursor's context ring has no public API. When investigating IDE context pressure, note the ring reading in metrics/manual-snapshots/ (freeform markdown or JSON).";

function readSharedRulesContent(): { content: string; bytes: number; lines: number } | undefined {
  const sharedRulesPath = expandHome(SHARED_RULES_PATH);
  if (!existsSync(sharedRulesPath)) return undefined;
  const content = readFileSync(sharedRulesPath, "utf-8");
  return { content, bytes: Buffer.byteLength(content, "utf-8"), lines: content.split("\n").length };
}

function readInstructionsContent(): string {
  const instructionsPath = getInstructionsSourcePath();
  if (!existsSync(instructionsPath)) return "";
  try {
    return readFileSync(instructionsPath, "utf-8");
  } catch (error) {
    logSkipped("measure/context-budget/instructions", error);
    return "";
  }
}

function collectTopSections(deployRules: string, limit = 10): ContextBudgetSection[] {
  return measureSections(deployRules)
    .slice(0, limit)
    .map((section) => ({
      heading: section.heading,
      chars: section.chars,
      tokens: estimateTokens(section.chars),
    }));
}

function countUniqueSkills(status: ReturnType<typeof collectStatusData>): number {
  const seen = new Set<string>();
  for (const source of status?.skills ?? []) {
    for (const name of source.names) seen.add(name);
  }
  return seen.size;
}

function tryCcusageDaily(): ContextBudgetSnapshot["runtime"]["ccusage"] {
  const attempts: Array<{ command: string; args: string[] }> = [
    { command: "bunx", args: ["ccusage", "claude", "daily", "--json"] },
    { command: "npx", args: ["-y", "ccusage", "claude", "daily", "--json"] },
  ];
  for (const { command, args } of attempts) {
    try {
      const stdout = execFileSync(command, args, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 45_000,
      });
      return { available: true, daily: JSON.parse(stdout) as unknown };
    } catch (error) {
      logSkipped(`measure/context-budget/ccusage/${command}`, error);
    }
  }
  return {
    available: false,
    skippedReason: "ccusage not available (install via bunx/npx ccusage or skip for static-only metrics)",
  };
}

function runLintCheck(quiet: boolean): { passed: boolean; errors: number; warnings: number } {
  if (quiet) {
    const validation = validateConfig();
    const shared = readSharedRulesContent();
    let extraErrors = 0;
    if (shared) {
      const deployRules = stripCursorRulesSection(compressSkillsListing(shared.content));
      const projected = projectedDeployedRulesSize(readInstructionsContent(), deployRules);
      if (projected > DEPLOYED_RULES_FILE_CHAR_BUDGET) extraErrors++;
      extraErrors += findSharedRulesBloat(shared.content).filter((f) => f.kind !== "section-budget").length;
    }
    const errors = validation.errors + extraErrors;
    return { passed: errors === 0, errors, warnings: validation.warnings };
  }

  const passed = lint();
  const validation = validateConfig();
  return { passed, errors: validation.errors, warnings: validation.warnings };
}

function collectRuntimeMetrics(options?: {
  skipCcusage?: boolean;
  skipTokscale?: boolean;
}): ContextBudgetSnapshot["runtime"] {
  const ccusage = options?.skipCcusage
    ? { available: false as const, skippedReason: "skipped by flag" }
    : tryCcusageDaily();
  const ccusageWithToday = ccusage.available
    ? { ...ccusage, today: extractRuntimeTodayFromCcusage(ccusage.daily) }
    : ccusage;
  const tokscale = options?.skipTokscale || options?.skipCcusage ? undefined : tryTokscaleToday();
  const openusage = options?.skipCcusage ? undefined : tryOpenusageDaily();
  return {
    ccusage: ccusageWithToday,
    ...(tokscale ? { tokscale } : {}),
    ...(openusage ? { openusage } : {}),
  };
}

export function buildContextBudgetSnapshot(options?: {
  skipCcusage?: boolean;
  skipTokscale?: boolean;
  quiet?: boolean;
}): ContextBudgetSnapshot {
  const shared = readSharedRulesContent();
  const instructions = readInstructionsContent();
  const deployRules = shared ? stripCursorRulesSection(compressSkillsListing(shared.content)) : "";
  const projectedChars = projectedDeployedRulesSize(instructions, deployRules);
  const projectedTokens = estimateTokens(projectedChars);
  const bloatFindings = shared ? findSharedRulesBloat(shared.content) : [];
  const lintResult = runLintCheck(options?.quiet ?? false);
  const status = collectStatusData();
  const detectedAgents = status?.agents.filter((a) => a.detected) ?? [];

  const staticBlock = {
    sharedRulesBytes: shared?.bytes ?? 0,
    sharedRulesLines: shared?.lines ?? 0,
    projectedDeployedChars: projectedChars,
    projectedDeployedTokens: projectedTokens,
    softCharThreshold: DEFAULT_TOKEN_WARNING_THRESHOLD,
    softTokenHeadroom: Math.max(0, estimateTokens(DEFAULT_TOKEN_WARNING_THRESHOLD) - projectedTokens),
    hardCharBudget: DEPLOYED_RULES_FILE_CHAR_BUDGET,
    overSoftThreshold: projectedChars > DEFAULT_TOKEN_WARNING_THRESHOLD,
    overHardBudget: projectedChars > DEPLOYED_RULES_FILE_CHAR_BUDGET,
    topSections: collectTopSections(deployRules),
    bloatFindingCount: bloatFindings.length,
    lintPassed: lintResult.passed,
    lintErrors: lintResult.errors,
    lintWarnings: lintResult.warnings,
  };

  const alerts = buildContextBudgetAlerts({ static: staticBlock });
  const runtime = collectRuntimeMetrics(options);

  return {
    schemaVersion: CONTEXT_BUDGET_SCHEMA_VERSION,
    measuredAt: new Date().toISOString(),
    static: staticBlock,
    inventory: {
      agentCount: status?.agents.length ?? 0,
      detectedAgentCount: detectedAgents.length,
      mcpServerCount: status?.mcpServers.length ?? 0,
      skillCount: countUniqueSkills(status),
      commandCount: status?.commands?.count ?? 0,
      cursorMdc: collectCursorMdcInventory(),
    },
    runtime,
    alerts,
    cursorRing: {
      automated: false,
      manualSnapshotDir: CONTEXT_BUDGET_MANUAL_SNAPSHOTS_DIR,
      note: CURSOR_RING_NOTE,
    },
    sources: [
      "agentbrew lint + rules-hygiene (static projected tokens)",
      "agentbrew status --json (inventory)",
      "optional: bunx ccusage claude daily --json (Claude runtime + runtime.today rollup)",
      "optional: bunx tokscale --today --client cursor --json (Cursor IDE runtime)",
      "optional: openusage daily --json (multi-provider daily rollup incl. Cursor local DB)",
      "optional: session-report skill (~/.claude/projects transcripts)",
      "manual: Cursor context ring → metrics/manual-snapshots/",
    ],
  };
}

function datedSnapshotPath(measuredAt: string): string {
  const day = measuredAt.slice(0, 10);
  return join(expandHome(CONTEXT_BUDGET_METRICS_DIR), `context-budget-${day}.json`);
}

export function writeContextBudgetSnapshot(snapshot: ContextBudgetSnapshot): string[] {
  const metricsDir = expandHome(CONTEXT_BUDGET_METRICS_DIR);
  const manualDir = expandHome(CONTEXT_BUDGET_MANUAL_SNAPSHOTS_DIR);
  mkdirSync(metricsDir, { recursive: true });
  mkdirSync(manualDir, { recursive: true });

  const payload = `${JSON.stringify(snapshot, null, 2)}\n`;
  const datedPath = datedSnapshotPath(snapshot.measuredAt);
  const latestPath = expandHome(CONTEXT_BUDGET_LATEST_PATH);
  writeFileSync(datedPath, payload, "utf-8");
  writeFileSync(latestPath, payload, "utf-8");
  return [datedPath, latestPath];
}

function printTopSections(sections: ContextBudgetSection[]): void {
  if (sections.length === 0) return;
  console.log(chalk.dim("  top sections:"));
  for (const section of sections.slice(0, 3)) {
    console.log(`    ${section.heading.padEnd(40)} ~${section.tokens.toLocaleString()} tokens`);
  }
}

function printRuntimeSummary(runtime: ContextBudgetSnapshot["runtime"]): void {
  if (runtime.ccusage.available) {
    const today = runtime.ccusage.today;
    if (today) {
      console.log(
        `  ${ICON_SUCCESS} ccusage today: ~${today.totalTokens.toLocaleString()} tokens ($${today.totalCost.toFixed(2)})`,
      );
    } else {
      console.log(`  ${ICON_SUCCESS} ccusage daily JSON captured`);
    }
  } else {
    console.log(`  ${chalk.dim("○")} ccusage skipped — ${runtime.ccusage.skippedReason}`);
  }
  if (runtime.tokscale?.available) {
    console.log(`  ${ICON_SUCCESS} tokscale Cursor today captured`);
  } else if (runtime.tokscale) {
    console.log(`  ${chalk.dim("○")} tokscale skipped — ${runtime.tokscale.skippedReason}`);
  }
  if (runtime.openusage?.available) {
    const today = runtime.openusage.today;
    if (today) {
      console.log(
        `  ${ICON_SUCCESS} openusage today: ~${today.totalTokens.toLocaleString()} tokens ($${today.totalCost.toFixed(2)})`,
      );
    } else {
      console.log(`  ${ICON_SUCCESS} openusage daily JSON captured`);
    }
  } else if (runtime.openusage) {
    console.log(`  ${chalk.dim("○")} openusage skipped — ${runtime.openusage.skippedReason}`);
  }
}

function printHumanSummary(snapshot: ContextBudgetSnapshot, writtenPaths: string[]): void {
  const { static: s, inventory } = snapshot;
  const icon = s.lintPassed ? ICON_SUCCESS : ICON_ERROR;
  console.log(chalk.bold("\nContext budget\n"));
  console.log(
    `  ${icon} projected deployed rules ~${s.projectedDeployedTokens.toLocaleString()} tokens (${s.projectedDeployedChars.toLocaleString()} chars)`,
  );
  if (s.overHardBudget) {
    console.log(`  ${ICON_ERROR} over hard char budget (${s.hardCharBudget.toLocaleString()})`);
  } else if (s.overSoftThreshold) {
    console.log(`  ${ICON_WARNING} over soft target (~${estimateTokens(s.softCharThreshold).toLocaleString()} tokens)`);
  }
  console.log(
    `  ${chalk.dim("shared-rules.md")} ${s.sharedRulesBytes.toLocaleString()} bytes / ${s.sharedRulesLines} lines`,
  );
  printTopSections(s.topSections);
  if (inventory.cursorMdc) {
    console.log(
      `  ${chalk.dim("Cursor .mdc")} ${inventory.cursorMdc.alwaysAppliedBytes.toLocaleString()} always-applied bytes / ${inventory.cursorMdc.totalBytes.toLocaleString()} total (${inventory.cursorMdc.rulesDir})`,
    );
  }
  console.log(`  ${chalk.dim("headroom")} ~${s.softTokenHeadroom.toLocaleString()} tokens to soft target`);
  console.log(
    `  ${chalk.dim("inventory")} ${inventory.detectedAgentCount} agents, ${inventory.mcpServerCount} MCP, ${inventory.skillCount} skills`,
  );
  printRuntimeSummary(snapshot.runtime);
  for (const line of formatContextBudgetAlertLines(snapshot.alerts)) {
    const icon = line.includes("over-hard") || line.includes("lint-failed") ? ICON_ERROR : ICON_WARNING;
    console.log(`  ${icon} ${line}`);
  }
  console.log(chalk.dim(`  Cursor ring: manual only → ${snapshot.cursorRing.manualSnapshotDir}`));
  console.log(chalk.dim(`  wrote ${writtenPaths.join(", ")}`));
}

export function measureContextBudget(options?: MeasureContextBudgetOptions): MeasureContextBudgetResult {
  if (options?.ifStaleMs !== undefined) {
    if (!shouldMeasureContextBudget({ minIntervalMs: options.ifStaleMs })) {
      if (options.json) {
        console.log(JSON.stringify({ skipped: true, reason: "not stale" }, null, 2));
      }
      return { writtenPaths: [], exitCode: 0, skipped: true, skippedReason: "not stale" };
    }
  }

  const snapshot = buildContextBudgetSnapshot({
    skipCcusage: options?.skipCcusage,
    skipTokscale: options?.skipTokscale ?? options?.skipCcusage,
    quiet: options?.quiet ?? options?.json,
  });
  const writtenPaths = options?.dryRun ? [] : writeContextBudgetSnapshot(snapshot);
  const exitCode = snapshot.static.lintPassed ? 0 : 1;

  emitContextBudgetAlerts(snapshot, { force: !options?.quiet });

  if (options?.json) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else if (!options?.quiet) {
    printHumanSummary(snapshot, writtenPaths);
  }

  return { snapshot, writtenPaths, exitCode };
}

/** Lightweight post-sync capture when the last snapshot is older than 24h. */
export function maybeMeasureContextBudgetAfterSync(): void {
  try {
    const result = measureContextBudget({
      quiet: true,
      skipCcusage: true,
      skipTokscale: true,
      ifStaleMs: CONTEXT_BUDGET_POST_SYNC_INTERVAL_MS,
    });
    if (result.skipped) {
      emitContextBudgetAlertsFromLatest();
    }
  } catch (error) {
    logSkipped("sync/maybeMeasureContextBudget", error);
  }
}

/** Emit stderr alerts for low headroom / over-threshold even in quiet/background paths. */
export function emitContextBudgetAlerts(snapshot: ContextBudgetSnapshot, options?: { force?: boolean }): void {
  if (snapshot.alerts.length === 0) return;
  if (!options?.force) return;
  for (const line of formatContextBudgetAlertLines(snapshot.alerts)) {
    console.warn(line);
  }
}

/** Read latest.json and warn when headroom is low (post-sync skip path). */
export function emitContextBudgetAlertsFromLatest(): void {
  const latestPath = expandHome(CONTEXT_BUDGET_LATEST_PATH);
  if (!existsSync(latestPath)) return;
  try {
    const snapshot = JSON.parse(readFileSync(latestPath, "utf-8")) as ContextBudgetSnapshot;
    if (!snapshot.static || !Array.isArray(snapshot.alerts)) return;
    emitContextBudgetAlerts(snapshot, { force: true });
  } catch (error) {
    logSkipped("measure/context-budget/alerts-from-latest", error);
  }
}
