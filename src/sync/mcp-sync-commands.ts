import { getStateServers } from "../agentfile.js";
import type { Context } from "../core/context.js";
import { createContext } from "../core/context.js";
import { AgentBrewError, errorMessage } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import { buildMcpmClientList } from "../core/mcp-agent-map.js";
import { getAdapter } from "../mcp/adapters.js";
import { requireState, saveState } from "../state.js";
import type { AgentConfig, McpServer } from "../types.js";
import { expandHome } from "../utils.js";
import { delegateMcpUninstall, isMcpmAvailable } from "./mcp-delegate.js";
import { getMcpTargetAgents, syncMcpServers } from "./mcp-sync.js";

interface AddMcpServerOptions {
  ctx?: Context;
  url?: string;
  headers?: Record<string, string>;
  /** Git URL this server was installed from (stored for `mcp update` support). */
  gitUrl?: string;
  /** Git ref pinned at install time (branch, tag, or commit SHA). */
  gitRef?: string;
}

function validateMcpServerInput(name: string, command: string, isUrlBased: boolean, url?: string): void {
  if (isUrlBased) {
    if (!url || url.trim().length === 0) {
      throw new AgentBrewError("INVALID_MCP", `MCP server '${name}' has an empty url.`);
    }
  } else if (!command || command.trim().length === 0) {
    throw new AgentBrewError(
      "INVALID_MCP",
      `MCP server '${name}' has an empty command. Stdio servers require a non-empty command.`,
    );
  }
}

function updateExistingServer(
  existing: McpServer,
  command: string,
  args: string[],
  env: Record<string, string>,
  options?: AddMcpServerOptions,
): void {
  existing.command = command;
  existing.args = args;
  existing.env = env;
  if (options?.url !== undefined) existing.url = options.url || undefined;
  if (options?.headers !== undefined)
    existing.headers = Object.keys(options.headers).length > 0 ? options.headers : undefined;
  if (options?.gitUrl !== undefined) existing.gitUrl = options.gitUrl;
  if (options?.gitRef !== undefined) existing.gitRef = options.gitRef;
}

function createNewServer(
  name: string,
  command: string,
  args: string[],
  env: Record<string, string>,
  options?: AddMcpServerOptions,
): McpServer {
  const server: McpServer = {
    name,
    command,
    args,
    env,
    source: "user",
    addedAt: new Date().toISOString(),
  };
  if (options?.url) server.url = options.url;
  if (options?.headers && Object.keys(options.headers).length > 0) server.headers = options.headers;
  if (options?.gitUrl) server.gitUrl = options.gitUrl;
  if (options?.gitRef) server.gitRef = options.gitRef;
  return server;
}

/**
 * Adds or updates an MCP server in state and immediately syncs to all agents.
 * The add/update logic lives here (not in syncMcpServers) so that callers get
 * a clear success message and the state mutation is isolated from sync concerns.
 */
export async function addMcpServer(
  name: string,
  command: string,
  args: string[],
  env: Record<string, string>,
  options?: AddMcpServerOptions,
): Promise<void> {
  const ctx = options?.ctx;
  const log = ctx?.logger ?? createContext().logger;
  const state = ctx ? ctx.state.require() : requireState();
  if (!state) return;

  validateMcpServerInput(name, command, !!options?.url, options?.url);

  const servers = getStateServers(state);
  const existing = servers.find((s) => s.name === name);
  if (existing) {
    log.warn(`MCP server '${name}' already exists. Updating...`);
    updateExistingServer(existing, command, args, env, options);
  } else {
    if (!state.mcpServers) state.mcpServers = [];
    state.mcpServers.push(createNewServer(name, command, args, env, options));
  }
  if (state.declinedMcpServers) {
    state.declinedMcpServers = state.declinedMcpServers.filter((declined) => declined !== name);
  }

  await syncMcpServers(undefined, ctx);

  if (ctx) ctx.state.save(state);
  else saveState(state);
  log.success("✓", `MCP server '${name}' registered.`);
}

