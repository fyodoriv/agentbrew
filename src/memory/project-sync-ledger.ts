import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { memoryProjectSyncLedgerPath } from "./paths.js";

export type ProjectMemorySyncStatus = "none" | "ok" | "degraded";

export interface ProjectMemorySyncStoreLedger {
  fingerprint: string;
  fileCount: number;
  lastSyncedAt: string;
  chunksStored: number;
}

export interface ProjectMemorySyncLedger {
  version: 1;
  lastAttemptedAt: string;
  lastSuccessfulAt?: string;
  status: ProjectMemorySyncStatus;
  stores: Record<string, ProjectMemorySyncStoreLedger>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoreLedger(value: unknown): value is ProjectMemorySyncStoreLedger {
  if (!isRecord(value)) return false;
  return (
    typeof value.fingerprint === "string" &&
    typeof value.fileCount === "number" &&
    typeof value.lastSyncedAt === "string" &&
    typeof value.chunksStored === "number"
  );
}

function parseLedger(value: unknown): ProjectMemorySyncLedger | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.lastAttemptedAt !== "string") return undefined;
  if (value.lastSuccessfulAt !== undefined && typeof value.lastSuccessfulAt !== "string") return undefined;
  if (value.status !== "none" && value.status !== "ok" && value.status !== "degraded") return undefined;
  if (!isRecord(value.stores) || !Object.values(value.stores).every(isStoreLedger)) return undefined;
  return value as unknown as ProjectMemorySyncLedger;
}

/**
 * Read only non-content project-memory sync evidence. The ledger deliberately
 * contains hashes, counts, and timestamps, never project-memory text or paths.
 */
export function readProjectMemorySyncLedger(path = memoryProjectSyncLedgerPath()): ProjectMemorySyncLedger | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return parseLedger(JSON.parse(readFileSync(path, "utf-8")) as unknown);
  } catch {
    return undefined;
  }
}

export interface WriteProjectMemorySyncLedgerOptions {
  /**
   * The ledger this run read before it synced (undefined when none existed).
   * When set, the write re-reads the ledger under a lock and keeps store
   * entries that other runs changed since `base`, so concurrent runs (the
   * daily LaunchAgent, the SessionEnd hook, ship-it) never drop each other's
   * stores. Entries that match `base` follow this run's decision, so stores
   * this run no longer finds are still pruned.
   */
  base?: ProjectMemorySyncLedger | undefined;
}

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 25;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function lockAgeMs(lockDir: string): number | undefined {
  try {
    return Date.now() - statSync(lockDir).mtimeMs;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Remove a lock left by a killed run. Only one waiter reclaims at a time,
 * behind a short guard lock, and it re-checks the age under the guard, so a
 * live lock that replaced the stale one is never removed. A guard left by a
 * killed waiter is itself removed after LOCK_STALE_MS.
 */
function reclaimStaleLock(lockDir: string): void {
  const guard = `${lockDir}.reclaim`;
  try {
    mkdirSync(guard);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    if ((lockAgeMs(guard) ?? 0) > LOCK_STALE_MS) rmSync(guard, { recursive: true, force: true });
    return;
  }
  try {
    if ((lockAgeMs(lockDir) ?? 0) > LOCK_STALE_MS) rmSync(lockDir, { recursive: true, force: true });
  } finally {
    rmSync(guard, { recursive: true, force: true });
  }
}

/**
 * Hold an mkdir-based lock next to the ledger while `fn` runs. mkdir is
 * atomic on local file systems. A lock older than LOCK_STALE_MS is left over
 * from a killed run and is reclaimed. Lifecycle: the lock directory exists
 * only for the duration of one ledger write. If the lock stays busy past
 * LOCK_WAIT_MS (adding up to that much to the run), `fn` runs without it: the
 * merged write can then lose one overlapping update, which still beats
 * dropping this run's evidence.
 */
function withLedgerLock<T>(path: string, fn: () => T): T {
  const lockDir = `${path}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  let locked = false;
  while (!locked && Date.now() <= deadline) {
    try {
      mkdirSync(lockDir);
      locked = true;
      break;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    const age = lockAgeMs(lockDir);
    if (age === undefined) continue;
    if (age > LOCK_STALE_MS) reclaimStaleLock(lockDir);
    sleepSync(LOCK_RETRY_MS);
  }
  try {
    return fn();
  } finally {
    if (locked) rmSync(lockDir, { recursive: true, force: true });
  }
}

function sameStore(a: ProjectMemorySyncStoreLedger | undefined, b: ProjectMemorySyncStoreLedger): boolean {
  return (
    a !== undefined &&
    a.fingerprint === b.fingerprint &&
    a.fileCount === b.fileCount &&
    a.lastSyncedAt === b.lastSyncedAt &&
    a.chunksStored === b.chunksStored
  );
}

function laterOf(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a > b ? a : b;
}

function mergeLedger(
  ledger: ProjectMemorySyncLedger,
  current: ProjectMemorySyncLedger | undefined,
  base: ProjectMemorySyncLedger | undefined,
): ProjectMemorySyncLedger {
  if (!current) return ledger;
  const stores = { ...ledger.stores };
  for (const [id, entry] of Object.entries(current.stores)) {
    if (sameStore(base?.stores[id], entry)) continue;
    const mine = stores[id];
    if (!mine || entry.lastSyncedAt > mine.lastSyncedAt) stores[id] = entry;
  }
  // Another run pruned a store this run left untouched: keep it pruned.
  for (const [id, entry] of Object.entries(base?.stores ?? {})) {
    const mine = stores[id];
    if (!(id in current.stores) && mine && sameStore(entry, mine)) delete stores[id];
  }
  // status and lastAttemptedAt describe the latest run, so the last writer
  // sets them; lastSuccessfulAt keeps the later of the two runs.
  const lastSuccessfulAt = laterOf(ledger.lastSuccessfulAt, current.lastSuccessfulAt);
  return { ...ledger, ...(lastSuccessfulAt ? { lastSuccessfulAt } : {}), stores };
}

export function writeProjectMemorySyncLedger(
  ledger: ProjectMemorySyncLedger,
  path = memoryProjectSyncLedgerPath(),
  options: WriteProjectMemorySyncLedgerOptions = {},
): void {
  mkdirSync(dirname(path), { recursive: true });
  const merge = "base" in options;
  withLedgerLock(path, () => {
    const next = merge ? mergeLedger(ledger, readProjectMemorySyncLedger(path), options.base) : ledger;
    writeFileAtomicSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  });
}
