import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContext } from "../core/context.js";
import { resolveMcpCursorLauncher } from "../mcp/cursor-gui-launch.js";
import { makeMcpAgentDef } from "../test-utils/mcp-fixtures.js";
import type { AgentBrewState, McpServer } from "../types.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({
    status: 0,
    stdout: Buffer.from(""),
    stderr: Buffer.from(""),
    error: null,
    pid: 0,
    signal: null,
    output: [],
  })),
  // resolveFromKeychain + resolveGitHubToken in src/mcp/env-vars.ts use execFileSync —
  // default to throwing so unmocked tests see "Keychain miss" / "gh auth token miss".
  // Per-test overrides via `vi.mocked(execFileSync).mockReturnValueOnce(...)`.
  execFileSync: vi.fn(() => {
    throw new Error("execFileSync mocked: no return value configured for this test");
  }),
}));

vi.mock("../state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, saveState: vi.fn() };
});

vi.mock("../import.js", () => ({
  discoverUnmanagedServers: vi.fn(() => []),
}));

vi.mock("../memory/sync-hooks.js", () => ({
  prepareMemoryForMcpSync: vi.fn(async () => {}),
  syncInstalledMemoryPacks: vi.fn(async () => {}),
}));

vi.mock("./mcp-delegate.js", () => ({
  delegateMcpClientEdit: vi.fn(() => ({ ok: false, carveOuts: [], perClient: [] })),
  delegateMcpUninstall: vi.fn(() => ({
    ok: false,
    carveOuts: [],
    perClient: [],
    globalUninstall: { ok: false },
  })),
  delegateMcpNew: vi.fn(() => ({ ok: false })),
  mcpServerConfigEquals: vi.fn((left, right) => JSON.stringify(left) === JSON.stringify(right)),
  readMcpmServer: vi.fn(() => undefined),
}));

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { sync as writeFileSync } from "write-file-atomic";
import { discoverUnmanagedServers } from "../import.js";
import * as adapters from "../mcp/adapters.js";
import { JsonAdapter } from "../mcp/adapters.js";
import { loadState, saveState } from "../state.js";
import { delegateMcpClientEdit, delegateMcpNew, mcpServerConfigEquals, readMcpmServer } from "./mcp-delegate.js";
import {
  addMcpServer,
  computeDiffWithAdapter,
  computeServerList,
  filterServersForLiteralAgent,
  getMcpmIntersectionAgents,
  getMcpTargetAgents,
  removeMcpServer,
  requiresNativeHttpTransport,
  syncDevinPermissions,
  syncMcpPermissions,
  syncMcpServers,
  syncWithAdapter,
} from "./mcp-sync.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockSpawnSync = vi.mocked(spawnSync);
const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);
const mockDiscoverUnmanagedServers = vi.mocked(discoverUnmanagedServers);
const mockDelegateMcpClientEdit = vi.mocked(delegateMcpClientEdit);
const mockDelegateMcpNew = vi.mocked(delegateMcpNew);
const mockMcpServerConfigEquals = vi.mocked(mcpServerConfigEquals);
const mockReadMcpmServer = vi.mocked(readMcpmServer);

beforeEach(() => {
  vi.clearAllMocks();
  mockDiscoverUnmanagedServers.mockReset();
  mockDiscoverUnmanagedServers.mockReturnValue([]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    name: "test-server",
    command: "npx",
    args: ["-y", "@test/mcp"],
    env: {},
    source: "user",
    ...overrides,
  };
}

describe("syncMcpServers", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await syncMcpServers();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("skips when no servers", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    await syncMcpServers();
    expect(console.log).toHaveBeenCalledWith("No MCP servers to sync.");
  });

  it("persists a repaired memory registration through the active context before fan-out", async () => {
    const state: AgentBrewState = {
      agents: [],
      sources: [],
      mcpServers: [],
      memory: { enabled: true },
      catalogVersion: "0.1.0",
    };
    const ctx = createTestContext(state);
    const save = vi.spyOn(ctx.state, "save");

    await syncMcpServers({ quiet: true }, ctx);

    expect(save).toHaveBeenCalledTimes(1);
    expect(ctx.stateManager.current?.mcpServers?.[0]).toMatchObject({
      name: "memory",
      source: "agentbrew-memory",
      url: "http://127.0.0.1:18765/mcp",
    });

    await syncMcpServers({ quiet: true }, ctx);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps the managed loopback memory transport reachable by every primary agent", () => {
    const primary = ["claude-code", "cursor", "windsurf", "devin", "codex"].map((name) => makeMcpAgentDef(name));
    const memory = makeServer({ name: "memory", command: "", args: [], url: "http://127.0.0.1:18765/mcp" });

    expect(requiresNativeHttpTransport(memory)).toBe(false);
    expect(getMcpTargetAgents(primary).map((agent) => agent.name)).toEqual(["cursor", "windsurf", "devin"]);
    expect(getMcpmIntersectionAgents(primary).map((agent) => agent.name)).toEqual(["claude-code", "codex"]);
  });

  it("syncs to non-claude agents via JSON", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro")],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");

    await syncMcpServers();
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("writes Devin MCP config without resolved shell-backed env secrets", async () => {
    const previousSecret = process.env.DEVIN_SYNC_SECRET;
    process.env.DEVIN_SYNC_SECRET = "sync-secret-should-not-be-written";
    let stored = JSON.stringify({ mcpServers: {}, permissions: { allow: [] } });
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("devin", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer({ name: "secure", env: { DEVIN_SYNC_SECRET: "${DEVIN_SYNC_SECRET}", APP_ENV: "dev" } })],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => stored);
    mockWriteFileSync.mockImplementation((_path: string | Buffer, data: string | Buffer) => {
      stored = String(data);
    });

    try {
      await syncMcpServers(undefined, { manifest: { hashes: {} } });
      const written = JSON.parse(stored);
      expect(written.mcpServers.secure.env).toEqual({ APP_ENV: "dev" });
      expect(stored).not.toContain("sync-secret-should-not-be-written");
      expect(written.permissions.allow).toContain("mcp__secure__*");
    } finally {
      if (previousSecret === undefined) delete process.env.DEVIN_SYNC_SECRET;
      else process.env.DEVIN_SYNC_SECRET = previousSecret;
    }
  });

  it("preserves manually fixed Devin entries during prune when shell env is temporarily absent", async () => {
    const previousSecret = process.env.DEVIN_TEMPORARILY_MISSING;
    delete process.env.DEVIN_TEMPORARILY_MISSING;
    let stored = JSON.stringify({
      mcpServers: {
        secure: {
          command: "npx",
          args: ["-y", "@test/mcp"],
          env: { DEVIN_TEMPORARILY_MISSING: "manual-token" },
        },
      },
      permissions: { allow: [] },
    });
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("devin", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer({ name: "secure", env: { DEVIN_TEMPORARILY_MISSING: "${DEVIN_TEMPORARILY_MISSING}" } })],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => stored);
    mockWriteFileSync.mockImplementation((_path: string | Buffer, data: string | Buffer) => {
      stored = String(data);
    });

    try {
      await syncMcpServers({ prune: true }, { manifest: { hashes: {} } });
      const written = JSON.parse(stored);
      expect(written.mcpServers.secure.env.DEVIN_TEMPORARILY_MISSING).toBe("manual-token");
      expect(written.permissions.allow).toContain("mcp__secure__*");
    } finally {
      if (previousSecret !== undefined) process.env.DEVIN_TEMPORARILY_MISSING = previousSecret;
    }
  });

  it("writes Cursor CLI MCP permissions while Cursor MCP config is delegated to mcpm", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("cursor", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer({ name: "context7" })],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path) => {
      if (String(path).endsWith("/.cursor/cli-config.json")) {
        return JSON.stringify({ permissions: { allow: ["Shell(ls)"], deny: [] }, approvalMode: "allowlist" });
      }
      return "{}";
    });

    await syncMcpServers(undefined, { manifest: { hashes: {} } });

    const cliConfigWrite = mockWriteFileSync.mock.calls.find(([path]) =>
      String(path).endsWith("/.cursor/cli-config.json"),
    );
    expect(cliConfigWrite).toBeDefined();
    const written = JSON.parse(String(cliConfigWrite?.[1]));
    expect(written.permissions.allow).toEqual(["Shell(ls)", "mcp__context7__*"]);
    expect(written.approvalMode).toBe("allowlist");
  });
});

