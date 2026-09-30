import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("./state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, saveState: vi.fn(), getStatePath: vi.fn(() => "/tmp/state.yaml") };
});

import { existsSync, readFileSync } from "node:fs";
import { discoverUnmanagedServers, importAll, importFromAgent } from "./import.js";
import { loadState, saveState } from "./state.js";

import type { AgentBrewState } from "./types.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);

function makeState(overrides?: Partial<AgentBrewState>): AgentBrewState {
  return {
    agents: [],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("importFromAgent", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await importFromAgent("cursor");
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("rejects unknown agent name", async () => {
    mockLoadState.mockReturnValue(makeState());
    await importFromAgent("nonexistent");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Unknown agent"));
  });

  it("warns when agent has no MCP config path", async () => {
    mockLoadState.mockReturnValue(makeState());
    await importFromAgent("augment");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("no MCP config"));
  });

  it("warns when config file does not exist", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    await importFromAgent("cursor");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("imports new servers from agent config", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: {
          "my-server": { command: "npx", args: ["my-pkg"] },
          "other-server": { command: "node", args: ["server.js"] },
        },
      }),
    );

    await importFromAgent("cursor");
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0] as AgentBrewState;
    expect(saved.mcpServers).toHaveLength(2);
    expect((saved.mcpServers ?? [])[0].name).toBe("my-server");
    expect((saved.mcpServers ?? [])[0].source).toBe("discovered");
  });

  it("skips servers already in state", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [{ name: "existing", command: "npx", args: [], env: {}, source: "user" }],
      }),
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: {
          existing: { command: "npx", args: ["old-pkg"] },
          "new-one": { command: "node", args: [] },
        },
      }),
    );

    await importFromAgent("cursor");
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0] as AgentBrewState;
    expect(saved.mcpServers).toHaveLength(2);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("already registered"));
  });

  it("does not save when nothing new to import", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        mcpServers: [{ name: "only-one", command: "npx", args: [], env: {}, source: "user" }],
      }),
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: { "only-one": { command: "npx" } },
      }),
    );

    await importFromAgent("cursor");
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("handles empty MCP config", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({}));

    await importFromAgent("cursor");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("No MCP servers found"));
  });
});

describe("importAll", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await importAll();
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("imports from all agents with configs", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.includes("cursor") || path.includes("claude");
    });
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("cursor")) {
        return JSON.stringify({ mcpServers: { "cursor-srv": { command: "npx" } } });
      }
      if (path.includes("claude")) {
        return JSON.stringify({ mcpServers: { "claude-srv": { command: "node" } } });
      }
      return "{}";
    });

    await importAll();
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0] as AgentBrewState;
    expect((saved.mcpServers ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("deduplicates across agents", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: { "shared-srv": { command: "npx" } },
      }),
    );

    await importAll();
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0] as AgentBrewState;
    const sharedCount = (saved.mcpServers ?? []).filter((s) => s.name === "shared-srv").length;
    expect(sharedCount).toBe(1);
  });
});

describe("discoverUnmanagedServers", () => {
  it("returns servers not in state", () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.includes("cursor") || path.includes("claude");
    });
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("cursor")) {
        return JSON.stringify({ mcpServers: { "cursor-srv": { command: "npx" }, known: { command: "node" } } });
      }
      if (path.includes("claude")) {
        return JSON.stringify({ mcpServers: { "claude-srv": { command: "node" } } });
      }
      return "{}";
    });

    const stateNames = new Set(["known"]);
    const unmanaged = discoverUnmanagedServers(stateNames);
    const names = unmanaged.map((u) => u.server);
    expect(names).toContain("cursor-srv");
    expect(names).toContain("claude-srv");
    expect(names).not.toContain("known");
  });

  it("returns empty array when all servers are managed", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcpServers: { managed: { command: "npx" } } }));

    const stateNames = new Set(["managed"]);
    const unmanaged = discoverUnmanagedServers(stateNames);
    expect(unmanaged).toHaveLength(0);
  });

  it("deduplicates across agents", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcpServers: { "shared-srv": { command: "npx" } } }));

    const unmanaged = discoverUnmanagedServers(new Set());
    const sharedCount = unmanaged.filter((u) => u.server === "shared-srv").length;
    expect(sharedCount).toBe(1);
  });

  it("skips unreadable config files gracefully", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("Permission denied");
    });

    const unmanaged = discoverUnmanagedServers(new Set());
    expect(unmanaged).toHaveLength(0);
  });

  it("returns empty when no agent configs exist", () => {
    mockExistsSync.mockReturnValue(false);
    const unmanaged = discoverUnmanagedServers(new Set());
    expect(unmanaged).toHaveLength(0);
  });

  it("excludes servers listed in externalMcpServers", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ mcpServers: { "ext-srv": { command: "npx" }, "local-srv": { command: "node" } } }),
    );

    const stateNames = new Set<string>();
    const externalNames = new Set(["ext-srv"]);
    const unmanaged = discoverUnmanagedServers(stateNames, externalNames);
    const names = unmanaged.map((u) => u.server);
    expect(names).toContain("local-srv");
    expect(names).not.toContain("ext-srv");
  });

  it("excludes mcpm wrapper servers when the underlying server is managed", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ mcpServers: { "mcpm_custom-srv": { command: "mcpm", args: ["run", "custom-srv"] } } }),
    );

    const unmanaged = discoverUnmanagedServers(new Set(["custom-srv"]));
    expect(unmanaged).toHaveLength(0);
  });

  it("excludes mcpm bridge servers managed outside agentbrew state", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ mcpServers: { "mcpm_custom-srv": { command: "mcpm", args: ["run", "custom-srv"] } } }),
    );

    const unmanaged = discoverUnmanagedServers(new Set());
    expect(unmanaged.map((entry) => entry.server)).not.toContain("mcpm_custom-srv");
  });

  it("excludes Devin user-managed HTTP MCP servers by design", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: {
          "example-mcp-server": { url: "http://localhost:3000" },
          "example-mcp-server-e2e": { url: "http://localhost:3001" },
          orphan: { command: "node" },
        },
      }),
    );

    const unmanaged = discoverUnmanagedServers(new Set());
    const names = unmanaged.map((entry) => entry.server);
    expect(names).not.toContain("example-mcp-server");
    expect(names).not.toContain("example-mcp-server-e2e");
    expect(names).toContain("orphan");
  });
});
