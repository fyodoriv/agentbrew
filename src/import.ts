import { existsSync } from "node:fs";
import chalk from "chalk";
import { getStateServers } from "./agentfile.js";
import { logSkipped } from "./core/logger.js";
import { getAdapter } from "./mcp/adapters.js";
import { requireState, saveState } from "./state.js";
import type { AgentBrewState, AgentConfig, McpServer } from "./types.js";
import { AGENT_DEFINITIONS } from "./types.js";
import { ICON_SUCCESS } from "./ui/output.js";
import { expandHome } from "./utils.js";

const MCPM_SERVER_PREFIX = "mcpm_";

function isKnownServerName(name: string, stateServerNames: Set<string>, externalNames?: Set<string>): boolean {
  if (stateServerNames.has(name) || externalNames?.has(name)) return true;
  // mcpm bridge entries (mcpm_<name>) are managed by mcpm, not agentbrew state
  if (name.startsWith(MCPM_SERVER_PREFIX)) return true;
  const underlyingName = name.slice(MCPM_SERVER_PREFIX.length);
  return stateServerNames.has(underlyingName) || externalNames?.has(underlyingName) === true;
}

/** Reads and extracts MCP servers from an agent config file via its format-specific adapter. */
function readDiscoveredServers(
  agentDef: Pick<AgentConfig, "name" | "mcpFormat" | "mcpKey">,
  configPath: string,
): McpServer[] {
  return getAdapter(agentDef).discoverServers(configPath, agentDef.mcpKey ?? "mcpServers");
}

/** Print import results: imported and skipped servers. */
function printImportResults(agentName: string, imported: McpServer[], skipped: string[]): void {
  console.log(chalk.bold(`\nImport from ${agentName}\n`));
  if (imported.length > 0) {
    for (const server of imported) {
      console.log(`  ${chalk.green("+")} ${server.name} — ${server.command} ${server.args.join(" ")}`);
    }
  }
  if (skipped.length > 0) {
    for (const name of skipped) {
      console.log(chalk.dim(`  - ${name} (already registered)`));
    }
  }
  if (imported.length === 0 && skipped.length > 0) {
    console.log(chalk.bold("\nAlready up to date.\n"));
  } else {
    console.log(chalk.bold(`\n${imported.length} imported, ${skipped.length} skipped.\n`));
  }
}

/** Import MCP servers from a specific agent's config into agentbrew state. */
export async function importFromAgent(agentName: string): Promise<void> {
  const state = requireState();
  if (!state) return;

  const agentDef = AGENT_DEFINITIONS.find((a) => a.name === agentName);
  if (!agentDef) {
    const names = AGENT_DEFINITIONS.map((a) => a.name).join(", ");
    console.error(chalk.red(`Unknown agent: ${agentName}`));
    console.log(chalk.dim(`  Available: ${names}`));
    return;
  }

  if (!agentDef.mcpConfig) {
    console.error(chalk.yellow(`${agentName} has no MCP config path defined.`));
    console.log(chalk.dim("  This agent doesn't support MCP server configuration. Try a different agent."));
    return;
  }

  const configPath = expandHome(agentDef.mcpConfig);
  if (!existsSync(configPath)) {
    console.error(chalk.yellow(`${agentName} config not found: ${agentDef.mcpConfig}`));
    console.log(
      chalk.dim(
        `  The agent may not be installed, or hasn't been configured yet.\n  Run the agent once to create its config file, then retry.`,
      ),
    );
    return;
  }

  const discovered = readDiscoveredServers(agentDef, configPath);

  if (discovered.length === 0) {
    console.log(chalk.dim(`No MCP servers found in ${agentName}.`));
    console.log(chalk.dim("  Run the agent at least once to populate its MCP config, then retry."));
    return;
  }

  const servers = getStateServers(state);
  const existing = new Set(servers.map((s) => s.name));
  const imported: McpServer[] = [];
  const skipped: string[] = [];

  if (!state.mcpServers) state.mcpServers = [];
  for (const server of discovered) {
    if (existing.has(server.name)) {
      skipped.push(server.name);
    } else {
      imported.push(server);
      state.mcpServers.push(server);
    }
  }

  if (imported.length > 0) {
    saveState(state);
  }

  printImportResults(agentName, imported, skipped);
}

/** Import servers from a single agent config into state. Returns {imported, skipped} counts. */
function importAgentServers(
  agentDef: (typeof AGENT_DEFINITIONS)[number],
  state: AgentBrewState,
  existing: Set<string>,
): { imported: number; skipped: number; total: number } | undefined {
  if (!agentDef.mcpConfig) return undefined;
  const configPath = expandHome(agentDef.mcpConfig);
  if (!existsSync(configPath)) {
    console.log(chalk.dim(`  - ${agentDef.name} — no config found`));
    return undefined;
  }

  const discovered = readDiscoveredServers(agentDef, configPath);
  if (!state.mcpServers) state.mcpServers = [];

  let imported = 0;
  let skipped = 0;
  for (const server of discovered) {
    if (!existing.has(server.name)) {
      state.mcpServers.push(server);
      existing.add(server.name);
      imported++;
    } else {
      skipped++;
    }
  }

  const label = imported > 0 ? `${chalk.green(String(imported))} new` : chalk.dim("up to date");
  console.log(`  ${ICON_SUCCESS} ${agentDef.name} — ${discovered.length} servers (${label})`);
  return { imported, skipped, total: discovered.length };
}

/** Import MCP servers from all detected agents. */
export async function importAll(): Promise<void> {
  const state = requireState();
  if (!state) return;

  const agentsWithConfig = AGENT_DEFINITIONS.filter((a) => a.mcpConfig);
  let totalImported = 0;
  let totalSkipped = 0;

  console.log(chalk.bold("\nImporting from all agents...\n"));

  const existing = new Set(getStateServers(state).map((s) => s.name));

  for (const agentDef of agentsWithConfig) {
    const result = importAgentServers(agentDef, state, existing);
    if (result) {
      totalImported += result.imported;
      totalSkipped += result.skipped;
    }
  }

  if (totalImported > 0) saveState(state);

  const summary =
    totalImported === 0 && totalSkipped > 0
      ? chalk.bold("\nAlready up to date.\n")
      : chalk.bold(`\n${totalImported} imported, ${totalSkipped} skipped.\n`);
  console.log(summary);
}

/** Discover MCP servers in agent configs that are NOT in agentbrew state.
 *  Returns a list of {agentName, serverName} pairs for servers found in
 *  agent configs but missing from state. Does NOT modify state.
 *  @param externalNames - server names managed by external systems (excluded from results) */
export function discoverUnmanagedServers(
  stateServerNames: Set<string>,
  externalNames?: Set<string>,
): Array<{ agent: string; server: string }> {
  const results: Array<{ agent: string; server: string }> = [];
  const agentsWithConfig = AGENT_DEFINITIONS.filter((a) => a.mcpConfig);

  for (const agentDef of agentsWithConfig) {
    if (!agentDef.mcpConfig) continue;
    const configPath = expandHome(agentDef.mcpConfig);
    if (!existsSync(configPath)) continue;

    try {
      const discovered = readDiscoveredServers(agentDef, configPath);
      for (const server of discovered) {
        if (!isKnownServerName(server.name, stateServerNames, externalNames)) {
          results.push({ agent: agentDef.name, server: server.name });
        }
      }
    } catch (e) {
      logSkipped("import/push", e);
    }
  }

  // Deduplicate by server name (same server may appear in multiple agents)
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.server)) return false;
    seen.add(r.server);
    return true;
  });
}
