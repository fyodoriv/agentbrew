import { homedir } from "node:os";
import { join } from "node:path";
import { expandHome } from "../utils.js";

export const MEMORY_PACKS_LEDGER_DIR = "~/.config/agentbrew/memory-packs";
export const MEMORY_PROJECT_SYNC_LEDGER_FILE = "memory-project-sync.json";
export const MEMORY_PROJECT_SYNC_SCHEDULER_RECEIPT_FILE = "memory-sync-projects-scheduler.json";

export function defaultMemoryDbPath(home = homedir()): string {
  return join(home, "Library/Application Support/mcp-memory/sqlite_vec.db");
}

export function defaultMemoryBackupsDir(home = homedir()): string {
  return join(home, "Library/Application Support/mcp-memory/backups");
}

export function resolveMemoryDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MCP_MEMORY_SQLITE_PATH) return env.MCP_MEMORY_SQLITE_PATH;
  return defaultMemoryDbPath();
}

export function resolveMemoryBackupsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MCP_MEMORY_BACKUPS_PATH) return env.MCP_MEMORY_BACKUPS_PATH;
  return defaultMemoryBackupsDir();
}

export function memoryPacksLedgerDir(): string {
  return expandHome(MEMORY_PACKS_LEDGER_DIR);
}

export function memoryPackLedgerPath(packId: string): string {
  return join(memoryPacksLedgerDir(), `${packId}.json`);
}

export function memoryMaintainMarkerPath(home = homedir()): string {
  const stateHome = process.env.XDG_STATE_HOME ?? join(home, ".local/state");
  return join(stateHome, "agentbrew/memory-maintain.ok");
}

export function memoryProjectSyncLedgerPath(home = homedir(), stateHome = process.env.XDG_STATE_HOME): string {
  return join(stateHome ?? join(home, ".local/state"), "agentbrew", MEMORY_PROJECT_SYNC_LEDGER_FILE);
}

export function memoryProjectSyncSchedulerReceiptPath(
  home = homedir(),
  stateHome = process.env.XDG_STATE_HOME,
): string {
  return join(stateHome ?? join(home, ".local/state"), "agentbrew", MEMORY_PROJECT_SYNC_SCHEDULER_RECEIPT_FILE);
}

export function memoryLaunchAgentLogDir(home = homedir()): string {
  return join(home, ".local/share/agentbrew/logs");
}
