import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import chalk from "chalk";
import { AGENTFILE_NAMES, getConfigServers, getStateServers, getStateSources } from "./agentfile.js";
import { checkCliBuildDrift } from "./cli-build-health.js";
import { checkEnvHygiene } from "./core/env-sanitize.js";
import { loadSyncErrors } from "./core/errors.js";
import { logSkipped } from "./core/logger.js";
import { checkMcpEnvVarsDrift } from "./drift.js";
import { validateConfig } from "./lint.js";
import { loadMcpHealthSnapshot, unhealthyMcpEntries } from "./mcp/health-snapshot.js";
import { COMMANDS_DIR } from "./paths.js";
import { getStatePath, requireState } from "./state.js";
import { type AutoRepairDescription, describeAutoRepair, probeAutoRepairHealth } from "./sync/auto-repair-health.js";
import { isInstructionsUpToDate, loadInstructions } from "./sync/instructions-sync.js";
import { resolveTargetModel } from "./sync/model-sync.js";
import { collectSkills, getSkillSources } from "./sync/skills-sync.js";
import { isAgentbrewProvidedSkillSource } from "./sync/soft-update.js";
import type { Source } from "./types.js";
import { AGENT_DEFINITIONS } from "./types.js";
import { ICON_ERROR, ICON_SUCCESS, ICON_WARNING } from "./ui/output.js";
import { expandHome, formatAge } from "./utils.js";

/** Find the Agentfile path in a directory, or undefined if none exists. */
function findAgentfile(directory: string): string | undefined {
  for (const name of AGENTFILE_NAMES) {
    const path = join(directory, name);
    if (existsSync(path)) return path;
  }
  return undefined;
}

export function getSourcesFreshness(sources: Source[]): string | undefined {
  const indexed = sources.filter((s) => s.indexedAt);
  if (indexed.length === 0) return sources.length > 0 ? "never fetched" : undefined;

  const latest = Math.max(...indexed.map((s) => new Date(s.indexedAt ?? "").getTime()));
  const latestIso = new Date(latest).toISOString();
  const age = formatAge(latestIso);
  return age === "just now" ? "fetched just now" : `fetched ${age}`;
}

interface StatusData {
  agents: Array<{ name: string; detected: boolean }>;
  mcpServers: Array<{ name: string; source: string }>;
  sources: Array<{ url: string; type: string; installed: number; available: number; origin?: string }>;
  skills: Array<{ source: string; names: string[] }>;
  commands: { count: number; deployedTo: number; totalTargets: number };
  instructions: { targets: number; upToDate: number; outOfDate: number; notDeployed: number } | undefined;
  syncErrors: Array<{ module?: string; message: string }> | undefined;
  mcpHealth: { failing: number; generatedAt?: string } | undefined;
  statePath: string;
}

// ── Shared helpers (private) ─────────────────────────────────────────────────

type AgentbrewState = NonNullable<ReturnType<typeof requireState>>;

function toneColor(tone: AutoRepairDescription["tone"]): (text: string) => string {
  if (tone === "ok") return chalk.green;
  return tone === "error" ? chalk.red : chalk.yellow;
}

function formatPreview(names: string[]): string {
  if (names.length <= 6) return names.join(", ");
  return `${names.slice(0, 5).join(", ")} +${names.length - 5} more`;
}

function computeInstructionsStatus(): StatusData["instructions"] {
  const content = loadInstructions();
  if (!content) return undefined;
  const targets = AGENT_DEFINITIONS.filter((a) => a.rulesFile !== undefined);
  let upToDate = 0;
  let outOfDate = 0;
  let notDeployed = 0;
  for (const agent of targets) {
    const targetPath = expandHome(agent.rulesFile ?? "");
    if (!existsSync(targetPath)) {
      notDeployed++;
      continue;
    }
    try {
      const deployed = readFileSync(targetPath, "utf-8");
      // Use isInstructionsUpToDate so user-content + managed rules sections + heading deduplication
      // don't produce false-positive drift. Raw `deployed === content` is never true for deployed
      // files (which wrap the template in markers and append a managed rules block).
      if (isInstructionsUpToDate(deployed, content)) upToDate++;
      else outOfDate++;
    } catch (e) {
      logSkipped("status/readFileSync", e);
      notDeployed++;
    }
  }
  return { targets: targets.length, upToDate, outOfDate, notDeployed };
}

