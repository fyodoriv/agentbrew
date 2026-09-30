import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../git-hooks.js", () => ({
  installHook: vi.fn(),
  removeHook: vi.fn(),
}));

vi.mock("../shell-hook.js", () => ({
  installShellHook: vi.fn(),
  uninstallShellHook: vi.fn(),
}));

vi.mock("../sync/auto-sync.js", () => ({
  autoSyncStatus: vi.fn(),
  cleanupLegacyAgents: vi.fn(),
  installAutoSync: vi.fn(),
  uninstallAutoSync: vi.fn(),
  watchAndSync: vi.fn(),
}));

import { installHook, removeHook } from "../git-hooks.js";
import { installShellHook, uninstallShellHook } from "../shell-hook.js";
import {
  autoSyncStatus,
  cleanupLegacyAgents,
  installAutoSync,
  uninstallAutoSync,
  watchAndSync,
} from "../sync/auto-sync.js";
import { registerInfraCommands } from "./cli-infra.js";
import { buildTestProgram } from "./test-program.js";

const mockInstallHook = vi.mocked(installHook);
const mockRemoveHook = vi.mocked(removeHook);
const mockInstallShellHook = vi.mocked(installShellHook);
const mockUninstallShellHook = vi.mocked(uninstallShellHook);
const mockAutoSyncStatus = vi.mocked(autoSyncStatus);
const mockCleanupLegacyAgents = vi.mocked(cleanupLegacyAgents);
const mockInstallAutoSync = vi.mocked(installAutoSync);
const mockUninstallAutoSync = vi.mocked(uninstallAutoSync);
const mockWatchAndSync = vi.mocked(watchAndSync);

const autoSync = vi.fn();

const buildProgram = (): Command => buildTestProgram((p) => registerInfraCommands(p, autoSync));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("registerInfraCommands", () => {
  describe("hook commands", () => {
    it("calls installHook on hook install", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "hook", "install"]);
      expect(mockInstallHook).toHaveBeenCalledOnce();
    });

    it("calls installShellHook on hook install (no flags: both installed)", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "hook", "install"]);
      expect(mockInstallShellHook).toHaveBeenCalledOnce();
    });

    it("calls only installShellHook when --shell flag is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "hook", "install", "--shell"]);
      expect(mockInstallShellHook).toHaveBeenCalledOnce();
      expect(mockInstallHook).not.toHaveBeenCalled();
    });

    it("calls only installHook when --git flag is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "hook", "install", "--git"]);
      expect(mockInstallHook).toHaveBeenCalledOnce();
      expect(mockInstallShellHook).not.toHaveBeenCalled();
    });

    it("calls removeHook on hook remove", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "hook", "remove"]);
      expect(mockRemoveHook).toHaveBeenCalledOnce();
    });

    it("calls uninstallShellHook on hook remove (no flags: both removed)", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "hook", "remove"]);
      expect(mockUninstallShellHook).toHaveBeenCalledOnce();
    });

    it("calls only uninstallShellHook when --shell flag is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "hook", "remove", "--shell"]);
      expect(mockUninstallShellHook).toHaveBeenCalledOnce();
      expect(mockRemoveHook).not.toHaveBeenCalled();
    });

    it("calls only removeHook when --git flag is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "hook", "remove", "--git"]);
      expect(mockRemoveHook).toHaveBeenCalledOnce();
      expect(mockUninstallShellHook).not.toHaveBeenCalled();
    });

    it("prefers --shell over --git when both flags are passed (install)", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "hook", "install", "--shell", "--git"]);
      expect(mockInstallShellHook).toHaveBeenCalledOnce();
      expect(mockInstallHook).not.toHaveBeenCalled();
    });

    it("prefers --shell over --git when both flags are passed (remove)", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "hook", "remove", "--shell", "--git"]);
      expect(mockUninstallShellHook).toHaveBeenCalledOnce();
      expect(mockRemoveHook).not.toHaveBeenCalled();
    });
  });

  describe("auto-sync commands", () => {
    it("calls watchAndSync on auto-sync watch", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "auto-sync", "watch"]);
      expect(mockWatchAndSync).toHaveBeenCalledOnce();
    });

    it("calls installAutoSync on auto-sync install", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "auto-sync", "install"]);
      expect(mockInstallAutoSync).toHaveBeenCalledOnce();
    });

    it("calls uninstallAutoSync on auto-sync uninstall", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "auto-sync", "uninstall"]);
      expect(mockUninstallAutoSync).toHaveBeenCalledOnce();
    });

    it("calls cleanupLegacyAgents and logs removed count on auto-sync cleanup", async () => {
      mockCleanupLegacyAgents.mockReturnValue(2);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "auto-sync", "cleanup"]);
      expect(mockCleanupLegacyAgents).toHaveBeenCalledOnce();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("2"));
    });

    it("logs no legacy agents found when cleanup removes none", async () => {
      mockCleanupLegacyAgents.mockReturnValue(0);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "auto-sync", "cleanup"]);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("No legacy"));
    });

    it("calls autoSyncStatus on auto-sync status", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "auto-sync", "status"]);
      expect(mockAutoSyncStatus).toHaveBeenCalledOnce();
    });

    it("rejects unknown auto-sync subcommand", async () => {
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        const program = buildProgram();
        await expect(program.parseAsync(["node", "test", "auto-sync", "not-a-command"])).rejects.toThrow();
      } finally {
        stderr.mockRestore();
      }
    });
  });

  describe("team commands removed", () => {
    it("the `team` command is no longer registered", async () => {
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        const program = buildProgram();
        await expect(program.parseAsync(["node", "test", "team", "init"])).rejects.toThrow();
      } finally {
        stderr.mockRestore();
      }
    });
  });
});
