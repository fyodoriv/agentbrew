import chalk from "chalk";
import { requireState } from "../state.js";
import { formatSuggestion } from "../suggest.js";
import { ICON_SUCCESS, ICON_WARNING } from "../ui/output.js";
import type { McpServerStatus } from "./mcp-status.js";
import { getInstalledMcpStatus, getMcpStatus, showMcpStatus } from "./mcp-status.js";
import {
  appendToShellConfig,
  getShellConfigPath,
  installSelectedServers,
  setupServerEnvVars,
  setupSingleServer,
} from "./mcp-wizard.js";

export type { McpServerStatus } from "./mcp-status.js";
// `showMcpStatus` is re-exported because cli-mcp.ts (and its test) import it
// alongside `runMcpSetup` — keeping the wizard surface as the single entry
// point for the `agentbrew mcp` command. Other mcp-status helpers
// (`getMcpStatus`, `getInstalledMcpStatus`, `getSetupInstructions`) are
// imported directly from `./mcp-status.js` by their consumers.
export { showMcpStatus } from "./mcp-status.js";
// Re-export everything from extracted modules so existing import paths keep working.
export type { McpValidationWarning } from "./mcp-validation.js";
export {
  extractEnvVars,
  isEnvVarResolved,
  printValidationWarnings,
  validateMcpEnvVars,
} from "./mcp-validation.js";

/**
 * Merge catalog statuses with installed-only statuses so user-added,
 * git-installed, and discovered servers appear alongside catalog items.
 */
function getUnifiedMcpStatus() {
  const catalogStatuses = getMcpStatus();
  const installedStatuses = getInstalledMcpStatus();
  const catalogNames = new Set(catalogStatuses.map((s) => s.name));

  // Add installed servers that aren't in the catalog (user-added, git, discovered)
  const extra = installedStatuses.filter((s) => !catalogNames.has(s.name));
  return [...catalogStatuses, ...extra];
}

// ── Wizard: mcp setup ────────────────────────────────────────────────────────

/** Handle setup for a single named server. Returns true if handled. */
async function handleSingleServerSetup(serverName: string): Promise<boolean> {
  const allStatuses = getUnifiedMcpStatus();
  const server = allStatuses.find((s) => s.name === serverName);
  if (!server) {
    const available = allStatuses.map((s) => s.name);
    console.error(chalk.red(`MCP server '${serverName}' not found.`));
    const suggestion = formatSuggestion(serverName, available);
    if (suggestion) {
      console.log(suggestion);
    } else {
      console.log(chalk.dim("  Run `agentbrew status` to see registered servers, or `agentbrew install` to add one."));
    }
    return true;
  }
  const icon = server.ready ? ICON_SUCCESS : ICON_WARNING;
  const missing =
    server.missingVars.length > 0 ? chalk.yellow(`missing: ${server.missingVars.join(", ")}`) : chalk.green("ready");
  console.log(chalk.bold(`\n${server.name}\n`));
  console.log(`  ${icon} ${missing}`);
  if (server.missingVars.length === 0) {
    console.log(chalk.green("\n  All env vars are configured.\n"));
    return true;
  }
  console.log();
  await setupSingleServer(server);
  return true;
}

/** Run the two-phase wizard: fix existing env vars, then offer to install new servers. */
async function runSetupWizard(options?: { installMissing?: boolean }): Promise<void> {
  const allStatuses = getUnifiedMcpStatus();
  const installed = allStatuses.filter((s) => s.installed);
  const needsSetup = installed.filter((s) => !s.ready);
  const notInstalled = allStatuses.filter((s) => !s.installed);

  if (needsSetup.length > 0) {
    const { confirm } = await import("@inquirer/prompts");
    const configureExisting = await confirm({
      message: "Configure missing env vars for installed servers?",
      default: true,
    });

    if (configureExisting) {
      for (const server of needsSetup) {
        const completed = await setupServerEnvVars(server);
        if (!completed) continue;
      }
      showMcpStatus();
    }
  }

  if (notInstalled.length > 0 && (options?.installMissing ?? true)) {
    await installSelectedServers(notInstalled, allStatuses);
  }
}