function pruneServerFromAgents(name: string, agents: AgentConfig[], log: Logger): void {
  for (const agent of agents) {
    if (!agent.mcpConfig) continue;

    try {
      const adapter = getAdapter(agent);
      const mcpKey = agent.mcpKey ?? "mcpServers";
      const removed = adapter.removeServer(expandHome(agent.mcpConfig), name, mcpKey);

      if (removed) {
        log.success("✓", `  ${agent.name} — removed`);
      } else {
        log.log(log.dim(`  - ${agent.name} — not present`));
      }
    } catch (err) {
      const message = errorMessage(err);
      log.log(`  ${log.red("✗")} ${agent.name} — ${log.red(message)}`);
    }
  }
}

/**
 * Bridge `agentbrew remove <name>` to mcpm for {@link MCP_INTERSECTION_AGENTS}.
 *
 * Slice 1 of `bridge-mcp-sync-to-mcpm-for-intersection`. After slice 4a
 * of `delegate-mcp-to-mcpm`, `getMcpTargetAgents` filters out
 * {@link MCP_INTERSECTION_AGENTS} clients from native
 * sync — `pruneServerFromAgents` therefore never touches them. This
 * helper closes that gap by running `mcpm client edit <client>
 * --remove-server <name>` per intersection client and `mcpm uninstall
 * <name> --force` for global cleanup. Symmetric mirror of the install
 * bridge in `installMcpServer` (PR #857).
 *
 * Failures are non-fatal — agentbrew state mutation already succeeded;
 * mcpm-side errors (missing binary, server-not-found, partial client
 * failures) fall through to a soft skip. The caller's
 * `pruneServerFromAgents` still handles carve-out clients (
 * overlay-desktop, copilot, opencode, kiro, amp).
 */
function bridgeRemoveToMcpm(agents: AgentConfig[], serverName: string, log: Logger): void {
  const detectedAgents = agents.filter((a) => a.detected).map((a) => a.name);
  if (detectedAgents.length === 0) return;

  // Short-circuit when no intersection clients are detected — `mcpm
  // uninstall` would clear the global config but there'd be no client
  // configs to remove from. Carve-out-only setups go through the
  // native `pruneServerFromAgents` path.
  const { clients } = buildMcpmClientList(detectedAgents);
  if (clients.length === 0) return;

  const result = delegateMcpUninstall({ serverName, agents: detectedAgents });
  if (result.ok && result.perClient.length > 0) {
    const clientNames = result.perClient
      .filter((r) => r.ok)
      .map((r) => r.client)
      .join(", ");
    if (clientNames) log.log(log.dim(`  Removed mcpm client configs from: ${clientNames}.`));
  }
}

/**
 * Removes an MCP server from state and prunes it from every agent's config file.
 * Separated from the core sync engine so that mutation operations don't inflate
 * the sync module's line count or test surface.
 */
export async function removeMcpServer(name: string, ctx?: Context): Promise<void> {
  const log = ctx?.logger ?? createContext().logger;
  const state = ctx ? ctx.state.require() : requireState();
  if (!state) return;

  if (!state.mcpServers) state.mcpServers = [];
  const index = state.mcpServers.findIndex((s) => s.name === name);
  if (index === -1) {
    log.warn(`MCP server '${name}' not found.`);
    return;
  }

  state.mcpServers.splice(index, 1);
  state.declinedMcpServers = [...new Set([...(state.declinedMcpServers ?? []), name])];
  if (ctx) ctx.state.save(state);
  else saveState(state);

  log.success("✓", `MCP server '${name}' removed from registry.`);

  // Bridge to mcpm for the MCP_INTERSECTION_AGENTS mcpm intersection (best-effort).
  const mcpmAvailable = isMcpmAvailable();
  if (mcpmAvailable) bridgeRemoveToMcpm(state.agents, name, log);

  const mcpAgents = getMcpTargetAgents(state.agents, { mcpmAvailable });
  pruneServerFromAgents(name, mcpAgents, log);
  log.log("");
}