describe("addMcpServer", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await addMcpServer("test", "npx", [], {});
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("adds a new server to state", async () => {
    const state = {
      agents: [],
      sources: [],
      mcpServers: [] as McpServer[],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    await addMcpServer("new-server", "npx", ["-y", "@test/mcp"], {});
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0];
    expect(saved.mcpServers).toHaveLength(1);
    expect((saved.mcpServers ?? [])[0].name).toBe("new-server");
  });

  it("updates existing server", async () => {
    const state = {
      agents: [],
      sources: [],
      mcpServers: [makeServer({ name: "existing" })],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    await addMcpServer("existing", "node", ["server.js"], {});
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0];
    expect(saved.mcpServers).toHaveLength(1);
    expect((saved.mcpServers ?? [])[0].command).toBe("node");
  });

  it("adds a URL-based server with headers", async () => {
    const state = {
      agents: [],
      sources: [],
      mcpServers: [] as McpServer[],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    await addMcpServer(
      "remote",
      "",
      [],
      {},
      {
        url: "https://api.example.com/mcp",
        headers: { Authorization: "Bearer ${TOKEN}" },
      },
    );
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0];
    expect(saved.mcpServers).toHaveLength(1);
    expect((saved.mcpServers ?? [])[0].url).toBe("https://api.example.com/mcp");
    expect((saved.mcpServers ?? [])[0].headers).toEqual({ Authorization: "Bearer ${TOKEN}" });
  });
});

describe("removeMcpServer", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await removeMcpServer("test");
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("warns when server not found", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    await removeMcpServer("nonexistent");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("removes server from state and agent configs", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer({ name: "remove-me" })],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{"remove-me":{"command":"npx"}}}');

    await removeMcpServer("remove-me");
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0];
    expect(saved.mcpServers).toHaveLength(0);
  });

  it("records the removed server so recommended installs skip it", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [makeServer({ name: "remove-me" })],
      declinedMcpServers: ["older"],
      catalogVersion: "0.1.0",
    });

    await removeMcpServer("remove-me");
    const saved = mockSaveState.mock.calls[0][0];
    expect(saved.declinedMcpServers).toEqual(["older", "remove-me"]);
  });
});

describe("addMcpServer — declined servers", () => {
  it("clears the declined record when the user adds the server back", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      declinedMcpServers: ["back-again", "other"],
      catalogVersion: "0.1.0",
    });

    await addMcpServer("back-again", "npx", ["-y", "back-again"], {});
    const saved = mockSaveState.mock.calls.at(-1)?.[0];
    expect(saved?.declinedMcpServers).toEqual(["other"]);
  });
});

// Slice 4a of `delegate-mcp-to-mcpm`: claude-code is in MCP_INTERSECTION_AGENTS
// intersection that's now mcpm-managed. Native sync filters it out
// (see `getMcpTargetAgents`); native remove also skips it because it
// uses the same agent list. The pre-slice-4a tests asserting `claude
// mcp add-json` / `claude mcp remove` CLI calls during sync/remove no
// longer apply — those code paths (`syncToClaudeCode`, the claude-code
// branch in `syncSingleAgent`, the claude CLI bridge in
// `ClaudeAdapter.syncViaCli`) become unreachable from the public API
// and are scheduled for physical deletion in slice 4b.
describe("syncMcpServers — claude-code intersection skip (slice 4a)", () => {
  it("does not invoke claude CLI when claude-code is the only detected agent", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "~/.claude.json" }],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");

    await syncMcpServers();

    // No spawnSync calls — claude-code is filtered out of native sync.
    // Pre-slice-4a, this would have invoked `claude mcp add-json`.
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("does not write ~/.claude.json when claude-code is the only detected agent", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "~/.claude.json" }],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");
    mockWriteFileSync.mockClear();

    await syncMcpServers();

    const writtenPaths = mockWriteFileSync.mock.calls.map((c) => String(c[0]));
    expect(writtenPaths.some((p) => p.includes(".claude.json"))).toBe(false);
  });

  it("logs a one-line dim note that claude-code is mcpm-managed during sync", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "~/.claude.json" }],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");

    await syncMcpServers();

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).toContain("claude-code");
    expect(calls).toContain("mcpm-managed");
  });
});

describe("removeMcpServer — claude-code intersection skip (slice 4a)", () => {
  it("does not invoke claude CLI removal for claude-code (intersection skipped)", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "~/.claude.json" }],
      sources: [],
      mcpServers: [makeServer({ name: "remove-me" })],
      catalogVersion: "0.1.0",
    });

    await removeMcpServer("remove-me");

    // Pre-slice-4a: would invoke `claude mcp remove remove-me`.
    // Post-slice-4a: claude-code is filtered, no CLI call.
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("continues to next agent when removeMcpServer encounters a write error (carve-out path)", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer({ name: "srv" })],
      catalogVersion: "0.1.0",
    });
    // readFileSync returns valid JSON with the server, so removeServer tries to write
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcpServers: { srv: { command: "x" } } }));
    mockWriteFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    await removeMcpServer("srv");
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("permission denied");
  });
});