/** Run the interactive MCP server setup wizard — configure env vars and optionally install new servers. */
export async function runMcpSetup(options?: {
  server?: string;
  installMissing?: boolean;
  all?: boolean;
  env?: string[];
}): Promise<void> {
  const state = requireState();
  if (!state) return;

  // Non-interactive: --env KEY=VAL pairs
  if (options?.env?.length) {
    setupFromEnv(options.env);
    return;
  }

  // Batch: --all configures all missing vars at once
  if (options?.all) {
    await setupAllServers();
    return;
  }

  if (options?.server) {
    await handleSingleServerSetup(options.server);
    return;
  }

  showMcpStatus();

  try {
    await runSetupWizard(options);
    console.log(chalk.bold("\n✓ Setup complete.\n"));
  } catch (error) {
    const { ExitPromptError } = await import("@inquirer/core");
    if (error instanceof ExitPromptError) {
      console.log(chalk.yellow("\n  Setup cancelled. No further changes will be made.\n"));
      return;
    }
    throw error;
  }
}

// ── Batch setup: --all ───────────────────────────────────────────────────────

/** Collect all missing env vars across all installed servers, deduplicate, prompt once per var. */
async function setupAllServers(): Promise<void> {
  const allStatuses = getUnifiedMcpStatus();
  const installed = allStatuses.filter((s) => s.installed);
  const needsSetup = installed.filter((s) => !s.ready);

  if (needsSetup.length === 0) {
    console.log(chalk.green("\n  ✓ All installed MCP servers are fully configured.\n"));
    return;
  }

  // Collect and deduplicate missing vars
  const varToServers = collectMissingVars(needsSetup);

  console.log(chalk.bold(`\n  ${varToServers.size} unique env var(s) needed across ${needsSetup.length} server(s):\n`));
  for (const [varName, servers] of varToServers) {
    console.log(`    ${chalk.cyan(varName)} — used by ${servers.join(", ")}`);
  }
  console.log();

  const { input, confirm } = await import("@inquirer/prompts");

  const collected = new Map<string, string>();
  for (const [varName] of varToServers) {
    const value = await input({
      message: `  Paste your ${chalk.cyan(varName)}:`,
      validate: (val) => val.trim().length > 0 || "Value cannot be empty",
    });
    collected.set(varName, value.trim());
  }

  // Confirm and save
  console.log(chalk.bold("\n  Review:"));
  for (const [varName, value] of collected) {
    const masked = value.length > 8 ? `${value.slice(0, 4)}${"•".repeat(value.length - 8)}${value.slice(-4)}` : "••••";
    console.log(`    ${chalk.cyan(varName)} = ${chalk.dim(masked)}`);
  }

  const shouldSave = await confirm({
    message: `  Save ${collected.size} var(s) to ${getShellConfigPath()}?`,
    default: true,
  });

  for (const [varName, value] of collected) {
    process.env[varName] = value;
    if (shouldSave) appendToShellConfig(varName, value);
  }

  if (shouldSave) {
    console.log(chalk.dim(`    ✓ ${collected.size} var(s) saved to ${getShellConfigPath()}`));
  }

  console.log(chalk.bold("\n✓ All servers configured.\n"));
}

/** Collect missing env vars across servers, mapping each var to the servers that need it. */
export function collectMissingVars(servers: McpServerStatus[]): Map<string, string[]> {
  const varToServers = new Map<string, string[]>();
  for (const server of servers) {
    for (const varName of server.missingVars) {
      const existing = varToServers.get(varName) ?? [];
      existing.push(server.name);
      varToServers.set(varName, existing);
    }
  }
  return varToServers;
}

// ── Non-interactive: --env KEY=VAL ──────────────────────────────────────────

/** Apply env vars from KEY=VAL pairs without prompting. Writes to shell config and process.env. */
export function setupFromEnv(pairs: string[]): void {
  let applied = 0;
  for (const pair of pairs) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) {
      console.error(chalk.yellow(`  ⚠ Skipping invalid pair (expected KEY=VAL): ${pair}`));
      continue;
    }
    const varName = pair.slice(0, eqIndex);
    const value = pair.slice(eqIndex + 1);
    if (!varName || !value) {
      console.error(chalk.yellow(`  ⚠ Skipping empty key or value: ${pair}`));
      continue;
    }
    process.env[varName] = value;
    appendToShellConfig(varName, value);
    applied++;
  }
  console.log(
    applied > 0
      ? `${ICON_SUCCESS} ${applied} var(s) saved to ${getShellConfigPath()}`
      : chalk.yellow("  No valid KEY=VAL pairs provided."),
  );
}
