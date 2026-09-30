import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../agentfile.js", () => ({
  generateAgentfile: vi.fn(),
  writeAgentfile: vi.fn(() => "/fake/Agentfile.yaml"),
  writeMergedAgentfile: vi.fn(() => "/fake/merged/Agentfile.yaml"),
  removeFromAgentfile: vi.fn(),
  removeFromProject: vi.fn(),
  globalAgentfileDir: vi.fn(() => "/fake/global"),
}));

vi.mock("../core/cli-error.js", () => ({
  cliMissingArg: vi.fn(),
}));

vi.mock("../health.js", () => ({
  healthCheck: vi.fn(),
}));

vi.mock("../import.js", () => ({
  importAll: vi.fn(),
  importFromAgent: vi.fn(),
}));

vi.mock("../init.js", () => ({
  init: vi.fn(),
  initForce: vi.fn(),
}));

vi.mock("../mcp/mcp-setup.js", () => ({
  runMcpSetup: vi.fn(),
}));

vi.mock("../portable.js", () => ({
  exportConfig: vi.fn(),
  importConfig: vi.fn(),
}));

vi.mock("../remove.js", () => ({
  remove: vi.fn(),
}));

vi.mock("../status.js", () => ({
  status: vi.fn(),
}));

vi.mock("../sync-runner.js", () => ({
  autoSync: vi.fn(),
}));