function collectSkillsData(): StatusData["skills"] {
  const skills: StatusData["skills"] = [];
  try {
    const skillSources = getSkillSources();
    for (const source of skillSources) {
      const found = source.scanner(source.path);
      if (found.length > 0) {
        skills.push({ source: source.label, names: found.map((s) => basename(s)).sort() });
      }
    }
  } catch (e) {
    logSkipped("status/push", e);
    /* unavailable */
  }
  return skills;
}

function collectCommandsInfo(): StatusData["commands"] {
  try {
    const commandsDir = expandHome(COMMANDS_DIR);
    if (!existsSync(commandsDir)) return { count: 0, deployedTo: 0, totalTargets: 0 };
    const commandFiles = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
    const targets = AGENT_DEFINITIONS.filter((a) => a.commandsDir !== undefined);
    const deployedCount = targets.filter((a) => existsSync(expandHome(a.commandsDir ?? ""))).length;
    return { count: commandFiles.length, deployedTo: deployedCount, totalTargets: targets.length };
  } catch (e) {
    logSkipped("status/filter", e);
    return { count: 0, deployedTo: 0, totalTargets: 0 };
  }
}

/**
 * Count unique skills across all known sources, deduplicated by skill name
 * (first source wins) — same model `agentbrew sync` uses when it prints
 * `Deployed N skills to M targets`. Returns the canonical numbers all
 * status / sync / install-plan call sites must agree on:
 *
 *   - `unique` — distinct skill names available across sources. This is the
 *     value sync prints as "N skills" in its summary line.
 *   - `sources` — number of sources that contributed at least one unique
 *     skill (matches the count of entries in sync's per-source breakdown).
 *   - `localCount` — project-local skills under `.agentbrew/skills/`,
 *     surfaced as a `+ N local` suffix.
 *
 * Two definitions are deliberately NOT exposed here because they cause the
 * 152-vs-125 / 9-vs-8 confusion the user reported:
 *   - "raw scanner sum" (would re-double-count duplicates across sources)
 *   - "sources tracked in state" (includes sources with zero skills)
 *
 * Both legitimate metrics live elsewhere — `getStateSources(state).length`
 * for tracked-source count, and the verbose `agentbrew status --verbose`
 * output for per-source breakdown.
 */
function countDeployedSkills(): { unique: number; sources: number; localCount: number } {
  try {
    const skillSources = getSkillSources();
    const scannedSources = skillSources.map((s) => ({
      label: s.label,
      skillPaths: s.scanner(s.path),
    }));
    const { skills, bySource } = collectSkills(scannedSources);
    const unique = skills.size;
    const sources = Object.keys(bySource).length;
    // Count project-local skills from .agentbrew/skills/
    let localCount = 0;
    const projectSkillsDir = join(process.cwd(), ".agentbrew", "skills");
    if (existsSync(projectSkillsDir)) {
      const entries = readdirSync(projectSkillsDir, { withFileTypes: true });
      localCount = entries.filter((e) => e.isDirectory()).length;
    }
    return { unique, sources, localCount };
  } catch (e) {
    logSkipped("status/filter", e);
    return { unique: 0, sources: 0, localCount: 0 };
  }
}

function getCommandFileCount(): number | undefined {
  try {
    const commandsDir = expandHome(COMMANDS_DIR);
    if (!existsSync(commandsDir)) return undefined;
    return readdirSync(commandsDir).filter((f) => f.endsWith(".md")).length;
  } catch (e) {
    logSkipped("status/readdirSync", e);
    return undefined;
  }
}

