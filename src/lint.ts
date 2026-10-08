import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";
import {
  type AgentBloatFinding,
  collectAgentBloatFindings,
  lintCommandBloat,
  lintMdcBloat,
  summarizeAgentBloat,
} from "./agent-bloat-lint.js";
import { AGENTFILE_NAMES, getStateServers, getStateSources, loadAgentfile, validateAgentfileMcp } from "./agentfile.js";
import { errorMessage } from "./core/errors.js";
import { logSkipped } from "./core/logger.js";
import { MCP_INTERSECTION_AGENTS } from "./core/mcp-agent-map.js";
import { detectSecretsInServers } from "./core/secret-detector.js";
import { getAdapter } from "./mcp/adapters.js";
import { sweepCatalogPins } from "./mcp/catalog-pin-sweep.js";
import { sweepPlaywrightIsolated } from "./mcp/playwright-isolated-sweep.js";
import { sweepMcpConfigs } from "./mcp/resilient-sweep.js";
import { collectCursorMdcInventory } from "./measure/cursor-mdc-inventory.js";
import { COMMANDS_DIR, SHARED_RULES_PATH } from "./paths.js";
import {
  DEPLOYED_RULES_FILE_CHAR_BUDGET,
  findSharedRulesBloat,
  projectedDeployedRulesSize,
  SHARED_RULES_GROWTH_CHAR_THRESHOLD,
  type SharedRulesBloatFinding,
  sectionTokenBudgetForHeading,
  stripManagedSharedRulesBlocks,
} from "./rules-hygiene.js";
import { getStatePath, loadState } from "./state.js";
import {
  compressSkillsListing,
  DEFAULT_TOKEN_WARNING_THRESHOLD,
  estimateTokens,
  measureSections,
  stripCursorRulesSection,
} from "./sync/instructions-content.js";
import { getInstructionsSourcePath } from "./sync/instructions-sync.js";
import { getSkillSources } from "./sync/skills-sync.js";
import { AGENT_DEFINITIONS } from "./types.js";
import { ICON_ERROR, ICON_INFO, ICON_SUCCESS, ICON_WARNING } from "./ui/output.js";
import { expandHome } from "./utils.js";

const AGENTFILE_KNOWN_KEYS = new Set([
  "mcp",
  "skills",
  "sources",
  "commands",
  "agents",
  "rules",
  "hooks",
  "recommended",
  "excludeAgents",
  "defaultModel",
  "defaultEffort",
  "modelOverrides",
  "task_backend",
  "repo",
  "project",
]);

