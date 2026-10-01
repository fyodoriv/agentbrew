import { existsSync } from "node:fs";
import { join } from "node:path";
import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { getStateSources } from "../agentfile.js";
import { cliNotFound } from "../core/cli-error.js";
import { COMMANDS_DIR } from "../paths.js";
import { loadState, requireState } from "../state.js";
import { formatSuggestion } from "../suggest.js";
import { loadSharedRules } from "../sync/rules-sync.js";
import type { Source } from "../types.js";
import { ICON_INFO, ICON_SUCCESS } from "../ui/output.js";
import { expandHome } from "../utils.js";
import {
  addRuleToSharedRules,
  installCliTool,
  installMcpServer,
  installRule,
  refreshRecommendedCatalogRules,
} from "./install-other.js";
import { installFromSource, installSkill, isAlreadyInstalled } from "./install-skill.js";
import type {
  Catalog,
  CatalogCliTool,
  CatalogDeprecation,
  CatalogMcpServer,
  CatalogRule,
  CatalogSkill,
} from "./types.js";
import { loadCatalog } from "./types.js";

/**
 * Stderr-warn at install time when a catalog entry carries a `deprecated:`
 * marker. Names the deprecation date + reason and (when available) the
 * replacement id-or-URL so the user can switch in one step. Quiet for
 * current (non-deprecated) entries — they're the common path.
 *
 * Stderr (not stdout) so the warning shows even when stdout is piped to
 * another tool, and so structured-output consumers see it on a distinct
 * channel from the install's per-step messages.
 *
 * Surfaced 2026-05-25 ecosystem audit (subagent report § 14) — see
 * `CatalogDeprecation` JSDoc in src/catalog/types.ts.
 */
export function warnIfDeprecated(name: string, kind: string, entry: { deprecated?: CatalogDeprecation }): void {
  if (!entry.deprecated) return;
  const { since, reason, replacement } = entry.deprecated;
  const header = chalk.yellow(`⚠  ${kind} '${name}' is deprecated (since ${since})`);
  console.error(header);
  console.error(`   ${chalk.dim("Reason:")} ${reason}`);
  if (replacement) {
    console.error(`   ${chalk.dim("Replacement:")} ${chalk.cyan(replacement)}`);
  } else {
    console.error(`   ${chalk.dim("Replacement: none available — entry is being removed")}`);
  }
}

/** Max characters shown when previewing a catalog item description. */
const DESCRIPTION_PREVIEW_LENGTH = 60;

/**
 * Truncate a description to `max` chars, adding "…" when truncation happens,
 * and preferring to break at a word boundary. Keeps the UI honest — users
 * know there's more, and they don't see `hypothesize → f` mid-word.
 */
function previewDescription(description: string, max: number = DESCRIPTION_PREVIEW_LENGTH): string {
  const text = description.trim();
  if (text.length <= max) return text;
  // Reserve 1 char for the ellipsis.
  const limit = max - 1;
  // Find the last whitespace at or before `limit` to break on a word.
  const slice = text.slice(0, limit);
  const lastSpace = slice.lastIndexOf(" ");
  // If breaking on a word would eat more than ~30% of the budget, fall back to
  // a hard char cut (prevents cases like a 60-char single word collapsing to 10).
  const wordCut = lastSpace > limit * 0.7 ? slice.slice(0, lastSpace).trimEnd() : slice.trimEnd();
  return `${wordCut}…`;
}

// ── Install summary collector ────────────────────────────────────────────────
// Accumulates repeated messages across batch installs for a single summary line.

export interface InstallSummary {
  /** Skills that were already installed (batched for a single summary line). */
  alreadyInstalled: string[];
  /** Source URLs that failed -> number of skills skipped from each. */
  failedSourceSkips: Map<string, number>;
}

export const installSummary: InstallSummary = {
  alreadyInstalled: [],
  failedSourceSkips: new Map(),
};

/** Reset the install summary so independent `install()` calls don't leak state. */
function resetInstallSummary(): void {
  installSummary.alreadyInstalled.length = 0;
  installSummary.failedSourceSkips.clear();
}

export function flushInstallSummary(): void {
  if (installSummary.alreadyInstalled.length > 0) {
    const count = installSummary.alreadyInstalled.length;
    console.log(`  ${ICON_SUCCESS} ${count} skill${count > 1 ? "s" : ""} already installed (skipped)`);
    installSummary.alreadyInstalled.length = 0;
  }
  for (const [url, count] of installSummary.failedSourceSkips) {
    if (count > 0) {
      console.error(chalk.yellow(`  ⚠ ${url}: ${count} skill${count > 1 ? "s" : ""} skipped (source unreachable)`));
    }
  }
  installSummary.failedSourceSkips.clear();
}

