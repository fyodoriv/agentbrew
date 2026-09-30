import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { logSkipped } from "./core/logger.js";
import { LAST_SEEN_PATH, REPAIR_LOG_PATH } from "./paths.js";
import { expandHome } from "./utils.js";

/** A single auto-repair action recorded by the background scheduler. */
export interface RepairAction {
  type: string;
  agent: string;
  detail: string;
}

/** Persisted repair log — records what the background scheduler fixed. */
export interface RepairLog {
  repairedAt: string;
  actions: RepairAction[];
}

function getRepairLogPath(): string {
  return expandHome(REPAIR_LOG_PATH);
}

function getLastSeenPath(): string {
  return expandHome(LAST_SEEN_PATH);
}

/** Save repair actions from the current fix run. */
export function saveRepairLog(actions: RepairAction[]): void {
  if (actions.length === 0) return;
  const path = getRepairLogPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    const existing = loadRepairLog();
    // Append to existing actions (accumulate between user sessions)
    const combined: RepairLog = {
      repairedAt: new Date().toISOString(),
      actions: [...(existing?.actions ?? []), ...actions],
    };
    writeFileAtomicSync(path, JSON.stringify(combined, null, 2), "utf-8");
  } catch (e) {
    logSkipped("repair-log/writeFileAtomicSync", e);
    // Best effort
  }
}

/** Load the current repair log. */
export function loadRepairLog(): RepairLog | undefined {
  const path = getRepairLogPath();
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as RepairLog;
  } catch (e) {
    logSkipped("repair-log/parse", e);
    return undefined;
  }
}

/** Clear the repair log (called after showing the summary to the user). */
export function clearRepairLog(): void {
  const path = getRepairLogPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileAtomicSync(path, JSON.stringify({ repairedAt: new Date().toISOString(), actions: [] }), "utf-8");
  } catch (e) {
    logSkipped("repair-log/writeFileAtomicSync", e);
    // Best effort
  }
}

/** Record that the user ran an interactive command (resets the "since last seen" window). */
export function touchLastSeen(): void {
  const path = getLastSeenPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileAtomicSync(path, JSON.stringify({ seenAt: new Date().toISOString() }), "utf-8");
  } catch (e) {
    logSkipped("repair-log/writeFileAtomicSync", e);
    // Best effort
  }
}

/** Get a human-readable summary of auto-repair actions, or undefined if none. */
export function getRepairSummary(): string | undefined {
  const log = loadRepairLog();
  if (!log?.actions?.length) return undefined;

  // Group by type
  const byType = new Map<string, number>();
  for (const action of log.actions) {
    byType.set(action.type, (byType.get(action.type) ?? 0) + 1);
  }

  const parts: string[] = [];
  for (const [type, count] of byType) {
    parts.push(`${count} ${type}`);
  }
  return `Auto-repaired since last run: ${parts.join(", ")}`;
}