function findUnknownAgentfileKeys(raw: Record<string, unknown> | undefined): string[] {
  return raw ? Object.keys(raw).filter((key) => !AGENTFILE_KNOWN_KEYS.has(key)) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function catalogYamlPath(): string {
  const agentBrewDir = process.env.AGENTBREW_DIR ?? resolve(join(import.meta.dirname, ".."));
  return join(agentBrewDir, "src", "catalog.yaml");
}

function printSharedRulesBloatFinding(finding: SharedRulesBloatFinding): void {
  if (finding.kind === "duplicate-heading") {
    console.error(
      `  ${ICON_ERROR} shared-rules.md — duplicate ## heading "${finding.heading}" at lines ${finding.lines.join(", ")}; merge into line ${finding.lines[0]}`,
    );
    return;
  }
  if (finding.kind === "repeated-subsection") {
    console.error(
      `  ${ICON_ERROR} shared-rules.md — repeated subsection marker "${finding.marker}" in "${finding.section}" at lines ${finding.lines.join(", ")}; merge into line ${finding.lines[0]}`,
    );
    return;
  }
  const budget = sectionTokenBudgetForHeading(finding.heading);
  console.error(
    `  ${ICON_ERROR} shared-rules.md — section over token budget "${finding.heading}" at line ${finding.line}: ${finding.tokens} tokens > ${budget}`,
  );
}

/** Validate AGENTS.md exists. */
function lintAgentsMd(): { errors: number } {
  const agentsMdPath = getInstructionsSourcePath();
  if (existsSync(agentsMdPath)) {
    console.log(`  ${ICON_SUCCESS} AGENTS.md`);
    return { errors: 0 };
  }
  console.error(`  ${ICON_ERROR} AGENTS.md — not found at ${agentsMdPath}`);
  return { errors: 1 };
}

/** Validate catalog.yaml is valid YAML. */
function lintCatalogYaml(): { errors: number } {
  const catalogPath = catalogYamlPath();
  if (!existsSync(catalogPath)) return { errors: 0 };
  try {
    const content = readFileSync(catalogPath, "utf-8");
    yaml.load(content);
    console.log(`  ${ICON_SUCCESS} src/catalog.yaml`);
    return { errors: 0 };
  } catch (error) {
    const message = errorMessage(error);
    console.error(`  ${ICON_ERROR} src/catalog.yaml — invalid YAML`);
    console.log(`    ${message}`);
    return { errors: 1 };
  }
}

function readCatalogYamlSilent(): unknown | undefined {
  const catalogPath = catalogYamlPath();
  if (!existsSync(catalogPath)) return undefined;
  try {
    return yaml.load(readFileSync(catalogPath, "utf-8"));
  } catch (error) {
    logSkipped("lint/catalog-smoke", error);
    return undefined;
  }
}

function hasValidSmokeCall(value: unknown): boolean {
  return isRecord(value) && typeof value.tool === "string" && value.tool.trim().length > 0;
}

/**
 * A `probeSuppression` states that this server's probe cannot pass and why —
 * Figma, for instance, authenticates per client, so agentbrew's unauthenticated
 * probe never gets past `initialize` and a smoke tool would never be reached.
 * Demanding one anyway would contradict the entry the catalog already carries.
 */
function hasDocumentedProbeSuppression(value: unknown): boolean {
  return isRecord(value) && typeof value.reason === "string" && value.reason.trim().length > 0;
}

function catalogSmokeCallErrors(): string[] {
  const catalog = readCatalogYamlSilent();
  if (!isRecord(catalog) || !Array.isArray(catalog.mcp_servers)) return [];
  const errors: string[] = [];
  for (const server of catalog.mcp_servers) {
    if (!isRecord(server) || server.recommended !== true) continue;
    if (hasValidSmokeCall(server.smokeCall) || hasDocumentedProbeSuppression(server.probeSuppression)) continue;
    const name = typeof server.name === "string" && server.name.trim() ? server.name : "(unnamed MCP)";
    errors.push(`${name}: recommended catalog MCP is missing smokeCall.tool`);
  }
  return errors;
}

function lintCatalogSmokeCalls(): { errors: number } {
  const errors = catalogSmokeCallErrors();
  if (!existsSync(catalogYamlPath())) return { errors: 0 };
  if (errors.length === 0) {
    console.log(`  ${ICON_SUCCESS} catalog MCP smokeCall metadata`);
    return { errors: 0 };
  }
  for (const error of errors) {
    console.error(`  ${ICON_ERROR} src/catalog.yaml — ${error}`);
  }
  return { errors: errors.length };
}

/** Validate Agentfile in cwd if present. */
function lintAgentfile(): { errors: number; warnings: number } {
  const agentfileName = AGENTFILE_NAMES.find((name) => existsSync(join(process.cwd(), name)));
  if (!agentfileName) return { errors: 0, warnings: 0 };

  const agentfilePath = join(process.cwd(), agentfileName);
  try {
    const agentfile = loadAgentfile(process.cwd());
    if (!agentfile) {
      console.error(`  ${ICON_ERROR} ${agentfileName} — failed to parse`);
      return { errors: 1, warnings: 0 };
    }
    const raw = yaml.load(readFileSync(agentfilePath, "utf-8")) as Record<string, unknown> | undefined;
    const unknownKeys = findUnknownAgentfileKeys(raw);
    if (unknownKeys.length > 0) {
      console.log(`  ${ICON_INFO} ${agentfileName} — unknown keys: ${unknownKeys.join(", ")}`);
      return { errors: 0, warnings: 1 };
    }
    const serverCount = agentfile.mcp?.length ?? 0;
    console.log(`  ${ICON_SUCCESS} ${agentfileName} (${serverCount} MCP server(s))`);
    return { errors: 0, warnings: 0 };
  } catch (error) {
    const message = errorMessage(error);
    console.error(`  ${ICON_ERROR} ${agentfileName} — invalid YAML`);
    console.log(`    ${message}`);
    return { errors: 1, warnings: 0 };
  }
}

/** Validate state.yaml structure. */
function lintStateYaml(): { errors: number } {
  const statePath = getStatePath();
  if (!existsSync(statePath)) {
    console.log(`  ${ICON_INFO} state.yaml — not initialized`);
    return { errors: 0 };
  }
  const state = loadState();
  if (!state) {
    console.error(`  ${ICON_ERROR} state.yaml — failed to parse`);
    return { errors: 1 };
  }
  const stateErrors: string[] = [];
  const servers = getStateServers(state);
  if (!Array.isArray(state.agents)) stateErrors.push("agents must be an array");
  if (!Array.isArray(getStateSources(state))) stateErrors.push("sources must be an array");
  if (!Array.isArray(servers)) stateErrors.push("mcpServers must be an array");

  if (stateErrors.length === 0) {
    console.log(`  ${ICON_SUCCESS} state.yaml (${state.agents.length} agents, ${servers.length} MCP servers)`);
    return { errors: 0 };
  }
  console.error(`  ${ICON_ERROR} state.yaml — ${stateErrors.join("; ")}`);
  return { errors: 1 };
}

/** Validate command files in commands dir. */
function lintCommands(): { errors: number; warnings: number } {
  const commandsDir = expandHome(COMMANDS_DIR);
  if (!existsSync(commandsDir)) return { errors: 0, warnings: 0 };

  console.log("");
  console.log(chalk.bold("Commands\n"));
  let commandErrors = 0;
  let commandWarnings = 0;
  try {
    const files = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const filePath = join(commandsDir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        if (content.trim().length === 0) {
          console.log(`  ${ICON_INFO} ${file} — empty`);
          commandWarnings++;
          continue;
        }
        for (const finding of lintCommandBloat(content, filePath)) {
          printAgentBloatFinding(finding, file);
          if (finding.severity === "error") commandErrors++;
          else commandWarnings++;
        }
      } catch (e) {
        logSkipped("lint/log", e);
        console.error(`  ${ICON_ERROR} ${file} — unreadable`);
        commandErrors++;
      }
    }
    if (commandErrors === 0) {
      console.log(`  ${ICON_SUCCESS} ${files.length} command(s)`);
    }
  } catch (e) {
    logSkipped("lint/log", e);
    console.error(`  ${ICON_ERROR} commands dir — unreadable`);
    commandErrors++;
  }
  return { errors: commandErrors, warnings: commandWarnings };
}

