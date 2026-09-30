import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, writeFileSync: vi.fn() };
});

vi.mock("../state.js", () => ({
  loadState: vi.fn(() => ({
    agents: [],
    catalogVersion: "0.3.0",
    memory: { packPaths: [] },
  })),
  requireState: vi.fn(() => ({
    agents: [],
    catalogVersion: "0.3.0",
    mcpServers: [],
  })),
  saveState: vi.fn(),
}));

vi.mock("../memory/enable.js", () => ({
  enableMemory: vi.fn(() => ({ enabled: true, launchAgent: { installed: false } })),
  disableMemory: vi.fn(),
  isMemoryEnabled: vi.fn(() => false),
  getMemoryPackSearchPaths: vi.fn((_state, extra) => extra),
}));

vi.mock("../memory/health.js", () => ({
  buildMemoryStatusJson: vi.fn(() => ({
    mcpUrl: "http://127.0.0.1:18765/mcp",
    dbPath: "/tmp/db",
    backupsDir: "/tmp/backups",
    newestBackup: null,
    dbExists: false,
    projectMemorySync: { stores: 1, stale: 0, status: "ok" },
  })),
  runMemoryDoctor: vi.fn(async () => ({ ok: true, checks: [] })),
  runMemoryReadinessDoctor: vi.fn(async () => ({
    ok: true,
    checks: [
      { name: "mcp_initialize", ok: true },
      { name: "mcp_tools_list", ok: true },
      { name: "bootstrap_profile", ok: true },
    ],
  })),
}));

vi.mock("../memory/launchagent.js", () => ({
  installMemoryLaunchAgents: vi.fn(() => ({ installed: false, changed: false })),
  isMemoryLaunchAgentInstalled: vi.fn(() => false),
  kickstartMemoryDaemon: vi.fn(),
  memoryLaunchAgentSupported: vi.fn(() => false),
}));

vi.mock("../memory/mcp-client.js", () => ({
  buildMemoryTransportReport: vi.fn(async () => ({
    endpoint: { url: "http://127.0.0.1:18765/mcp", loopbackOnly: true },
    availability: { ok: true, detail: "discovered 1 tools" },
    session: { detail: "legacy session" },
    origin: { policy: "unknown" },
    unauthenticatedAccess: { accepted: true },
    primaryAgents: [],
  })),
  createFetchMemoryMcpClient: vi.fn(),
  mcpBootstrapProfileHealthy: vi.fn(async () => true),
  mcpToolsListHealthy: vi.fn(async () => true),
  waitForMemoryMcpHealthy: vi.fn(async () => true),
}));

vi.mock("../memory/pack-reconcile.js", () => ({
  discoverPacks: vi.fn(() => []),
  reconcileAllInstalledPacks: vi.fn(async () => []),
  reconcileInstalledPack: vi.fn(async () => ({ packId: "x", actions: [], applied: true })),
  resolvePackDir: vi.fn(),
  uninstallPack: vi.fn(async () => ({ deleted: 0, dryRun: true })),
}));

vi.mock("../memory/project-sync.js", () => ({
  checkProjectMemorySync: vi.fn(() => ({ stores: 1, stale: 0, status: "ok" })),
  syncClaudeProjectMemories: vi.fn(async () => ({
    stores: 1,
    synced: 1,
    skipped: 0,
    unchanged: 0,
    status: "ok",
    results: [{ slug: "example", files: 2, status: "synced", chunksStored: 3 }],
  })),
}));

vi.mock("../memory/invoke.js", () => ({
  invokeMemory: vi.fn(() => ({ ok: true, status: 0, stdout: "", stderr: "" })),
  invokeMemoryMaintenance: vi.fn(() => ({ ok: true, status: 0, stdout: "", stderr: "", command: "memory maintain" })),
}));

import { writeFileSync } from "node:fs";
import { installMemoryLaunchAgents, memoryLaunchAgentSupported } from "../memory/launchagent.js";
import { checkProjectMemorySync, syncClaudeProjectMemories } from "../memory/project-sync.js";
import { registerMemoryCommands } from "./cli-memory.js";
import { buildTestProgram } from "./test-program.js";