function printCompactConfigLine(): void {
  try {
    const validation = validateConfig();
    if (validation.errors > 0) {
      console.log(
        `  Config:       ${chalk.red(`${validation.errors} error(s)`)} ${chalk.dim("— run `agentbrew lint`")}`,
      );
    } else {
      console.log(`  Config:       ${chalk.green("valid")}`);
    }
  } catch (e) {
    logSkipped("status/log", e);
    /* lint unavailable */
  }
}

function printAgentfileLines(prefix: string): void {
  const globalDir = expandHome("~/.config/agentbrew");
  const globalAgentfile = findAgentfile(globalDir);
  const projectAgentfile = findAgentfile(process.cwd());
  if (globalAgentfile) {
    console.log(chalk.dim(`\n${prefix}Agentfile: ${globalAgentfile} (global)`));
  }
  if (projectAgentfile) {
    console.log(chalk.dim(`${prefix}Project:   ${projectAgentfile}`));
  } else {
    console.log(chalk.dim(`${prefix}Project:   no Agentfile — ask your agent to create one (agentfile-init skill)`));
  }
}

// ── Verbose display helpers (private) ────────────────────────────────────────

/** Agents that are detected (home dir exists) but whose MCP config file is missing. */
function getUnconfiguredAgents(state: AgentbrewState): Array<{ name: string; mcpConfig: string }> {
  const detectedNames = new Set(state.agents.filter((a) => a.detected).map((a) => a.name));
  return AGENT_DEFINITIONS.filter((def) => {
    if (!def.mcpConfig || !detectedNames.has(def.name)) return false;
    return !existsSync(expandHome(def.mcpConfig));
  }).map((def) => ({ name: def.name, mcpConfig: def.mcpConfig ?? "" }));
}

function printVerboseAgentsSection(state: AgentbrewState): void {
  const detectedAgents = state.agents.filter((a) => a.detected);
  const experimentalNames = new Set(AGENT_DEFINITIONS.filter((a) => a.experimental).map((a) => a.name));
  const stableCount = detectedAgents.filter((a) => !experimentalNames.has(a.name)).length;
  const experimentalCount = detectedAgents.length - stableCount;
  const countParts = [`${stableCount} stable`];
  if (experimentalCount > 0) countParts.push(`${experimentalCount} experimental`);

  console.log(`${chalk.bold("\nAgents")} (${detectedAgents.length} detected — ${countParts.join(", ")})\n`);
  for (const agent of state.agents) {
    if (agent.detected) {
      const badge = experimentalNames.has(agent.name) ? chalk.dim(" (experimental)") : "";
      console.log(`  ${ICON_SUCCESS} ${agent.name}${badge}`);
    }
  }

  const unconfigured = getUnconfiguredAgents(state);
  if (unconfigured.length > 0) {
    console.log(chalk.bold(`\n  Needs setup (${unconfigured.length}):\n`));
    for (const agent of unconfigured) {
      console.log(`  ${ICON_WARNING} ${agent.name} — open the app once to create ${agent.mcpConfig}, then re-sync`);
    }
  }
}

function printVerboseModelSection(state: AgentbrewState): void {
  if (!state.defaultModel) return;
  console.log(`${chalk.bold("\nDefault Model")} (${state.defaultModel})\n`);
  const detectedNames = new Set(state.agents.filter((a) => a.detected).map((a) => a.name));
  for (const def of AGENT_DEFINITIONS) {
    if (!def.modelConfig || !detectedNames.has(def.name)) continue;
    const effective = resolveTargetModel(def.name, state.defaultModel, state.modelOverrides);
    if (effective === undefined) {
      console.log(`  ${def.name} — ${chalk.dim("skipped (override: keep agent's own model)")}`);
    } else {
      console.log(`  ${def.name} — ${chalk.green(effective)} ${chalk.dim(`(${def.modelConfig.file})`)}`);
    }
  }
}