// State is authoritative for the mcpm intersection. Exact config comparison
// keeps no-op syncs cheap while repairing same-name transport/backend drift.
describe("syncMcpServers — bridgeStateMcpToMcpm", () => {
  beforeEach(() => {
    mockMcpServerConfigEquals.mockReturnValue(true);
    mockDelegateMcpNew.mockReturnValue({ ok: true, stdout: "" });
    mockReadMcpmServer.mockReturnValue(makeServer({ name: "any-server" }));
    mockDelegateMcpClientEdit.mockReturnValue({
      ok: true,
      carveOuts: [],
      perClient: [{ client: "claude-code", ok: true }],
    });
    // claude-code now syncs MCP permissions to ~/.claude/settings.json after bridge.
    mockExistsSync.mockReturnValue(true);
    mockWriteFileSync.mockImplementation(() => {});
    mockReadFileSync.mockImplementation((path) => {
      const p = String(path);
      if (p.includes("settings.json")) {
        return JSON.stringify({ permissions: { allow: ["Read(**)"] } });
      }
      if (p.includes(".claude.json")) {
        return JSON.stringify({ mcpServers: { mcpm_time: { command: "mcpm" }, mcpm_fetch: { command: "mcpm" } } });
      }
      return "{}";
    });
  });

  it("re-wires a server that an intersection client cannot reach even when mcpm matches", async () => {
    mockMcpServerConfigEquals.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path) => {
      const p = String(path);
      if (p.includes(".claude.json")) return JSON.stringify({ mcpServers: { mcpm_time: { command: "mcpm" } } });
      return "{}";
    });
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "~/.claude.json" }],
      sources: [],
      mcpServers: [makeServer({ name: "time" }), makeServer({ name: "fetch" })],
      catalogVersion: "0.1.0",
    });

    await syncMcpServers();

    expect(mockDelegateMcpNew).toHaveBeenCalledTimes(1);
    expect(mockDelegateMcpNew).toHaveBeenCalledWith(expect.objectContaining({ serverName: "fetch" }));
    expect(mockDelegateMcpClientEdit).toHaveBeenCalledTimes(1);
  });

  it("registers exact state definitions and edits clients when claude-code is detected", async () => {
    mockMcpServerConfigEquals.mockReturnValueOnce(false).mockReturnValueOnce(false);
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "~/.claude.json" }],
      sources: [],
      mcpServers: [makeServer({ name: "time" }), makeServer({ name: "fetch" })],
      catalogVersion: "0.1.0",
    });

    await syncMcpServers();

    expect(mockDelegateMcpNew).toHaveBeenCalledTimes(2);
    expect(mockDelegateMcpNew).toHaveBeenCalledWith(expect.objectContaining({ serverName: "time", command: "npx" }));
    expect(mockDelegateMcpNew).toHaveBeenCalledWith(expect.objectContaining({ serverName: "fetch", command: "npx" }));
    expect(mockDelegateMcpClientEdit).toHaveBeenCalledTimes(2);
  });

  it("re-registers a same-name server when its mcpm definition differs", async () => {
    mockMcpServerConfigEquals.mockReturnValueOnce(true).mockReturnValueOnce(false);
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "~/.claude.json" }],
      sources: [],
      mcpServers: [makeServer({ name: "time" }), makeServer({ name: "fetch" })],
      catalogVersion: "0.1.0",
    });

    await syncMcpServers();

    expect(mockDelegateMcpNew).toHaveBeenCalledTimes(1);
    expect(mockDelegateMcpNew).toHaveBeenCalledWith(expect.objectContaining({ serverName: "fetch" }));
  });

  it("skips the bridge when every state definition already matches mcpm", async () => {
    mockMcpServerConfigEquals.mockReturnValue(true);
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "~/.claude.json" }],
      sources: [],
      mcpServers: [makeServer({ name: "time" }), makeServer({ name: "fetch" })],
      catalogVersion: "0.1.0",
    });

    await syncMcpServers();

    expect(mockDelegateMcpNew).not.toHaveBeenCalled();
    expect(mockDelegateMcpClientEdit).not.toHaveBeenCalled();
  });

  it("does not call the bridge when no intersection agents are detected (carve-outs only)", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");

    await syncMcpServers();

    expect(mockDelegateMcpNew).not.toHaveBeenCalled();
    expect(mockDelegateMcpClientEdit).not.toHaveBeenCalled();
  });

  it("does not call the bridge when no agents are detected at all", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });

    await syncMcpServers();

    expect(mockDelegateMcpNew).not.toHaveBeenCalled();
    expect(mockDelegateMcpClientEdit).not.toHaveBeenCalled();
  });

  it("skips client editing when exact registration fails", async () => {
    mockMcpServerConfigEquals.mockReturnValueOnce(false);
    mockDelegateMcpNew.mockReturnValue({ ok: false, stderr: "registration failed" });
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "~/.claude.json" }],
      sources: [],
      mcpServers: [makeServer({ name: "time" })],
      catalogVersion: "0.1.0",
    });

    await syncMcpServers();

    expect(mockDelegateMcpNew).toHaveBeenCalledTimes(1);
    expect(mockDelegateMcpClientEdit).not.toHaveBeenCalled();
  });

  it("does not call the bridge on dry runs", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "~/.claude.json" }],
      sources: [],
      mcpServers: [makeServer({ name: "time" })],
      catalogVersion: "0.1.0",
    });

    await syncMcpServers({ dryRun: true });

    expect(mockReadMcpmServer).not.toHaveBeenCalled();
    expect(mockDelegateMcpNew).not.toHaveBeenCalled();
    expect(mockDelegateMcpClientEdit).not.toHaveBeenCalled();
  });

  it("logs a one-line dim summary listing the bridged server names", async () => {
    mockMcpServerConfigEquals.mockReturnValueOnce(false).mockReturnValueOnce(false);
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "~/.claude.json" }],
      sources: [],
      mcpServers: [makeServer({ name: "time" }), makeServer({ name: "fetch" })],
      catalogVersion: "0.1.0",
    });

    await syncMcpServers();

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).toContain("Reconciled 2 server(s)");
    expect(calls).toContain("time");
    expect(calls).toContain("fetch");
    expect(calls).toContain("claude-code");
  });

  it("translates rename pairs (codex → codex-cli) when reporting bridged clients", async () => {
    mockMcpServerConfigEquals.mockReturnValueOnce(false);
    mockDelegateMcpClientEdit.mockReturnValue({
      ok: true,
      carveOuts: [],
      perClient: [{ client: "codex-cli", ok: true }],
    });
    mockLoadState.mockReturnValue({
      agents: [{ name: "codex", detected: true, skillsDir: "x", mcpConfig: "~/.codex/config.toml" }],
      sources: [],
      mcpServers: [makeServer({ name: "time" })],
      catalogVersion: "0.1.0",
    });

    await syncMcpServers();

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    // The reported client list uses mcpm's canonical names (codex-cli, not codex).
    expect(calls).toContain("codex-cli");
  });
});

describe("syncMcpServers error resilience", () => {
  it("reports error and continues when adapter write fails", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    // readFileSync returns empty config so new server will be added
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");
    // write fails with permission error
    mockWriteFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    await syncMcpServers();
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("write failed");
    expect(calls).toContain("1 failed");
  });
});

describe("syncDevinPermissions", () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockWriteFileSync.mockImplementation(() => {});
  });

  it("adds missing mcp__<name>__* permission for each server", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: {},
        permissions: { allow: ["Read(**)"], deny: [] },
      }),
    );

    const servers = [makeServer({ name: "slack-corp" }), makeServer({ name: "atlassian" })];
    const added = syncDevinPermissions("~/.config/devin/config.json", servers);

    expect(added).toBe(2);
    const written = JSON.parse((mockWriteFileSync.mock.calls[0][1] as string).toString());
    expect(written.permissions.allow).toContain("mcp__slack-corp__*");
    expect(written.permissions.allow).toContain("mcp__atlassian__*");
    expect(written.permissions.allow).toContain("Read(**)");
  });

  it("skips permissions already present", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: {},
        permissions: { allow: ["Read(**)", "mcp__slack-corp__*"] },
      }),
    );

    const servers = [makeServer({ name: "slack-corp" }), makeServer({ name: "atlassian" })];
    const added = syncDevinPermissions("~/.config/devin/config.json", servers);

    expect(added).toBe(1);
    const written = JSON.parse((mockWriteFileSync.mock.calls[0][1] as string).toString());
    expect(written.permissions.allow).toContain("mcp__atlassian__*");
    // should only appear once
    expect(written.permissions.allow.filter((p: string) => p === "mcp__slack-corp__*").length).toBe(1);
  });

  it("does not write when all permissions already present", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: {},
        permissions: { allow: ["mcp__slack-corp__*"] },
      }),
    );

    const servers = [makeServer({ name: "slack-corp" })];
    const added = syncDevinPermissions("~/.config/devin/config.json", servers);

    expect(added).toBe(0);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("does not write on dry run even when permissions are missing", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: {},
        permissions: { allow: [] },
      }),
    );

    const servers = [makeServer({ name: "slack-corp" })];
    const added = syncDevinPermissions("~/.config/devin/config.json", servers, true);

    expect(added).toBe(1);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("handles missing permissions block gracefully", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcpServers: {} }));

    const servers = [makeServer({ name: "minsky" })];
    const added = syncDevinPermissions("~/.config/devin/config.json", servers);

    expect(added).toBe(1);
    const written = JSON.parse((mockWriteFileSync.mock.calls[0][1] as string).toString());
    expect(written.permissions.allow).toContain("mcp__minsky__*");
  });

  it("grants permission to servers present in mcpServers but missing from state (mcpm- or user-added)", () => {
    // Regression guard for sync-idempotent-and-complete issue 4 (mcp-permissions subset):
    // mcpm install or a manual edit can add a server to devin's mcpServers without
    // going through agentbrew state. checkDevinPermissionDrift flags the missing
    // mcp__<name>__* allow entry for those servers, so syncDevinPermissions must
    // also add them — otherwise drift detection reports persistent "missing
    // permission" items that fix() can never clear.
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: {
          "organization-developer-portal": { command: "/usr/local/bin/developer-portal-mcp" },
          "user-only": { command: "/usr/local/bin/user-only" },
        },
        permissions: { allow: ["Read(**)"], deny: [] },
      }),
    );

    // State only knows about a different server that's not in mcpServers yet.
    const servers = [makeServer({ name: "agentbrew-managed" })];
    const added = syncDevinPermissions("~/.config/devin/config.json", servers);

    // 3 added: state's `agentbrew-managed` + mcpServers' `organization-developer-portal` + `user-only`.
    expect(added).toBe(3);
    const written = JSON.parse((mockWriteFileSync.mock.calls[0][1] as string).toString());
    expect(written.permissions.allow).toContain("mcp__agentbrew-managed__*");
    expect(written.permissions.allow).toContain("mcp__organization-developer-portal__*");
    expect(written.permissions.allow).toContain("mcp__user-only__*");
    expect(written.permissions.allow).toContain("Read(**)");
  });

  it("preserves permissions for servers in mcpServers when state is empty", () => {
    // A user could `agentbrew remove` every state server while mcpm still has
    // its own entries in devin's mcpServers. The existing pruning logic must not
    // delete those permissions — they correspond to live servers.
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: {
          "mcpm-managed": { command: "/usr/local/bin/mcpm" },
        },
        permissions: { allow: ["mcp__mcpm-managed__*", "Read(**)"] },
      }),
    );

    const servers: ReturnType<typeof makeServer>[] = [];
    const added = syncDevinPermissions("~/.config/devin/config.json", servers);

    expect(added).toBe(0); // already present, nothing to add
    // mockWriteFileSync also should NOT be called because nothing changed.
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("prunes stale mcp__<name>__* entries whose server is in neither state nor mcpServers", () => {
    // Servers removed from BOTH state AND mcpServers should have their permission
    // pruned. The existing prune logic was state-only, so an mcpm-added server
    // would have been incorrectly pruned. Now: keep if in either source.
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: { "still-there": { command: "/x" } },
        permissions: {
          allow: ["mcp__still-there__*", "mcp__truly-stale__*", "Read(**)"],
        },
      }),
    );

    const servers: ReturnType<typeof makeServer>[] = [];
    syncDevinPermissions("~/.config/devin/config.json", servers);

    const written = JSON.parse((mockWriteFileSync.mock.calls[0][1] as string).toString());
    expect(written.permissions.allow).toContain("mcp__still-there__*"); // kept (in mcpServers)
    expect(written.permissions.allow).not.toContain("mcp__truly-stale__*"); // pruned (in neither)
    expect(written.permissions.allow).toContain("Read(**)"); // non-MCP, untouched
  });
});

