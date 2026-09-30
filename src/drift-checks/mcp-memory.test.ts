import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStateServers } from "../agentfile.js";
import { MEMORY_MANAGED_SERVER_NAME, MEMORY_MANAGED_SOURCE, MEMORY_MCP_URL } from "../memory/constants.js";
import { loadState } from "../state.js";
import type { AgentBrewState, McpServer } from "../types.js";
import { checkMcpDrift } from "./mcp.js";

vi.mock("../agentfile.js", () => ({
  getConfigServers: vi.fn(() => []),
  getStateServers: vi.fn((state: AgentBrewState) => state.mcpServers ?? []),
}));

vi.mock("../state.js", () => ({
  loadState: vi.fn(),
}));

const mockGetStateServers = vi.mocked(getStateServers);
const mockLoadState = vi.mocked(loadState);

function makeState(mcpServers: McpServer[], enabled = true): AgentBrewState {
  return {
    agents: [],
    sources: [],
    mcpServers,
    memory: { enabled },
    catalogVersion: "0.1.0",
  };
}

function managedMemoryServer(): McpServer {
  return {
    name: MEMORY_MANAGED_SERVER_NAME,
    command: "",
    args: [],
    env: {},
    source: MEMORY_MANAGED_SOURCE,
    url: MEMORY_MCP_URL,
    addedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("checkMcpDrift — managed memory registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStateServers.mockImplementation((state) => state.mcpServers ?? []);
  });

  it("reports enabled memory with a missing managed registration", () => {
    mockLoadState.mockReturnValue(makeState([]));

    expect(checkMcpDrift()).toEqual([
      expect.objectContaining({
        agent: MEMORY_MANAGED_SERVER_NAME,
        type: "mcp",
        detail: expect.stringContaining("is missing"),
        diff: { added: [MEMORY_MANAGED_SERVER_NAME] },
      }),
    ]);
  });

  it("reports a malformed managed registration as repairable drift", () => {
    mockLoadState.mockReturnValue(
      makeState([
        {
          ...managedMemoryServer(),
          command: "node",
          args: ["broken.js"],
          source: "agentfile",
        },
      ]),
    );

    expect(checkMcpDrift()).toEqual([
      expect.objectContaining({
        type: "mcp",
        detail: expect.stringContaining("is malformed"),
        diff: { updated: [MEMORY_MANAGED_SERVER_NAME] },
      }),
    ]);
  });

  it("does not report memory drift when memory is disabled or valid", () => {
    mockLoadState.mockReturnValue(makeState([], false));
    expect(checkMcpDrift()).toEqual([]);

    mockLoadState.mockReturnValue(makeState([managedMemoryServer()]));
    expect(checkMcpDrift()).toEqual([]);
  });
});
