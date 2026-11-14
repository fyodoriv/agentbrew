import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { errorMessage } from "../core/errors.js";
import { MEMORY_BACKUP_KEEP, MEMORY_UPGRADE_SNAPSHOT_DIR } from "./constants.js";

export interface SqliteBackupOptions {
  sqliteBin?: string;
}

function assertSafeDarwinAcl(path: string): void {
  const output = execFileSync("/bin/ls", ["-lde", path], {
    encoding: "utf-8",
    timeout: 5_000,
    env: { ...process.env, LC_ALL: "C" },
  });
  const acl = output.trimEnd().split("\n").slice(1);
  if (acl.some((line) => /\ballow\b/.test(line) || !/^\s*\d+:.*\bdeny\b/.test(line))) {
    throw new Error("backup directory has an unverified access rule");
  }
}

function assertTrustedAncestors(dir: string, uid: number): void {
  let current = dir;
  for (;;) {
    const item = lstatSync(current);
    const writable = (item.mode & 0o022) !== 0;
    const trustedSticky = (item.mode & 0o1000) !== 0 && (item.uid === 0 || item.uid === uid);
    if (!item.isDirectory() || (item.uid !== 0 && item.uid !== uid) || (writable && !trustedSticky)) {
      throw new Error("backup directory ancestor is not trusted");
    }
    if (process.platform === "darwin") assertSafeDarwinAcl(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function trustedBackupDirectory(path: string): string {
  const dir = resolve(path);
  const info = lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("backup directory is not a directory");
  const canonical = realpathSync(dir);
  if (/['\r\n\0]/.test(canonical)) throw new Error("backup directory cannot be safely quoted");
  if (process.platform === "win32") return canonical;
  const uid = process.getuid?.();
  const resolved = lstatSync(canonical);
  if (
    uid === undefined ||
    info.uid !== uid ||
    resolved.uid !== uid ||
    info.dev !== resolved.dev ||
    info.ino !== resolved.ino ||
    (info.mode & 0o022) !== 0 ||
    (resolved.mode & 0o022) !== 0
  ) {
    throw new Error("backup directory is not privately writable");
  }
  assertTrustedAncestors(canonical, uid);
  return canonical;
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
export function sqliteBackup(sourceDb: string, destDb: string, options?: SqliteBackupOptions): string {
  if (!existsSync(sourceDb)) {
    throw new Error(`source database not found: ${sourceDb}`);
  }
  const sqliteBin = options?.sqliteBin ?? "sqlite3";
  mkdirSync(dirname(destDb), { recursive: true, mode: 0o700 });
  const destDir = trustedBackupDirectory(dirname(destDb));
  const identity = lstatSync(destDir, { bigint: true });
  const assertDirectory = () => {
    const current = lstatSync(destDir, { bigint: true });
    if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino) {
      throw new Error("backup directory changed");
    }
  };
  const target = join(destDir, basename(destDb));
  const tempDir = mkdtempSync(join(destDir, ".agentbrew-memory-backup-"));
  const tempBackup = join(tempDir, "backup.db");
  try {
    if (process.platform === "darwin") execFileSync("/bin/chmod", ["-N", tempDir], { timeout: 5_000 });
    execFileSync(sqliteBin, [sourceDb, `.backup '${tempBackup}'`], { encoding: "utf-8" });
    chmodSync(tempBackup, 0o600);
    assertDirectory();
    linkSync(tempBackup, target);
    return target;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
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
  const dest = join(backupsDir, `agentbrew-memory_${stamp}_${randomUUID()}.db`);
  return sqliteBackup(sourceDb, dest);
}

/** Delete all but the newest `keep` `.db` backups (and their sidecars) in `backupsDir`; return the removed paths. */
export function pruneMemoryBackups(backupsDir: string, keep: number): string[] {
  if (!existsSync(backupsDir)) return [];
  if (basename(realpathSync(backupsDir)) === MEMORY_UPGRADE_SNAPSHOT_DIR) {
    throw new Error("Cannot rotate protected memory upgrade snapshots");
  }
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
    pruneMemoryBackups(dirname(path), keep);
    return { ok: true, path };
  } catch (error) {
    return { ok: false, path: null, error: errorMessage(error) };
  }
}
