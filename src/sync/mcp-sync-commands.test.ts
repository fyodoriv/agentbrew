import { describe, expect, it, vi } from "vitest";

import { createTestContext } from "../core/context.js";
import type { AgentBrewState } from "../types.js";

import { addMcpServer, removeMcpServer } from "./mcp-sync-commands.js";

vi.mock("./mcp-sync.js", () => ({
  getMcpTargetAgents: vi.fn().mockReturnValue([]),
  syncMcpServers: vi.fn().mockResolvedValue(undefined),
}));

// Slice 1 of `bridge-mcp-sync-to-mcpm-for-intersection`: `removeMcpServer`
// now calls `delegateMcpUninstall` from this module to clean intersection
// clients (cursor, claude-code, codex, etc.). Without the mock, every
// `removeMcpServer` test would spawn real `mcpm` subprocesses.
vi.mock("./mcp-delegate.js", () => ({
  delegateMcpUninstall: vi.fn(() => ({
    ok: false,
    carveOuts: [],
    perClient: [],
    globalUninstall: { ok: false },
  })),
}));

vi.mock("../mcp/adapters.js", () => ({
  getAdapter: vi.fn(),
}));

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    expandHome: vi.fn((p: string) => p),
    formatAge: vi.fn((iso: string) => `mocked-age(${iso})`),
  };
});

function makeState(overrides: Partial<AgentBrewState> = {}): AgentBrewState {
  return {
    agents: [],
    sources: [],
    mcpServers: [],
    catalogVersion: "0",
    ...overrides,
  };
}

// ── addMcpServer ──────────────────────────────────────────────────────────────

describe("addMcpServer", () => {
  it("adds a new server when name does not exist", async () => {
    const ctx = createTestContext(makeState());
    await addMcpServer("my-server", "npx", ["-y", "@scope/pkg"], {}, { ctx });
    const state = ctx.stateManager.require();
    expect(state?.mcpServers).toHaveLength(1);
    expect((state?.mcpServers ?? [])[0]).toMatchObject({
      name: "my-server",
      command: "npx",
      args: ["-y", "@scope/pkg"],
      source: "user",
    });
  });

  it("updates existing server and logs a warn when name already exists (line 35-43)", async () => {
    const initial = makeState({
      mcpServers: [{ name: "existing", command: "old-cmd", args: [], env: {}, source: "user" }],
    });
    const ctx = createTestContext(initial);
    const warnSpy = vi.spyOn(ctx.logger, "warn");

    await addMcpServer("existing", "new-cmd", ["--flag"], { KEY: "val" }, { ctx });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("existing"));
    const state = ctx.stateManager.require();
    expect(state?.mcpServers).toHaveLength(1);
    expect((state?.mcpServers ?? [])[0]).toMatchObject({
      name: "existing",
      command: "new-cmd",
      args: ["--flag"],
      env: { KEY: "val" },
    });
  });

  it("updates url and non-empty headers when provided during update (line 39-41)", async () => {
    const initial = makeState({
      mcpServers: [{ name: "srv", command: "cmd", args: [], env: {}, source: "user" }],
    });
    const ctx = createTestContext(initial);

    await addMcpServer(
      "srv",
      "cmd",
      [],
      {},
      {
        ctx,
        url: "https://example.com",
        headers: { Authorization: "Bearer token" },
      },
    );

    const server = (ctx.stateManager.require()?.mcpServers ?? [])[0];
    expect(server?.url).toBe("https://example.com");
    expect(server?.headers).toEqual({ Authorization: "Bearer token" });
  });

  it("clears headers on update when empty object passed (line 41 falsy branch)", async () => {
    const initial = makeState({
      mcpServers: [
        {
          name: "srv",
          command: "cmd",
          args: [],
          env: {},
          source: "user",
          headers: { X: "old" },
        },
      ],
    });
    const ctx = createTestContext(initial);

    await addMcpServer("srv", "cmd", [], {}, { ctx, headers: {} });

    const server = (ctx.stateManager.require()?.mcpServers ?? [])[0];
    expect(server?.headers).toBeUndefined();
  });

  it("stores gitUrl and gitRef when provided for a new server", async () => {
    const ctx = createTestContext(makeState());
    await addMcpServer(
      "git-srv",
      "npx",
      [],
      {},
      {
        ctx,
        gitUrl: "https://github.com/org/repo",
        gitRef: "main",
      },
    );
    const server = (ctx.stateManager.require()?.mcpServers ?? [])[0];
    expect(server?.gitUrl).toBe("https://github.com/org/repo");
    expect(server?.gitRef).toBe("main");
  });

  it("sets addedAt timestamp when adding a new server", async () => {
    const before = new Date().toISOString();
    const ctx = createTestContext(makeState());
    await addMcpServer("ts-srv", "cmd", [], {}, { ctx });
    const after = new Date().toISOString();

    const server = (ctx.stateManager.require()?.mcpServers ?? [])[0];
    expect(server?.addedAt).toBeDefined();
    expect(new Date(server?.addedAt ?? "").getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    expect(new Date(server?.addedAt ?? "").getTime()).toBeLessThanOrEqual(new Date(after).getTime());
  });

  it("preserves existing addedAt when updating a server", async () => {
    const original = "2025-06-01T00:00:00.000Z";
    const initial = makeState({
      mcpServers: [{ name: "srv", command: "old", args: [], env: {}, source: "user", addedAt: original }],
    });
    const ctx = createTestContext(initial);
    await addMcpServer("srv", "new-cmd", [], {}, { ctx });

    const server = (ctx.stateManager.require()?.mcpServers ?? [])[0];
    expect(server?.addedAt).toBe(original);
  });

  it("rejects a stdio server with an empty command", async () => {
    const ctx = createTestContext(makeState());
    await expect(addMcpServer("bad", "", [], {}, { ctx })).rejects.toThrow(/empty command/i);
    expect(ctx.stateManager.require()?.mcpServers).toHaveLength(0);
  });

  it("rejects a stdio server with a whitespace-only command", async () => {
    const ctx = createTestContext(makeState());
    await expect(addMcpServer("bad", "   ", [], {}, { ctx })).rejects.toThrow(/empty command/i);
    expect(ctx.stateManager.require()?.mcpServers).toHaveLength(0);
  });

  it("allows a url-based server with an empty command", async () => {
    const ctx = createTestContext(makeState());
    await addMcpServer("url-srv", "", [], {}, { ctx, url: "https://example.com/mcp" });
    const servers = ctx.stateManager.require()?.mcpServers ?? [];
    expect(servers).toHaveLength(1);
    expect(servers[0]?.url).toBe("https://example.com/mcp");
  });

  it("rejects a url-based server with an empty url", async () => {
    const ctx = createTestContext(makeState());
    await expect(addMcpServer("bad", "", [], {}, { ctx, url: "  " })).rejects.toThrow(/empty.*url/i);
    expect(ctx.stateManager.require()?.mcpServers).toHaveLength(0);
  });
});

