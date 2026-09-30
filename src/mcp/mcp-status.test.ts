import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../catalog/types.js", () => ({
  loadCatalog: vi.fn(),
}));

vi.mock("../state.js", () => ({
  requireState: vi.fn(),
  loadState: vi.fn(),
}));

vi.mock("./mcp-validation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mcp-validation.js")>();
  return { ...actual };
});

import type { CatalogMcpServer } from "../catalog/types.js";
import { loadCatalog } from "../catalog/types.js";
import { loadState, requireState } from "../state.js";
import type { AgentBrewState, McpServer } from "../types.js";
import { getInstalledMcpStatus, getMcpStatus, getSetupInstructions, showMcpStatus } from "./mcp-status.js";

const mockLoadCatalog = vi.mocked(loadCatalog);
const mockRequireState = vi.mocked(requireState);
const mockLoadState = vi.mocked(loadState);

function makeCatalogServer(overrides: Partial<CatalogMcpServer> = {}): CatalogMcpServer {
  return {
    name: "catalog-server",
    description: "A catalog server",
    command: "npx",
    args: [],
    category: "productivity",
    recommended: false,
    ...overrides,
  };
}

function makeInstalledServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    name: "installed-server",
    command: "npx",
    args: [],
    env: {},
    source: "catalog",
    ...overrides,
  };
}

function makeState(mcpServers: McpServer[] = []): AgentBrewState {
  return {
    agents: [],
    sources: [],
    mcpServers,
    catalogVersion: "1.0.0",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mockLoadCatalog.mockReturnValue({
    skills: [],
    mcp_servers: [],
    rules: [],
  });
  mockRequireState.mockReturnValue(undefined);
  mockLoadState.mockReturnValue(undefined);
});

describe("getMcpStatus", () => {
  it("returns empty array when catalog has no servers", () => {
    expect(getMcpStatus()).toEqual([]);
  });

  it("marks server as not installed when absent from state", () => {
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [makeCatalogServer()], rules: [] });
    mockRequireState.mockReturnValue(makeState([]));
    mockLoadState.mockReturnValue(makeState([]));

    const statuses = getMcpStatus();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].installed).toBe(false);
    expect(statuses[0].ready).toBe(false);
  });

  it("marks server as installed when present in state", () => {
    const server = makeCatalogServer({ name: "my-server" });
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [server], rules: [] });
    mockRequireState.mockReturnValue(makeState([makeInstalledServer({ name: "my-server" })]));
    mockLoadState.mockReturnValue(makeState([makeInstalledServer({ name: "my-server" })]));

    const statuses = getMcpStatus();
    expect(statuses[0].installed).toBe(true);
  });

  it("marks server as ready when installed and all env vars resolved", () => {
    process.env.RESOLVED_API_KEY = "value";
    const server = makeCatalogServer({ name: "ready-server", env: { K: "${RESOLVED_API_KEY}" } });
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [server], rules: [] });
    mockRequireState.mockReturnValue(makeState([makeInstalledServer({ name: "ready-server" })]));
    mockLoadState.mockReturnValue(makeState([makeInstalledServer({ name: "ready-server" })]));

    const statuses = getMcpStatus();
    expect(statuses[0].ready).toBe(true);
    expect(statuses[0].missingVars).toEqual([]);
    delete process.env.RESOLVED_API_KEY;
  });

  it("marks server as not ready when installed but missing env vars", () => {
    delete process.env.MISSING_API_KEY;
    const server = makeCatalogServer({ name: "needs-setup", env: { K: "${MISSING_API_KEY}" } });
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [server], rules: [] });
    mockRequireState.mockReturnValue(makeState([makeInstalledServer({ name: "needs-setup" })]));
    mockLoadState.mockReturnValue(makeState([makeInstalledServer({ name: "needs-setup" })]));

    const statuses = getMcpStatus();
    expect(statuses[0].ready).toBe(false);
    expect(statuses[0].missingVars).toContain("MISSING_API_KEY");
  });

  it("includes note field from catalog server", () => {
    const server = makeCatalogServer({ note: "requires paid plan" });
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [server], rules: [] });

    const statuses = getMcpStatus();
    expect(statuses[0].note).toBe("requires paid plan");
  });

  it("handles null state gracefully — no installed servers", () => {
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [makeCatalogServer()], rules: [] });
    mockRequireState.mockReturnValue(undefined);
    mockLoadState.mockReturnValue(undefined);

    const statuses = getMcpStatus();
    expect(statuses[0].installed).toBe(false);
  });

  it("maps name, description, and category from catalog", () => {
    const server = makeCatalogServer({ name: "srv", description: "desc", category: "cat" });
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [server], rules: [] });

    const statuses = getMcpStatus();
    expect(statuses[0].name).toBe("srv");
    expect(statuses[0].description).toBe("desc");
    expect(statuses[0].category).toBe("cat");
  });

  it("includes installed servers that are not in the catalog", () => {
    const state = makeState([makeInstalledServer({ name: "custom-srv", source: "user" })]);
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [], rules: [] });
    mockRequireState.mockReturnValue(state);
    mockLoadState.mockReturnValue(state);

    const statuses = getMcpStatus();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ name: "custom-srv", installed: true, category: "user" });
  });
});

