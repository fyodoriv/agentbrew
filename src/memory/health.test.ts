import { describe, expect, it, vi } from "vitest";
import { runMemoryDoctor, runMemoryReadinessDoctor } from "./health.js";

describe("memory doctor", () => {
  it("treats disabled behavioral bootstrap as unhealthy", async () => {
    const report = await runMemoryDoctor({
      mcpHealthy: async () => true,
      toolsListHealthy: async () => true,
      bootstrapHealthy: async () => false,
      checkDb: () => true,
      newestBackup: () => "/tmp/memory-backup.db",
      backupFresh: () => true,
      verifyBackup: () => true,
    });

    expect(report.checks).toContainEqual({
      name: "bootstrap_profile",
      ok: false,
      detail: "disabled or unavailable",
    });
    expect(report.ok).toBe(false);
  });

  it("reports bootstrap profile health when the tool is enabled", async () => {
    const report = await runMemoryDoctor({
      mcpHealthy: async () => true,
      toolsListHealthy: async () => true,
      bootstrapHealthy: async () => true,
      checkDb: () => true,
      newestBackup: () => "/tmp/memory-backup.db",
      backupFresh: () => true,
      verifyBackup: () => true,
    });

    expect(report.checks).toContainEqual({
      name: "bootstrap_profile",
      ok: true,
      detail: "enabled",
    });
  });

  it("startup readiness does not depend on backup maintenance state", async () => {
    const report = await runMemoryReadinessDoctor({
      mcpHealthy: async () => true,
      toolsListHealthy: async () => true,
      bootstrapHealthy: async () => true,
      newestBackup: () => undefined,
    });

    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual(["mcp_initialize", "mcp_tools_list", "bootstrap_profile"]);
  });

  it("fails readiness when tools/list is empty or unavailable", async () => {
    const bootstrapHealthy = vi.fn(async () => true);
    const report = await runMemoryReadinessDoctor({
      mcpHealthy: async () => true,
      toolsListHealthy: async () => false,
      bootstrapHealthy,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "mcp_tools_list",
      ok: false,
      detail: "empty or unavailable",
    });
    expect(bootstrapHealthy).not.toHaveBeenCalled();
  });

  it("surfaces stale project-memory ingestion as advisory without failing daemon health", async () => {
    const report = await runMemoryDoctor({
      mcpHealthy: async () => true,
      toolsListHealthy: async () => true,
      bootstrapHealthy: async () => true,
      checkDb: () => true,
      newestBackup: () => "/tmp/memory-backup.db",
      backupFresh: () => true,
      verifyBackup: () => true,
      projectSyncCheck: () => ({ stores: 2, stale: 1, status: "drifted" }),
      maintainMarkerPath: () => "/tmp/no-memory-maintain-marker",
    });

    expect(report.checks).toContainEqual({
      name: "project_memory_sync",
      ok: false,
      severity: "advisory",
      detail: "1/2 stores need sync",
    });
    expect(report.checks.filter((check) => check.severity !== "advisory").every((check) => check.ok)).toBe(true);
  });

  it("treats an explicitly disabled maintenance scheduler differently from an unloaded one", async () => {
    const common = {
      mcpHealthy: async () => true,
      toolsListHealthy: async () => true,
      bootstrapHealthy: async () => true,
      checkDb: () => true,
      newestBackup: () => "/tmp/memory-backup.db",
      backupFresh: () => true,
      verifyBackup: () => true,
      projectSyncCheck: () => ({ stores: 0, stale: 0, status: "none" as const }),
      launchAgentSupported: () => true,
      maintainLaunchAgentStatus: () => ({ installed: true, loaded: false, disabled: true }),
    };

    const report = await runMemoryDoctor(common);
    expect(report.checks).toContainEqual({
      name: "maintain_launchagent",
      ok: true,
      detail: "explicitly disabled",
    });

    const unloaded = await runMemoryDoctor({
      ...common,
      maintainLaunchAgentStatus: () => ({ installed: true, loaded: false, disabled: false }),
    });
    expect(unloaded.checks).toContainEqual({
      name: "maintain_launchagent",
      ok: false,
      detail: "plist present but unloaded — run agentbrew memory fix",
    });
    expect(unloaded.ok).toBe(false);
  });
});