vi.mock("../upgrade.js", () => ({
  upgrade: vi.fn(() => ({ upgraded: true })),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import {
  generateAgentfile,
  globalAgentfileDir,
  removeFromAgentfile,
  removeFromProject,
  writeAgentfile,
  writeMergedAgentfile,
} from "../agentfile.js";
import { cliMissingArg } from "../core/cli-error.js";
import { healthCheck } from "../health.js";
import { importAll, importFromAgent } from "../import.js";
import { init, initForce } from "../init.js";
import { runMcpSetup } from "../mcp/mcp-setup.js";
import { exportConfig, importConfig } from "../portable.js";
import { remove } from "../remove.js";
import { status } from "../status.js";
import { autoSync } from "../sync-runner.js";
import { upgrade } from "../upgrade.js";
import { registerCoreCommands } from "./cli-core.js";
import { buildTestProgram } from "./test-program.js";

// ── Typed mocks ────────────────────────────────────────────────────────────

const mockInit = vi.mocked(init);
const mockInitForce = vi.mocked(initForce);
const mockGenerateAgentfile = vi.mocked(generateAgentfile);
const mockWriteAgentfile = vi.mocked(writeAgentfile);
const mockWriteMergedAgentfile = vi.mocked(writeMergedAgentfile);
const mockStatus = vi.mocked(status);
const mockHealthCheck = vi.mocked(healthCheck);
const mockAutoSync = vi.mocked(autoSync);
const mockRemove = vi.mocked(remove);
const mockRemoveFromAgentfile = vi.mocked(removeFromAgentfile);
const mockRemoveFromProject = vi.mocked(removeFromProject);
const mockGlobalAgentfileDir = vi.mocked(globalAgentfileDir);
const mockImportAll = vi.mocked(importAll);
const mockImportFromAgent = vi.mocked(importFromAgent);
const mockImportConfig = vi.mocked(importConfig);
const mockUpgrade = vi.mocked(upgrade);
const mockExportConfig = vi.mocked(exportConfig);
const mockCliMissingArg = vi.mocked(cliMissingArg);
const mockRunMcpSetup = vi.mocked(runMcpSetup);

// ── Helpers ────────────────────────────────────────────────────────────────

const buildProgram = (): Command => buildTestProgram(registerCoreCommands);

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
  mockUpgrade.mockResolvedValue({
    upgraded: true,
    latestVersion: "1.0.0",
    currentVersion: "1.0.0",
    updateAvailable: false,
    method: "global",
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("registerCoreCommands", () => {
  describe("agentfile command", () => {
    it("merges Agentfiles into the requested output path", async () => {
      const program = buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "agentfile",
        "merge",
        "base.yaml",
        "overlay.yaml",
        "--output",
        "out.yaml",
      ]);
      expect(mockWriteMergedAgentfile).toHaveBeenCalledWith(["base.yaml", "overlay.yaml"], "out.yaml");
    });
  });

  // ── init ──────────────────────────────────────────────────────────────

  describe("init command", () => {
    it("calls init() with default options", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "init"]);
      expect(mockInit).toHaveBeenCalledWith({ skipInstall: undefined, skipSync: undefined });
    });

    it("calls initForce when --force is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "init", "--force"]);
      expect(mockInitForce).toHaveBeenCalledWith({ skipInstall: undefined, skipSync: undefined });
      expect(mockInit).not.toHaveBeenCalled();
    });

    it("passes skip options to initForce when --force is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "init", "--force", "--skip-install", "--skip-sync"]);
      expect(mockInitForce).toHaveBeenCalledWith({ skipInstall: true, skipSync: true });
      expect(mockInit).not.toHaveBeenCalled();
    });

    it("passes --skip-install to init", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "init", "--skip-install"]);
      expect(mockInit).toHaveBeenCalledWith({ skipInstall: true, skipSync: undefined });
    });

    it("passes --skip-sync to init", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "init", "--skip-sync"]);
      expect(mockInit).toHaveBeenCalledWith({ skipInstall: undefined, skipSync: true });
    });

    it("calls generateAgentfile and writeAgentfile when --from-state is passed", async () => {
      mockGenerateAgentfile.mockReturnValue("mcp:\n  - context7\n");
      const program = buildProgram();
      await program.parseAsync(["node", "test", "init", "--from-state"]);
      expect(mockGenerateAgentfile).toHaveBeenCalledOnce();
      expect(mockWriteAgentfile).toHaveBeenCalledOnce();
      expect(mockInit).not.toHaveBeenCalled();
    });

    it("sets exitCode 1 when --from-state has no state to export", async () => {
      mockGenerateAgentfile.mockReturnValue(undefined);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "init", "--from-state"]);
      expect(process.exitCode).toBe(1);
      expect(mockWriteAgentfile).not.toHaveBeenCalled();
      process.exitCode = undefined;
    });
  });

  // ── status ────────────────────────────────────────────────────────────

  describe("status command", () => {
    it("calls status() with default options", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "status"]);
      expect(mockStatus).toHaveBeenCalledWith({ verbose: undefined });
    });

    it("calls status with verbose when --verbose is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "status", "--verbose"]);
      expect(mockStatus).toHaveBeenCalledWith({ verbose: true });
    });

    it("`status --usage` is no longer accepted (removed usage analytics)", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "status", "--usage"])).rejects.toThrow();
    });

    it("calls healthCheck with autoFix when --fix is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "status", "--fix"]);
      expect(mockHealthCheck).toHaveBeenCalledWith({ autoFix: true, ci: undefined, json: undefined });
      expect(mockStatus).not.toHaveBeenCalled();
    });

    it("calls healthCheck with ci when --ci is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "status", "--ci"]);
      expect(mockHealthCheck).toHaveBeenCalledWith({ autoFix: undefined, ci: true, json: undefined });
    });

    it("calls healthCheck with json when --json is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "status", "--json"]);
      expect(mockHealthCheck).toHaveBeenCalledWith({ autoFix: undefined, ci: undefined, json: true });
    });
  });

  // ── remove ────────────────────────────────────────────────────────────

  describe("remove command", () => {
    it("calls remove and autoSync", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "remove", "my-server"]);
      expect(mockRemove).toHaveBeenCalledWith("my-server", { dryRun: undefined, yes: undefined });
      expect(mockAutoSync).toHaveBeenCalledOnce();
    });

    it("calls removeFromAgentfile after remove", async () => {
      mockGlobalAgentfileDir.mockReturnValue("/fake/global");
      const program = buildProgram();
      await program.parseAsync(["node", "test", "remove", "my-server"]);
      expect(mockRemoveFromAgentfile).toHaveBeenCalledWith("/fake/global", "my-server");
    });

    it("skips sync and removeFromAgentfile in dry-run", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "remove", "my-server", "--dry-run"]);
      expect(mockRemove).toHaveBeenCalledWith("my-server", { dryRun: true, yes: undefined });
      expect(mockAutoSync).not.toHaveBeenCalled();
      expect(mockRemoveFromAgentfile).not.toHaveBeenCalled();
    });

    it("calls removeFromProject when --project is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "remove", "my-item", "--project"]);
      expect(mockRemoveFromProject).toHaveBeenCalledOnce();
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("calls cliMissingArg when no name is provided", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "remove"]);
      expect(mockCliMissingArg).toHaveBeenCalledOnce();
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("skips autoSync and removeFromAgentfile when remove sets process.exitCode (item not found)", async () => {
      // Regression: `agentbrew remove nonexistent` previously printed
      // "'nonexistent' not found" AND then triggered a full autoSync (which
      // re-installed Agentfile skills and MCP servers) — misleading, wasteful,
      // and terrifying to a user who just tried to remove something. remove()
      // signals "not found" via process.exitCode = 1; callers must honour it.
      process.exitCode = undefined;
      mockRemove.mockImplementation(async () => {
        process.exitCode = 1;
      });
      const program = buildProgram();
      await program.parseAsync(["node", "test", "remove", "nonexistent-item"]);

      expect(mockRemove).toHaveBeenCalledWith("nonexistent-item", { dryRun: undefined, yes: undefined });
      expect(mockAutoSync).not.toHaveBeenCalled();
      expect(mockRemoveFromAgentfile).not.toHaveBeenCalled();
    });
  });

  // ── import ────────────────────────────────────────────────────────────

  describe("import command", () => {
    it("calls importAll when no options", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "import"]);
      expect(mockImportAll).toHaveBeenCalledOnce();
      expect(mockAutoSync).toHaveBeenCalledOnce();
    });

    it("calls importFromAgent when --from is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "import", "--from", "cursor"]);
      expect(mockImportFromAgent).toHaveBeenCalledWith("cursor");
      expect(mockImportAll).not.toHaveBeenCalled();
    });

    it("calls importConfig when --bundle is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "import", "--bundle", "backup.yaml"]);
      expect(mockImportConfig).toHaveBeenCalledWith({
        file: "backup.yaml",
        merge: true,
        dryRun: undefined,
      });
      expect(mockAutoSync).toHaveBeenCalledOnce();
    });

    it("calls importConfig with merge=false when --replace is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "import", "--bundle", "backup.yaml", "--replace"]);
      expect(mockImportConfig).toHaveBeenCalledWith({
        file: "backup.yaml",
        merge: false,
        dryRun: undefined,
      });
    });

    it("skips autoSync in bundle dry-run", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "import", "--bundle", "backup.yaml", "--dry-run"]);
      expect(mockImportConfig).toHaveBeenCalledWith({
        file: "backup.yaml",
        merge: true,
        dryRun: true,
      });
      expect(mockAutoSync).not.toHaveBeenCalled();
    });

    it("rejects --dry-run without --bundle (was silently ignored + still mutated state)", async () => {
      // Regression: `agentbrew import --dry-run` used to fall through to
      // importAll/importFromAgent with no dry-run plumbing, so the command
      // actually mutated state.yaml AND triggered autoSync — the exact
      // opposite of what "--dry-run" advertises. Until dry-run is
      // implemented for the non-bundle path, reject the combination with a
      // clear error so users aren't misled.
      process.exitCode = undefined;
      const program = buildProgram();
      await program.parseAsync(["node", "test", "import", "--dry-run"]);

      expect(mockImportAll).not.toHaveBeenCalled();
      expect(mockImportFromAgent).not.toHaveBeenCalled();
      expect(mockAutoSync).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/dry-run.*bundle|bundle.*dry-run/i));
      expect(process.exitCode).toBe(1);
    });
  });

  // ── deprecated aliases removed ────────────────────────────────────────

  describe("deprecated aliases removed", () => {
    it("`add` is not a valid command", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "add", "user/repo"])).rejects.toThrow();
    });

    it("`update` is not a valid command", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "update"])).rejects.toThrow();
    });
  });

  // ── upgrade ───────────────────────────────────────────────────────────

  describe("upgrade command", () => {
    it("calls upgrade()", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "upgrade"]);
      expect(mockUpgrade).toHaveBeenCalledWith({ check: undefined });
    });

    it("passes --check option", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "upgrade", "--check"]);
      expect(mockUpgrade).toHaveBeenCalledWith({ check: true });
    });

    it("sets exitCode 1 when update is available but not upgraded", async () => {
      mockUpgrade.mockResolvedValue({
        upgraded: false,
        updateAvailable: true,
        latestVersion: "2.0.0",
        currentVersion: "1.0.0",
        method: "global",
      });
      const program = buildProgram();
      await program.parseAsync(["node", "test", "upgrade"]);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    });

    it("does not set exitCode when successfully upgraded", async () => {
      mockUpgrade.mockResolvedValue({
        upgraded: true,
        latestVersion: "2.0.0",
        currentVersion: "1.0.0",
        updateAvailable: false,
        method: "global",
      });
      const program = buildProgram();
      await program.parseAsync(["node", "test", "upgrade"]);
      expect(process.exitCode).toBeUndefined();
    });
  });

  // ── export ────────────────────────────────────────────────────────────

  describe("export command", () => {
    it("calls exportConfig with default options", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "export"]);
      expect(mockExportConfig).toHaveBeenCalledWith({ output: undefined, json: undefined });
    });

    it("passes --output option", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "export", "--output", "my-export.yaml"]);
      expect(mockExportConfig).toHaveBeenCalledWith({ output: "my-export.yaml", json: undefined });
    });

    it("passes --json option", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "export", "--json"]);
      expect(mockExportConfig).toHaveBeenCalledWith({ output: undefined, json: true });
    });
  });

  // ── setup ─────────────────────────────────────────────────────────────

  describe("setup command", () => {
    it("calls runMcpSetup with no server", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "setup"]);
      expect(mockRunMcpSetup).toHaveBeenCalledWith({ server: undefined });
    });

    it("calls runMcpSetup with server name", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "setup", "my-server"]);
      expect(mockRunMcpSetup).toHaveBeenCalledWith({ server: "my-server" });
    });

    it("rejects --dry-run when not setting up opencode (was silently ignored)", async () => {
      // Regression: `agentbrew setup --dry-run` and
      // `agentbrew setup my-server --dry-run` used to accept the flag,
      // silently drop it, and fall through to the interactive env-var
      // wizard — so "--dry-run" did nothing. Until dry-run is implemented
      // for runMcpSetup, reject the combination with a clear error so
      // the flag's advertised contract is not violated.
      process.exitCode = undefined;
      const program = buildProgram();
      await program.parseAsync(["node", "test", "setup", "--dry-run"]);

      expect(mockRunMcpSetup).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/dry-run.*opencode|opencode.*dry-run/i));
      expect(process.exitCode).toBe(1);
    });
  });
});
