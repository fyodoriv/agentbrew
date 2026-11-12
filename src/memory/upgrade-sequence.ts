import { errorMessage } from "../core/errors.js";
import { verifySqliteBackup, writeMemoryBackup } from "./backup.js";
import { withMemoryWriteReservation } from "./write-reservation.js";

export interface MemoryUpgradeOperations {
  dbPath: string;
  backupsDir: string;
  stopOld: () => Promise<void>;
  isOldStopped: () => Promise<boolean>;
  startOld: () => Promise<void>;
  /** Register the candidate without waiting for database initialization. */
  startCandidate: (snapshot: string) => Promise<void>;
  candidateHealthy: () => Promise<boolean>;
}

export interface MemoryUpgradeResult {
  ok: boolean;
  stage: "stop" | "backup" | "candidate" | "complete";
  snapshot?: string;
  error?: string;
}

/** Callers must establish database identity and an exclusive launchd handoff. */
export async function upgradeMemoryWithSnapshot(ops: MemoryUpgradeOperations): Promise<MemoryUpgradeResult> {
  const progress: { stage: "stop" | "backup" | "candidate" } = { stage: "stop" };
  let snapshot: string | undefined;
  try {
    await withMemoryWriteReservation(ops.dbPath, async (assertHeld) => {
      await ops.stopOld();
      progress.stage = "backup";
      if (!(await ops.isOldStopped())) throw new Error("old memory daemon did not stop");
      assertHeld();
      snapshot = writeMemoryBackup(ops.dbPath, ops.backupsDir);
      if (!verifySqliteBackup(snapshot).ok) throw new Error("memory backup failed verification");
      if (!(await ops.isOldStopped())) throw new Error("old memory daemon restarted during backup");
      assertHeld();
      progress.stage = "candidate";
      await ops.startCandidate(snapshot);
      assertHeld();
    });
  } catch (error) {
    try {
      if (progress.stage === "backup" && (await ops.isOldStopped())) await ops.startOld();
    } catch {
      // Preserve the database and snapshot; the caller must report recovery failure.
      return {
        ok: false,
        stage: progress.stage,
        snapshot,
        error: `${errorMessage(error)}; old daemon recovery failed`,
      };
    }
    return { ok: false, stage: progress.stage, snapshot, error: errorMessage(error) };
  }

  try {
    if (!snapshot) throw new Error("verified memory snapshot is missing");
    if (!(await ops.candidateHealthy())) throw new Error("candidate memory daemon is not healthy");
    return { ok: true, stage: "complete", snapshot };
  } catch (error) {
    // The candidate may have migrated or written data. Never restore over that database here.
    return { ok: false, stage: "candidate", snapshot, error: errorMessage(error) };
  }
}
