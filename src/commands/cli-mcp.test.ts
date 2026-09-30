import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../mcp/mcp-git.js", () => ({
  installMcpFromGit: vi.fn(),
  updateMcpFromGit: vi.fn(),
}));

vi.mock("../mcp/mcp-setup.js", () => ({
  runMcpSetup: vi.fn(),
  showMcpStatus: vi.fn(),
}));

vi.mock("../sync/mcp-sync.js", () => ({
  addMcpServer: vi.fn(),
}));

// Slice 3 of `bridge-mcp-sync-to-mcpm-for-intersection`: `addMcpServerFromFlags`
// now calls `delegateMcpNew` + `delegateMcpClientEdit` to bridge custom MCP
// adds to mcpm. Without these mocks, every `mcp add` test would spawn real
// `mcpm` subprocesses.
vi.mock("../sync/mcp-delegate.js", () => ({
  delegateMcpNew: vi.fn(() => ({ ok: false })),
  delegateMcpClientEdit: vi.fn(() => ({ ok: false, carveOuts: [], perClient: [] })),
}));

vi.mock("../state.js", () => ({
  requireState: vi.fn(() => ({
    agents: [],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
  })),
  saveState: vi.fn(),
}));

import { installMcpFromGit, updateMcpFromGit } from "../mcp/mcp-git.js";
import { runMcpSetup, showMcpStatus } from "../mcp/mcp-setup.js";
import { requireState } from "../state.js";
import { delegateMcpClientEdit, delegateMcpNew } from "../sync/mcp-delegate.js";
import { addMcpServer } from "../sync/mcp-sync.js";
import { registerMcpCommands } from "./cli-mcp.js";
import { buildTestProgram } from "./test-program.js";

const mockInstallMcpFromGit = vi.mocked(installMcpFromGit);
const mockUpdateMcpFromGit = vi.mocked(updateMcpFromGit);
const mockRunMcpSetup = vi.mocked(runMcpSetup);
const mockShowMcpStatus = vi.mocked(showMcpStatus);
const mockAddMcpServer = vi.mocked(addMcpServer);
const mockDelegateMcpNew = vi.mocked(delegateMcpNew);
const mockDelegateMcpClientEdit = vi.mocked(delegateMcpClientEdit);
const mockRequireState = vi.mocked(requireState);

const autoSync = vi.fn();

const buildProgram = (): Command => buildTestProgram((p) => registerMcpCommands(p, autoSync));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
});

