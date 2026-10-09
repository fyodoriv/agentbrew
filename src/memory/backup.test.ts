import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  backupAgeSec,
  backupIsFresh,
  newestBackupInDir,
  pruneMemoryBackups,
  rotateMemoryBackup,
  writeMemoryBackup,
} from "./backup.js";

describe("memory backup helpers", () => {
  it("reports backup age from mtime", () => {
    const now = 1_700_000_000;
    expect(backupAgeSec("/missing", now)).toBeUndefined();
    expect(backupIsFresh("/missing", 3600, now)).toBe(false);
  });

  it("returns undefined when backup directory is missing", () => {
    expect(newestBackupInDir("/path/that/does/not/exist/agentbrew-memory-backups")).toBeUndefined();
  });
});

describe("pruneMemoryBackups", () => {
  it("keeps the newest backups and leaves other files alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentbrew-backup-prune-"));
    try {
      for (let i = 0; i < 5; i++) {
        const file = join(dir, `agentbrew-memory_2026100${i}_031500.db`);
        writeFileSync(file, "x");
        utimesSync(file, 1_700_000_000 + i, 1_700_000_000 + i);
      }
      writeFileSync(join(dir, "notes.txt"), "keep me");

      const removed = pruneMemoryBackups(dir, 2);

      expect(removed).toHaveLength(3);
      expect(readdirSync(dir).sort()).toEqual([
        "agentbrew-memory_20261003_031500.db",
        "agentbrew-memory_20261004_031500.db",
        "notes.txt",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty list when the directory is missing", () => {
    expect(pruneMemoryBackups("/path/that/does/not/exist/agentbrew-memory-backups", 2)).toEqual([]);
  });

  it("removes the SQLite -shm and -wal sidecars of pruned backups", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentbrew-backup-sidecars-"));
    try {
      for (let i = 0; i < 2; i++) {
        const file = join(dir, `agentbrew-memory_2026100${i}_031500.db`);
        for (const path of [file, `${file}-shm`, `${file}-wal`]) {
          writeFileSync(path, "x");
          utimesSync(path, 1_700_000_000 + i, 1_700_000_000 + i);
        }
      }

      pruneMemoryBackups(dir, 1);

      expect(readdirSync(dir).sort()).toEqual([
        "agentbrew-memory_20261001_031500.db",
        "agentbrew-memory_20261001_031500.db-shm",
        "agentbrew-memory_20261001_031500.db-wal",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writeMemoryBackup", () => {
  it("writes a timestamped, verifiable copy of the database", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentbrew-backup-write-"));
    try {
      const source = join(dir, "source.db");
      execFileSync("sqlite3", [
        source,
        "CREATE TABLE memories (id INTEGER, deleted_at TEXT); INSERT INTO memories VALUES (1, NULL);",
      ]);
      const backupsDir = join(dir, "backups");
      mkdirSync(backupsDir);

      const dest = writeMemoryBackup(source, backupsDir, new Date("2026-10-08T03:15:00Z"));

      expect(dest).toBe(join(backupsDir, "agentbrew-memory_20261008_031500.db"));
      expect(newestBackupInDir(backupsDir)).toBe(dest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("rotateMemoryBackup", () => {
  it("reports a failure instead of throwing when the source database is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentbrew-backup-rotate-"));
    try {
      const result = rotateMemoryBackup(join(dir, "missing.db"), join(dir, "backups"));
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