describe("syncClaudeCodePermissions", () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockWriteFileSync.mockImplementation(() => {});
  });

  it("adds permissions for state servers and servers deployed in ~/.claude.json", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        permissions: { allow: ["Read(**)", "mcp__github__*"] },
      }),
    );

    const servers = [makeServer({ name: "context7" })];
    const added = syncMcpPermissions("~/.claude/settings.json", servers, {
      deployedServerNames: ["overlay-drive-mcp", "atlassian"],
    });

    expect(added).toBe(3);
    const written = JSON.parse((mockWriteFileSync.mock.calls[0][1] as string).toString());
    expect(written.permissions.allow).toContain("mcp__context7__*");
    expect(written.permissions.allow).toContain("mcp__overlay-drive-mcp__*");
    expect(written.permissions.allow).toContain("mcp__atlassian__*");
    expect(written.permissions.allow).not.toContain("mcp__github__*");
  });
});

describe("computeServerList — pass-through behavior", () => {
  it("preserves the user-state list verbatim, including a server tagged source: 'project'", () => {
    // After delete-legacy-project-format, project-scoped overrides flow into
    // state via applyAgentfile() — computeServerList just hands the list back.
    const merged = computeServerList({
      userServers: [
        makeServer({ name: "personal", command: "user", args: [], env: {}, source: "user" }),
        makeServer({ name: "from-agentfile", command: "proj", args: [], env: {}, source: "project" }),
      ],
    });
    expect(merged).toHaveLength(2);
    expect(merged.map((s) => s.source).sort()).toEqual(["project", "user"]);
  });
});

describe("computeDiffWithAdapter — idempotency and prune", () => {
  const json = new JsonAdapter();

  it("produces no actions when existing entries already match desired", () => {
    const desired = [makeServer()];
    const existing: Record<string, Record<string, unknown>> = {
      "test-server": { command: "npx", args: ["-y", "@test/mcp"] },
    };
    const diff = computeDiffWithAdapter("cursor", desired, existing, json);
    expect(diff.actions).toHaveLength(0);
    expect(diff.added).toBe(0);
    expect(diff.updated).toBe(0);
    expect(diff.pruned).toBe(0);
  });

  it("does not treat extra user env keys on existing entry as a mismatch", () => {
    const desired = [makeServer({ env: { TOKEN: "a" } })];
    const existing: Record<string, Record<string, unknown>> = {
      "test-server": {
        command: "npx",
        args: ["-y", "@test/mcp"],
        env: { TOKEN: "a", USER_EXTRA: "keep-me" },
      },
    };
    const diff = computeDiffWithAdapter("cursor", desired, existing, json);
    expect(diff.actions).toHaveLength(0);
  });

  it("prunes forcePruneNames even when still present in existing entries", () => {
    const json = new JsonAdapter();
    const desired = [makeServer({ name: "keep" })];
    const existing: Record<string, Record<string, unknown>> = {
      keep: { command: "npx", args: ["-y", "@test/mcp"] },
      stale: { command: "old", args: ["-y", "@gone"] },
    };
    const diff = computeDiffWithAdapter("cursor", desired, existing, json, {
      prune: true,
      forcePruneNames: new Set(["stale"]),
    });
    expect(diff.actions.some((a) => a.type === "prune" && a.serverName === "stale")).toBe(true);
  });

  it("does not force-prune when prune is false even if forcePruneNames is set", () => {
    const json = new JsonAdapter();
    const desired = [makeServer({ name: "keep" })];
    const existing: Record<string, Record<string, unknown>> = {
      keep: { command: "npx", args: ["-y", "@test/mcp"] },
      stale: { command: "old", args: ["-y", "@gone"] },
    };
    const diff = computeDiffWithAdapter("cursor", desired, existing, json, {
      prune: false,
      forcePruneNames: new Set(["stale"]),
    });
    expect(diff.actions.filter((a) => a.type === "prune")).toHaveLength(0);
  });

  it("prunes unmanaged names only when in managedNames set", () => {
    const desired: McpServer[] = [];
    const existing: Record<string, Record<string, unknown>> = {
      managed: { command: "x" },
      userAdded: { command: "y" },
    };
    const diff = computeDiffWithAdapter("cursor", desired, existing, json, {
      prune: true,
      managedNames: new Set(["managed"]),
    });
    const pruned = diff.actions.filter((a) => a.type === "prune").map((a) => a.serverName);
    expect(pruned).toContain("managed");
    expect(pruned).not.toContain("userAdded");
  });
});

