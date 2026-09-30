import type { AgentBrewState, McpServer } from "../types.js";
import { MEMORY_MANAGED_SERVER_NAME, MEMORY_MANAGED_SOURCE, MEMORY_MCP_URL } from "./constants.js";
import { installMemoryLaunchAgents, memoryLaunchAgentSupported, uninstallMemoryLaunchAgents } from "./launchagent.js";

export interface MemoryEnableResult {
  enabled: boolean;
  launchAgent: { installed: boolean; reason?: string };
}

export function isMemoryEnabled(state: AgentBrewState): boolean {
  return state.memory?.enabled === true;
}

function buildManagedMemoryServer(addedAt = new Date().toISOString()): McpServer {
  return {
    name: MEMORY_MANAGED_SERVER_NAME,
    command: "",
    args: [],
    env: {},
    source: MEMORY_MANAGED_SOURCE,
    url: MEMORY_MCP_URL,
    addedAt,
  };
}

function hasNoEntries(value: Record<string, string> | undefined): boolean {
  return value === undefined || Object.keys(value).length === 0;
}

/** Return true when an entry has the exact managed shared-memory transport shape. */
export function isManagedMemoryServer(server: McpServer | undefined): boolean {
  return (
    server !== undefined &&
    server.name === MEMORY_MANAGED_SERVER_NAME &&
    server.command === "" &&
    Array.isArray(server.args) &&
    server.args.length === 0 &&
    hasNoEntries(server.env) &&
    server.source === MEMORY_MANAGED_SOURCE &&
    server.url === MEMORY_MCP_URL &&
    server.headers === undefined &&
    server.gitUrl === undefined &&
    server.gitRef === undefined
  );
}

/** Repair the managed shared-memory MCP entry without changing user memory data. */
export function ensureMemoryMcpServer(state: AgentBrewState): boolean {
  if (!isMemoryEnabled(state)) return false;
  if (!state.mcpServers) state.mcpServers = [];

  const index = state.mcpServers.findIndex((server) => server.name === MEMORY_MANAGED_SERVER_NAME);
  if (index === -1) {
    state.mcpServers.push(buildManagedMemoryServer());
    return true;
  }

  const existing = state.mcpServers[index];
  const managed = buildManagedMemoryServer(existing.addedAt);
  if (isManagedMemoryServer(existing) && existing.addedAt === managed.addedAt) return false;

  state.mcpServers[index] = managed;
  return true;
}

/** Wire shared HTTP memory MCP into state; does not delete SQLite data on disable. */
export function enableMemoryInState(state: AgentBrewState): McpServer {
  state.memory = { ...state.memory, enabled: true };
  ensureMemoryMcpServer(state);
  const managed = state.mcpServers?.find((server) => server.name === MEMORY_MANAGED_SERVER_NAME);
  if (!managed) throw new Error("failed to wire the managed memory MCP server");
  return managed;
}

export function disableMemoryInState(state: AgentBrewState): void {
  if (state.memory) {
    state.memory.enabled = false;
  } else {
    state.memory = { enabled: false };
  }
  if (!state.mcpServers) return;
  state.mcpServers = state.mcpServers.filter(
    (s) => !(s.name === MEMORY_MANAGED_SERVER_NAME && s.source === MEMORY_MANAGED_SOURCE),
  );
  // Preserve memory.packPaths and ledgers — disable only removes managed wiring.
}

export function enableMemory(state: AgentBrewState): MemoryEnableResult {
  enableMemoryInState(state);
  const launchAgent = memoryLaunchAgentSupported()
    ? installMemoryLaunchAgents()
    : { installed: false, reason: "no boot persistence on non-macOS" };
  return { enabled: true, launchAgent };
}

export function disableMemory(state: AgentBrewState): void {
  disableMemoryInState(state);
  uninstallMemoryLaunchAgents();
}

export function mergeMemoryPackPaths(state: AgentBrewState, paths: string[]): void {
  const existing = new Set(state.memory?.packPaths ?? []);
  for (const p of paths) existing.add(p);
  state.memory = { ...state.memory, enabled: state.memory?.enabled, packPaths: [...existing] };
}

/** Team unset removes overlay pack paths from state but never touches ledgers or SQLite rows. */
export function removeTeamMemoryPackPaths(state: AgentBrewState, paths: string[]): void {
  if (!state.memory?.packPaths?.length) return;
  const remove = new Set(paths);
  const packPaths = state.memory.packPaths.filter((p) => !remove.has(p));
  state.memory = { ...state.memory, packPaths };
}

export function getMemoryPackSearchPaths(state: AgentBrewState, extra: string[] = []): string[] {
  return [...new Set([...(state.memory?.packPaths ?? []), ...extra])];
}