function printAgentBloatFinding(finding: AgentBloatFinding, label?: string): void {
  const icon = finding.severity === "error" ? ICON_ERROR : ICON_WARNING;
  const target = label ?? finding.path;
  const print = finding.severity === "error" ? console.error : console.log;
  print(`  ${icon} ${target} — ${finding.message}`);
}

/** Lint repo-owned skills, rule templates, and deployed Cursor .mdc rules for bloat. */
function lintAgentBloat(): { errors: number; warnings: number } {
  console.log("");
  console.log(chalk.bold("Agent bloat\n"));

  const agentBrewDir = process.env.AGENTBREW_DIR ?? resolve(join(import.meta.dirname, ".."));
  const findings = collectAgentBloatFindings({ repoRoot: agentBrewDir });

  const inventory = collectCursorMdcInventory();
  if (inventory) {
    for (const file of inventory.files) {
      const path = join(inventory.rulesDir, file.name);
      try {
        findings.push(...lintMdcBloat(readFileSync(path, "utf-8"), path));
      } catch (e) {
        logSkipped("lint/mdc-bloat", e);
      }
    }
  }

  if (findings.length === 0) {
    console.log(`  ${ICON_SUCCESS} no bloat findings`);
    return { errors: 0, warnings: 0 };
  }

  const bySeverity = [...findings].sort((a, b) => {
    if (a.severity === b.severity) return a.path.localeCompare(b.path);
    return a.severity === "error" ? -1 : 1;
  });
  for (const finding of bySeverity) printAgentBloatFinding(finding);
  return summarizeAgentBloat(findings);
}

