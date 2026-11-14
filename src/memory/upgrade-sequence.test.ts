import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { upgradeMemoryWithSnapshot } from "./upgrade-sequence.js";

const hasSqlite = await import("node:sqlite").then(
  () => true,
  () => false,
);
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
const sqliteExpected = major >= 24 || (major === 23 && minor >= 4) || (major === 22 && minor >= 13);

it.runIf(sqliteExpected)("provides SQLite on supported Node runtimes", () => {
  expect(hasSqlite).toBe(true);
});

describe.runIf(hasSqlite)("memory upgrade snapshot sequence", () => {
  it("does not back up or start the candidate if stopping the old daemon fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-upgrade-stop-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      const startCandidate = vi.fn();
      const startOld = vi.fn();
      const result = await upgradeMemoryWithSnapshot({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        stopOld: async () => {
          throw new Error("synthetic stop failure");
        },
        isOldStopped: async () => false,
        startOld,
        persistCandidateIntent: async () => undefined,
        startCandidate,
        candidateHealthy: async () => true,
      });
      expect(result).toMatchObject({ ok: false, stage: "stop" });
      expect(existsSync(join(dir, "backups"))).toBe(false);
      expect(startCandidate).not.toHaveBeenCalled();
      expect(startOld).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("backs up stopped memory before starting the candidate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-upgrade-sequence-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [
        db,
        "CREATE TABLE memories (id INTEGER, deleted_at TEXT); INSERT INTO memories VALUES (1, NULL);",
      ]);
      let stopped = false;
      let recorded = false;
      const startCandidate = vi.fn(async (snapshot: string) => {
        expect(stopped).toBe(true);
        expect(recorded).toBe(true);
        expect(
          execFileSync("sqlite3", [snapshot, "SELECT COUNT(*) FROM memories;"], { encoding: "utf-8" }).trim(),
        ).toBe("1");
        expect(() =>
          execFileSync("sqlite3", ["-cmd", ".timeout 50", db, "INSERT INTO memories VALUES (98, NULL);"], {
            stdio: "pipe",
          }),
        ).toThrow();
      });
      const result = await upgradeMemoryWithSnapshot({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        stopOld: async () => {
          expect(() =>
            execFileSync("sqlite3", ["-cmd", ".timeout 50", db, "INSERT INTO memories VALUES (99, NULL);"], {
              stdio: "pipe",
            }),
          ).toThrow();
          stopped = true;
        },
        isOldStopped: async () => stopped,
        startOld: async () => {
          stopped = false;
        },
        persistCandidateIntent: async (snapshot: string) => {
          expect(existsSync(snapshot)).toBe(true);
          recorded = true;
        },
        startCandidate,
        candidateHealthy: async () => {
          execFileSync("sqlite3", [db, "INSERT INTO memories VALUES (2, NULL);"]);
          return true;
        },
      });
      expect(result.ok).toBe(true);
      expect(startCandidate).toHaveBeenCalledTimes(1);
      expect(result.snapshot && existsSync(result.snapshot)).toBe(true);
      expect(execFileSync("sqlite3", [db, "SELECT COUNT(*) FROM memories;"], { encoding: "utf-8" }).trim()).toBe("2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not register the candidate when recording its intent fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-upgrade-intent-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      const startOld = vi.fn();
      const startCandidate = vi.fn();
      const result = await upgradeMemoryWithSnapshot({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        stopOld: async () => undefined,
        isOldStopped: async () => true,
        startOld,
        persistCandidateIntent: async () => {
          throw new Error("synthetic receipt failure");
        },
        startCandidate,
        candidateHealthy: async () => true,
      });
      expect(result).toMatchObject({ ok: false, stage: "backup" });
      expect(result.error).toContain("synthetic receipt failure");
      expect(startCandidate).not.toHaveBeenCalled();
      expect(startOld).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not register the candidate if the old daemon restarts while recording intent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-upgrade-intent-restart-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      const startCandidate = vi.fn();
      const startOld = vi.fn();
      let stopped = true;
      const result = await upgradeMemoryWithSnapshot({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        stopOld: async () => undefined,
        isOldStopped: async () => stopped,
        startOld,
        persistCandidateIntent: async () => {
          stopped = false;
        },
        startCandidate,
        candidateHealthy: async () => true,
      });
      expect(result).toMatchObject({ ok: false, stage: "backup" });
      expect(result.error).toContain("restarted during intent recording");
      expect(startCandidate).not.toHaveBeenCalled();
      expect(startOld).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never starts the candidate when backup verification fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-upgrade-invalid-"));
    try {
      const db = join(dir, "invalid.db");
      execFileSync("sqlite3", [db, "CREATE TABLE unrelated (id INTEGER); INSERT INTO unrelated VALUES (1);"]);
      const original = readFileSync(db);
      const startCandidate = vi.fn();
      const startOld = vi.fn(async () => undefined);
      const result = await upgradeMemoryWithSnapshot({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        stopOld: async () => undefined,
        isOldStopped: async () => true,
        startOld,
        persistCandidateIntent: async () => undefined,
        startCandidate,
        candidateHealthy: async () => true,
      });
      expect(result.ok).toBe(false);
      expect(startCandidate).not.toHaveBeenCalled();
      expect(startOld).toHaveBeenCalledTimes(1);
      expect(result.error).toContain("backup failed verification");
      expect(readFileSync(db)).toEqual(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not start a candidate if the old daemon restarts during backup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-upgrade-restart-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [
        db,
        "CREATE TABLE memories (id INTEGER, deleted_at TEXT); INSERT INTO memories VALUES (1, NULL);",
      ]);
      const startCandidate = vi.fn();
      const stopped = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      const result = await upgradeMemoryWithSnapshot({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        stopOld: async () => undefined,
        isOldStopped: stopped,
        startOld: async () => undefined,
        persistCandidateIntent: async () => undefined,
        startCandidate,
        candidateHealthy: async () => true,
      });
      expect(result.ok).toBe(false);
      expect(startCandidate).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves both the changed database and its snapshot if the candidate fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-upgrade-failed-"));
    try {
      const db = join(dir, "memory.db");
      mkdirSync(join(dir, "backups"));
      execFileSync("sqlite3", [
        db,
        "CREATE TABLE memories (id INTEGER, deleted_at TEXT); INSERT INTO memories VALUES (1, NULL);",
      ]);
      const startOld = vi.fn();
      const result = await upgradeMemoryWithSnapshot({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        stopOld: async () => undefined,
        isOldStopped: async () => true,
        startOld,
        persistCandidateIntent: async () => undefined,
        startCandidate: async () => undefined,
        candidateHealthy: async () => {
          execFileSync("sqlite3", [db, "INSERT INTO memories VALUES (2, NULL);"]);
          throw new Error("synthetic candidate failure");
        },
      });
      expect(result.ok).toBe(false);
      expect(startOld).not.toHaveBeenCalled();
      expect(result.snapshot && existsSync(result.snapshot)).toBe(true);
      expect(execFileSync("sqlite3", [db, "SELECT COUNT(*) FROM memories;"], { encoding: "utf-8" }).trim()).toBe("2");
      expect(
        execFileSync("sqlite3", [result.snapshot!, "SELECT COUNT(*) FROM memories;"], { encoding: "utf-8" }).trim(),
      ).toBe("1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not restart the old version after an unhealthy candidate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-upgrade-health-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [
        db,
        "CREATE TABLE memories (id INTEGER, deleted_at TEXT); INSERT INTO memories VALUES (1, NULL);",
      ]);
      const startOld = vi.fn();
      const result = await upgradeMemoryWithSnapshot({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        stopOld: async () => undefined,
        isOldStopped: async () => true,
        startOld,
        persistCandidateIntent: async () => undefined,
        startCandidate: async () => undefined,
        candidateHealthy: async () => false,
      });
      expect(result).toMatchObject({ ok: false, stage: "candidate" });
      expect(startOld).not.toHaveBeenCalled();
      expect(result.snapshot && existsSync(result.snapshot)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not restart the old version when candidate registration fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-upgrade-registration-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [
        db,
        "CREATE TABLE memories (id INTEGER, deleted_at TEXT); INSERT INTO memories VALUES (1, NULL);",
      ]);
      const startOld = vi.fn();
      const result = await upgradeMemoryWithSnapshot({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        stopOld: async () => undefined,
        isOldStopped: async () => true,
        startOld,
        persistCandidateIntent: async () => undefined,
        startCandidate: async () => {
          throw new Error("synthetic registration failure");
        },
        candidateHealthy: async () => true,
      });
      expect(result).toMatchObject({ ok: false, stage: "candidate" });
      expect(startOld).not.toHaveBeenCalled();
      expect(result.snapshot && existsSync(result.snapshot)).toBe(true);
      execFileSync("sqlite3", [db, "INSERT INTO memories VALUES (2, NULL);"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
