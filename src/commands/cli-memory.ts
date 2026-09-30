import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { newestBackupInDir, sqliteBackup, verifySqliteBackup } from "../memory/backup.js";
import { disableMemory, enableMemory, getMemoryPackSearchPaths, isMemoryEnabled } from "../memory/enable.js";
import { buildMemoryStatusJson, runMemoryDoctor, runMemoryReadinessDoctor } from "../memory/health.js";
import { invokeMemory, invokeMemoryMaintenance } from "../memory/invoke.js";
import {
  installMemoryLaunchAgents,
  isMemoryLaunchAgentInstalled,
  kickstartMemoryDaemon,
  memoryLaunchAgentSupported,
  memoryMaintenanceLaunchAgentStatus,
} from "../memory/launchagent.js";
import {
  buildMemoryTransportReport,
  createFetchMemoryMcpClient,
  mcpBootstrapProfileHealthy,
  mcpToolsListHealthy,
  waitForMemoryMcpHealthy,
} from "../memory/mcp-client.js";
import {
  discoverPacks,
  type PackReconcileResult,
  reconcileAllInstalledPacks,
  reconcileInstalledPack,
  resolvePackDir,
  uninstallPack,
} from "../memory/pack-reconcile.js";
import { memoryMaintainMarkerPath, resolveMemoryBackupsDir, resolveMemoryDbPath } from "../memory/paths.js";
import {
  checkProjectMemorySync,
  type ProjectMemorySyncCheck,
  type ProjectMemorySyncResult,
  type ProjectMemorySyncStoreResult,
  syncClaudeProjectMemories,
} from "../memory/project-sync.js";
import {
  writeProjectMemorySyncErrorReceipt,
  writeProjectMemorySyncResultReceipt,
} from "../memory/project-sync-scheduler-receipt.js";
import { loadState, requireState, saveState } from "../state.js";

const builtinFixturePack = join(fileURLToPath(new URL(".", import.meta.url)), "../memory/fixtures/example-pack");

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function defaultPackSearchPaths(): string[] {
  const state = loadState();
  if (!state) return [builtinFixturePack];
  return getMemoryPackSearchPaths(state, [builtinFixturePack]);
}

interface ProjectMemorySyncCommandOptions {
  dryRun?: boolean;
  force?: boolean;
  quiet?: boolean;
  json?: boolean;
  check?: boolean;
}

function presentProjectMemoryCheck(result: ProjectMemorySyncCheck, options: ProjectMemorySyncCommandOptions): void {
  if (options.json) {
    printJson(result);
  } else if (result.status === "none") {
    console.log("memory-sync: no project memory stores with content");
  } else if (result.status === "drifted") {
    console.log(`memory-sync: ${result.stale}/${result.stores} stores need sync`);
  } else {
    console.log(`memory-sync: ${result.stores} stores up to date`);
  }
  if (result.status === "drifted") process.exitCode = 1;
}

function presentProjectMemoryStore(store: ProjectMemorySyncStoreResult): void {
  if (store.status === "would-sync") {
    console.log(`memory-sync: would sync ${store.slug} (${store.files} files)`);
  } else if (store.status === "unchanged") {
    console.log(`memory-sync: ${store.slug} — up to date`);
  } else if (store.status === "skipped") {
    console.log(`memory-sync: ${store.slug} — daemon unavailable, skipped`);
  } else {
    console.log(`memory-sync: ${store.slug} — ${store.files} files, ${store.chunksStored ?? 0} new chunks`);
  }
}

function presentProjectMemorySync(result: ProjectMemorySyncResult, options: ProjectMemorySyncCommandOptions): void {
  if (options.json) {
    printJson(result);
    return;
  }
  if (!options.quiet) {
    for (const store of result.results) presentProjectMemoryStore(store);
  }
  if (result.status === "none") {
    console.log("memory-sync: no project memory stores with content");
    return;
  }
  const action = options.dryRun ? "would sync" : "synced";
  const unchanged = result.unchanged > 0 ? ` (${result.unchanged} up to date)` : "";
  const skipped = result.skipped > 0 ? ` (${result.skipped} skipped — daemon unavailable)` : "";
  console.log(`memory-sync: ${result.synced}/${result.stores} stores ${action}${unchanged}${skipped}`);
}

