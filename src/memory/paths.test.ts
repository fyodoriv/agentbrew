import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifySqliteBackup, writeMemoryBackup } from "./backup.js";
import { resolveMemoryBackupsDir, resolveMemoryDbPath } from "./paths.js";

describe("memory database path", () => {
  it("uses the upstream SQLite-vec alias when the primary path is absent", () => {
    expect(resolveMemoryDbPath({ MCP_MEMORY_SQLITEVEC_PATH: "/tmp/alternate-memory.db" })).toBe(
      "/tmp/alternate-memory.db",
    );
  });

  it("gives the primary path precedence over the upstream alias", () => {
    expect(
      resolveMemoryDbPath({
        MCP_MEMORY_SQLITE_PATH: "/tmp/primary-memory.db",
        MCP_MEMORY_SQLITEVEC_PATH: "/tmp/alternate-memory.db",
        MCP_MEMORY_BASE_DIR: "/tmp/memory-fixture",
      }),
    ).toBe("/tmp/primary-memory.db");
  });

  it("uses the upstream base directory for the database and backups", () => {
    const env = { MCP_MEMORY_BASE_DIR: "/tmp/memory-fixture" };
    expect(resolveMemoryDbPath(env)).toBe("/tmp/memory-fixture/sqlite_vec.db");
    expect(resolveMemoryBackupsDir(env)).toBe("/tmp/memory-fixture/backups");
  });

  it("honors the upstream backup-directory alias after the primary setting", () => {
    expect(resolveMemoryBackupsDir({ mcpMemoryBackupsPath: "/tmp/alternate-backups" })).toBe(
      "/tmp/alternate-backups",
    );
    expect(
      resolveMemoryBackupsDir({
        MCP_MEMORY_BACKUPS_PATH: "/tmp/primary-backups",
        mcpMemoryBackupsPath: "/tmp/alternate-backups",
      }),
    ).toBe("/tmp/primary-backups");
  });

  it("backs up the configured base-directory database", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentbrew-memory-path-"));
    try {
      const env = { MCP_MEMORY_BASE_DIR: join(dir, "data") };
      const source = resolveMemoryDbPath(env);
      mkdirSync(env.MCP_MEMORY_BASE_DIR);
      execFileSync("sqlite3", [
        source,
        "CREATE TABLE memories (id INTEGER, deleted_at TEXT); INSERT INTO memories VALUES (1, NULL);",
      ]);

      const backup = writeMemoryBackup(source, resolveMemoryBackupsDir(env));
      expect(verifySqliteBackup(backup)).toMatchObject({ ok: true, activeCount: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
