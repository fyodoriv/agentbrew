import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { verifySqliteBackup, writeMemoryBackup } from "./backup.js";
import { withMemoryWriteReservation } from "./write-reservation.js";

const hasSqlite = await import("node:sqlite").then(
  () => true,
  () => false,
);

describe("memory SQLite write reservation", () => {
  it.runIf(hasSqlite)("blocks a second writer while a verified backup captures committed data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-reservation-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [
        db,
        "PRAGMA journal_mode=WAL; CREATE TABLE memories (id INTEGER, deleted_at TEXT); INSERT INTO memories VALUES (1, NULL);",
      ]);
      await withMemoryWriteReservation(db, async (assertHeld) => {
        expect(() =>
          execFileSync("sqlite3", ["-cmd", ".timeout 50", db, "INSERT INTO memories VALUES (2, NULL);"], {
            stdio: "pipe",
          }),
        ).toThrow();
        const backup = writeMemoryBackup(db, join(dir, "backups"));
        expect(verifySqliteBackup(backup)).toMatchObject({ ok: true, activeCount: 1 });
        assertHeld();
      });
      execFileSync("sqlite3", [db, "INSERT INTO memories VALUES (2, NULL);"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(hasSqlite)("releases the reservation when the protected operation fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-reservation-fail-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER);"]);
      await expect(
        withMemoryWriteReservation(db, async () => {
          throw new Error("synthetic failure");
        }),
      ).rejects.toThrow("synthetic failure");
      execFileSync("sqlite3", [db, "INSERT INTO memories VALUES (1);"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(hasSqlite)("rejects a database replaced during the reservation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-reservation-replaced-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER);"]);
      await expect(
        withMemoryWriteReservation(db, async () => {
          renameSync(db, join(dir, "original.db"));
          writeFileSync(db, "replacement");
        }),
      ).rejects.toThrow("database changed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(hasSqlite)("does not run protected work when another connection holds the writer lock", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-reservation-busy-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER);"]);
      const work = vi.fn(async () => undefined);
      await withMemoryWriteReservation(db, async () => {
        await expect(withMemoryWriteReservation(db, work, { busyTimeoutMs: 50 })).rejects.toThrow();
      });
      expect(work).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not create a missing database or run without SQLite support", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-reservation-missing-"));
    try {
      const db = join(dir, "missing.db");
      const work = vi.fn(async () => undefined);
      await expect(withMemoryWriteReservation(db, work)).rejects.toThrow();
      expect(existsSync(db)).toBe(false);
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER);"]);
      await expect(
        withMemoryWriteReservation(db, work, {
          loadSqlite: async () => {
            throw new Error("unavailable");
          },
        }),
      ).rejects.toThrow("SQLite reservation is unavailable");
      expect(work).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(!hasSqlite)("fails closed when this runtime lacks the built-in SQLite module", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-reservation-unsupported-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER);"]);
      const work = vi.fn(async () => undefined);
      await expect(withMemoryWriteReservation(db, work)).rejects.toThrow("SQLite reservation is unavailable");
      expect(work).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