/**
 * Validate MCP config files per agent.
 *
 * Skips agents in {@link MCP_INTERSECTION_AGENTS} — those are mcpm-managed
 * (slice 4a of `delegate-mcp-to-mcpm`); their configs are validated by
 * `mcpm doctor` instead. Only carve-out agents (overlay-desktop,
 * copilot, opencode, kiro, amp) get an agentbrew-side MCP config check.
 */
function lintMcpConfigs(): { errors: number } {
  console.log("");
  console.log(chalk.bold("MCP configs\n"));
  let mcpErrors = 0;
  const mcpAgents = AGENT_DEFINITIONS.filter((a) => a.mcpConfig !== undefined && !MCP_INTERSECTION_AGENTS.has(a.name));
  for (const agent of mcpAgents) {
    if (!agent.mcpConfig) continue;
    const configPath = expandHome(agent.mcpConfig);
    if (!existsSync(configPath)) continue;
    try {
      const adapter = getAdapter(agent);
      adapter.readEntries(configPath, agent.mcpKey ?? "mcpServers");
      console.log(`  ${ICON_SUCCESS} ${agent.name}`);
    } catch (error) {
      const message = errorMessage(error);
      console.error(`  ${ICON_ERROR} ${agent.name} — ${message}`);
      mcpErrors++;
    }
  }
  return { errors: mcpErrors };
}

function lintDeployedSizeBudget(sharedRules: string): { errors: number; warnings: number } {
  const instructionsPath = getInstructionsSourcePath();
  let instructions = "";
  try {
    instructions = existsSync(instructionsPath) ? readFileSync(instructionsPath, "utf-8") : "";
  } catch (e) {
    logSkipped("lint/deployed-size-instructions", e);
  }
  const deployRules = stripCursorRulesSection(compressSkillsListing(sharedRules));
  const projected = projectedDeployedRulesSize(instructions, deployRules);
  if (projected <= DEFAULT_TOKEN_WARNING_THRESHOLD) return { errors: 0, warnings: 0 };

  const overHardBudget = projected > DEPLOYED_RULES_FILE_CHAR_BUDGET;
  const print = overHardBudget ? console.error : console.log;
  const icon = overHardBudget ? ICON_ERROR : ICON_WARNING;
  const budget = overHardBudget
    ? `> ${DEPLOYED_RULES_FILE_CHAR_BUDGET.toLocaleString()} char budget (agents warn/degrade above this)`
    : `> ${DEFAULT_TOKEN_WARNING_THRESHOLD.toLocaleString()} chars (soft target)`;
  print(`  ${icon} deployed rules file projected at ~${projected.toLocaleString()} chars ${budget}`);
  const sections = measureSections(deployRules).slice(0, 3);
  for (const section of sections) {
    print(`      ${section.heading.padEnd(40)} ~${estimateTokens(section.chars).toLocaleString()} tokens`);
  }
  print(
    chalk.dim(
      "      Trim shared rules / Agentfile rules: blocks, run `agentbrew rules dedupe`, or move detail into skills.",
    ),
  );
  return overHardBudget ? { errors: 1, warnings: 0 } : { errors: 0, warnings: 1 };
}

function hasOpenContextTrimTask(tasksContent: string): boolean {
  const lines = tasksContent.split("\n");
  let inOpen = false;
  for (const line of lines) {
    if (/^- \[ \]/.test(line)) inOpen = true;
    if (/^- \[x\]/i.test(line)) inOpen = false;
    if (inOpen && /(trim-|context-budget|token-budget)/i.test(line)) return true;
  }
  return false;
}

