import { describe, expect, it, vi } from "vitest";
import type { AgentBrewState, McpServer } from "../types.js";
import { MEMORY_MANAGED_SERVER_NAME, MEMORY_MANAGED_SOURCE, MEMORY_MCP_URL } from "./constants.js";
import {
  disableMemoryInState,
  disableMemory,
  enableMemory,
  enableMemoryInState,
  ensureMemoryMcpServer,
  isManagedMemoryServer,
  isMemoryEnabled,
  mergeMemoryPackPaths,
} from "./enable.js";
import { installMemoryLaunchAgents, memoryLaunchAgentSupported, uninstallMemoryLaunchAgents } from "./launchagent.js";

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
  it.each([false, true])("preserves existing enabled=%s state when an upgrade is refused", (wasEnabled) => {
    const state = baseState();
    if (wasEnabled) enableMemoryInState(state);
    const before = structuredClone(state);
    vi.mocked(memoryLaunchAgentSupported).mockReturnValueOnce(true);
    vi.mocked(installMemoryLaunchAgents).mockReturnValueOnce({
      installed: false,
      upgradeBlocked: true,
      reason: "protected backup required",
    });

    expect(enableMemory(state)).toMatchObject({ enabled: wasEnabled, launchAgent: { upgradeBlocked: true } });
    expect(state).toEqual(before);
  });

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

  it("preserves memory state when service removal fails", () => {
    const state = baseState();
    enableMemoryInState(state);
    mergeMemoryPackPaths(state, ["/tmp/pack-a"]);
    const before = structuredClone(state);
    vi.mocked(uninstallMemoryLaunchAgents).mockImplementationOnce(() => {
      throw new Error("service removal refused");
    });
    expect(() => disableMemory(state)).toThrow("service removal refused");
    expect(state).toEqual(before);
  });
});
