import chalk from "chalk";
import { getConfigServers } from "../agentfile.js";
import { loadCatalog } from "../catalog/types.js";
import { requireState } from "../state.js";
import { ICON_SUCCESS, ICON_WARNING } from "../ui/output.js";
import { extractEnvVars, isEnvVarResolved } from "./mcp-validation.js";

// ── Status types ─────────────────────────────────────────────────────────────

/** Runtime status of a single MCP server — installed state, env var readiness. */
export interface McpServerStatus {
  name: string;
  description: string;
  category: string;
  installed: boolean;
  requiredVars: string[];
  missingVars: string[];
  ready: boolean;
  note?: string;
  /** Clickable URL shown at the top of the setup wizard. See CatalogMcpServer.setupLink. */
  setupLink?: string;
}

// ── Catalog + state status ───────────────────────────────────────────────────

/** Get status of all catalog MCP servers — installed or not, missing env vars. */
export function getMcpStatus(): McpServerStatus[] {
  const catalog = loadCatalog();
  const _state = requireState({ quiet: true });
  const installedNames = new Set(getConfigServers().map((s) => s.name));

  const catalogStatuses = catalog.mcp_servers.map((server) => {
    const requiredVars = extractEnvVars(server);
    const missingVars = requiredVars.filter((v) => !isEnvVarResolved(v));
    const installed = installedNames.has(server.name);

    return {
      name: server.name,
      description: server.description,
      category: server.category,
      installed,
      requiredVars,
      missingVars,
      ready: installed && missingVars.length === 0,
      note: server.note,
      setupLink: server.setupLink,
    };
  });
  const catalogNames = new Set(catalogStatuses.map((s) => s.name));
  const installedOnly = getInstalledMcpStatus().filter((s) => !catalogNames.has(s.name));
  return [...catalogStatuses, ...installedOnly];
}

/** Get status for currently installed (state) MCP servers only. */
export function getInstalledMcpStatus(): McpServerStatus[] {
  const state = requireState({ quiet: true });
  if (!state) return [];

  return getConfigServers().map((server) => {
    const requiredVars = extractEnvVars(server);
    const missingVars = requiredVars.filter((v) => !isEnvVarResolved(v));

    return {
      name: server.name,
      description: "",
      category: server.source,
      installed: true,
      requiredVars,
      missingVars,
      ready: missingVars.length === 0,
    };
  });
}

/** Look up setup instructions for a server's env vars from the catalog. */
export function getSetupInstructions(
  serverName: string,
): Record<string, import("./mcp-validation.js").EnvVarSetupInfo> {
  const catalog = loadCatalog();
  const server = catalog.mcp_servers.find((s) => s.name === serverName);
  return server?.setup ?? {};
}

// ── Display: mcp status ──────────────────────────────────────────────────────

function printInstalledServers(installed: McpServerStatus[]): void {
  if (installed.length === 0) return;
  console.log(chalk.bold("  Installed:"));
  for (const server of installed) {
    const icon = server.ready ? ICON_SUCCESS : ICON_WARNING;
    const name = chalk.cyan(server.name);
    const missing =
      server.missingVars.length > 0
        ? chalk.yellow(` — missing: ${server.missingVars.join(", ")}`)
        : chalk.green(" — ready");
    console.log(`    ${icon} ${name}${missing}`);
  }
  console.log();
}

function printAvailableServers(available: McpServerStatus[]): void {
  console.log(chalk.bold("  Available (not installed):"));
  for (const server of available) {
    const vars = server.missingVars.length > 0 ? chalk.dim(` (needs: ${server.missingVars.join(", ")})`) : "";
    console.log(`    ${chalk.dim("○")} ${chalk.dim(server.name)}${vars}`);
  }
  console.log();
}

function printStatusSummary(installed: McpServerStatus[]): void {
  const readyCount = installed.filter((s) => s.ready).length;
  const needsSetup = installed.filter((s) => !s.ready);

  if (needsSetup.length > 0) {
    console.log(
      chalk.yellow(`  ${readyCount}/${installed.length} servers ready. `) +
        chalk.yellow(`${needsSetup.length} need configuration.`),
    );
    console.log(chalk.dim(`  Run ${chalk.white("agentbrew setup")} to configure missing env vars.\n`));
  } else if (installed.length > 0) {
    console.log(chalk.green(`  All ${installed.length} installed servers are ready.\n`));
  } else {
    console.log(
      chalk.dim(`  No MCP servers installed. Run ${chalk.white("agentbrew install --recommended")} to get started.\n`),
    );
  }
}

/** Render MCP server status to stdout — installed/missing servers and env var readiness. */
export function showMcpStatus(options?: { all?: boolean; json?: boolean }): void {
  const showAll = options?.all ?? false;
  const statuses = getMcpStatus();

  if (options?.json) {
    console.log(JSON.stringify(statuses, undefined, 2));
    return;
  }

  const installed = statuses.filter((s) => s.installed);
  const available = statuses.filter((s) => !s.installed);

  console.log(chalk.bold("\nMCP Server Status\n"));

  // Installed servers
  printInstalledServers(installed);

  // Not installed
  if (showAll && available.length > 0) {
    printAvailableServers(available);
  }

  // Summary
  printStatusSummary(installed);
}