function lintSharedRulesBaselineGrowth(content: string): { errors: number; warnings: number } {
  const agentBrewDir = process.env.AGENTBREW_DIR ?? resolve(join(import.meta.dirname, ".."));
  const baselinePath = join(agentBrewDir, "docs", "shared-rules.md");
  const tasksPath = join(agentBrewDir, "TASKS.md");
  if (!existsSync(baselinePath)) return { errors: 0, warnings: 0 };

  let baseline = "";
  try {
    baseline = readFileSync(baselinePath, "utf-8");
  } catch (e) {
    logSkipped("lint/shared-rules-baseline", e);
    return { errors: 0, warnings: 0 };
  }

  const delta =
    Buffer.byteLength(stripManagedSharedRulesBlocks(content), "utf-8") -
    Buffer.byteLength(stripManagedSharedRulesBlocks(baseline), "utf-8");
  if (delta <= SHARED_RULES_GROWTH_CHAR_THRESHOLD) return { errors: 0, warnings: 0 };

  let tasksContent = "";
  if (existsSync(tasksPath)) {
    try {
      tasksContent = readFileSync(tasksPath, "utf-8");
    } catch (e) {
      logSkipped("lint/tasks-md", e);
    }
  }

  if (hasOpenContextTrimTask(tasksContent)) {
    console.log(
      `  ${ICON_WARNING} shared-rules.md grew ~${estimateTokens(delta).toLocaleString()} tokens vs docs/shared-rules.md baseline — open context-budget trim task linked`,
    );
    return { errors: 0, warnings: 1 };
  }

  console.error(
    `  ${ICON_ERROR} shared-rules.md grew ~${estimateTokens(delta).toLocaleString()} tokens vs docs/shared-rules.md without an open trim/context-budget task in TASKS.md — add a paired trim task or revert`,
  );
  return { errors: 1, warnings: 0 };
}

/** Validate shared rules file. */
function lintSharedRules(): { errors: number; warnings: number } {
  console.log("");
  console.log(chalk.bold("Shared rules\n"));
  const sharedRulesPath = expandHome(SHARED_RULES_PATH);
  if (!existsSync(sharedRulesPath)) {
    console.log(`  ${chalk.dim("○")} shared-rules.md — not found`);
    return { errors: 0, warnings: 0 };
  }
  try {
    const content = readFileSync(sharedRulesPath, "utf-8");
    if (content.trim().length === 0) {
      console.log(`  ${ICON_INFO} shared-rules.md — empty`);
      return { errors: 0, warnings: 1 };
    }
    const bloatFindings = findSharedRulesBloat(content);
    const statusIcon = bloatFindings.length > 0 ? ICON_INFO : ICON_SUCCESS;
    console.log(`  ${statusIcon} shared-rules.md (${content.split("\n").length} lines)`);
    for (const finding of bloatFindings) printSharedRulesBloatFinding(finding);
    const budgetResult = lintDeployedSizeBudget(content);
    const growthResult = lintSharedRulesBaselineGrowth(content);
    return {
      errors: bloatFindings.length + budgetResult.errors + growthResult.errors,
      warnings: budgetResult.warnings + growthResult.warnings,
    };
  } catch (e) {
    logSkipped("lint/log", e);
    console.error(`  ${ICON_ERROR} shared-rules.md — unreadable`);
    return { errors: 1, warnings: 0 };
  }
}

/** Validate skill sources are accessible. */
function lintSkillSources(): void {
  console.log("");
  console.log(chalk.bold("Skill sources\n"));
  const sources = getSkillSources();
  for (const source of sources) {
    const sourcePath = source.path;
    if (existsSync(sourcePath)) {
      const skills = source.scanner(sourcePath);
      console.log(`  ${ICON_SUCCESS} ${source.label} (${skills.length} skills)`);
    } else {
      console.log(`  ${chalk.dim("○")} ${source.label} — not found`);
    }
  }
}

/**
 * Scan every detected agent's MCP config for bare `${VAR}` placeholders.
 *
 * Mirrors the drift check (`checkBarePlaceholdersDrift`) but runs as part of `agentbrew
 * lint` so CI / `npm run verify` fail when bare placeholders are present. Doesn't
 * auto-fix — that's the drift+sync path. Lint's job is to fail loudly so a regression
 * (e.g. a new catalog entry written without `:-` default by a future tool) shows up
 * in the verify gate before it lands.
 *
 * Why dry-run: lint must be side-effect-free per AGENTS.md "Verify gate" semantics.
 */
