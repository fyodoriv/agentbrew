import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { errorMessage } from "../core/errors.js";
import { MEMORY_BACKUP_KEEP } from "./constants.js";

export interface SqliteBackupOptions {
  sqliteBin?: string;
}

export function sqliteActiveCount(dbPath: string, options?: SqliteBackupOptions): number | undefined {
  const sqliteBin = options?.sqliteBin ?? "sqlite3";
  try {
    const out = execFileSync(sqliteBin, [dbPath, "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL;"], {
      encoding: "utf-8",
    }).trim();
    const count = Number(out);
    return Number.isFinite(count) ? count : undefined;
  } catch {
    return undefined;
  }
}

export function verifySqliteBackup(
  backupPath: string,
  options?: SqliteBackupOptions,
): {
  ok: boolean;
  activeCount?: number;
} {
  if (!existsSync(backupPath)) return { ok: false };
  const sqliteBin = options?.sqliteBin ?? "sqlite3";
  try {
    const integrity = execFileSync(sqliteBin, [backupPath, "PRAGMA integrity_check;"], {
      encoding: "utf-8",
    })
      .split("\n")[0]
      ?.trim();
    if (integrity !== "ok") return { ok: false };
    const activeCount = sqliteActiveCount(backupPath, options);
    if (activeCount === undefined) return { ok: false };
    return { ok: true, activeCount };
  } catch {
    return { ok: false };
  }
}

/** Safe online backup using sqlite3 `.backup` — mirrors dotfiles-memory.sh. */
export function sqliteBackup(sourceDb: string, destDb: string, options?: SqliteBackupOptions): void {
  if (!existsSync(sourceDb)) {
    throw new Error(`source database not found: ${sourceDb}`);
  }
  const sqliteBin = options?.sqliteBin ?? "sqlite3";
  mkdirSync(dirname(destDb), { recursive: true });
  const tempBackup = join(tmpdir(), `agentbrew-memory-backup-${process.pid}-${Date.now()}`);
  const staging = `${destDb}.partial.${process.pid}`;
  try {
    execFileSync(sqliteBin, [sourceDb, `.backup '${tempBackup}'`], { encoding: "utf-8" });
    copyFileSync(tempBackup, staging);
    rmSync(destDb, { force: true });
    copyFileSync(staging, destDb);
  } finally {
    rmSync(tempBackup, { force: true });
    rmSync(staging, { force: true });
  }
}

export function backupAgeSec(path: string, nowSec = Math.floor(Date.now() / 1000)): number | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const mtime = Math.floor(statSync(path).mtimeMs / 1000);
    return nowSec - mtime;
  } catch {
    return undefined;
  }
}

export function backupIsFresh(path: string, maxAgeSec: number, nowSec?: number): boolean {
  const age = backupAgeSec(path, nowSec);
  return age !== undefined && age <= maxAgeSec;
}

export function newestBackupInDir(backupsDir: string): string | undefined {
  if (!existsSync(backupsDir)) return undefined;
  let newest: string | undefined;
  let newestMtime = -1;
  for (const entry of readdirSync(backupsDir)) {
    if (!entry.endsWith(".db")) continue;
    const full = join(backupsDir, entry);
    try {
      const mtime = statSync(full).mtimeMs;
      if (mtime >= newestMtime) {
        newestMtime = mtime;
        newest = full;
      }
    } catch {
      // skip unreadable entries
    }
  }
  return newest;
}

/** Write a timestamped backup of `sourceDb` into `backupsDir` and return its path. */
export function writeMemoryBackup(sourceDb: string, backupsDir: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
  const dest = join(backupsDir, `agentbrew-memory_${stamp}.db`);
  sqliteBackup(sourceDb, dest);
  return dest;
}

/** Delete all but the newest `keep` `.db` backups (and their sidecars) in `backupsDir`; return the removed paths. */
export function pruneMemoryBackups(backupsDir: string, keep: number): string[] {
  if (!existsSync(backupsDir)) return [];
  const backups = readdirSync(backupsDir)
    .filter((entry) => entry.endsWith(".db"))
    .map((entry) => {
      const full = join(backupsDir, entry);
      return { full, mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  const removed = backups.slice(keep).map((backup) => backup.full);
  // Opening a backup to verify it can leave SQLite -shm/-wal sidecars next to it.
  for (const path of removed) {
    for (const file of [path, `${path}-shm`, `${path}-wal`]) rmSync(file, { force: true });
  }
  return removed;
}

/**
 * Write, verify, and rotate the daily memory backup. Never throws: a failure
 * comes back as `{ ok: false, error }` so `memory maintain` can report it.
 */
export function rotateMemoryBackup(
  sourceDb: string,
  backupsDir: string,
  keep: number = MEMORY_BACKUP_KEEP,
): { ok: boolean; path: string | null; error?: string } {
  try {
    const path = writeMemoryBackup(sourceDb, backupsDir);
    if (!verifySqliteBackup(path).ok) return { ok: false, path, error: `backup failed verification: ${path}` };
    pruneMemoryBackups(backupsDir, keep);
    return { ok: true, path };
  } catch (error) {
    return { ok: false, path: null, error: errorMessage(error) };
  }
}