describe("getMcpTargetAgents", () => {
  // Slice 4a of `delegate-mcp-to-mcpm`: MCP_INTERSECTION_AGENTS
  // `MCP_INTERSECTION_AGENTS` Set (claude-code, cursor, claude-desktop,
  // cline, windsurf, gemini-cli, codex, goose, roo-code) is filtered out
  // — those clients are populated by `mcpm install` + `mcpm client edit`
  // during `agentbrew mcp install`, not by native sync (cli-removed-commands-allowlist:
  // pre-slice-5a wrapper, deleted in PR #851 — the test covers the native
  // sync skip behavior, not the wrapper invocation). These tests use the
  // carve-out agents (`kiro`, `devin`, `overlay-desktop`, `copilot`,
  // `opencode`, `amp`) to exercise the native path.
  it("returns only detected agents that have MCP config in definitions", () => {
    const agents = [
      makeMcpAgentDef("kiro", { skillsDir: "x" }),
      { name: "not-in-definitions", detected: true, skillsDir: "x" },
    ];
    const targets = getMcpTargetAgents(agents as never);
    expect(targets.every((a) => a.mcpConfig)).toBe(true);
    expect(targets.some((a) => a.name === "kiro")).toBe(true);
    expect(targets.some((a) => a.name === "not-in-definitions")).toBe(false);
  });

  it("drops agents that are not detected", () => {
    const agents = [makeMcpAgentDef("kiro", { detected: false, skillsDir: "x" })];
    expect(getMcpTargetAgents(agents as never)).toHaveLength(0);
  });

  // Slice 4a regression guard: claude-desktop is in MCP_INTERSECTION_AGENTS
  // intersection so it MUST be filtered out of native sync targets.
  // Pre-slice-4a, this test asserted the opposite (claude-desktop
  // appeared in targets); post-slice-4a, it must be excluded.
  it("filters claude-desktop out of native sync (intersection agent — mcpm-managed)", () => {
    const agents = [
      { name: "claude-desktop", detected: true, skillsDir: "~/Library/Application Support/Claude/skills" },
    ];
    const targets = getMcpTargetAgents(agents as never);
    expect(targets.some((a) => a.name === "claude-desktop")).toBe(false);
  });

  it("returned agents are fresh objects, not references to input (no state contamination)", () => {
    const agents = [makeMcpAgentDef("kiro")];
    const targets = getMcpTargetAgents(agents as never);
    expect(targets).toHaveLength(1);
    // Verify these targets are fresh objects, not references to the input agents
    // (they shouldn't contaminate the source state.agents array)
    expect(targets[0]).not.toBe(agents[0]);
  });

  // Regression guard: `augment` is in AGENT_DEFINITIONS with no `mcpConfig`
  // (skills-only agent). It must be filtered out of MCP sync targets — if the
  // capability check flipped or was inverted, this test would catch it.
  // See TASKS.md `sync-unsupported-agent-coverage`.
  it("silently skips agents without mcpConfig (e.g. augment) while keeping supported ones", () => {
    const agents = [makeMcpAgentDef("kiro"), { name: "augment", detected: true, skillsDir: "~/.augment/skills" }];
    const targets = getMcpTargetAgents(agents as never);
    expect(targets.some((a) => a.name === "kiro")).toBe(true);
    expect(targets.some((a) => a.name === "augment")).toBe(false);
    // Every returned target must have a resolvable mcpConfig path
    expect(targets.every((a) => a.mcpConfig)).toBe(true);
  });

  // Slice 4a invariant: every agent in the intersection set is filtered
  // out, and every carve-out is included (when detected + has mcpConfig).
  it("slice 4a — filters MCP_INTERSECTION_AGENTS and keeps AGENTBREW_ONLY_MCP_AGENTS", () => {
    const intersectionAgents = [
      { name: "claude-code", detected: true, skillsDir: "~/.claude/skills" },
      { name: "claude-desktop", detected: true, skillsDir: "~/Library/Application Support/Claude/skills" },
      { name: "cline", detected: true, skillsDir: "~/.cline/skills" },
      // windsurf: moved to carve-outs (endpoint-security agent, 2026-05-19)
      // cursor: moved to carve-outs (mcpm run wrapper not surfaced to agent layer)
      { name: "gemini-cli", detected: true, skillsDir: "~/.gemini/skills" },
      { name: "codex", detected: true, skillsDir: "~/.codex/skills" },
      { name: "goose", detected: true, skillsDir: "~/.config/goose/skills" },
      { name: "roo-code", detected: true, skillsDir: "~/.roo/skills" },
    ];
    const carveOuts = [
      { name: "devin", detected: true, skillsDir: "~/.config/devin/skills" },
      { name: "copilot", detected: true, skillsDir: "~/.copilot/skills" },
      { name: "opencode", detected: true, skillsDir: "~/.config/opencode/skills" },
      makeMcpAgentDef("kiro"),
      { name: "amp", detected: true, skillsDir: "~/.config/amp/skills" },
      { name: "windsurf", detected: true, skillsDir: "~/.codeium/windsurf/skills" },
      { name: "cursor", detected: true, skillsDir: "~/.cursor/skills" },
    ];
    const targets = getMcpTargetAgents([...intersectionAgents, ...carveOuts] as never);
    const targetNames = targets.map((t) => t.name);

    // Intersection: every one excluded.
    for (const a of intersectionAgents) {
      expect(targetNames).not.toContain(a.name);
    }
    // Carve-outs: every one included (note copilot has no mcpConfig in
    // current agents.yaml so it's correctly excluded by the mcpConfig
    // filter, not the intersection filter).
    expect(targetNames).toContain("devin");
    expect(targetNames).toContain("opencode");
    expect(targetNames).toContain("kiro");
    expect(targetNames).toContain("amp");
    expect(targetNames).toContain("windsurf");
    expect(targetNames).toContain("cursor");
  });
});

describe("filterServersForLiteralAgent", () => {
  it("filters servers with unresolved ${VAR} for devin", () => {
    const log = vi.fn();
    const servers = [
      makeServer({ name: "ok", env: {} }),
      makeServer({ name: "bad", env: { TOKEN: "${NOT_SET_VAR_XYZ}" } }),
    ];
    const filtered = filterServersForLiteralAgent(servers, "devin", log);
    expect(filtered.map((s) => s.name)).toEqual(["ok"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('skipping "bad"'));
  });

  it("does not filter for standard agents when env has placeholders", () => {
    const log = vi.fn();
    const servers = [makeServer({ name: "x", env: { TOKEN: "${NOT_SET_VAR_XYZ}" } })];
    const filtered = filterServersForLiteralAgent(servers, "cursor", log);
    expect(filtered).toHaveLength(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("passes slack-work through for devin when SLACK_BOT_TOKEN is set in env", () => {
    const prev = process.env.SLACK_BOT_TOKEN;
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    try {
      const log = vi.fn();
      const slackServer = makeServer({
        name: "slack-work",
        env: { SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}", APP_ENV: "dev" },
      });
      const filtered = filterServersForLiteralAgent([slackServer], "devin", log);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("slack-work");
      expect(log).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.SLACK_BOT_TOKEN;
      else process.env.SLACK_BOT_TOKEN = prev;
    }
  });

  it("filters slack-work for devin when SLACK_BOT_TOKEN is not set and not in Keychain", () => {
    // Simulate env var absent and Keychain missing (spawnSync returns non-zero)
    const prevBot = process.env.SLACK_BOT_TOKEN;
    const prevUser = process.env.SLACK_USER_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_USER_TOKEN;
    // Override spawnSync so Keychain lookup fails
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      error: undefined,
      pid: 0,
      signal: null,
      output: [],
    });
    try {
      const log = vi.fn();
      const slackServer = makeServer({
        name: "slack-work",
        env: { SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}", SLACK_USER_TOKEN: "${SLACK_USER_TOKEN}", APP_ENV: "dev" },
      });
      const filtered = filterServersForLiteralAgent([slackServer], "devin", log);
      expect(filtered).toHaveLength(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('skipping "slack-work"'));
    } finally {
      if (prevBot !== undefined) process.env.SLACK_BOT_TOKEN = prevBot;
      if (prevUser !== undefined) process.env.SLACK_USER_TOKEN = prevUser;
    }
  });

  it("passes slack-work through for devin when SLACK_BOT_TOKEN is ONLY in Keychain (regression)", () => {
    // Regression for the silent-filter bug: hasUnresolvedInheritedEnv used to
    // check raw process.env, ignoring ENV_FALLBACKS. The literal-format
    // substitution path resolves via Keychain, so the filter was more
    // conservative than reality and dropped servers whose secrets only lived
    // in Keychain. Observed in the wild on 2026-05-21 when jira-mcp got
    // silently filtered out of Devin's config because JIRA_EMAIL was only
    // available via Keychain fallback — the agent then reported "Server
    // 'jira-mcp' not found in configuration".
    const prevBot = process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    // resolveFromKeychain calls execFileSync("security", ...) — return a value so
    // the Keychain fallback in ENV_FALLBACKS["SLACK_BOT_TOKEN"] resolves.
    vi.mocked(execFileSync).mockReturnValueOnce(Buffer.from("xoxb-from-keychain\n"));
    try {
      const log = vi.fn();
      const slackServer = makeServer({
        name: "slack-work",
        env: { SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}", APP_ENV: "dev" },
      });
      const filtered = filterServersForLiteralAgent([slackServer], "devin", log);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("slack-work");
      expect(log).not.toHaveBeenCalled();
    } finally {
      if (prevBot !== undefined) process.env.SLACK_BOT_TOKEN = prevBot;
    }
  });

  it("skipped servers with unresolved vars survive prune for devin (managedNames exclusion)", () => {
    // Simulate: atlassian has unresolved ${JIRA_URL} but Devin already has a working entry.
    // Even with prune: true, the resolved entry must NOT be pruned.
    const log = vi.fn();
    const allServers = [
      makeServer({ name: "ok", env: {} }),
      makeServer({ name: "atlassian", env: { JIRA_URL: "${UNRESOLVABLE_JIRA_VAR}" } }),
    ];
    // filterServersForLiteralAgent skips atlassian for devin
    const agentServers = filterServersForLiteralAgent(allServers, "devin", log);
    expect(agentServers.map((s) => s.name)).toEqual(["ok"]);

    // Compute skippedNames + safeManagedNames (same logic as syncSingleAgent)
    const skippedNames = new Set(
      allServers.filter((s) => !agentServers.some((a) => a.name === s.name)).map((s) => s.name),
    );
    const managedNames = new Set(["ok", "atlassian"]);
    const safeManagedNames = new Set([...managedNames].filter((n) => !skippedNames.has(n)));

    // Existing Devin config has both servers with resolved values
    const existing: Record<string, Record<string, unknown>> = {
      ok: { command: "npx", args: ["-y", "@test/ok"] },
      atlassian: {
        command: "uvx",
        args: ["mcp-atlassian"],
        env: { JIRA_URL: "https://real-jira.example.com" },
      },
    };

    const adapter = new JsonAdapter();
    const diff = computeDiffWithAdapter("devin", agentServers, existing, adapter, {
      prune: true,
      managedNames: safeManagedNames,
      unsafePruneNames: skippedNames,
    });

    // atlassian must NOT appear in prune actions
    const pruned = diff.actions.filter((a) => a.type === "prune").map((a) => a.serverName);
    expect(pruned).not.toContain("atlassian");
  });
});

describe("syncMcpServers — partial failures across agents", () => {
  // Slice 4a: uses carve-out agents from AGENTBREW_ONLY_MCP_AGENTS (kiro + amp) — windsurf is now
  // an intersection-skip agent and would never reach the write path.
  it("continues when one agent write fails and still syncs another", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" }), makeMcpAgentDef("amp", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    // Track written content per file so readback validation works correctly
    const fileStore: Record<string, string> = {};
    mockReadFileSync.mockImplementation((pathArg) => {
      const p = typeof pathArg === "string" || Buffer.isBuffer(pathArg) ? String(pathArg) : "";
      return fileStore[p] ?? "{}";
    });
    mockWriteFileSync.mockImplementation((path: string | Buffer, data: string | Buffer) => {
      if (String(path).includes("amp/settings")) {
        throw new Error("EACCES: amp write failed");
      }
      fileStore[String(path)] = String(data);
    });

    await syncMcpServers();
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("write failed");
    expect(calls).toContain("1 failed");
    expect(calls).toContain("amp");
  });
});

describe("syncMcpServers — idempotent second run", () => {
  it("applies no further adds when config already matches desired state", async () => {
    let stored = JSON.stringify({ mcpServers: {} });
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => stored);
    mockWriteFileSync.mockImplementation((writePath: string | Buffer, data: string | Buffer) => {
      if (String(writePath).includes("mcp.json")) {
        stored = typeof data === "string" ? data : data.toString();
      }
    });

    await syncMcpServers();
    await syncMcpServers({ verbose: true });

    const summary = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(summary).toContain("up to date");
  });
});

