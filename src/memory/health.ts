import { existsSync } from "node:fs";
import { backupIsFresh, newestBackupInDir, verifySqliteBackup } from "./backup.js";
import { MEMORY_BACKUP_MAX_AGE_SEC, MEMORY_MCP_URL } from "./constants.js";
import { invokeMemory } from "./invoke.js";
import { memoryLaunchAgentSupported, memoryMaintenanceLaunchAgentStatus } from "./launchagent.js";
import { mcpBootstrapProfileHealthy, mcpInitializeHealthy, mcpToolsListHealthy } from "./mcp-client.js";
import { memoryMaintainMarkerPath, resolveMemoryBackupsDir, resolveMemoryDbPath } from "./paths.js";
import { checkProjectMemorySync, type ProjectMemorySyncCheck } from "./project-sync.js";
import { readProjectMemorySyncLedger } from "./project-sync-ledger.js";
import { readProjectMemorySyncSchedulerReceipt } from "./project-sync-scheduler-receipt.js";

export interface MemoryDoctorCheck {
  name: string;
  ok: boolean;
  detail?: string;
  severity?: "advisory";
}

export interface MemoryDoctorReport {
  ok: boolean;
  checks: MemoryDoctorCheck[];
}

export interface MemoryDoctorDeps {
  mcpHealthy?: () => Promise<boolean>;
  toolsListHealthy?: () => Promise<boolean>;
  bootstrapHealthy?: () => Promise<boolean>;
  checkDb?: () => boolean;
  newestBackup?: () => string | undefined;
  backupFresh?: (path: string) => boolean;
  verifyBackup?: (path: string) => boolean;
  projectSyncCheck?: () => ProjectMemorySyncCheck;
  now?: () => Date;
  launchAgentSupported?: () => boolean;
  maintainLaunchAgentStatus?: () => { installed: boolean; loaded: boolean; disabled: boolean };
  maintainMarkerPath?: () => string;
}

const PROJECT_MEMORY_SYNC_MAX_AGE_MS = 26 * 60 * 60 * 1_000;

function projectMemorySyncDoctorCheck(check: ProjectMemorySyncCheck, now: Date): MemoryDoctorCheck {
  if (check.status === "none") {
    return { name: "project_memory_sync", ok: true, severity: "advisory", detail: "no project-memory stores" };
  }
  if (check.status === "drifted") {
    return {
      name: "project_memory_sync",
      ok: false,
      severity: "advisory",
      detail: `${check.stale}/${check.stores} stores need sync`,
    };
  }
  const lastSuccessful = check.lastSuccessfulAt ? Date.parse(check.lastSuccessfulAt) : Number.NaN;
  const fresh = Number.isFinite(lastSuccessful) && now.getTime() - lastSuccessful <= PROJECT_MEMORY_SYNC_MAX_AGE_MS;
  return {
    name: "project_memory_sync",
    ok: fresh,
    severity: "advisory",
    detail: fresh
      ? `${check.stores} stores up to date`
      : `${check.stores} stores up to date but no successful sync within 26 hours`,
  };
}

function addSchemaCheck(checks: MemoryDoctorCheck[], deps: MemoryDoctorDeps): void {
  const checkDb =
    deps.checkDb ??
    (() => {
      const result = invokeMemory(["check-db"]);
      return result.ok;
    });
  const healthy = checkDb();
  checks.push({ name: "schema", ok: healthy, detail: healthy ? "healthy" : "check-db failed" });
}

function addBackupCheck(checks: MemoryDoctorCheck[], deps: MemoryDoctorDeps): void {
  const backupPath = (deps.newestBackup ?? (() => newestBackupInDir(resolveMemoryBackupsDir())))();
  if (!backupPath) {
    checks.push({ name: "backup", ok: false, detail: "newest backup missing" });
    return;
  }
  const fresh = (deps.backupFresh ?? ((path) => backupIsFresh(path, MEMORY_BACKUP_MAX_AGE_SEC)))(backupPath);
  const verified = (deps.verifyBackup ?? ((path) => verifySqliteBackup(path).ok))(backupPath);
  checks.push({
    name: "backup",
    ok: fresh && verified,
    detail: `${backupPath.split("/").pop()} fresh=${fresh} verified=${verified}`,
  });
}