/** Displays popular catalog items when no install name is provided. */
function showPopularItems(catalog: Catalog): void {
  const recommendedSkills = catalog.skills.filter((s) => s.recommended).slice(0, 5);
  const recommendedMcp = catalog.mcp_servers.filter((s) => s.recommended).slice(0, 3);

  console.log(chalk.bold("\nPopular skills:\n"));
  for (const skill of recommendedSkills) {
    console.log(
      `  ${chalk.cyan(skill.name)} ${chalk.yellow("★")}  ${chalk.dim(previewDescription(skill.description))}`,
    );
  }

  if (recommendedMcp.length > 0) {
    console.log(chalk.bold("\nPopular MCP servers:\n"));
    for (const server of recommendedMcp) {
      console.log(
        `  ${chalk.cyan(server.name)} ${chalk.yellow("★")}  ${chalk.dim(previewDescription(server.description))}`,
      );
    }
  }

  console.log(chalk.bold("\nInstall:\n"));
  console.log("  agentbrew install <name>            Install one item");
  console.log("  agentbrew install --recommended      Install all recommended");
  console.log("  agentbrew catalog                    Browse everything");
  console.log();
}

/** Handles install from a specific source specified via --from flag. */
async function installFromSpecificSource(
  state: NonNullable<ReturnType<typeof requireState>>,
  name: string,
  from: string,
): Promise<void> {
  const source = getStateSources(state).find((s) => s.url === from);
  if (!source) {
    cliNotFound(from, "in registered sources", "Run `agentbrew status` to list available sources.");
    return;
  }
  const item = (source.availableItems ?? []).find((i) => i.name === name);
  if (!item) {
    cliNotFound(name, `in source '${from}'`, "Run `agentbrew sync --pull` to refresh the source index.");
    return;
  }
  await installFromSource(source, name, installSummary);
}

/** Displays dry-run output for an MCP server install, including env vars. */
function showMcpDryRun(server: CatalogMcpServer): void {
  console.log(chalk.bold("\nDry run — install\n"));
  console.log(`  ${chalk.blue("~")} Would install MCP server ${chalk.cyan(server.name)}`);
  // stdio entries print `command args`; http-transport entries print the url.
  const transportLine = server.url ?? `${server.command ?? ""} ${(server.args ?? []).join(" ")}`.trim();
  console.log(chalk.dim(`    ${transportLine}`));
  if (Object.keys(server.env ?? {}).length > 0) {
    console.log(chalk.dim(`    env: ${Object.keys(server.env ?? {}).join(", ")}`));
  }
  console.log();
}

/** Displays a simple dry-run message for skill, rule, or CLI tool installs. */
function showSimpleDryRun(type: string, name: string, suffix?: string): void {
  console.log(chalk.bold("\nDry run — install\n"));
  console.log(`  ${chalk.blue("~")} Would install ${type} ${chalk.cyan(name)}${suffix ? ` ${suffix}` : ""}`);
  console.log();
}

/** Searches all cached sources for a skill and installs it, or shows not-found suggestions. */
async function searchAndInstallFromSources(
  state: NonNullable<ReturnType<typeof requireState>>,
  catalog: Catalog,
  name: string,
): Promise<void> {
  const matches = findInAllSources(state, name);
  if (matches.length === 1) {
    await installFromSource(matches[0].source, name, installSummary);
    return;
  }
  if (matches.length > 1) {
    console.log(chalk.yellow(`\n'${name}' found in ${matches.length} sources:\n`));
    const chosen = await select({
      message: `Install '${name}' from which source?`,
      choices: matches.map((m) => ({
        name: `${m.source.url} — ${m.item.description || "no description"}`,
        value: m.source.url,
      })),
    });
    const match = matches.find((m) => m.source.url === chosen);
    if (match) {
      await installFromSource(match.source, name, installSummary);
    }
    return;
  }
  const allNames = [
    ...catalog.skills.map((s) => s.name),
    ...catalog.mcp_servers.map((s) => s.name),
    ...catalog.rules.map((r) => r.name),
    ...(catalog.cli_tools ?? []).map((t) => t.name),
    ...findInAllSources(state, "").map((m) => m.item.name),
  ];
  console.error(chalk.red(`'${name}' not found in catalog or sources.`));
  const suggestion = formatSuggestion(name, allNames);
  if (suggestion) {
    console.log(suggestion);
  }
  console.log(chalk.dim("  Run `agentbrew catalog` to see available items."));
  process.exitCode = 1;
}