describe("syncWithAdapter — partial failures", () => {
  it("returns read failed when adapter.readEntries throws", () => {
    class ThrowOnRead extends JsonAdapter {
      override readEntries(): Record<string, Record<string, unknown>> {
        throw new Error("mock read failure");
      }
    }

    const result = syncWithAdapter(new ThrowOnRead(), "/tmp/agentbrew-mcp-sync-test.json", [makeServer()], "cursor");
    expect(result.error).toContain("read failed");
    expect(result.error).toContain("mock read failure");
  });

  it("returns write failed when adapter.writeEntries throws after a diff", () => {
    class ThrowOnWrite extends JsonAdapter {
      override readEntries(): Record<string, Record<string, unknown>> {
        return {};
      }
      override writeEntries(): void {
        throw new Error("mock write failure");
      }
    }

    const result = syncWithAdapter(new ThrowOnWrite(), "/tmp/agentbrew-mcp-sync-test.json", [makeServer()], "cursor");
    expect(result.error).toContain("write failed");
    expect(result.error).toContain("mock write failure");
  });

  it("does not call writeEntries when dryRun is true even when diff has actions", () => {
    class TrackWrite extends JsonAdapter {
      writeCalls = 0;
      override readEntries(): Record<string, Record<string, unknown>> {
        return {};
      }
      override writeEntries(): void {
        this.writeCalls++;
      }
    }
    const adapter = new TrackWrite();
    const result = syncWithAdapter(adapter, "/tmp/agentbrew-mcp-dryrun.json", [makeServer()], "cursor", {
      dryRun: true,
    });
    expect(result.added).toBe(1);
    expect(adapter.writeCalls).toBe(0);
  });
});

describe("syncWithAdapter — prune deletes entries before write", () => {
  it("removes pruned server keys from entries map when not dry run", () => {
    class CapturePrune extends JsonAdapter {
      lastWritten: Record<string, Record<string, unknown>> | undefined;
      override readEntries(): Record<string, Record<string, unknown>> {
        return {
          stale: { command: "old", args: ["-y", "@gone"] },
        };
      }
      override writeEntries(_path: string, entries: Record<string, Record<string, unknown>>, _mcpKey: string): void {
        this.lastWritten = { ...entries };
      }
    }
    const adapter = new CapturePrune();
    const result = syncWithAdapter(adapter, "/tmp/agentbrew-mcp-prune-test.json", [], "cursor", {
      prune: true,
      managedNames: new Set(["stale"]),
    });
    expect(result.pruned).toBe(1);
    expect(adapter.lastWritten).toBeDefined();
    expect(adapter.lastWritten).not.toHaveProperty("stale");
  });
});

describe("syncWithAdapter — post-write readback validation", () => {
  it("returns error when readback fails after a successful write", () => {
    let writeCount = 0;
    class CorruptAfterWrite extends JsonAdapter {
      override readEntries(): Record<string, Record<string, unknown>> {
        if (writeCount > 0) {
          throw new Error("corrupted JSON after write");
        }
        return {};
      }
      override writeEntries(): void {
        writeCount++;
      }
    }

    const result = syncWithAdapter(
      new CorruptAfterWrite(),
      "/tmp/agentbrew-readback-test.json",
      [makeServer()],
      "cursor",
    );
    expect(result.error).toContain("readback");
  });

  it("returns error when readback is missing expected server names", () => {
    class LoseServerOnWrite extends JsonAdapter {
      override readEntries(): Record<string, Record<string, unknown>> {
        return {};
      }
      override writeEntries(): void {
        // Write succeeds but...
      }
    }

    // The adapter always returns empty from readEntries (simulating data loss)
    const result = syncWithAdapter(
      new LoseServerOnWrite(),
      "/tmp/agentbrew-readback-missing.json",
      [makeServer({ name: "important-server" })],
      "cursor",
    );
    expect(result.error).toContain("readback");
    expect(result.error).toContain("important-server");
  });

  it("succeeds when readback contains all expected servers", () => {
    const stored: Record<string, Record<string, unknown>> = {};
    class GoodWrite extends JsonAdapter {
      override readEntries(): Record<string, Record<string, unknown>> {
        return { ...stored };
      }
      override writeEntries(_p: string, entries: Record<string, Record<string, unknown>>): void {
        Object.assign(stored, entries);
      }
    }

    const result = syncWithAdapter(
      new GoodWrite(),
      "/tmp/agentbrew-readback-ok.json",
      [makeServer({ name: "srv-a" }), makeServer({ name: "srv-b" })],
      "cursor",
    );
    expect(result.error).toBeUndefined();
    expect(result.added).toBe(2);
  });

  it("returns schema error when readback shape violates the agent contract", () => {
    class CaptureEntries extends JsonAdapter {
      entries: Record<string, Record<string, unknown>> = {};
      override readEntries(): Record<string, Record<string, unknown>> {
        return this.entries;
      }
      override writeEntries(_path: string, entries: Record<string, Record<string, unknown>>): void {
        this.entries = entries;
      }
    }

    const result = syncWithAdapter(
      new CaptureEntries(),
      "/tmp/agentbrew-schema-readback.json",
      [makeServer()],
      "opencode",
    );

    expect(result.error).toContain("schema validation failed for opencode.test-server");
  });

  it("skips readback validation on dry run", () => {
    let readCalls = 0;
    class CountReads extends JsonAdapter {
      override readEntries(): Record<string, Record<string, unknown>> {
        readCalls++;
        return {};
      }
      override writeEntries(): void {}
    }

    syncWithAdapter(new CountReads(), "/tmp/agentbrew-readback-dryrun.json", [makeServer()], "cursor", {
      dryRun: true,
    });
    // Only the initial read, no readback since nothing was written
    expect(readCalls).toBe(1);
  });

  it("skips readback validation when there are no actions", () => {
    let readCalls = 0;
    const existingEntry = { command: "npx", args: ["-y", "@test/mcp"] };
    class CountReads extends JsonAdapter {
      override readEntries(): Record<string, Record<string, unknown>> {
        readCalls++;
        return { "test-server": existingEntry };
      }
      override writeEntries(): void {}
    }

    syncWithAdapter(new CountReads(), "/tmp/agentbrew-readback-noop.json", [makeServer()], "cursor");
    // Initial read; when the overlay launcher exists, finalize-only wrapping persists and triggers readback.
    expect(readCalls).toBe(resolveMcpCursorLauncher() ? 2 : 1);
  });
});

