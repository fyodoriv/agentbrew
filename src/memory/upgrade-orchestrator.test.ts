import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./candidate-schema.js", async () => ({
  ...(await vi.importActual<typeof import("./candidate-schema.js")>("./candidate-schema.js")),
  checkCandidateSchema: vi.fn(() => true),
}));

import { pruneMemoryBackups } from "./backup.js";
import { readUpgradeIntent } from "./upgrade-intent.js";
import { orchestrateMemoryUpgrade } from "./upgrade-orchestrator.js";

const hasSqlite = await import("node:sqlite").then(
  () => true,
  () => false,
);

describe.runIf(hasSqlite)("memory upgrade orchestration", () => {
  it.each(["existing-intent", "failed-preflight"])("stops before changing the service on %s", async (reason) => {
    const dir = mkdtempSync(join(tmpdir(), "memory-orchestration-block-"));
    try {
      const db = join(dir, "memory.db");
      const intent = join(dir, "intent.json");
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      if (reason === "existing-intent") writeFileSync(intent, "partial");
      const stopOld = vi.fn();
      const result = await orchestrateMemoryUpgrade({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        intentPath: intent,
        oldJobLabel: "com.example.memory",
        candidateSpec: "mcp-memory-service[sqlite]==12.9.0",
        candidateRuntime: { uvxBin: "/fixture/uvx", cwd: "/fixture", env: {} },
        attemptId: "synthetic",
        assertControl: async () => undefined,
        inspect: () => ({ visibleEvidenceConsistent: reason !== "failed-preflight" }),
        stopOld,
        isOldStopped: async () => true,
        startOld: vi.fn(),
        startCandidate: vi.fn(),
        verifyCandidate: async (observe) => observe(),
        candidateHealthy: async () => true,
      });
      expect(result.ok).toBe(false);
      expect(stopOld).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records the verified snapshot before candidate startup and retains later writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-orchestration-success-"));
    try {
      const db = join(dir, "memory.db");
      const intent = join(dir, "intent.json");
      execFileSync("sqlite3", [
        db,
        "CREATE TABLE memories (id INTEGER, deleted_at TEXT); INSERT INTO memories VALUES (1, NULL);",
      ]);
      const startOld = vi.fn();
      const result = await orchestrateMemoryUpgrade({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        intentPath: intent,
        oldJobLabel: "com.example.memory",
        candidateSpec: "mcp-memory-service[sqlite]==12.9.0",
        candidateRuntime: { uvxBin: "/fixture/uvx", cwd: "/fixture", env: {} },
        attemptId: "synthetic",
        assertControl: async () => undefined,
        inspect: () => ({ visibleEvidenceConsistent: true }),
        stopOld: async () => undefined,
        isOldStopped: async () => true,
        startOld,
        startCandidate: async (snapshot) => {
          expect(readUpgradeIntent(intent)).toMatchObject({
            state: "recovery-required",
            record: { snapshotPath: snapshot },
          });
        },
        verifyCandidate: async (observe) => observe(),
        candidateHealthy: async () => {
          execFileSync("sqlite3", [db, "INSERT INTO memories VALUES (2, NULL);"]);
          return false;
        },
      });
      expect(result).toMatchObject({ ok: false, stage: "candidate" });
      expect(startOld).not.toHaveBeenCalled();
      expect(readUpgradeIntent(intent)).toMatchObject({ state: "recovery-required" });
      expect(execFileSync("sqlite3", [db, "SELECT COUNT(*) FROM memories;"], { encoding: "utf8" }).trim()).toBe("2");
      expect(readFileSync(intent, "utf8")).toContain("candidate-may-have-run");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the intent and does not restart the old service after a lost registration response", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-orchestration-response-"));
    try {
      const db = join(dir, "memory.db");
      const intent = join(dir, "intent.json");
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      const startOld = vi.fn();
      const result = await orchestrateMemoryUpgrade({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        intentPath: intent,
        oldJobLabel: "com.example.memory",
        candidateSpec: "mcp-memory-service[sqlite]==12.9.0",
        candidateRuntime: { uvxBin: "/fixture/uvx", cwd: "/fixture", env: {} },
        attemptId: "synthetic",
        assertControl: async () => undefined,
        inspect: () => ({ visibleEvidenceConsistent: true }),
        stopOld: async () => undefined,
        isOldStopped: async () => true,
        startOld,
        startCandidate: async () => {
          throw new Error("synthetic lost response");
        },
        verifyCandidate: async (observe) => observe(),
        candidateHealthy: async () => true,
      });
      expect(result).toMatchObject({ ok: false, stage: "candidate" });
      expect(startOld).not.toHaveBeenCalled();
      expect(readUpgradeIntent(intent)).toMatchObject({
        state: "recovery-required",
        record: { attemptId: "synthetic" },
      });
      execFileSync("sqlite3", [db, "INSERT INTO memories VALUES (2, NULL);"]);
      expect(execFileSync("sqlite3", [db, "SELECT COUNT(*) FROM memories;"], { encoding: "utf8" }).trim()).toBe("1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not restart the old service if maintenance control is lost", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-orchestration-control-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      const startOld = vi.fn();
      let controlled = true;
      const result = await orchestrateMemoryUpgrade({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        intentPath: join(dir, "intent.json"),
        oldJobLabel: "com.example.memory",
        candidateSpec: "mcp-memory-service[sqlite]==12.9.0",
        candidateRuntime: { uvxBin: "/fixture/uvx", cwd: "/fixture", env: {} },
        attemptId: "synthetic",
        assertControl: async () => {
          if (!controlled) throw new Error("control lost");
        },
        inspect: () => ({ visibleEvidenceConsistent: true }),
        stopOld: async () => {
          controlled = false;
        },
        isOldStopped: async () => true,
        startOld,
        startCandidate: vi.fn(),
        verifyCandidate: async (observe) => observe(),
        candidateHealthy: async () => true,
      });
      expect(result.ok).toBe(false);
      expect(startOld).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not restart the old daemon if the database was replaced after stop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-orchestration-db-swap-"));
    try {
      const db = join(dir, "memory.db");
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      const startOld = vi.fn();
      const result = await orchestrateMemoryUpgrade({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        intentPath: join(dir, "intent.json"),
        oldJobLabel: "com.example.memory",
        candidateSpec: "mcp-memory-service[sqlite]==12.9.0",
        candidateRuntime: { uvxBin: "/fixture/uvx", cwd: "/fixture", env: {} },
        attemptId: "synthetic",
        assertControl: async () => undefined,
        inspect: () => ({ visibleEvidenceConsistent: true }),
        stopOld: async () => {
          renameSync(db, `${db}.old`);
          copyFileSync(`${db}.old`, db);
        },
        isOldStopped: async () => true,
        startOld,
        startCandidate: vi.fn(),
        verifyCandidate: async (observe) => observe(),
        candidateHealthy: async () => true,
      });
      expect(result.ok).toBe(false);
      expect(startOld).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not start a candidate if the verified snapshot was replaced", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-orchestration-snapshot-swap-"));
    try {
      const db = join(dir, "memory.db");
      const intent = join(dir, "intent.json");
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      let swapped = false;
      const startCandidate = vi.fn();
      const result = await orchestrateMemoryUpgrade({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        intentPath: intent,
        oldJobLabel: "com.example.memory",
        candidateSpec: "mcp-memory-service[sqlite]==12.9.0",
        candidateRuntime: { uvxBin: "/fixture/uvx", cwd: "/fixture", env: {} },
        attemptId: "synthetic",
        assertControl: async () => {
          const status = readUpgradeIntent(intent);
          if (!swapped && status.state === "recovery-required" && status.record) {
            const path = status.record.snapshotPath;
            renameSync(path, `${path}.old`);
            copyFileSync(`${path}.old`, path);
            swapped = true;
          }
        },
        inspect: () => ({ visibleEvidenceConsistent: true }),
        stopOld: async () => undefined,
        isOldStopped: async () => true,
        startOld: vi.fn(),
        startCandidate,
        verifyCandidate: async (observe) => observe(),
        candidateHealthy: async () => true,
      });
      expect(swapped).toBe(true);
      expect(result.ok).toBe(false);
      expect(startCandidate).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the unresolved upgrade snapshot outside ordinary backup rotation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-orchestration-retention-"));
    try {
      const db = join(dir, "memory.db");
      const backups = join(dir, "backups");
      const intent = join(dir, "intent.json");
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      const result = await orchestrateMemoryUpgrade({
        dbPath: db,
        backupsDir: backups,
        intentPath: intent,
        oldJobLabel: "com.example.memory",
        candidateSpec: "mcp-memory-service[sqlite]==12.9.0",
        candidateRuntime: { uvxBin: "/fixture/uvx", cwd: "/fixture", env: {} },
        attemptId: "synthetic",
        assertControl: async () => undefined,
        inspect: () => ({ visibleEvidenceConsistent: true }),
        stopOld: async () => undefined,
        isOldStopped: async () => true,
        startOld: vi.fn(),
        startCandidate: async () => undefined,
        verifyCandidate: async (observe) => observe(),
        candidateHealthy: async () => false,
      });
      expect(result).toMatchObject({ ok: false, stage: "candidate" });
      const saved = readUpgradeIntent(intent);
      if (saved.state !== "recovery-required" || !saved.record) throw new Error("missing synthetic intent");
      mkdirSync(backups, { recursive: true });
      const normal = join(backups, "newer.db");
      writeFileSync(normal, "synthetic");
      const future = new Date(Date.now() + 60_000);
      utimesSync(normal, future, future);
      pruneMemoryBackups(backups, 1);
      expect(existsSync(saved.record.snapshotPath)).toBe(true);
      const alias = join(dir, "later-configured-backups");
      symlinkSync(dirname(saved.record.snapshotPath), alias);
      expect(() => pruneMemoryBackups(alias, 0)).toThrow();
      expect(existsSync(saved.record.snapshotPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an ordinary backup path that aliases the protected snapshot directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-orchestration-backup-alias-"));
    try {
      const db = join(dir, "memory.db");
      const protectedDir = join(dir, ".agentbrew-upgrade-snapshots");
      const alias = join(dir, "ordinary-backups");
      mkdirSync(protectedDir, { mode: 0o700 });
      symlinkSync(protectedDir, alias);
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      const stopOld = vi.fn();
      const result = await orchestrateMemoryUpgrade({
        dbPath: db,
        backupsDir: alias,
        intentPath: join(dir, "intent.json"),
        oldJobLabel: "com.example.memory",
        candidateSpec: "mcp-memory-service[sqlite]==12.9.0",
        candidateRuntime: { uvxBin: "/fixture/uvx", cwd: "/fixture", env: {} },
        attemptId: "synthetic",
        assertControl: async () => undefined,
        inspect: () => ({ visibleEvidenceConsistent: true }),
        stopOld,
        isOldStopped: async () => true,
        startOld: vi.fn(),
        startCandidate: vi.fn(),
        verifyCandidate: async (observe) => observe(),
        candidateHealthy: async () => true,
      });
      expect(result).toMatchObject({ ok: false, stage: "preflight" });
      expect(stopOld).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