function lintBarePlaceholders(): { errors: number } {
  console.log("");
  console.log(chalk.bold("Resilient placeholders\n"));
  const state = loadState();
  if (!state) {
    console.log(`  ${chalk.dim("○")} state.yaml — not initialized`);
    return { errors: 0 };
  }
  // Defensive: lintStateYaml already reports malformed state, so just skip this section
  // when agents isn't an array. Avoids cascading the same "state.yaml malformed" error
  // through every downstream section.
  if (!Array.isArray(state.agents)) {
    console.log(`  ${chalk.dim("○")} skipped — state.yaml structural issues reported above`);
    return { errors: 0 };
  }
  const detected = state.agents.filter((a) => a.detected);
  const sweep = sweepMcpConfigs({ dryRun: true, detected });
  if (sweep.length === 0) {
    console.log(`  ${ICON_SUCCESS} no bare \${VAR} placeholders in any detected agent's MCP config`);
    return { errors: 0 };
  }
  let total = 0;
  for (const result of sweep) {
    const uniqueVars = Array.from(new Set(result.findings.map((f) => f.varName))).sort();
    console.error(
      `  ${ICON_ERROR} ${chalk.yellow(result.agentName)} — ${result.findings.length} bare \${VAR} placeholder(s) [${uniqueVars.join(", ")}]`,
    );
    total += result.findings.length;
  }
  console.log(
    chalk.dim(
      `\n  Strict env-var interpolators importing Claude/Cursor configs crash on bare \${VAR} when the var is unset.\n  Run ${chalk.white("agentbrew sync")} to rewrite ${total} placeholder(s) to the resilient \${VAR:-} form.\n`,
    ),
  );
  return { errors: sweep.length };
}

/**
 * Scan every detected agent's MCP config for Playwright entries missing `--isolated`.
 *
 * Mirrors the drift check (`checkPlaywrightIsolatedDrift`) but runs as part of `agentbrew
 * lint` so CI / `npm run verify` fail when an entry is missing the flag. Doesn't
 * auto-fix — that's the drift+sync path. Lint's job is to fail loudly so a regression
 * (e.g. a new project gets a playwright entry via Claude Code's UI without `--isolated`)
 * shows up in the verify gate before it bites a user.
 */
function lintPlaywrightIsolated(): { errors: number } {
  console.log("");
  console.log(chalk.bold("Playwright --isolated\n"));
  const state = loadState();
  if (!state) {
    console.log(`  ${chalk.dim("○")} state.yaml — not initialized`);
    return { errors: 0 };
  }
  if (!Array.isArray(state.agents)) {
    console.log(`  ${chalk.dim("○")} skipped — state.yaml structural issues reported above`);
    return { errors: 0 };
  }
  const detected = state.agents.filter((a) => a.detected);
  const sweep = sweepPlaywrightIsolated({ dryRun: true, detected });
  if (sweep.length === 0) {
    console.log(`  ${ICON_SUCCESS} every detected agent's Playwright MCP entries use --isolated`);
    return { errors: 0 };
  }
  let total = 0;
  for (const result of sweep) {
    console.error(
      `  ${ICON_ERROR} ${chalk.yellow(result.agentName)} — ${result.findings.length} Playwright MCP entr${result.findings.length === 1 ? "y" : "ies"} missing --isolated`,
    );
    total += result.findings.length;
  }
  console.log(
    chalk.dim(
      `\n  Persistent Playwright profiles collide when multiple agents run concurrently in the same repo (playwright #40419).\n  Run ${chalk.white("agentbrew sync")} to append --isolated to ${total} entr${total === 1 ? "y" : "ies"}.\n`,
    ),
  );
  return { errors: sweep.length };
}

function lintCatalogPins(): { errors: number } {
  console.log("");
  console.log(chalk.bold("Catalog MCP pins\n"));
  const state = loadState();
  if (!state) {
    console.log(`  ${chalk.dim("○")} state.yaml — not initialized`);
    return { errors: 0 };
  }
  if (!Array.isArray(state.agents)) {
    console.log(`  ${chalk.dim("○")} skipped — state.yaml structural issues reported above`);
    return { errors: 0 };
  }
  const detected = state.agents.filter((agent) => agent.detected);
  const sweep = sweepCatalogPins({ dryRun: true, detected });
  if (sweep.length === 0) {
    console.log(`  ${ICON_SUCCESS} every detected agent's floating catalog MCP entries are pinned`);
    return { errors: 0 };
  }
  let total = 0;
  for (const result of sweep) {
    console.error(
      `  ${ICON_ERROR} ${chalk.yellow(result.agentName)} — ${result.findings.length} floating catalog MCP entr${result.findings.length === 1 ? "y" : "ies"}`,
    );
    total += result.findings.length;
  }
  console.log(
    chalk.dim(
      `\n  Run ${chalk.white("agentbrew sync")} to re-pin ${total} catalog MCP entr${total === 1 ? "y" : "ies"}.\n`,
    ),
  );
  return { errors: sweep.length };
}