async function runProjectMemorySyncCommand(options: ProjectMemorySyncCommandOptions): Promise<void> {
  if (options.check) {
    presentProjectMemoryCheck(checkProjectMemorySync({ force: options.force }), options);
    return;
  }
  const receiptOptions = {
    path: process.env.AGENTBREW_MEMORY_SYNC_RECEIPT_PATH,
    scheduledAt: process.env.AGENTBREW_MEMORY_SYNC_SCHEDULED_AT,
    startedAt: process.env.AGENTBREW_MEMORY_SYNC_STARTED_AT,
  };
  try {
    const result = await syncClaudeProjectMemories({ dryRun: options.dryRun, force: options.force });
    if (receiptOptions.path) {
      try {
        writeProjectMemorySyncResultReceipt(result, receiptOptions);
      } catch {
        // The SessionEnd hook is non-blocking. A receipt failure must not
        // turn a completed sync into a Claude shutdown failure.
      }
    }
    presentProjectMemorySync(result, options);
  } catch (error) {
    if (receiptOptions.path) {
      try {
        writeProjectMemorySyncErrorReceipt(receiptOptions);
      } catch {
        // Preserve the original command error if receipt persistence fails.
      }
    }
    throw error;
  }
}

function maintenanceLaunchAgentFailure(launchAgent: { maintainLoaded?: boolean; maintainDisabled?: boolean }): string {
  return launchAgent.maintainLoaded === false && !launchAgent.maintainDisabled
    ? "memory maintenance LaunchAgent unavailable"
    : "";
}

function recordMemoryMaintenanceSuccess(): void {
  writeFileSync(memoryMaintainMarkerPath(), `${new Date().toISOString()}\n`, "utf-8");
}

function daemonLaunchAgentFailure(launchAgent: { daemonLoaded?: boolean }): string {
  return launchAgent.daemonLoaded === false ? "memory daemon LaunchAgent unavailable" : "";
}

async function repairMemoryRuntime(): Promise<{
  ok: boolean;
  mcpHealthy: boolean;
  bootstrapHealthy: boolean;
  launchAgent: {
    installed: boolean;
    changed?: boolean;
    daemonRestarted?: boolean;
    daemonLoaded?: boolean;
    maintainLoaded?: boolean;
    maintainDisabled?: boolean;
    reason?: string;
  };
  cursorReloadRecommended: boolean;
  cursorReloadAdvisory?: string;
  maintainOk: boolean;
  command: string;
  stderr?: string;
  failureMessage?: string;
}> {
  const supported = memoryLaunchAgentSupported();
  const launchAgent = supported
    ? installMemoryLaunchAgents()
    : { installed: false, changed: false, reason: "no boot persistence on non-macOS" };
  let daemonRecoveryOccurred = launchAgent.daemonRestarted ?? false;
  let mcpHealthy = launchAgent.changed ? await waitForMemoryMcpHealthy() : await mcpToolsListHealthy();
  if (!mcpHealthy && supported) {
    daemonRecoveryOccurred = kickstartMemoryDaemon() || daemonRecoveryOccurred;
    mcpHealthy = await waitForMemoryMcpHealthy();
  }
  const bootstrapHealthy = mcpHealthy && (await mcpBootstrapProfileHealthy());
  const maintenance = invokeMemoryMaintenance();
  if (maintenance.ok) {
    recordMemoryMaintenanceSuccess();
  }
  const failures = [
    !mcpHealthy ? "memory MCP unavailable" : "",
    !bootstrapHealthy ? "behavioral bootstrap unavailable" : "",
    daemonLaunchAgentFailure(launchAgent),
    maintenanceLaunchAgentFailure(launchAgent),
    !maintenance.ok ? maintenance.stderr || "memory maintain failed" : "",
  ].filter(Boolean);
  const cursorReloadRecommended = daemonRecoveryOccurred;
  return {
    ok: failures.length === 0,
    mcpHealthy,
    bootstrapHealthy,
    launchAgent,
    cursorReloadRecommended,
    ...(cursorReloadRecommended
      ? {
          cursorReloadAdvisory:
            "The memory daemon was recovered. Fully restart Cursor or reload its window manually so its in-process MCP host drops any stale connection.",
        }
      : {}),
    maintainOk: maintenance.ok,
    command: maintenance.command,
    stderr: maintenance.stderr || undefined,
    failureMessage: failures.join("; ") || undefined,
  };
}