// ── removeMcpServer ───────────────────────────────────────────────────────────

describe("removeMcpServer", () => {
  it("removes the server from state when found", async () => {
    const initial = makeState({
      mcpServers: [{ name: "to-remove", command: "cmd", args: [], env: {}, source: "user" }],
    });
    const ctx = createTestContext(initial);
    await removeMcpServer("to-remove", ctx);
    expect(ctx.stateManager.require()?.mcpServers).toHaveLength(0);
  });

  it("logs a warn and returns early when server not found", async () => {
    const ctx = createTestContext(makeState());
    const warnSpy = vi.spyOn(ctx.logger, "warn");
    await removeMcpServer("ghost", ctx);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ghost"));
  });
});

// ── removeMcpServer — bridge to mcpm (slice 1) ────────────────────────────────
//
// `bridge-mcp-sync-to-mcpm-for-intersection` slice 1: `removeMcpServer` now
// calls `delegateMcpUninstall` so the MCP_INTERSECTION_AGENTS mcpm intersection (cursor,
// claude-code, codex, etc.) gets the server removed from each client's
// actual config file. Native `pruneServerFromAgents` only handles
// carve-outs after slice 4a of `delegate-mcp-to-mcpm`.

describe("removeMcpServer — bridge to mcpm", () => {
  it("does NOT call delegateMcpUninstall when no agents detected", async () => {
    const { delegateMcpUninstall } = await import("./mcp-delegate.js");
    const mockDelegate = vi.mocked(delegateMcpUninstall);
    mockDelegate.mockClear();

    const initial = makeState({
      mcpServers: [{ name: "to-remove", command: "cmd", args: [], env: {}, source: "user" }],
    });
    const ctx = createTestContext(initial);
    await removeMcpServer("to-remove", ctx);

    expect(mockDelegate).not.toHaveBeenCalled();
  });

  it("does NOT call delegateMcpUninstall when only carve-out agents are detected", async () => {
    // kiro + copilot are explicit carve-outs. Native
    // `pruneServerFromAgents` handles them; the bridge stays silent.
    const { delegateMcpUninstall } = await import("./mcp-delegate.js");
    const mockDelegate = vi.mocked(delegateMcpUninstall);
    mockDelegate.mockClear();

    const initial = makeState({
      mcpServers: [{ name: "to-remove", command: "cmd", args: [], env: {}, source: "user" }],
      agents: [{ name: "kiro", detected: true } as never, { name: "copilot", detected: true } as never],
    });
    const ctx = createTestContext(initial);
    await removeMcpServer("to-remove", ctx);

    expect(mockDelegate).not.toHaveBeenCalled();
  });

  it("calls delegateMcpUninstall with detected intersection agents", async () => {
    const { delegateMcpUninstall } = await import("./mcp-delegate.js");
    const mockDelegate = vi.mocked(delegateMcpUninstall);
    mockDelegate.mockClear();
    mockDelegate.mockReturnValueOnce({
      ok: true,
      carveOuts: [],
      perClient: [
        { client: "cursor", ok: true },
        { client: "claude-code", ok: true },
      ],
      globalUninstall: { ok: true },
    });

    const initial = makeState({
      mcpServers: [{ name: "to-remove", command: "cmd", args: [], env: {}, source: "user" }],
      agents: [{ name: "cursor", detected: true } as never, { name: "claude-code", detected: true } as never],
    });
    const ctx = createTestContext(initial);
    await removeMcpServer("to-remove", ctx);

    expect(mockDelegate).toHaveBeenCalledWith({
      serverName: "to-remove",
      agents: ["cursor", "claude-code"],
    });
  });

  it("filters out undetected agents from the routing list", async () => {
    const { delegateMcpUninstall } = await import("./mcp-delegate.js");
    const mockDelegate = vi.mocked(delegateMcpUninstall);
    mockDelegate.mockClear();
    mockDelegate.mockReturnValueOnce({
      ok: true,
      carveOuts: [],
      perClient: [{ client: "cursor", ok: true }],
      globalUninstall: { ok: true },
    });

    const initial = makeState({
      mcpServers: [{ name: "to-remove", command: "cmd", args: [], env: {}, source: "user" }],
      agents: [
        { name: "cursor", detected: true } as never,
        { name: "claude-code", detected: false } as never,
        { name: "codex", detected: true } as never,
      ],
    });
    const ctx = createTestContext(initial);
    await removeMcpServer("to-remove", ctx);

    expect(mockDelegate).toHaveBeenCalledWith({
      serverName: "to-remove",
      agents: ["cursor", "codex"],
    });
  });

  it("logs which clients had mcpm configs removed", async () => {
    const { delegateMcpUninstall } = await import("./mcp-delegate.js");
    const mockDelegate = vi.mocked(delegateMcpUninstall);
    mockDelegate.mockClear();
    mockDelegate.mockReturnValueOnce({
      ok: true,
      carveOuts: [],
      perClient: [
        { client: "cursor", ok: true },
        { client: "claude-code", ok: true },
      ],
      globalUninstall: { ok: true },
    });

    const initial = makeState({
      mcpServers: [{ name: "to-remove", command: "cmd", args: [], env: {}, source: "user" }],
      agents: [{ name: "cursor", detected: true } as never, { name: "claude-code", detected: true } as never],
    });
    const ctx = createTestContext(initial);
    const logSpy = vi.spyOn(ctx.logger, "log");
    await removeMcpServer("to-remove", ctx);

    const allLogs = logSpy.mock.calls.flat().join(" ");
    expect(allLogs).toContain("Removed mcpm client configs from");
    expect(allLogs).toContain("cursor");
    expect(allLogs).toContain("claude-code");
  });

  it("stays silent when delegateMcpUninstall fails (failure is non-fatal)", async () => {
    const { delegateMcpUninstall } = await import("./mcp-delegate.js");
    const mockDelegate = vi.mocked(delegateMcpUninstall);
    mockDelegate.mockClear();
    mockDelegate.mockReturnValueOnce({
      ok: false,
      carveOuts: [],
      perClient: [{ client: "cursor", ok: false, stderr: "mcpm: server not found" }],
      globalUninstall: { ok: false, stderr: "mcpm: not found in registry" },
    });

    const initial = makeState({
      mcpServers: [{ name: "to-remove", command: "cmd", args: [], env: {}, source: "user" }],
      agents: [{ name: "cursor", detected: true } as never],
    });
    const ctx = createTestContext(initial);
    const logSpy = vi.spyOn(ctx.logger, "log");
    const errorSpy = vi.spyOn(ctx.logger, "error");
    await removeMcpServer("to-remove", ctx);

    // The state mutation succeeded — the operation as a whole reports
    // success, even though the bridge silently failed.
    expect(ctx.stateManager.require()?.mcpServers).toHaveLength(0);
    const allLogs = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
    expect(allLogs).not.toContain("Removed mcpm client configs from");
  });
});
