import { execFile, execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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
  it.runIf(process.platform !== "win32").each(["destination", "ancestor"])(
    "refuses a writable %s directory",
    (scenario) => {
      const dir = mkdtempSync(join(tmpdir(), "memory-backup-shared-"));
      try {
        const shared = join(dir, "shared");
        mkdirSync(shared);
        chmodSync(shared, 0o777);
        const destination = scenario === "destination" ? shared : join(shared, "private");
        if (scenario === "ancestor") mkdirSync(destination, { mode: 0o700 });
        const source = join(dir, "source.db");
        writeFileSync(source, "synthetic");
        expect(() => sqliteBackup(source, join(destination, "backup.db"), { sqliteBin: "/missing/fixture" })).toThrow(
          /backup directory/i,
        );
        expect(readdirSync(destination)).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
  it.runIf(process.platform !== "win32")("refuses a symlinked backup directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-backup-link-"));
    try {
      const real = join(dir, "real");
      const link = join(dir, "link");
      mkdirSync(real);
      symlinkSync(real, link);
      const source = join(dir, "source.db");
      writeFileSync(source, "synthetic");
      expect(() => sqliteBackup(source, join(link, "backup.db"))).toThrow(/backup directory/i);
      expect(readdirSync(real)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.runIf(process.platform === "darwin")("refuses a backup directory with a granting ACL", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-backup-acl-"));
    try {
      const dest = join(dir, "backups");
      mkdirSync(dest, { mode: 0o700 });
      execFileSync("/bin/chmod", ["+a", "everyone allow add_file", dest]);
      const source = join(dir, "source.db");
      writeFileSync(source, "synthetic");
      expect(() => sqliteBackup(source, join(dest, "backup.db"), { sqliteBin: "/missing/fixture" })).toThrow(
        /backup directory/i,
      );
      expect(readdirSync(dest)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.runIf(process.platform === "darwin")("does not inherit access rules into the synthetic backup", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-backup-inherit-"));
    const destDir = join(dir, "backups");
    try {
      mkdirSync(destDir, { mode: 0o700 });
      execFileSync("/bin/chmod", ["+a", "everyone deny delete,file_inherit,directory_inherit", destDir]);
      const source = join(dir, "source.db");
      execFileSync("sqlite3", [source, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      const published = sqliteBackup(source, join(destDir, "backup.db"));
      const acl = execFileSync("/bin/ls", ["-le", published], { encoding: "utf-8" });
      expect(acl.trimEnd().split("\n")).toHaveLength(1);
      expect(statSync(published).mode & 0o077).toBe(0);
    } finally {
      if (existsSync(destDir)) execFileSync("/bin/chmod", ["-N", destDir]);
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("keeps temporary and published synthetic backups private under a permissive umask", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-backup-private-"));
    const originalTmp = process.env.TMPDIR;
    const originalUmask = process.umask(0o022);
    try {
      const shared = join(dir, "shared");
      mkdirSync(shared, { mode: 0o777 });
      chmodSync(shared, 0o777);
      process.env.TMPDIR = shared;
      const source = join(dir, "source.db");
      const dest = join(dir, "backup.db");
      const probe = join(dir, "probe.json");
      const tool = join(dir, "sqlite-fixture");
      writeFileSync(source, "synthetic");
      writeFileSync(
        tool,
        `#!${process.execPath}\nconst fs = require('node:fs'); const path = require('node:path');\nconst match = /^\\.backup '(.+)'$/.exec(process.argv[3]); if (!match) process.exit(1);\nconst target = match[1]; fs.writeFileSync(target, 'synthetic', { mode: 0o666 });\nfs.writeFileSync(${JSON.stringify(probe)}, JSON.stringify({ parentMode: fs.statSync(path.dirname(target)).mode & 0o777 }));\n`,
      );
      chmodSync(tool, 0o700);
      sqliteBackup(source, dest, { sqliteBin: tool });
      expect(JSON.parse(readFileSync(probe, "utf-8")).parentMode & 0o077).toBe(0);
      expect(statSync(dest).mode & 0o077).toBe(0);
    } finally {
      process.umask(originalUmask);
      if (originalTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmp;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.runIf(process.platform !== "win32")("accepts an owner-written directory that others can traverse", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-backup-readable-"));
    try {
      const backupDir = join(dir, "backups");
      mkdirSync(backupDir, { mode: 0o755 });
      chmodSync(backupDir, 0o755);
      const source = join(dir, "source.db");
      execFileSync("sqlite3", [source, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      const dest = join(backupDir, "backup.db");
      sqliteBackup(source, dest);
      expect(statSync(dest).mode & 0o077).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("cleans temporary synthetic data when the SQLite backup fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-backup-failure-"));
    try {
      const source = join(dir, "source.db");
      const probe = join(dir, "probe.txt");
      const tool = join(dir, "sqlite-fixture");
      writeFileSync(source, "synthetic");
      writeFileSync(
        tool,
        `#!${process.execPath}\nconst fs = require('node:fs'); const path = require('node:path');\nconst match = /^\\.backup '(.+)'$/.exec(process.argv[3]); if (!match) process.exit(1);\nfs.writeFileSync(match[1], 'synthetic'); fs.writeFileSync(${JSON.stringify(probe)}, path.dirname(match[1])); process.exit(17);\n`,
      );
      chmodSync(tool, 0o700);
      expect(() => sqliteBackup(source, join(dir, "backup.db"), { sqliteBin: tool })).toThrow();
      const tempDir = readFileSync(probe, "utf-8");
      expect(existsSync(tempDir)).toBe(false);
      expect(readdirSync(dir).some((name) => name.includes(".partial."))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
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
      expect(realpathSync(newestBackupInDir(backupsDir) ?? "")).toBe(dest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the published path stable if a parent alias changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentbrew-backup-alias-"));
    try {
      const source = join(dir, "source.db");
      execFileSync("sqlite3", [source, "CREATE TABLE memories (id INTEGER);"]);
      const first = join(dir, "first");
      const second = join(dir, "second");
      mkdirSync(join(first, "backups"), { recursive: true });
      mkdirSync(join(second, "backups"), { recursive: true });
      const alias = join(dir, "alias");
      symlinkSync(first, alias);
      const published = writeMemoryBackup(source, join(alias, "backups"));
      rmSync(alias);
      symlinkSync(second, alias);
      expect(published.startsWith(realpathSync(first) + "/")).toBe(true);
      expect(execFileSync("sqlite3", [published, "PRAGMA integrity_check;"], { encoding: "utf-8" }).trim()).toBe("ok");
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
  it("rotates the published directory even when its parent alias changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentbrew-rotate-alias-"));
    const originalPath = process.env.PATH;
    try {
      const source = join(dir, "source.db");
      execFileSync("/usr/bin/sqlite3", [source, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      const first = join(dir, "first");
      const second = join(dir, "second");
      mkdirSync(join(first, "backups"), { recursive: true });
      mkdirSync(join(second, "backups"), { recursive: true });
      const decoy = join(second, "backups", "decoy.db");
      writeFileSync(decoy, "fixture");
      const alias = join(dir, "alias");
      symlinkSync(first, alias);
      const bin = join(dir, "bin");
      mkdirSync(bin);
      const wrapper = join(bin, "sqlite3");
      writeFileSync(
        wrapper,
        `#!/bin/sh
if [ "$2" = "PRAGMA integrity_check;" ]; then
  /bin/rm "$TEST_ALIAS"
  /bin/ln -s "$TEST_SECOND" "$TEST_ALIAS"
fi
exec /usr/bin/sqlite3 "$@"
`,
        { mode: 0o755 },
      );
      process.env.PATH = `${bin}:${originalPath}`;
      process.env.TEST_ALIAS = alias;
      process.env.TEST_SECOND = second;
      const result = rotateMemoryBackup(source, join(alias, "backups"), 0);
      expect(result.ok).toBe(true);
      expect(existsSync(decoy)).toBe(true);
    } finally {
      process.env.PATH = originalPath;
      delete process.env.TEST_ALIAS;
      delete process.env.TEST_SECOND;
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