function presentMemoryDoctorReport(
  report: Awaited<ReturnType<typeof runMemoryDoctor>>,
  options: { json?: boolean },
): void {
  if (options.json) {
    printJson(report);
  } else {
    for (const check of report.checks) {
      const marker = check.ok ? "✓" : check.severity === "advisory" ? "!" : "✗";
      console.log(`${marker} ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
    }
  }
  if (!report.ok) process.exitCode = 1;
}

function presentMemoryTransportReport(
  report: Awaited<ReturnType<typeof buildMemoryTransportReport>>,
  options: { json?: boolean },
): void {
  if (options.json) {
    printJson(report);
  } else {
    console.log(`Endpoint: ${report.endpoint.url}`);
    console.log(`Loopback-only: ${report.endpoint.loopbackOnly}`);
    console.log(`Discovery: ${report.availability.ok ? "available" : report.availability.detail}`);
    console.log(`Legacy session: ${report.session.detail}`);
    console.log(`Invalid Origin policy: ${report.origin.policy}`);
    console.log(`Unauthenticated discovery: ${report.unauthenticatedAccess.accepted ? "accepted" : "unavailable"}`);
    for (const agent of report.primaryAgents) {
      console.log(
        `${agent.agent}: ${agent.detected ? "detected" : "not detected"}, ${agent.delivery}, ${
          agent.currentEndpointSupported ? "state-managed endpoint" : "missing managed endpoint"
        }`,
      );
    }
    console.log("Hardening gate: not ready until every primary client has current-spec/auth compatibility evidence.");
  }
  if (!report.availability.ok) process.exitCode = 1;
}

export function registerMemoryCommands(program: Command): void {
  const memory = program.command("memory").description("Shared semantic memory runtime and pack manager");

  memory
    .command("enable")
    .description("Install shared HTTP memory MCP wiring and optional macOS LaunchAgent")
    .option("--json", "Output result as JSON")
    .action((options: { json?: boolean }) => {
      const state = requireState();
      if (!state) return;
      const result = enableMemory(state);
      saveState(state);
      if (options.json) {
        printJson({ ...result });
      } else {
        console.log("Memory enabled — shared MCP URL wired into agentbrew state.");
        if (result.launchAgent.installed) {
          console.log("LaunchAgent installed (macOS).");
        } else if (result.launchAgent.reason) {
          console.log(result.launchAgent.reason);
        }
      }
    });

  memory
    .command("disable")
    .description("Remove managed memory wiring; preserves SQLite data and pack ledgers")
    .option("--json", "Output result as JSON")
    .action((options: { json?: boolean }) => {
      const state = requireState();
      if (!state) return;
      disableMemory(state);
      saveState(state);
      if (options.json) printJson({ enabled: false });
      else console.log("Memory disabled — local data preserved.");
    });

  memory
    .command("status")
    .description("Report memory daemon paths and backup state")
    .option("--json", "Output as JSON")
    .action((options: { json?: boolean }) => {
      const state = loadState();
      const statusJson = buildMemoryStatusJson();
      const launchAgentSupported = memoryLaunchAgentSupported();
      const payload = {
        enabled: state ? isMemoryEnabled(state) : false,
        launchAgentSupported,
        launchAgentInstalled: isMemoryLaunchAgentInstalled(),
        maintenanceLaunchAgent: launchAgentSupported ? memoryMaintenanceLaunchAgentStatus() : null,
        mcpUrl: statusJson.mcpUrl,
        dbPath: statusJson.dbPath,
        backupsDir: statusJson.backupsDir,
        newestBackup: statusJson.newestBackup,
        dbExists: statusJson.dbExists,
        projectMemorySync: statusJson.projectMemorySync,
        projectMemoryScheduler: statusJson.projectMemoryScheduler,
      };
      if (options.json) printJson(payload);
      else {
        console.log(`Memory enabled: ${payload.enabled}`);
        console.log(`MCP URL: ${payload.mcpUrl}`);
        console.log(`DB: ${payload.dbPath}`);
        if (payload.newestBackup) console.log(`Newest backup: ${payload.newestBackup}`);
      }
    });

  memory
    .command("doctor")
    .description("Health checks for MCP initialize, tools/list discovery, schema, and backups")
    .option("--ready", "Check only the MCP discovery contract and behavioral bootstrap")
    .option("--json", "Output as JSON")
    .action(async (options: { ready?: boolean; json?: boolean }) => {
      const report = options.ready ? await runMemoryReadinessDoctor() : await runMemoryDoctor();
      presentMemoryDoctorReport(report, options);
    });

  memory
    .command("transport-report")
    .description("Read-only compatibility evidence for a future memory transport security migration")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      presentMemoryTransportReport(await buildMemoryTransportReport({ state: loadState() ?? undefined }), options);
    });

  memory
    .command("fix")
    .description("Reconcile memory daemon, verify bootstrap, and run maintenance")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      const payload = await repairMemoryRuntime();
      if (options.json) printJson(payload);
      if (!payload.ok) {
        if (!options.json) console.error(payload.failureMessage);
        process.exitCode = 1;
      } else if (!options.json) {
        console.log("Memory fix complete — MCP and behavioral bootstrap are healthy.");
      }
      if (payload.cursorReloadRecommended && !options.json) {
        console.log(`Advisory: ${payload.cursorReloadAdvisory}`);
      }
    });

  memory
    .command("backup")
    .description("Create a safe SQLite backup of the memory database")
    .option("--json", "Output as JSON")
    .action((options: { json?: boolean }) => {
      const source = resolveMemoryDbPath();
      const destDir = resolveMemoryBackupsDir();
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
      const dest = join(destDir, `agentbrew-memory_${stamp}.db`);
      sqliteBackup(source, dest);
      const verified = verifySqliteBackup(dest);
      const payload = { source, dest, activeCount: verified.activeCount };
      if (options.json) printJson(payload);
      else console.log(`Backup written: ${dest} (${verified.activeCount ?? "?"} active rows)`);
    });

  memory
    .command("verify-backup")
    .description("Verify backup integrity and active row count")
    .argument("[path]", "Backup file path (defaults to newest)")
    .option("--json", "Output as JSON")
    .action((path: string | undefined, options: { json?: boolean }) => {
      const backupPath = path ?? newestBackupInDir(resolveMemoryBackupsDir());
      if (!backupPath) {
        console.error("No backup found");
        process.exitCode = 1;
        return;
      }
      const verified = verifySqliteBackup(backupPath);
      const payload = { path: backupPath, ...verified };
      if (options.json) printJson(payload);
      else console.log(verified.ok ? `OK (${verified.activeCount} rows)` : "FAILED");
      if (!verified.ok) process.exitCode = 1;
    });

  memory
    .command("maintain")
    .description("Run upstream memory maintenance (schema check, backup rotation)")
    .option("--deep", "Run deep maintenance when supported")
    .option("--json", "Output as JSON")
    .action((options: { deep?: boolean; json?: boolean }) => {
      const result = invokeMemoryMaintenance();
      if (result.ok) {
        recordMemoryMaintenanceSuccess();
      }
      if (options.json) {
        printJson({ ok: result.ok, command: result.command, stdout: result.stdout, stderr: result.stderr });
      } else if (!result.ok) {
        console.error(result.stderr || "maintain failed");
        process.exitCode = 1;
      } else {
        console.log(result.stdout.trim() || "maintain complete");
      }
    });

  memory
    .command("sync-projects")
    .description("Ingest Claude project-memory files into the managed shared memory store")
    .option("--dry-run", "List populated stores without contacting the MCP daemon")
    .option("--force", "Re-ingest every populated store regardless of metadata freshness")
    .option("--quiet", "Print only the summary")
    .option("--json", "Output result as JSON")
    .option("--check", "Report unsynced project-memory changes without ingesting")
    .action(runProjectMemorySyncCommand);

  memory
    .command("dashboard")
    .description("Open the memory dashboard (delegates to upstream memory CLI)")
    .action(() => {
      const result = invokeMemory(["dashboard"]);
      if (!result.ok) {
        console.error(result.stderr || "dashboard failed");
        process.exitCode = 1;
      }
    });

  memory
    .command("stop-dashboard")
    .description("Stop the memory dashboard")
    .action(() => {
      const result = invokeMemory(["stop-dashboard"]);
      if (!result.ok) {
        console.error(result.stderr || "stop-dashboard failed");
        process.exitCode = 1;
      }
    });

  const pack = memory.command("pack").description("Memory pack install and reconciliation");

  pack
    .command("list")
    .description("List discovered memory packs")
    .option("--json", "Output as JSON")
    .action((options: { json?: boolean }) => {
      const packs = discoverPacks(defaultPackSearchPaths());
      if (options.json) printJson({ packs });
      else {
        for (const p of packs) {
          console.log(`${p.installed ? "*" : " "} ${p.id}@${p.version} — ${p.title} (${p.privacy})`);
        }
      }
    });

  pack
    .command("install <id>")
    .description("Explicitly install a memory pack into the semantic store")
    .option("--json", "Output as JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const packDir = resolvePackDir(id, defaultPackSearchPaths());
      if (!packDir) {
        console.error(`Pack not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      const client = createFetchMemoryMcpClient();
      const result = await reconcileInstalledPack(client, packDir);
      if (options.json) printJson(result);
      else {
        for (const action of result.actions) {
          console.log(`${action.action} ${action.key}`);
        }
      }
    });

  pack
    .command("update [id]")
    .description("Reconcile installed pack(s) against manifest fingerprint")
    .option("--json", "Output as JSON")
    .action(async (id: string | undefined, options: { json?: boolean }) => {
      const client = createFetchMemoryMcpClient();
      let results: PackReconcileResult[];
      if (id) {
        const packDir = resolvePackDir(id, defaultPackSearchPaths());
        if (!packDir) {
          console.error(`Pack not found: ${id}`);
          process.exitCode = 1;
          return;
        }
        results = [await reconcileInstalledPack(client, packDir)];
      } else {
        results = await reconcileAllInstalledPacks(client);
      }
      if (options.json) printJson({ results });
      else {
        for (const result of results) {
          console.log(`${result.packId}: ${result.actions.map((a) => a.action).join(", ")}`);
        }
      }
    });

  pack
    .command("verify <id>")
    .description("Dry-run pack reconciliation diff")
    .option("--json", "Output as JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const packDir = resolvePackDir(id, defaultPackSearchPaths());
      if (!packDir) {
        console.error(`Pack not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      const client = createFetchMemoryMcpClient();
      const result = await reconcileInstalledPack(client, packDir, { dryRun: true });
      if (options.json) printJson(result);
      else {
        for (const action of result.actions) {
          console.log(`${action.action} ${action.key}`);
        }
      }
    });

  pack
    .command("uninstall <id>")
    .description("Remove pack-tagged memories (requires --confirm after dry-run)")
    .option("--confirm", "Execute deletion")
    .option("--json", "Output as JSON")
    .action(async (id: string, options: { confirm?: boolean; json?: boolean }) => {
      const client = createFetchMemoryMcpClient();
      const result = await uninstallPack(client, id, {
        confirm: options.confirm,
        dryRun: !options.confirm,
      });
      if (options.json) printJson(result);
      else if (result.dryRun) {
        console.log(`Dry-run: would delete ${result.deleted} pack-tagged row(s). Re-run with --confirm.`);
      } else {
        console.log(`Deleted ${result.deleted} pack-tagged row(s).`);
      }
    });
}