describe("getInstalledMcpStatus", () => {
  it("returns empty array when state is null", () => {
    mockRequireState.mockReturnValue(undefined);
    mockLoadState.mockReturnValue(undefined);
    expect(getInstalledMcpStatus()).toEqual([]);
  });

  it("returns empty array when no servers are installed", () => {
    mockRequireState.mockReturnValue(makeState([]));
    mockLoadState.mockReturnValue(makeState([]));
    expect(getInstalledMcpStatus()).toEqual([]);
  });

  it("returns status for each installed server", () => {
    const state = makeState([makeInstalledServer({ name: "srv-a" }), makeInstalledServer({ name: "srv-b" })]);
    mockRequireState.mockReturnValue(state);
    mockLoadState.mockReturnValue(state);

    const statuses = getInstalledMcpStatus();
    expect(statuses).toHaveLength(2);
    expect(statuses.map((s) => s.name)).toEqual(["srv-a", "srv-b"]);
  });

  it("marks all returned servers as installed=true", () => {
    mockRequireState.mockReturnValue(makeState([makeInstalledServer()]));
    mockLoadState.mockReturnValue(makeState([makeInstalledServer()]));
    const statuses = getInstalledMcpStatus();
    expect(statuses[0].installed).toBe(true);
  });

  it("marks server as ready when no env vars are missing", () => {
    mockRequireState.mockReturnValue(makeState([makeInstalledServer({ env: {} })]));
    mockLoadState.mockReturnValue(makeState([makeInstalledServer({ env: {} })]));
    const statuses = getInstalledMcpStatus();
    expect(statuses[0].ready).toBe(true);
    expect(statuses[0].missingVars).toEqual([]);
  });

  it("marks server as not ready when env vars are missing", () => {
    delete process.env.MISSING_STATE_VAR;
    mockRequireState.mockReturnValue(makeState([makeInstalledServer({ env: { K: "${MISSING_STATE_VAR}" } })]));
    mockLoadState.mockReturnValue(makeState([makeInstalledServer({ env: { K: "${MISSING_STATE_VAR}" } })]));
    const statuses = getInstalledMcpStatus();
    expect(statuses[0].ready).toBe(false);
    expect(statuses[0].missingVars).toContain("MISSING_STATE_VAR");
  });

  it("uses source field as category", () => {
    mockRequireState.mockReturnValue(makeState([makeInstalledServer({ source: "user" })]));
    mockLoadState.mockReturnValue(makeState([makeInstalledServer({ source: "user" })]));
    const statuses = getInstalledMcpStatus();
    expect(statuses[0].category).toBe("user");
  });
});

describe("getSetupInstructions", () => {
  it("returns empty object when server is not in catalog", () => {
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [], rules: [] });
    expect(getSetupInstructions("nonexistent")).toEqual({});
  });

  it("returns empty object when server has no setup field", () => {
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [makeCatalogServer({ name: "srv" })], rules: [] });
    expect(getSetupInstructions("srv")).toEqual({});
  });

  it("returns setup instructions for a server that has them", () => {
    const setup = { MY_TOKEN: { description: "Your API token", link: "https://example.com/tokens" } };
    const server = makeCatalogServer({ name: "srv-with-setup", setup });
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [server], rules: [] });

    const instructions = getSetupInstructions("srv-with-setup");
    expect(instructions).toEqual(setup);
  });
});

describe("showMcpStatus", () => {
  it("prints JSON when json option is set", () => {
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [makeCatalogServer()], rules: [] });
    mockRequireState.mockReturnValue(makeState([]));
    mockLoadState.mockReturnValue(makeState([]));

    showMcpStatus({ json: true });

    const output = vi.mocked(console.log).mock.calls[0][0] as string;
    const parsed = JSON.parse(output) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("prints 'no servers installed' message when none are installed", () => {
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [], rules: [] });
    mockRequireState.mockReturnValue(makeState([]));
    mockLoadState.mockReturnValue(makeState([]));

    showMcpStatus();

    const allOutput = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(" ");
    expect(allOutput).toContain("No MCP servers installed");
  });

  it("prints installed servers section when servers are installed", () => {
    const server = makeCatalogServer({ name: "my-srv" });
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [server], rules: [] });
    mockRequireState.mockReturnValue(makeState([makeInstalledServer({ name: "my-srv" })]));
    mockLoadState.mockReturnValue(makeState([makeInstalledServer({ name: "my-srv" })]));

    showMcpStatus();

    const allOutput = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(" ");
    expect(allOutput).toContain("Installed");
    expect(allOutput).toContain("my-srv");
  });

  it("prints installed custom servers that are absent from the catalog", () => {
    const state = makeState([makeInstalledServer({ name: "custom-srv", source: "user" })]);
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [], rules: [] });
    mockRequireState.mockReturnValue(state);
    mockLoadState.mockReturnValue(state);

    showMcpStatus();

    const allOutput = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(" ");
    expect(allOutput).toContain("Installed");
    expect(allOutput).toContain("custom-srv");
  });

  it("shows available servers when --all flag is set", () => {
    const server = makeCatalogServer({ name: "available-srv" });
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [server], rules: [] });
    mockRequireState.mockReturnValue(makeState([]));
    mockLoadState.mockReturnValue(makeState([]));

    showMcpStatus({ all: true });

    const allOutput = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(" ");
    expect(allOutput).toContain("Available");
    expect(allOutput).toContain("available-srv");
  });

  it("does not show available section without --all flag", () => {
    const server = makeCatalogServer({ name: "hidden-srv" });
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [server], rules: [] });
    mockRequireState.mockReturnValue(makeState([]));
    mockLoadState.mockReturnValue(makeState([]));

    showMcpStatus();

    const allOutput = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(" ");
    expect(allOutput).not.toContain("Available");
  });

  it("prints 'all servers ready' when all installed servers have vars resolved", () => {
    const server = makeCatalogServer({ name: "ready-srv" });
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [server], rules: [] });
    mockRequireState.mockReturnValue(makeState([makeInstalledServer({ name: "ready-srv", env: {} })]));
    mockLoadState.mockReturnValue(makeState([makeInstalledServer({ name: "ready-srv", env: {} })]));

    showMcpStatus();

    const allOutput = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(" ");
    expect(allOutput).toContain("ready");
  });
});