function printVerboseServersSection(state: AgentbrewState): void {
  const servers = getStateServers(state);
  console.log(`${chalk.bold("\nMCP Servers")} (${servers.length})\n`);
  if (servers.length > 0) {
    for (const server of servers) {
      const age = server.addedAt ? chalk.dim(` — added ${formatAge(server.addedAt)}`) : "";
      console.log(`  ${chalk.cyan(server.name)} — ${server.source}${age}`);
    }
  } else {
    console.log("  (none)");
  }
}

function printMcpHealthSummary(prefix: string): void {
  const snapshot = loadMcpHealthSnapshot();
  const unhealthy = unhealthyMcpEntries(snapshot);
  if (unhealthy.length === 0) return;
  const preview = unhealthy
    .slice(0, 3)
    .map((entry) => `${entry.name}/${entry.agent}`)
    .join(", ");
  const suffix = unhealthy.length > 3 ? `, +${unhealthy.length - 3}` : "";
  const oldestUnhealthyAt = unhealthy
    .map((entry) => entry.lastOkAt ?? entry.lastCheckedAt)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort()[0];
  const unhealthyFor = oldestUnhealthyAt ? ` unhealthy for ${formatAge(oldestUnhealthyAt).replace(/ ago$/, "")}` : "";
  console.log(
    `${prefix}MCP Health:   ${chalk.red(`${unhealthy.length} failing`)} ${chalk.dim(`${preview}${suffix}${unhealthyFor} — run \`agentbrew mcp probe --deep\``)}`,
  );
}

function printCliBuildSummary(prefix: string): void {
  for (const item of checkCliBuildDrift()) {
    console.log(`${prefix}CLI build:    ${chalk.red("stale")} ${chalk.dim(item.detail)}`);
  }
}

function sourceOriginLabel(origin?: string): string {
  if (origin === "agentfile") return chalk.magenta(" [agentfile]");
  if (origin === "global") return chalk.magenta(" [global]");
  if (origin === "catalog") return chalk.magenta(" [catalog]");
  if (typeof origin === "string" && origin.startsWith("team:")) return chalk.magenta(` [${origin}]`);
  return "";
}

function sourceManagedLabel(source: { type: string; origin?: string }): string {
  if (isAgentbrewProvidedSkillSource(source as Source)) {
    return chalk.dim(" — agentbrew-managed, always-fresh on sync");
  }
  if (source.type === "github" || source.type === "url") {
    return chalk.dim(" — remote (refresh on `agentbrew sync --pull`)");
  }
  return "";
}

/** Format a single source entry for verbose display. */
function formatSourceEntry(source: {
  url: string;
  type: string;
  availableItems?: Array<{ name: string }>;
  skillsInstalled: string[];
  origin?: string;
}): string {
  const available = source.availableItems?.length ?? 0;
  const installed = source.skillsInstalled.length;
  const counts = available > 0 ? `${installed}/${available} installed` : `${installed} skills`;
  return `  ${source.url} (${counts})${sourceManagedLabel(source)}${sourceOriginLabel(source.origin)}`;
}

function printVerboseSourcesSection(state: AgentbrewState): void {
  const stateSources = getStateSources(state);
  const freshness = getSourcesFreshness(stateSources);
  console.log(`${chalk.bold("\nSources")} (${stateSources.length})${freshness ? chalk.dim(` — ${freshness}`) : ""}\n`);
  if (stateSources.length > 0) {
    for (const source of stateSources) {
      console.log(formatSourceEntry(source));
    }
  } else {
    console.log("  (none)");
  }
}

function printVerboseSkillsSection(): void {
  let skillSources: ReturnType<typeof getSkillSources>;
  try {
    skillSources = getSkillSources();
  } catch (e) {
    logSkipped("status/getSkillSources", e);
    return;
  }
  let totalSkills = 0;
  const sourceBreakdown: string[] = [];
  for (const source of skillSources) {
    const skills = source.scanner(source.path);
    if (skills.length > 0) {
      totalSkills += skills.length;
      sourceBreakdown.push(`${skills.length} from ${source.label}`);
    }
  }
  console.log(
    `${chalk.bold("\nSkills")} (${totalSkills})${sourceBreakdown.length > 0 ? chalk.dim(` — ${sourceBreakdown.join(", ")}`) : ""}\n`,
  );
  if (totalSkills === 0) {
    console.log("  (none)");
    return;
  }
  for (const source of skillSources) {
    const skills = source.scanner(source.path);
    if (skills.length === 0) continue;
    const names = skills.map((s) => basename(s)).sort();
    console.log(`  ${source.label}: ${chalk.dim(formatPreview(names))}`);
  }
}

function printVerboseCommandsSection(): void {
  try {
    const commandsDir = expandHome(COMMANDS_DIR);
    if (!existsSync(commandsDir)) return;
    const commandFiles = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
    const targets = AGENT_DEFINITIONS.filter((a) => a.commandsDir !== undefined);
    const deployedCount = targets.filter((a) => existsSync(expandHome(a.commandsDir ?? ""))).length;
    console.log(
      `${chalk.bold("\nCommands")} (${commandFiles.length})${chalk.dim(` — deployed to ${deployedCount}/${targets.length} agents`)}\n`,
    );
    if (commandFiles.length > 0) {
      const names = commandFiles.map((f) => basename(f, ".md")).sort();
      console.log(`  ${chalk.dim(formatPreview(names))}`);
    } else {
      console.log("  (none)");
    }
  } catch (e) {
    logSkipped("status/log", e);
    // commands scan unavailable
  }
}

function printVerboseInstructionsSection(): void {
  try {
    const instructionsStatus = computeInstructionsStatus();
    if (!instructionsStatus) return;
    const parts: string[] = [];
    if (instructionsStatus.upToDate > 0) parts.push(chalk.green(`${instructionsStatus.upToDate} up to date`));
    if (instructionsStatus.outOfDate > 0)
      parts.push(chalk.yellow(`${instructionsStatus.outOfDate} out of date — run \`agentbrew sync\``));
    if (instructionsStatus.notDeployed > 0) parts.push(chalk.dim(`${instructionsStatus.notDeployed} not deployed`));
    console.log(
      `${chalk.bold("\nInstructions")} (${instructionsStatus.targets} targets)${parts.length > 0 ? ` — ${parts.join(", ")}` : ""}\n`,
    );
  } catch (e) {
    logSkipped("status/bold", e);
    // instructions scan unavailable
  }
}