describe("computeServerList — empty + single-entry edge cases", () => {
  it("returns an empty list when state has no servers", () => {
    expect(computeServerList({ userServers: [] })).toEqual([]);
  });
});

describe("computeDiffWithAdapter — JsonAdapter merge conflicts (applyUpdate)", () => {
  const json = new JsonAdapter();

  it("emits update when agentbrew-managed command differs", () => {
    const desired = [makeServer({ command: "new-cmd" })];
    const existing: Record<string, Record<string, unknown>> = {
      "test-server": { command: "old-cmd", args: ["-y", "@test/mcp"] },
    };
    const diff = computeDiffWithAdapter("cursor", desired, existing, json);
    expect(diff.actions.some((a) => a.type === "update" && a.serverName === "test-server")).toBe(true);
  });

  it("merges desired env into existing env via applyUpdate without losing user keys", () => {
    const entries: Record<string, Record<string, unknown>> = {
      "test-server": { command: "npx", args: ["-y", "@test/mcp"], env: { USER: "keep" } },
    };
    const desired = makeServer({ env: { TOKEN: "from-brew" } });
    json.applyUpdate(entries, "test-server", json.toEntry(desired, "cursor"));
    expect(entries["test-server"].env).toEqual({ USER: "keep", TOKEN: "from-brew" });
  });
});

// Slice 4a/4b of `delegate-mcp-to-mcpm`:
// - `ClaudeAdapter` was deleted (slice 4b) because claude-code is filtered
//   out of native sync; JsonAdapter resolves env vars per-agent today.
// - `GooseAdapter` was deleted (slice 4a follow-up); goose (yaml) is in
//   MCP_INTERSECTION_AGENTS and gets only a read-only adapter. The codex
//   `TomlAdapter` serves the remote-HTTPS carve-out and is covered in
//   `adapters.test.ts` and `native-http-transport.test.ts`.

describe("syncMcpServers — dry run idempotency", () => {
  it("does not write files when dry run", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");
    mockWriteFileSync.mockClear();

    await syncMcpServers({ dryRun: true });
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

describe("syncMcpServers — unexpected agent errors", () => {
  it("reports error when getAdapter throws inside the agent sync try block", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");

    const spy = vi.spyOn(adapters, "getAdapter").mockImplementationOnce(() => {
      throw new Error("adapter init failed");
    });

    await syncMcpServers();
    spy.mockRestore();

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("adapter init failed");
    expect(calls).toContain("1 failed");
  });
});

describe("syncMcpServers — unmanaged server discovery logging", () => {
  it("logs detailed discovery output when --discover and unmanaged servers exist", async () => {
    mockDiscoverUnmanagedServers.mockReturnValue([{ agent: "cursor", server: "extra-srv" }]);
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");

    await syncMcpServers({ discover: true });

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("Discovered 1 server(s) not in agentbrew");
    expect(calls).toContain("extra-srv");
    expect(mockDiscoverUnmanagedServers).toHaveBeenCalled();
  });

  it("logs compact info when unmanaged exist without --discover", async () => {
    mockDiscoverUnmanagedServers.mockReturnValue([{ agent: "cursor", server: "orphan" }]);
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");

    await syncMcpServers();

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("server(s) in agent configs not in agentbrew");
    expect(calls).toContain("orphan");
  });

  it("logs no-unmanaged message when --discover and configs match state", async () => {
    mockDiscoverUnmanagedServers.mockReturnValue([]);
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");

    await syncMcpServers({ discover: true });

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("No unmanaged servers found");
  });

  it("truncates unmanaged names in compact mode when more than five", async () => {
    mockDiscoverUnmanagedServers.mockReturnValue(
      Array.from({ length: 6 }, (_, i) => ({ agent: "cursor", server: `extra-${i}` })),
    );
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");

    await syncMcpServers();

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("+1 more");
    expect(calls).toMatch(/extra-[0-4]/);
  });
});

// Slice 4a: this describe block previously asserted that when
// ~/.claude.json is absent, claude-code sync still runs the CLI bridge.
// Post-slice-4a, claude-code is filtered out of native sync entirely
// — the test below pins the new behavior (zero output regardless of
// whether ~/.claude.json exists). The CLI fallback path itself is
// scheduled for physical deletion in slice 4b.
describe("syncMcpServers — claude-code intersection skip (no ~/.claude.json fallback)", () => {
  it("makes no CLI or filesystem call when ~/.claude.json is absent", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "~/.claude.json" }],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockImplementation((p) => !String(p).includes(".claude.json"));
    mockWriteFileSync.mockClear();
    mockSpawnSync.mockClear();

    await syncMcpServers();

    expect(mockSpawnSync).not.toHaveBeenCalled();
    const writtenPaths = mockWriteFileSync.mock.calls.map((c) => String(c[0]));
    expect(writtenPaths.some((p) => p.includes(".claude.json"))).toBe(false);
  });
});

describe("syncMcpServers — devin integration", () => {
  it("writes Devin MCP permissions after sync via syncDevinPermissions", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("devin", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((pathArg) => {
      const p = typeof pathArg === "string" || Buffer.isBuffer(pathArg) ? String(pathArg) : "";
      if (p.includes("devin") && p.includes("config.json")) {
        return JSON.stringify({
          mcpServers: {},
          permissions: { allow: ["Read(**)"] },
        });
      }
      return "{}";
    });
    mockWriteFileSync.mockImplementation(() => {});

    await syncMcpServers();

    const bodies = mockWriteFileSync.mock.calls.map((c) => String(c[1]));
    expect(bodies.some((json) => json.includes("mcp__test-server__*"))).toBe(true);
  });

  it("removes stale unresolved Devin entries while keeping other MCP servers", async () => {
    const previousToken = process.env.JENKINS_API_TOKEN;
    delete process.env.JENKINS_API_TOKEN;
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("devin", { skillsDir: "x" })],
      sources: [],
      mcpServers: [
        makeServer({ name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp"] }),
        makeServer({
          name: "jenkins",
          command: "npx",
          args: ["-y", "@test/jenkins"],
          env: { JENKINS_API_TOKEN: "${JENKINS_API_TOKEN}" },
        }),
      ],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    let devinConfig = JSON.stringify({
      mcpServers: {
        jenkins: {
          command: "npx",
          args: ["-y", "@test/jenkins"],
          env: { JENKINS_API_TOKEN: "${JENKINS_API_TOKEN}" },
        },
      },
      permissions: { allow: ["Read(**)"] },
    });
    mockReadFileSync.mockImplementation((pathArg) => {
      const path = String(pathArg);
      if (path.includes("devin") && path.includes("config.json")) return devinConfig;
      return "{}";
    });
    mockWriteFileSync.mockImplementation((path, data) => {
      const configPath = String(path);
      if (configPath.includes("devin") && configPath.includes("config.json")) {
        devinConfig = String(data);
      }
    });

    try {
      await syncMcpServers();
    } finally {
      if (previousToken === undefined) delete process.env.JENKINS_API_TOKEN;
      else process.env.JENKINS_API_TOKEN = previousToken;
    }

    const writtenConfig = JSON.parse(devinConfig);
    expect(writtenConfig.mcpServers).toHaveProperty("context7");
    expect(writtenConfig.mcpServers).not.toHaveProperty("jenkins");
    expect(devinConfig).not.toContain("${JENKINS_API_TOKEN}");
  });

  it("logs literal skip warnings for devin when env placeholders are unresolved", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("devin", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer({ env: { TOKEN: "${NOT_SET_VAR_DEVIN_SKIP}" } })],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");

    await syncMcpServers();

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("devin");
    expect(calls).toContain("skipping");
  });
});