/** Scan state.yaml MCP servers for hardcoded secrets that should use placeholders. */
function lintSecrets(): { errors: number } {
  console.log("");
  console.log(chalk.bold("Secrets\n"));
  const statePath = getStatePath();
  if (!existsSync(statePath)) {
    console.log(`  ${chalk.dim("○")} state.yaml — not initialized`);
    return { errors: 0 };
  }
  const state = loadState();
  if (!state) {
    console.log(`  ${chalk.dim("○")} state.yaml — could not load`);
    return { errors: 0 };
  }
  const servers = getStateServers(state);
  if (!Array.isArray(servers) || servers.length === 0) {
    console.log(`  ${ICON_SUCCESS} no MCP servers to scan`);
    return { errors: 0 };
  }
  const findings = detectSecretsInServers(servers);
  if (findings.length === 0) {
    console.log(`  ${ICON_SUCCESS} no hardcoded secrets detected`);
    return { errors: 0 };
  }
  for (const finding of findings) {
    console.error(
      `  ${ICON_WARNING} ${chalk.yellow(finding.location)}.${finding.field} — ${finding.pattern} (${chalk.dim(finding.preview)})`,
    );
  }
  console.log(chalk.dim(`\n  Use \${VAR} placeholders instead of hardcoded secrets.`));
  console.log(chalk.dim(`  Run ${chalk.white("agentbrew setup")} to configure secrets via env vars or Keychain.\n`));
  return { errors: findings.length };
}

/** Validate all agentbrew configuration files. Returns true if valid. */
export function lint(): boolean {
  let errors = 0;
  let warnings = 0;

  console.log(chalk.bold("\nValidating agentbrew config...\n"));

  errors += lintAgentsMd().errors;
  errors += lintCatalogYaml().errors;
  errors += lintCatalogSmokeCalls().errors;

  const agentfileResult = lintAgentfile();
  errors += agentfileResult.errors;
  warnings += agentfileResult.warnings;

  errors += lintStateYaml().errors;
  errors += lintMcpConfigs().errors;

  const rulesResult = lintSharedRules();
  errors += rulesResult.errors;
  warnings += rulesResult.warnings;

  const commandsResult = lintCommands();
  errors += commandsResult.errors;
  warnings += commandsResult.warnings;

  lintSkillSources();

  const bloatResult = lintAgentBloat();
  errors += bloatResult.errors;
  warnings += bloatResult.warnings;

  errors += lintBarePlaceholders().errors;
  errors += lintCatalogPins().errors;
  errors += lintPlaywrightIsolated().errors;
  errors += lintSecrets().errors;

  console.log("");
  if (errors === 0 && warnings === 0) {
    console.log(chalk.green("All config valid"));
  } else if (errors === 0) {
    console.log(chalk.yellow(`${warnings} warning(s), no errors`));
  } else {
    console.error(chalk.red(`${errors} error(s), ${warnings} warning(s)`));
  }

  return errors === 0;
}

/**
 * Validate MCP configs silently, returning error messages.
 *
 * Mirrors {@link lintMcpConfigs} — skips intersection agents because they're
 * validated by `mcpm doctor` (slice 4a of `delegate-mcp-to-mcpm`).
 */
function validateMcpConfigs(): string[] {
  const errors: string[] = [];
  const mcpAgents = AGENT_DEFINITIONS.filter((a) => a.mcpConfig !== undefined && !MCP_INTERSECTION_AGENTS.has(a.name));
  for (const agent of mcpAgents) {
    if (!agent.mcpConfig) continue;
    const configPath = expandHome(agent.mcpConfig);
    if (!existsSync(configPath)) continue;
    try {
      const adapter = getAdapter(agent);
      adapter.readEntries(configPath, agent.mcpKey ?? "mcpServers");
    } catch (e) {
      logSkipped("lint/readEntries", e);
      errors.push(`${agent.name} MCP config invalid`);
    }
  }
  return errors;
}