const buildProgram = (): Command => buildTestProgram((p) => registerMemoryCommands(p));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  process.exitCode = undefined;
});

describe("registerMemoryCommands", () => {
  it("registers memory top-level command with pack subcommands", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "test", "memory", "status", "--json"]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"mcpUrl"'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"projectMemorySync"'));
  });

  it("registers memory pack list", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "test", "memory", "pack", "list", "--json"]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"packs"'));
  });

  it("verifies behavioral bootstrap during memory fix", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "test", "memory", "fix", "--json"]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"bootstrapHealthy": true'));
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("memory-maintain.ok"),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*\n$/),
      "utf-8",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("reports a manual Cursor reload advisory after daemon recovery", async () => {
    vi.mocked(memoryLaunchAgentSupported).mockReturnValue(true);
    vi.mocked(installMemoryLaunchAgents).mockReturnValue({
      installed: true,
      changed: true,
      daemonRestarted: true,
    });

    const program = buildProgram();
    await program.parseAsync(["node", "test", "memory", "fix", "--json"]);

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toContain('"cursorReloadRecommended": true');
    expect(output).toContain("Fully restart Cursor or reload its window manually");
  });

  it("reports an unavailable daemon LaunchAgent even when an old daemon still responds", async () => {
    vi.mocked(memoryLaunchAgentSupported).mockReturnValue(true);
    vi.mocked(installMemoryLaunchAgents).mockReturnValue({
      installed: true,
      changed: false,
      daemonLoaded: false,
      maintainLoaded: true,
    });

    const program = buildProgram();
    await program.parseAsync(["node", "test", "memory", "fix", "--json"]);

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toContain("memory daemon LaunchAgent unavailable");
    expect(process.exitCode).toBe(1);
  });

  it("supports the bounded startup readiness gate", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "test", "memory", "doctor", "--ready", "--json"]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"bootstrap_profile"'));
    expect(process.exitCode).toBeUndefined();
  });

  it("prints read-only transport compatibility evidence", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "test", "memory", "transport-report", "--json"]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"loopbackOnly": true'));
    expect(process.exitCode).toBeUndefined();
  });

  it("syncs Claude project memories without exposing store paths", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "test", "memory", "sync-projects", "--json"]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"chunksStored": 3'));
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("directoryPath"));
    expect(process.exitCode).toBeUndefined();
  });

  it("reports degraded project-memory ingestion without failing the best-effort CLI", async () => {
    vi.mocked(syncClaudeProjectMemories).mockResolvedValueOnce({
      stores: 2,
      synced: 1,
      skipped: 1,
      unchanged: 0,
      status: "degraded",
      results: [
        { slug: "healthy", files: 1, status: "synced", chunksStored: 1 },
        { slug: "retry", files: 1, status: "skipped", detail: "daemon-unavailable" },
      ],
    });

    const program = buildProgram();
    await program.parseAsync(["node", "test", "memory", "sync-projects", "--json"]);

    expect(process.exitCode).toBeUndefined();
  });

  it("checks project-memory freshness without ingesting", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "test", "memory", "sync-projects", "--check"]);

    expect(console.log).toHaveBeenCalledWith("memory-sync: 1 stores up to date");
    expect(process.exitCode).toBeUndefined();
  });

  it("forwards force to the canonical project-memory ingestion path", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "test", "memory", "sync-projects", "--force", "--quiet"]);

    expect(syncClaudeProjectMemories).toHaveBeenCalledWith({ dryRun: undefined, force: true });
  });

  it("returns a nonzero exit code when project-memory freshness has drifted", async () => {
    vi.mocked(checkProjectMemorySync).mockReturnValueOnce({ stores: 2, stale: 1, status: "drifted" });

    const program = buildProgram();
    await program.parseAsync(["node", "test", "memory", "sync-projects", "--check"]);

    expect(console.log).toHaveBeenCalledWith("memory-sync: 1/2 stores need sync");
    expect(process.exitCode).toBe(1);
  });
});