describe("registerMcpCommands", () => {
  describe("mcp add", () => {
    it("sets exitCode=1 when no name and no --git is given", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "add"]);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("is required"));
      expect(mockAddMcpServer).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it("logs error when neither --command nor --url nor --git is given", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "add", "my-server"]);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("required"));
      expect(mockAddMcpServer).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it("calls addMcpServer with --command", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "add", "my-server", "--command", "npx"]);
      expect(mockAddMcpServer).toHaveBeenCalledWith(
        "my-server",
        "npx",
        [],
        {},
        {
          url: undefined,
          headers: {},
        },
      );
      expect(autoSync).toHaveBeenCalledOnce();
    });

    it("passes --args to addMcpServer", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "add", "srv", "--command", "npx", "--args", "arg1", "arg2"]);
      expect(mockAddMcpServer).toHaveBeenCalledWith(
        "srv",
        "npx",
        ["arg1", "arg2"],
        {},
        {
          url: undefined,
          headers: {},
        },
      );
    });

    it("parses KEY=VALUE env pairs", async () => {
      const program = buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "mcp",
        "add",
        "srv",
        "--command",
        "npx",
        "--env",
        "FOO=bar",
        "BAZ=qux",
      ]);
      expect(mockAddMcpServer).toHaveBeenCalledWith(
        "srv",
        "npx",
        [],
        { FOO: "bar", BAZ: "qux" },
        {
          url: undefined,
          headers: {},
        },
      );
    });

    it("calls addMcpServer with --url transport", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "add", "remote", "--url", "https://example.com/mcp"]);
      expect(mockAddMcpServer).toHaveBeenCalledWith(
        "remote",
        "",
        [],
        {},
        {
          url: "https://example.com/mcp",
          headers: {},
        },
      );
    });

    it("calls installMcpFromGit with --git", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "add", "my-server", "--git", "https://github.com/org/mcp"]);
      expect(mockInstallMcpFromGit).toHaveBeenCalledWith("https://github.com/org/mcp", {
        ref: undefined,
        name: "my-server",
      });
      expect(mockAddMcpServer).not.toHaveBeenCalled();
    });

    it("passes --ref with --git", async () => {
      const program = buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "mcp",
        "add",
        "my-server",
        "--git",
        "https://github.com/org/mcp",
        "--ref",
        "v2",
      ]);
      expect(mockInstallMcpFromGit).toHaveBeenCalledWith("https://github.com/org/mcp", {
        ref: "v2",
        name: "my-server",
      });
    });
  });

  // Slice 3 of `bridge-mcp-sync-to-mcpm-for-intersection`: `mcp add` for
  // custom servers now bridges to mcpm via `mcpm new` + `mcpm client edit
  // --add-server` per intersection client.
  describe("mcp add — bridge to mcpm", () => {
    it("does NOT call delegateMcpNew when no agents are detected", async () => {
      mockRequireState.mockReturnValueOnce({
        agents: [],
        sources: [],
        mcpServers: [],
        catalogVersion: "0",
      } as never);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "add", "my-srv", "-c", "node"]);
      expect(mockAddMcpServer).toHaveBeenCalled();
      expect(mockDelegateMcpNew).not.toHaveBeenCalled();
    });

    it("does NOT call delegateMcpNew when only carve-out agents are detected", async () => {
      mockRequireState.mockReturnValueOnce({
        agents: [{ name: "devin", detected: true } as never, { name: "copilot", detected: true } as never],
        sources: [],
        mcpServers: [],
        catalogVersion: "0",
      } as never);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "add", "my-srv", "-c", "node"]);
      expect(mockAddMcpServer).toHaveBeenCalled();
      expect(mockDelegateMcpNew).not.toHaveBeenCalled();
    });

    it("calls mcpm new + client edit when intersection agents are detected", async () => {
      mockRequireState.mockReturnValueOnce({
        agents: [{ name: "cline", detected: true } as never, { name: "claude-code", detected: true } as never],
        sources: [],
        mcpServers: [],
        catalogVersion: "0",
      } as never);
      mockDelegateMcpNew.mockReturnValueOnce({ ok: true });
      mockDelegateMcpClientEdit.mockReturnValueOnce({
        ok: true,
        carveOuts: [],
        perClient: [
          { client: "cline", ok: true },
          { client: "claude-code", ok: true },
        ],
      });

      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "add", "my-srv", "-c", "node", "-a", "./srv.js"]);

      expect(mockDelegateMcpNew).toHaveBeenCalledWith({
        serverName: "my-srv",
        command: "node",
        args: ["./srv.js"],
        env: {},
        url: undefined,
        headers: {},
      });
      expect(mockDelegateMcpClientEdit).toHaveBeenCalledWith({
        serverName: "my-srv",
        agents: ["cline", "claude-code"],
      });
    });

    it("skips client edit when mcpm new fails", async () => {
      mockRequireState.mockReturnValueOnce({
        agents: [{ name: "cline", detected: true } as never],
        sources: [],
        mcpServers: [],
        catalogVersion: "0",
      } as never);
      mockDelegateMcpNew.mockReturnValueOnce({ ok: false, stderr: "server already exists" });

      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "add", "my-srv", "-c", "node"]);

      expect(mockDelegateMcpNew).toHaveBeenCalled();
      expect(mockDelegateMcpClientEdit).not.toHaveBeenCalled();
    });
  });

  describe("mcp update", () => {
    it("logs error when no name is given", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "update"]);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("required"));
      expect(mockUpdateMcpFromGit).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it("calls updateMcpFromGit with server name", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "update", "my-server"]);
      expect(mockUpdateMcpFromGit).toHaveBeenCalledWith("my-server");
    });
  });

  describe("mcp status", () => {
    it("calls showMcpStatus with default options", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "status"]);
      expect(mockShowMcpStatus).toHaveBeenCalledWith({ all: undefined, json: undefined });
    });

    it("passes --all and --json", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "status", "--all", "--json"]);
      expect(mockShowMcpStatus).toHaveBeenCalledWith({ all: true, json: true });
    });
  });

  describe("mcp setup", () => {
    it("calls runMcpSetup and autoSync", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "setup"]);
      expect(mockRunMcpSetup).toHaveBeenCalledWith({ server: undefined, installMissing: true });
      expect(autoSync).toHaveBeenCalledOnce();
    });

    it("passes server name to runMcpSetup", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "setup", "my-server"]);
      expect(mockRunMcpSetup).toHaveBeenCalledWith({ server: "my-server", installMissing: true });
    });

    it("passes --no-install to runMcpSetup", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "mcp", "setup", "--no-install"]);
      expect(mockRunMcpSetup).toHaveBeenCalledWith({ server: undefined, installMissing: false });
    });
  });

  describe("mcp project (removed)", () => {
    it("the `mcp project` command is no longer registered", async () => {
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        const program = buildProgram();
        await expect(program.parseAsync(["node", "test", "mcp", "project", "sync"])).rejects.toThrow();
        await expect(program.parseAsync(["node", "test", "mcp", "project", "status"])).rejects.toThrow();
        await expect(program.parseAsync(["node", "test", "mcp", "project", "init"])).rejects.toThrow();
      } finally {
        stderr.mockRestore();
      }
    });
  });
});
