import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStateServers } from "../agentfile.js";
import { MCP_INTERSECTION_AGENTS } from "../core/mcp-agent-map.js";
import { loadState } from "../state.js";
import type { AgentBrewState, McpServer } from "../types.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { checkMcpDrift, checkMcpPermissionDrift } from "./mcp.js";

/**
 * Quarantine holds an endpoint out of the fanout on purpose. Before this, the
 * drift checks still measured every agent against the raw state list, so one
 * blocked endpoint reported "missing server" in every agent forever and
 * offered an auto-fix that could never succeed.
 */

let sandbox = "";

vi.mock("../agentfile.js", () => ({
  getConfigServers: vi.fn(() => []),
  getStateServers: vi.fn((state: AgentBrewState) => state.mcpServers ?? []),
}));

vi.mock("../state.js", () => ({
  loadState: vi.fn(),
}));

// Redirect every agent config path into the sandbox so the checks read fixtures
// instead of this machine's real agent configs.
vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return { ...actual, expandHome: (path: string) => join(sandbox, basename(path)) };
});

vi.mock("../mcp/adapters.js", () => ({
  getAdapter: () => ({
    readEntries: (path: string) => {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
      const servers = (parsed as { mcpServers?: Record<string, unknown> }).mcpServers;
      return servers ?? {};
    },
  }),
}));

const mockGetStateServers = vi.mocked(getStateServers);
const mockLoadState = vi.mocked(loadState);

const QUARANTINED = "Blocked Remote";
const HEALTHY = "github";

function server(name: string, quarantine?: McpServer["quarantine"]): McpServer {
  return { name, command: "npx", args: [], env: {}, source: "agentfile", quarantine };
}

function blocked(name: string): McpServer {
  return server(name, { reason: "upstream gateway denies an authenticated user", since: "2020-01-01T00:00:00.000Z" });
}

function stateWith(servers: McpServer[], agentName: string): AgentBrewState {
  return {
    agents: [{ name: agentName, detected: true } as AgentBrewState["agents"][number]],
    sources: [],
    mcpServers: servers,
    memory: { enabled: false },
    catalogVersion: "0.1.0",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetStateServers.mockImplementation((state) => state.mcpServers ?? []);
  sandbox = mkdtempSync(join(tmpdir(), "agentbrew-quarantine-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("checkMcpDrift — quarantined servers", () => {
  /** A drift-checked agent: has an MCP config and is not delegated to mcpm. */
  const agent = AGENT_DEFINITIONS.find((a) => a.mcpConfig && !MCP_INTERSECTION_AGENTS.has(a.name));

  /** Write an agent config deploying exactly `names`. */
  function deploy(names: string[]): void {
    if (!agent?.mcpConfig) return;
    const mcpServers = Object.fromEntries(names.map((name) => [name, { command: "npx" }]));
    writeFileSync(join(sandbox, basename(agent.mcpConfig)), JSON.stringify({ mcpServers }), "utf-8");
  }

  it("reports a healthy server the agent config is missing", () => {
    expect(agent).toBeDefined();
    deploy([]);
    mockLoadState.mockReturnValue(stateWith([server(HEALTHY)], agent?.name ?? ""));

    const details = checkMcpDrift()
      .map((item) => item.detail)
      .join(" ");

    expect(details).toContain(HEALTHY);
  });

  it("does not report a quarantined server as missing", () => {
    expect(agent).toBeDefined();
    deploy([]);
    mockLoadState.mockReturnValue(stateWith([blocked(QUARANTINED)], agent?.name ?? ""));

    expect(checkMcpDrift()).toEqual([]);
  });

  it("reports the healthy server while staying silent about the quarantined one", () => {
    expect(agent).toBeDefined();
    deploy([]);
    mockLoadState.mockReturnValue(stateWith([server(HEALTHY), blocked(QUARANTINED)], agent?.name ?? ""));

    const details = checkMcpDrift()
      .map((item) => item.detail)
      .join(" ");

    expect(details).toContain(HEALTHY);
    expect(details).not.toContain(QUARANTINED);
  });
});

describe("checkMcpPermissionDrift — quarantined servers", () => {
  const agent = AGENT_DEFINITIONS.find((a) => a.mcpPermissionsConfig);

  function writePermissions(allow: string[]): void {
    if (!agent?.mcpPermissionsConfig) return;
    const path = join(sandbox, basename(agent.mcpPermissionsConfig.file));
    writeFileSync(path, JSON.stringify({ permissions: { allow } }), "utf-8");
  }

  it("does not demand a permission entry for a server sync withholds", () => {
    expect(agent).toBeDefined();
    writePermissions([]);
    mockLoadState.mockReturnValue(stateWith([blocked(QUARANTINED)], agent?.name ?? ""));

    expect(checkMcpPermissionDrift().filter((item) => item.detail.includes(QUARANTINED))).toEqual([]);
  });

  it("still demands a permission entry for a healthy server", () => {
    expect(agent).toBeDefined();
    writePermissions([]);
    mockLoadState.mockReturnValue(stateWith([server(HEALTHY)], agent?.name ?? ""));

    const details = checkMcpPermissionDrift()
      .map((item) => item.detail)
      .join(" ");

    expect(details).toContain(HEALTHY);
  });
});