/** Validate Agentfile in cwd silently, returning errors and warnings. */
function validateAgentfileSilent(): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const agentfileName = AGENTFILE_NAMES.find((name) => existsSync(join(process.cwd(), name)));
  if (!agentfileName) return { errors, warnings };
  try {
    const agentfile = loadAgentfile(process.cwd());
    if (!agentfile) {
      errors.push(`${agentfileName} failed to parse`);
    } else {
      const raw = yaml.load(readFileSync(join(process.cwd(), agentfileName), "utf-8")) as
        | Record<string, unknown>
        | undefined;
      const unknownKeys = findUnknownAgentfileKeys(raw);
      if (unknownKeys.length > 0) {
        warnings.push(`${agentfileName} has unknown keys: ${unknownKeys.join(", ")}`);
      }

      // Validate MCP entries against catalog
      const mcpWarnings = validateAgentfileMcp(agentfile);
      for (const w of mcpWarnings) {
        warnings.push(w.message);
      }
    }
  } catch (e) {
    logSkipped("lint/push", e);
    errors.push(`${agentfileName} invalid YAML`);
  }
  return { errors, warnings };
}

/** Scan state.yaml MCP servers for hardcoded secrets silently, returning errors. */
function validateSecretsSilent(): string[] {
  const statePath = getStatePath();
  if (!existsSync(statePath)) return [];
  const state = loadState();
  if (!state) return [];
  const servers = getStateServers(state);
  if (!Array.isArray(servers)) return [];
  return detectSecretsInServers(servers).map(
    (f) => `${f.location}.${f.field}: possible ${f.pattern} — use \${VAR} placeholder`,
  );
}

/** Scan detected agents' MCP configs for bare `${VAR}` silently, returning errors. */
function validateBarePlaceholdersSilent(): string[] {
  const state = loadState();
  if (!state || !Array.isArray(state.agents)) return [];
  const detected = state.agents.filter((a) => a.detected);
  return sweepMcpConfigs({ dryRun: true, detected }).map(
    (r) => `${r.agentName}: ${r.findings.length} bare \${VAR} placeholder(s) — strict importers crash on missing vars`,
  );
}

/** Scan detected agents' MCP configs for Playwright entries missing --isolated, returning errors. */
function validatePlaywrightIsolatedSilent(): string[] {
  const state = loadState();
  if (!state || !Array.isArray(state.agents)) return [];
  const detected = state.agents.filter((a) => a.detected);
  return sweepPlaywrightIsolated({ dryRun: true, detected }).map(
    (r) =>
      `${r.agentName}: ${r.findings.length} Playwright MCP entr${r.findings.length === 1 ? "y" : "ies"} missing --isolated — persistent profile collides under concurrent multi-agent use`,
  );
}

function validateCatalogPinsSilent(): string[] {
  const state = loadState();
  if (!state || !Array.isArray(state.agents)) return [];
  const detected = state.agents.filter((agent) => agent.detected);
  return sweepCatalogPins({ dryRun: true, detected }).map(
    (result) =>
      `${result.agentName}: ${result.findings.length} floating catalog MCP entr${result.findings.length === 1 ? "y" : "ies"}`,
  );
}

/** Lightweight config validation — returns error/warning counts without printing. */
export function validateConfig(): { errors: number; warnings: number; details: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const statePath = getStatePath();
  if (existsSync(statePath)) {
    const state = loadState();
    if (!state) errors.push("state.yaml failed to parse");
  }

  const agentfileResult = validateAgentfileSilent();
  errors.push(...agentfileResult.errors);
  warnings.push(...agentfileResult.warnings);

  errors.push(...validateMcpConfigs());
  errors.push(...catalogSmokeCallErrors());
  errors.push(...validateSecretsSilent());
  errors.push(...validateBarePlaceholdersSilent());
  errors.push(...validateCatalogPinsSilent());
  errors.push(...validatePlaywrightIsolatedSilent());

  return {
    errors: errors.length,
    warnings: warnings.length,
    details: [...errors, ...warnings],
  };
}