function printVerboseSyncSection(): void {
  const errorLog = loadSyncErrors();
  if (!errorLog) return;
  if (errorLog.errors.length > 0) {
    console.log(chalk.bold.red("\nSync Errors") + chalk.dim(` (last sync: ${formatAge(errorLog.lastSyncAt)})\n`));
    for (const entry of errorLog.errors.slice(0, 10)) {
      const module = entry.module ? chalk.dim(`[${entry.module}] `) : "";
      console.error(`  ${ICON_ERROR} ${module}${entry.message}`);
    }
    if (errorLog.errors.length > 10) {
      console.log(chalk.dim(`  ... and ${errorLog.errors.length - 10} more`));
    }
    console.log(chalk.dim(`\n  Run ${chalk.white("agentbrew sync")} to retry.\n`));
  } else {
    console.log(
      chalk.bold("\nLast Sync") + chalk.dim(` — ${formatAge(errorLog.lastSyncAt)}`) + chalk.green(" ✓ no errors"),
    );
  }
}

export function collectStatusData(): StatusData | undefined {
  const state = requireState();
  if (!state) return undefined;

  const agents = state.agents.map((a) => ({ name: a.name, detected: !!a.detected }));
  const mcpServers = getStateServers(state).map((s) => ({ name: s.name, source: s.source }));
  const sources = getStateSources(state).map((s) => ({
    url: s.url,
    type: s.type,
    installed: s.skillsInstalled.length,
    available: s.availableItems?.length ?? 0,
    origin: s.origin,
  }));

  const skills = collectSkillsData();
  const commands = collectCommandsInfo();

  let instructions: StatusData["instructions"];
  try {
    instructions = computeInstructionsStatus();
  } catch (e) {
    logSkipped("status/computeInstructionsStatus", e);
    /* unavailable */
  }

  let syncErrors: StatusData["syncErrors"];
  const errorLog = loadSyncErrors();
  if (errorLog && errorLog.errors.length > 0) {
    syncErrors = errorLog.errors.map((e) => ({ module: e.module, message: e.message }));
  }
  const snapshot = loadMcpHealthSnapshot();
  const unhealthy = unhealthyMcpEntries(snapshot);

  return {
    agents,
    mcpServers,
    sources,
    skills,
    commands,
    instructions,
    syncErrors,
    mcpHealth: snapshot ? { failing: unhealthy.length, generatedAt: snapshot.generatedAt } : undefined,
    statePath: getStatePath(),
  };
}