function addMaintenanceChecks(checks: MemoryDoctorCheck[], deps: MemoryDoctorDeps): void {
  const marker = (deps.maintainMarkerPath ?? memoryMaintainMarkerPath)();
  if (existsSync(marker)) {
    const fresh = backupIsFresh(marker, MEMORY_BACKUP_MAX_AGE_SEC);
    checks.push({ name: "maintain_marker", ok: fresh, detail: marker });
  }
  if (!(deps.launchAgentSupported ?? memoryLaunchAgentSupported)()) return;
  const maintain = (deps.maintainLaunchAgentStatus ?? memoryMaintenanceLaunchAgentStatus)();
  if (!maintain.installed) return;
  checks.push({
    name: "maintain_launchagent",
    ok: maintain.loaded || maintain.disabled,
    detail: maintain.disabled
      ? "explicitly disabled"
      : maintain.loaded
        ? "registered"
        : "plist present but unloaded — run agentbrew memory fix",
  });
}

function addProjectMemorySyncAdvisory(checks: MemoryDoctorCheck[], deps: MemoryDoctorDeps): void {
  const projectSync = (deps.projectSyncCheck ?? (() => checkProjectMemorySync()))();
  const now = (deps.now ?? (() => new Date()))();
  checks.push(projectMemorySyncDoctorCheck(projectSync, now));
}

export async function runMemoryReadinessDoctor(deps: MemoryDoctorDeps = {}): Promise<MemoryDoctorReport> {
  const checks: MemoryDoctorCheck[] = [];
  const mcpOk = await (deps.mcpHealthy ?? (() => mcpInitializeHealthy()))();
  checks.push({
    name: "mcp_initialize",
    ok: mcpOk,
    detail: mcpOk ? MEMORY_MCP_URL : "unavailable",
  });

  const toolsListOk = mcpOk && (await (deps.toolsListHealthy ?? (() => mcpToolsListHealthy()))());
  checks.push({
    name: "mcp_tools_list",
    ok: toolsListOk,
    detail: toolsListOk ? "non-empty tools/list" : "empty or unavailable",
  });

  const bootstrapOk = mcpOk && toolsListOk && (await (deps.bootstrapHealthy ?? (() => mcpBootstrapProfileHealthy()))());
  checks.push({
    name: "bootstrap_profile",
    ok: bootstrapOk,
    detail: bootstrapOk ? "enabled" : "disabled or unavailable",
  });
  return { ok: checks.every((check) => check.ok), checks };
}

export async function runMemoryDoctor(deps: MemoryDoctorDeps = {}): Promise<MemoryDoctorReport> {
  const readiness = await runMemoryReadinessDoctor(deps);
  const checks: MemoryDoctorCheck[] = [...readiness.checks];
  addSchemaCheck(checks, deps);
  addBackupCheck(checks, deps);
  addMaintenanceChecks(checks, deps);
  addProjectMemorySyncAdvisory(checks, deps);

  const ok = checks.filter((check) => check.severity !== "advisory").every((check) => check.ok);
  return { ok, checks };
}

export function buildMemoryStatusJson(): Record<string, unknown> {
  const dbPath = resolveMemoryDbPath();
  const backupsDir = resolveMemoryBackupsDir();
  const newest = newestBackupInDir(backupsDir);
  const projectSync = readProjectMemorySyncLedger();
  const schedulerReceipt = readProjectMemorySyncSchedulerReceipt();
  return {
    mcpUrl: MEMORY_MCP_URL,
    dbPath,
    backupsDir,
    newestBackup: newest ?? null,
    dbExists: existsSync(dbPath),
    projectMemorySync: projectSync
      ? {
          status: projectSync.status,
          stores: Object.keys(projectSync.stores).length,
          lastAttemptedAt: projectSync.lastAttemptedAt,
          lastSuccessfulAt: projectSync.lastSuccessfulAt ?? null,
        }
      : null,
    projectMemoryScheduler: schedulerReceipt
      ? {
          outcome: schedulerReceipt.outcome,
          scheduledAt: schedulerReceipt.scheduledAt,
          completedAt: schedulerReceipt.completedAt,
          elapsedMs: schedulerReceipt.elapsedMs,
          stores: schedulerReceipt.stores,
          synced: schedulerReceipt.synced,
          skipped: schedulerReceipt.skipped,
          unchanged: schedulerReceipt.unchanged,
        }
      : null,
  };
}
