import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("../core/launchctl.js", () => ({
  launchdTargetsThisHome: () => true,
  probeLaunchctl: vi.fn(() => ({ status: 113, stdout: "" })),
  runLaunchctl: vi.fn(() => ""),
}));

import { runLaunchctl } from "../core/launchctl.js";
import { acquireMemoryControlLock, memoryControlPaths } from "./control-lock.js";
import { kickstartMemoryDaemon } from "./launchagent.js";
import { readUpgradeIntent } from "./upgrade-intent.js";
import { orchestrateCoordinatedMemoryUpgrade } from "./upgrade-orchestrator.js";

const hasSqlite = await import("node:sqlite").then(
  () => true,
  () => false,
);

it.runIf(process.platform === "darwin" && hasSqlite)("holds the shared lock through the scratch handoff", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-coordinated-"));
  const paths = memoryControlPaths();
  const db = join(dir, "memory.db");
  try {
    execFileSync("sqlite3", [
      db,
      "CREATE TABLE memories (id INTEGER, deleted_at TEXT); INSERT INTO memories VALUES (1, NULL);",
    ]);
    const result = await orchestrateCoordinatedMemoryUpgrade({
      dbPath: db,
      backupsDir: join(dir, "backups"),
      oldJobLabel: "com.example.memory",
      candidateSpec: "example-memory==2.0.0",
      attemptId: "synthetic",
      assertControl: async () => undefined,
      inspect: () => ({ visibleEvidenceConsistent: true }),
      stopOld: async () => {
        expect(kickstartMemoryDaemon()).toBe(false);
        expect(runLaunchctl).not.toHaveBeenCalled();
      },
      isOldStopped: async () => true,
      startOld: async () => undefined,
      startCandidate: async (snapshot) => {
        expect(readUpgradeIntent(paths.intent)).toMatchObject({
          state: "recovery-required",
          record: { snapshotPath: snapshot },
        });
      },
      candidateHealthy: async () => true,
    });
    expect(result).toMatchObject({ ok: true, stage: "complete" });
    const release = acquireMemoryControlLock(paths.lock);
    release();
    expect(kickstartMemoryDaemon()).toBe(false);
  } finally {
    rmSync(paths.dir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

it.runIf(process.platform === "darwin" && hasSqlite).each(["held", "intent", "operation"])(
  "releases control after a blocked or failed %s handoff",
  async (scenario) => {
    const dir = mkdtempSync(join(tmpdir(), "memory-coordinated-failure-"));
    const paths = memoryControlPaths();
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    const db = join(dir, "memory.db");
    let held: ReturnType<typeof acquireMemoryControlLock> | undefined;
    try {
      execFileSync("sqlite3", [db, "CREATE TABLE memories (id INTEGER, deleted_at TEXT);"]);
      if (scenario === "held") held = acquireMemoryControlLock(paths.lock);
      if (scenario === "intent") writeFileSync(paths.intent, "partial", { mode: 0o600 });
      const stopOld = vi.fn(async () => {
        if (scenario === "operation") throw new Error("fixture stop failure");
      });
      const result = await orchestrateCoordinatedMemoryUpgrade({
        dbPath: db,
        backupsDir: join(dir, "backups"),
        oldJobLabel: "com.example.memory",
        candidateSpec: "example-memory==2.0.0",
        attemptId: "synthetic",
        assertControl: async () => undefined,
        inspect: () => ({ visibleEvidenceConsistent: true }),
        stopOld,
        isOldStopped: async () => true,
        startOld: async () => undefined,
        startCandidate: async () => undefined,
        candidateHealthy: async () => true,
      });
      expect(result.ok).toBe(false);
      expect(stopOld).toHaveBeenCalledTimes(scenario === "operation" ? 1 : 0);
      held?.();
      held = undefined;
      const release = acquireMemoryControlLock(paths.lock);
      release();
    } finally {
      held?.();
      rmSync(paths.dir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
