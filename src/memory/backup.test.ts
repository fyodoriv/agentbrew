import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  backupAgeSec,
  backupIsFresh,
  newestBackupInDir,
  pruneMemoryBackups,
  rotateMemoryBackup,
  sqliteBackup,
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

      expect(dest).toMatch(/agentbrew-memory_20261008_031500_[0-9a-f-]+\.db$/);
      expect(newestBackupInDir(backupsDir)).toBe(dest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves both snapshots when backups share a timestamp", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentbrew-backup-collision-"));
    try {
      const source = join(dir, "source.db");
      execFileSync("sqlite3", [
        source,
        "CREATE TABLE memories (id INTEGER, deleted_at TEXT); INSERT INTO memories VALUES (1, NULL);",
      ]);
      const now = new Date("2026-10-08T03:15:00Z");
      const first = writeMemoryBackup(source, join(dir, "backups"), now);
      execFileSync("sqlite3", [source, "INSERT INTO memories VALUES (2, NULL);"]);
      const second = writeMemoryBackup(source, join(dir, "backups"), now);

      expect(second).not.toBe(first);
      expect(execFileSync("sqlite3", [first, "SELECT COUNT(*) FROM memories;"], { encoding: "utf-8" }).trim()).toBe(
        "1",
      );
      expect(execFileSync("sqlite3", [second, "SELECT COUNT(*) FROM memories;"], { encoding: "utf-8" }).trim()).toBe(
        "2",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never replaces an existing destination", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentbrew-backup-existing-"));
    try {
      const source = join(dir, "source.db");
      const dest = join(dir, "existing.db");
      execFileSync("sqlite3", [source, "CREATE TABLE memories (id INTEGER);"]);
      writeFileSync(dest, "existing snapshot");
      expect(() => sqliteBackup(source, dest)).toThrow();
      expect(readFileSync(dest, "utf-8")).toBe("existing snapshot");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps backups from separate processes started at the same time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentbrew-backup-parallel-"));
    try {
      const source = join(dir, "source.db");
      execFileSync("sqlite3", [
        source,
        "CREATE TABLE memories (id INTEGER, deleted_at TEXT); INSERT INTO memories VALUES (1, NULL);",
      ]);
      const run = promisify(execFile);
      const script = `import { writeMemoryBackup } from ${JSON.stringify(new URL("./backup.ts", import.meta.url).href)};
        console.log(writeMemoryBackup(process.argv[1], process.argv[2], new Date("2026-10-08T03:15:00Z")));`;
      const args = ["--import", "tsx", "--input-type=module", "-e", script, source, join(dir, "backups")];
      const [first, second] = await Promise.all([run(process.execPath, args), run(process.execPath, args)]);
      const paths = [first.stdout.trim(), second.stdout.trim()];
      expect(new Set(paths).size).toBe(2);
      for (const path of paths) {
        expect(execFileSync("sqlite3", [path, "PRAGMA integrity_check;"], { encoding: "utf-8" }).trim()).toBe("ok");
        expect(execFileSync("sqlite3", [path, "SELECT COUNT(*) FROM memories;"], { encoding: "utf-8" }).trim()).toBe(
          "1",
        );
      }
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