/** Look up a catalog item by name and show dry-run output. Returns true if item was found. */
function showCatalogDryRun(catalog: ReturnType<typeof loadCatalog>, name: string, local?: string): boolean {
  const skill = catalog.skills.find((s) => s.name === name);
  if (skill) {
    showSimpleDryRun("skill", skill.name, `from ${skill.source}${local ? " (local)" : ""}`);
    return true;
  }
  const mcp = catalog.mcp_servers.find((s) => s.name === name);
  if (mcp) {
    showMcpDryRun(mcp);
    return true;
  }
  const rule = catalog.rules.find((r) => r.name === name);
  if (rule) {
    showSimpleDryRun("rule", rule.name);
    return true;
  }
  const cli = (catalog.cli_tools ?? []).find((t) => t.name === name);
  if (cli) {
    showSimpleDryRun("CLI tool", cli.name);
    return true;
  }
  return false;
}

async function installFromCatalog(
  state: NonNullable<ReturnType<typeof requireState>>,
  catalog: ReturnType<typeof loadCatalog>,
  name: string,
  dryRun: boolean,
  local?: string,
): Promise<void> {
  if (dryRun && showCatalogDryRun(catalog, name, local)) return;

  const skill = catalog.skills.find((s) => s.name === name);
  if (skill) {
    warnIfDeprecated(name, "skill", skill);
    await installSkill(skill, installSummary, local);
    return;
  }
  const mcpServer = catalog.mcp_servers.find((s) => s.name === name);
  if (mcpServer) {
    warnIfDeprecated(name, "MCP server", mcpServer);
    await installMcpServer(mcpServer);
    return;
  }
  const rule = catalog.rules.find((r) => r.name === name);
  if (rule) {
    warnIfDeprecated(name, "rule", rule);
    installRule(rule);
    return;
  }
  const cliTool = (catalog.cli_tools ?? []).find((t) => t.name === name);
  if (cliTool) {
    warnIfDeprecated(name, "CLI tool", cliTool);
    await installCliTool(cliTool);
    return;
  }
  await searchAndInstallFromSources(state, catalog, name);
}

export async function install(
  name?: string,
  options?: { recommended?: boolean; yes?: boolean; from?: string; dryRun?: boolean; local?: string },
): Promise<void> {
  resetInstallSummary();
  const state = requireState();
  if (!state) return;

  const catalog = loadCatalog();

  if (options?.recommended) {
    await installRecommended(catalog, options.dryRun ?? false);
    return;
  }

  if (!name) {
    showPopularItems(catalog);
    return;
  }

  if (options?.from) {
    await installFromSpecificSource(state, name, options.from);
    flushInstallSummary();
    return;
  }

  await installFromCatalog(state, catalog, name, options?.dryRun ?? false, options?.local);
  flushInstallSummary();
}

/** Install multiple catalog skills with one summary flush (used by Agentfile sync). */
export async function installSkills(names: readonly string[]): Promise<void> {
  if (names.length === 0) return;
  resetInstallSummary();
  const state = requireState();
  if (!state) return;
  const catalog = loadCatalog();
  for (const name of names) {
    await installFromCatalog(state, catalog, name, false);
  }
}

export function findInAllSources(
  state: { sources?: Source[] },
  name: string,
): Array<{ source: Source; item: { name: string; description: string } }> {
  const matches: Array<{ source: Source; item: { name: string; description: string } }> = [];
  for (const source of state.sources ?? []) {
    const item = (source.availableItems ?? []).find((i) => i.name === name);
    if (item) matches.push({ source, item });
  }
  return matches;
}

/** True when an MCP server from the catalog is already registered in state. */
function isMcpServerRegistered(server: CatalogMcpServer): boolean {
  const state = loadState();
  return Boolean(state?.mcpServers?.some((s) => s.name === server.name));
}

/** True when a catalog rule's marker already lives in shared-rules.md. */
function isRuleInSharedRules(rule: CatalogRule): boolean {
  const existing = loadSharedRules();
  if (existing === undefined) return false;
  return existing.includes(`<!-- rule: ${rule.name} -->`);
}

/** True when every `.md` file the CLI tool ships already exists in the commands dir. */
function areCliToolCommandsInstalled(tool: CatalogCliTool): boolean {
  const commandsDir = expandHome(COMMANDS_DIR);
  return tool.commands.every((cmd) => {
    const filename = cmd.endsWith(".md") ? cmd : `${cmd}.md`;
    return existsSync(join(commandsDir, filename));
  });
}

interface RecommendedItems {
  skills: CatalogSkill[];
  mcp: CatalogMcpServer[];
  rules: CatalogRule[];
  cliTools: CatalogCliTool[];
}

/** Partition recommended items by pending vs. already-installed so each section can be suppressed independently on a no-op sync. */
interface PendingRecommended {
  skills: CatalogSkill[];
  mcp: CatalogMcpServer[];
  rules: CatalogRule[];
  cliTools: CatalogCliTool[];
  total: number;
}