/** Print the compact default-model line when the Agentfile manages one. */
function printCompactModelLine(state: NonNullable<ReturnType<typeof requireState>>): void {
  if (!state.defaultModel) return;
  const overrideCount = Object.keys(state.modelOverrides ?? {}).length;
  const overrideNote = overrideCount > 0 ? chalk.dim(` (${overrideCount} per-agent override(s))`) : "";
  console.log(`  Model:        ${chalk.green(state.defaultModel)} default${overrideNote}`);
}

/** Print MCP readiness line — shows how many servers need env var setup. */
function printMcpReadiness(): void {
  const envDrift = checkMcpEnvVarsDrift();
  if (envDrift.length === 0) return;
  const total = getConfigServers().length;
  const ready = total - envDrift.length;
  console.log(
    `  MCP Ready:    ${ready}/${total} ${chalk.yellow(`(${envDrift.length} need setup)`)} ${chalk.dim("— run `agentbrew setup`")}`,
  );
}

export async function status(options?: { json?: boolean; verbose?: boolean }): Promise<void> {
  if (options?.json) {
    const data = collectStatusData();
    if (data) console.log(JSON.stringify(data, null, 2));
    return;
  }

  const state = requireState();
  if (!state) return;

  if (options?.verbose) {
    await statusVerbose(state);
    return;
  }

  // Compact status (default): fits on one screen
  const detectedAgents = state.agents.filter((a) => a.detected);
  const agentNames = detectedAgents
    .slice(0, 3)
    .map((a) => a.name)
    .join(", ");
  const agentExtra = detectedAgents.length > 3 ? `, +${detectedAgents.length - 3}` : "";

  console.log(chalk.bold("\nagentbrew status\n"));
  console.log(`  Agents:       ${chalk.green(String(detectedAgents.length))} detected (${agentNames}${agentExtra})`);

  const unconfigured = getUnconfiguredAgents(state);
  if (unconfigured.length > 0) {
    const names = unconfigured.map((a) => a.name).join(", ");
    console.log(
      `  Needs setup:  ${chalk.yellow(String(unconfigured.length))} ${chalk.dim(`(${names}) — open the app once, then re-sync`)}`,
    );
  }

  printCompactModelLine(state);

  console.log(`  MCP Servers:  ${chalk.green(String(getConfigServers().length))} registered`);
  printMcpReadiness();
  printMcpHealthSummary("  ");
  printCliBuildSummary("  ");

  const { unique: uniqueSkills, sources: sourceCount, localCount } = countDeployedSkills();
  const localSuffix = localCount > 0 ? `, ${localCount} local` : "";
  // "in library" (not "deployed from") because this counts unique skill names
  // across sources, not symlinks placed in agent dirs. The per-agent deploy
  // counts are surfaced by `agentbrew sync`'s summary line — this same number
  // is what sync prints, so the two displays now agree on a single quantity.
  // See `countDeployedSkills`'s JSDoc for the canonical definitions.
  console.log(
    `  Skills:       ${chalk.green(String(uniqueSkills))} in library across ${sourceCount} sources${localSuffix}`,
  );

  const commandCount = getCommandFileCount();
  if (commandCount !== undefined) {
    console.log(`  Commands:     ${chalk.green(String(commandCount))} deployed`);
  }

  const freshness = getSourcesFreshness(getStateSources(state));
  console.log(
    `  Sources:      ${getStateSources(state).length} tracked${freshness ? chalk.dim(` (${freshness})`) : ""}`,
  );

  // Sync errors. Note: this line reports ONLY whether the last `agentbrew
  // sync` invocation completed without errors — it does NOT imply zero drift.
  // The compact label used to say "clean" which led users to read "no
  // problems" while the Drift line on the same screen showed N issues.
  // "no errors" mirrors the verbose-mode label and matches what's actually
  // being checked. (Sub-issue 1 of `sync-idempotent-and-complete` —
  // disambiguates "the sync command ran successfully" from "the deployed
  // state matches the declared state".)
  const errorLog = loadSyncErrors();
  if (errorLog?.errors.length) {
    console.log(
      `  Last Sync:    ${chalk.red(`${errorLog.errors.length} error(s)`)} ${chalk.dim(`(${formatAge(errorLog.lastSyncAt)}) — run \`agentbrew sync\` to retry`)}`,
    );
  } else if (errorLog) {
    console.log(`  Last Sync:    ${chalk.green("no errors")} ${chalk.dim(`(${formatAge(errorLog.lastSyncAt)})`)}`);
  }

  // Config validation summary
  printCompactConfigLine();

  const autoRepair = describeAutoRepair(probeAutoRepairHealth());
  const autoRepairDetail = autoRepair.tone === "ok" ? `(${autoRepair.detail})` : `— ${autoRepair.detail}`;
  console.log(`  Auto-repair:  ${toneColor(autoRepair.tone)(autoRepair.summary)} ${chalk.dim(autoRepairDetail)}`);

  // Env hygiene
  const envWarnings = checkEnvHygiene();
  if (envWarnings.length > 0) {
    const varNames = envWarnings.map((w) => w.variable).join(", ");
    console.log(
      `  Env:          ${chalk.yellow(`${envWarnings.length} var(s) may leak`)} ${chalk.dim(`(${varNames})`)}`,
    );
  }

  // Agentfile context
  printAgentfileLines("  ");
  console.log(chalk.dim("  Run `agentbrew status --verbose` for full details.\n"));
}

async function statusVerbose(state: NonNullable<ReturnType<typeof requireState>>): Promise<void> {
  printVerboseAgentsSection(state);
  printVerboseModelSection(state);
  printVerboseServersSection(state);
  printMcpHealthSummary("  ");
  printCliBuildSummary("  ");
  printVerboseSourcesSection(state);
  printVerboseSkillsSection();
  printVerboseCommandsSection();
  printVerboseInstructionsSection();
  printVerboseSyncSection();

  const autoRepair = describeAutoRepair(probeAutoRepairHealth());
  const mark = autoRepair.tone === "ok" ? "✓" : "✗";
  console.log(
    chalk.bold("\nDrift Repair") +
      toneColor(autoRepair.tone)(` ${mark} ${autoRepair.summary}`) +
      chalk.dim(` — ${autoRepair.detail}`),
  );

  // Agentfile context
  printAgentfileLines("");
  console.log();
}