// ── Carve-out lock-down (sub-task simplify-mcp-sync-lock-down-carveouts) ────
//
// Pins each remaining MCP carve-out's config shape (file path + key path
// + adapter format) so the upcoming `simplify-mcp-sync-annotate-functions`
// + `simplify-mcp-sync-shrink-or-document` sub-tasks can delete branches
// without silently breaking a carve-out. Five describe blocks below cover
// carve-outs missing a named regression block — `devin` already has
// its own integration describe at line ~1632.
//
// Per the sibling sub-task acceptance criterion (b): "every carve-out has
// at least one `*.test.ts` block whose description names it".

describe("syncMcpServers — kiro carve-out (default mcpServers key)", () => {
  it("writes through default `mcpServers` key at ~/.kiro/settings/mcp.json", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro")],
      sources: [],
      mcpServers: [makeServer({ name: "kiro-srv" })],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");
    mockWriteFileSync.mockImplementation(() => {});

    await syncMcpServers();

    const writes = mockWriteFileSync.mock.calls.map((c) => ({
      path: String(c[0]),
      body: String(c[1]),
    }));
    const kiroWrite = writes.find((w) => w.path.includes(".kiro/settings/mcp.json"));
    expect(kiroWrite).toBeDefined();
    const parsed = JSON.parse(kiroWrite!.body);
    expect(parsed.mcpServers?.["kiro-srv"]).toBeDefined();
    expect(parsed.mcpServers?.["kiro-srv"]?.command).toBe("npx");
  });
});

describe("syncMcpServers — opencode carve-out (`mcp` key + opencode 1.14+ shape)", () => {
  it("writes opencode 1.14+ shape ({ type: 'local', command: [...] }) under the `mcp` key", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("opencode", { mcpKey: "mcp", mcpFormat: "opencode" })],
      sources: [],
      mcpServers: [makeServer({ name: "opencode-srv" })],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");
    mockWriteFileSync.mockImplementation(() => {});

    await syncMcpServers();

    const writes = mockWriteFileSync.mock.calls.map((c) => ({
      path: String(c[0]),
      body: String(c[1]),
    }));
    const opencodeWrite = writes.find((w) => w.path.includes("opencode/opencode.json"));
    expect(opencodeWrite).toBeDefined();
    const parsed = JSON.parse(opencodeWrite!.body);
    // Carve-out invariants:
    //  1. opencode uses `mcp`, NOT `mcpServers`.
    //  2. opencode 1.14+ schema: `{ type: "local", command: [cmd, ...args] }`.
    //     Bare `command` scalar + separate `args` array would crash opencode-serve.
    expect(parsed.mcp?.["opencode-srv"]).toBeDefined();
    expect(parsed.mcp["opencode-srv"].type).toBe("local");
    expect(parsed.mcp["opencode-srv"].command).toEqual(["npx", "-y", "@test/mcp"]);
    expect(parsed.mcp["opencode-srv"].args).toBeUndefined();
    expect(parsed.mcpServers).toBeUndefined();
  });
});

describe("syncMcpServers — amp carve-out (`amp.mcpServers` flat dotted key)", () => {
  it("writes to flat dotted key `amp.mcpServers`, not nested `amp.mcpServers`", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("amp", { mcpKey: "amp.mcpServers" })],
      sources: [],
      mcpServers: [makeServer({ name: "amp-srv" })],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");
    mockWriteFileSync.mockImplementation(() => {});

    await syncMcpServers();

    const writes = mockWriteFileSync.mock.calls.map((c) => ({
      path: String(c[0]),
      body: String(c[1]),
    }));
    const ampWrite = writes.find((w) => w.path.includes("amp/settings.json"));
    expect(ampWrite).toBeDefined();
    const parsed = JSON.parse(ampWrite!.body);
    // Carve-out invariant: amp uses a flat dotted key — `setServers` does
    // `raw["amp.mcpServers"] = entries`, not `raw.amp.mcpServers`.
    expect(parsed["amp.mcpServers"]?.["amp-srv"]).toBeDefined();
    expect(parsed.amp).toBeUndefined();
    expect(parsed.mcpServers).toBeUndefined();
  });
});

describe("syncMcpServers — copilot carve-out (VS Code settings.json)", () => {
  it("writes to VS Code settings.json with default `mcpServers` key", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("copilot")],
      sources: [],
      mcpServers: [makeServer({ name: "copilot-srv" })],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");
    mockWriteFileSync.mockImplementation(() => {});

    await syncMcpServers();

    const writes = mockWriteFileSync.mock.calls.map((c) => ({
      path: String(c[0]),
      body: String(c[1]),
    }));
    // mcpConfig resolves to ~/Library/Application Support/Code/User/settings.json
    // on darwin or ~/.config/Code/User/settings.json on Linux.
    const copilotWrite = writes.find((w) => w.path.includes("Code/User/settings.json"));
    expect(copilotWrite).toBeDefined();
    const parsed = JSON.parse(copilotWrite!.body);
    expect(parsed.mcpServers?.["copilot-srv"]).toBeDefined();
    expect(parsed.mcpServers?.["copilot-srv"]?.command).toBe("npx");
  });
});

describe("syncMcpServers — config read failures", () => {
  it("surfaces read failed when adapter readEntries throws (bypassing readMcpJson catch)", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer()],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");

    class ThrowingRead extends JsonAdapter {
      override readEntries(): Record<string, Record<string, unknown>> {
        throw new Error("adapter readEntries failed");
      }
    }

    const spy = vi.spyOn(adapters, "getAdapter").mockReturnValueOnce(new ThrowingRead() as never);

    await syncMcpServers();
    spy.mockRestore();

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("read failed");
    expect(calls).toContain("adapter readEntries failed");
  });
});

describe("syncMcpServers — invalid server filtering", () => {
  it("skips servers with empty command and does not write them to agent config", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [
        makeServer({ name: "valid-server", command: "npx" }),
        makeServer({ name: "broken-server", command: "" }),
      ],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");
    mockWriteFileSync.mockImplementation(() => {});

    await syncMcpServers();

    const writtenJson = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    expect(writtenJson.mcpServers).toHaveProperty("valid-server");
    expect(writtenJson.mcpServers).not.toHaveProperty("broken-server");
  });

  it("logs warning for each skipped invalid server", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [
        makeServer({ name: "empty-cmd", command: "" }),
        makeServer({ name: "whitespace-cmd", command: "   " }),
      ],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");

    await syncMcpServers();

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain('skipping "empty-cmd"');
    expect(calls).toContain('skipping "whitespace-cmd"');
  });

  it("does not skip url-based servers that have empty command", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer({ name: "remote", url: "https://example.com/mcp", command: "" })],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");
    mockWriteFileSync.mockImplementation(() => {});

    await syncMcpServers();

    const writtenJson = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    expect(writtenJson.mcpServers).toHaveProperty("remote");
  });

  it("reports 'No MCP servers to sync' when all servers are invalid", async () => {
    mockLoadState.mockReturnValue({
      agents: [makeMcpAgentDef("kiro", { skillsDir: "x" })],
      sources: [],
      mcpServers: [makeServer({ name: "broken", command: "" })],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");

    await syncMcpServers();

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("No MCP servers to sync");
  });
});