function computePendingRecommended(items: RecommendedItems): PendingRecommended {
  const skills = items.skills.filter((s) => !isAlreadyInstalled(s));
  const declined = new Set(loadState()?.declinedMcpServers ?? []);
  const mcp = items.mcp.filter((s) => !declined.has(s.name) && !isMcpServerRegistered(s));
  const rules = items.rules.filter((r) => !isRuleInSharedRules(r));
  const cliTools = items.cliTools.filter((t) => !areCliToolCommandsInstalled(t));
  return {
    skills,
    mcp,
    rules,
    cliTools,
    total: skills.length + mcp.length + rules.length + cliTools.length,
  };
}

/** Print the per-rule status line for a recommended rule after attempting to add it. */
function logRuleStatus(rule: CatalogRule, status: ReturnType<typeof addRuleToSharedRules>): void {
  if (status === "added") {
    console.log(`  ${ICON_SUCCESS} ${rule.name} — added to shared-rules.md`);
  } else if (status === "already-present") {
    // Disambiguate from the drift "rules — managed section out of date"
    // message: this status is about the snippet being in the
    // source-of-truth `shared-rules.md`, not about agent-side deployed
    // copies (`~/.claude/CLAUDE.md`, `~/.cursor/rules/`, …) which are
    // tracked by `checkRulesDrift` under the `[rules]` drift type.
    console.log(`  ${ICON_SUCCESS} ${rule.name} — already in shared-rules.md`);
  } else {
    console.log(`  ${ICON_INFO} ${rule.name} — skipped (no shared-rules.md)`);
  }
}

function logPendingRecommended(pending: PendingRecommended): void {
  console.log(chalk.bold("\nInstalling recommended items:\n"));
  if (pending.skills.length > 0) console.log(`  Skills: ${pending.skills.map((s) => s.name).join(", ")}`);
  if (pending.mcp.length > 0) console.log(`  MCP servers: ${pending.mcp.map((s) => s.name).join(", ")}`);
  if (pending.rules.length > 0) console.log(`  Rules: ${pending.rules.map((r) => r.name).join(", ")}`);
  if (pending.cliTools.length > 0) console.log(`  CLI tools: ${pending.cliTools.map((t) => t.name).join(", ")}`);
  console.log();
}

async function installPendingRecommended(items: RecommendedItems, pending: PendingRecommended): Promise<void> {
  for (const skill of items.skills) await installSkill(skill, installSummary);
  for (const server of pending.mcp) await installMcpServer(server);
  for (const tool of pending.cliTools) await installCliTool(tool);

  if (pending.rules.length > 0) {
    console.log(chalk.bold("\nRules\n"));
    for (const rule of pending.rules) logRuleStatus(rule, addRuleToSharedRules(rule));
  }
}

function refreshRecommendedRules(catalog: Catalog): void {
  const { refreshed } = refreshRecommendedCatalogRules(catalog.rules);
  if (refreshed.length > 0) {
    console.log(
      chalk.dim(`\n  Refreshed ${refreshed.length} catalog rule(s) from catalog.yaml: ${refreshed.join(", ")}\n`),
    );
  }
}

async function installRecommended(catalog: Catalog, dryRun = false): Promise<void> {
  const items: RecommendedItems = {
    skills: catalog.skills.filter((s) => s.recommended),
    mcp: catalog.mcp_servers.filter((s) => s.recommended),
    rules: catalog.rules.filter((r) => r.recommended),
    cliTools: (catalog.cli_tools ?? []).filter((t) => t.recommended),
  };

  if (!dryRun) refreshRecommendedRules(catalog);

  // Issue 2 of `sync-idempotent-and-complete`: quiet no-op on a
  // fully-synced system. Header, per-category listing, each installer
  // call, the rules section, and the "✓ Recommended setup complete"
  // footer are each suppressed when the matching category has zero
  // pending items. When EVERY category has zero pending, `installRecommended`
  // prints nothing. This keeps `agentbrew sync` silent when nothing changed
  // while preserving the full verbose output on a first install.
  const pending = computePendingRecommended(items);
  if (pending.total === 0) return;

  logPendingRecommended(pending);
  if (dryRun) {
    console.log(chalk.bold("Dry run — no changes made.\n"));
    return;
  }

  // Skills go through installSkill even when "already installed" (it has
  // its own quiet-skip path via installSummary) — pass the full list so
  // the summary-line message ("N skills already installed") still fires.
  // MCP / CLI tools / rules only get invoked for pending entries because
  // the underlying installers are unconditionally chatty when called.
  await installPendingRecommended(items, pending);

  flushInstallSummary();
  console.log(chalk.bold("\n✓ Recommended setup complete.\n"));
}
