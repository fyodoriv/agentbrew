import { describe, expect, it, vi } from "vitest";
import type { AgentBrewState, McpServer } from "../types.js";
import { MEMORY_MANAGED_SERVER_NAME, MEMORY_MANAGED_SOURCE, MEMORY_MCP_URL } from "./constants.js";
import {
  disableMemoryInState,
  enableMemoryInState,
  ensureMemoryMcpServer,
  isManagedMemoryServer,
  isMemoryEnabled,
  mergeMemoryPackPaths,
  removeTeamMemoryPackPaths,
} from "./enable.js";

vi.mock("./launchagent.js", () => ({
  installMemoryLaunchAgents: vi.fn(() => ({ installed: true })),
  uninstallMemoryLaunchAgents: vi.fn(),
  memoryLaunchAgentSupported: vi.fn(() => false),
}));

function baseState(): AgentBrewState {
  return {
    agents: [],
    catalogVersion: "0.3.0",
    mcpServers: [],
  };
}

describe("memory enable state wiring", () => {
  it("wires shared HTTP MCP server into state on enable", () => {
    const state = baseState();
    enableMemoryInState(state);
    expect(isMemoryEnabled(state)).toBe(true);
    const server = state.mcpServers?.find((s) => s.name === MEMORY_MANAGED_SERVER_NAME);
    expect(server).toMatchObject({
      name: MEMORY_MANAGED_SERVER_NAME,
      source: MEMORY_MANAGED_SOURCE,
      url: MEMORY_MCP_URL,
    } satisfies Partial<McpServer>);
  });

  it("repairs missing and malformed registration idempotently", () => {
    const state = baseState();
    state.memory = { enabled: true };

    expect(ensureMemoryMcpServer(state)).toBe(true);
    const first = state.mcpServers?.[0];
    expect(first).toBeDefined();
    expect(isManagedMemoryServer(first)).toBe(true);
    expect(ensureMemoryMcpServer(state)).toBe(false);
    expect(state.mcpServers?.[0]).toBe(first);

    state.mcpServers![0] = {
      ...first!,
      command: "node",
      args: ["broken.js"],
      env: { BROKEN: "1" },
      source: "agentfile",
      url: "http://127.0.0.1:9999/mcp",
      headers: { Authorization: "stale" },
    };

    expect(ensureMemoryMcpServer(state)).toBe(true);
    expect(isManagedMemoryServer(state.mcpServers?.[0])).toBe(true);
    expect(state.mcpServers?.[0].addedAt).toBe(first?.addedAt);
    expect(ensureMemoryMcpServer(state)).toBe(false);
  });

  it("disable removes managed wiring but preserves pack paths", () => {
    const state = baseState();
    enableMemoryInState(state);
    mergeMemoryPackPaths(state, ["/tmp/pack-a"]);
    disableMemoryInState(state);
    expect(isMemoryEnabled(state)).toBe(false);
    expect(state.mcpServers?.some((s) => s.source === MEMORY_MANAGED_SOURCE)).toBe(false);
    expect(state.memory?.packPaths).toEqual(["/tmp/pack-a"]);
  });

  it("team unset removes overlay pack paths without touching enabled flag", () => {
    const state = baseState();
    mergeMemoryPackPaths(state, ["/tmp/global", "/tmp/team-pack"]);
    removeTeamMemoryPackPaths(state, ["/tmp/team-pack"]);
    expect(state.memory?.packPaths).toEqual(["/tmp/global"]);
  });
});
