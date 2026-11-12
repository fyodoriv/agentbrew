import { errorMessage } from "../core/errors.js";
import { verifySqliteBackup, writeMemoryBackup } from "./backup.js";

export interface MemoryUpgradeOperations {
  dbPath: string;
  backupsDir: string;
  stopOld: () => Promise<void>;
  isOldStopped: () => Promise<boolean>;
  startOld: () => Promise<void>;
  startCandidate: (snapshot: string) => Promise<void>;
  candidateHealthy: () => Promise<boolean>;
}

export interface MemoryUpgradeResult {
  ok: boolean;
  stage: "stop" | "backup" | "candidate" | "complete";
  snapshot?: string;
  error?: string;
}

/** Sequence only. Callers must establish database identity and an exclusive handoff. */
export async function upgradeMemoryWithSnapshot(ops: MemoryUpgradeOperations): Promise<MemoryUpgradeResult> {
  try {
    await ops.stopOld();
  } catch (error) {
    return { ok: false, stage: "stop", error: errorMessage(error) };
  }

  let snapshot: string | undefined;
  try {
    if (!(await ops.isOldStopped())) throw new Error("old memory daemon did not stop");
    snapshot = writeMemoryBackup(ops.dbPath, ops.backupsDir);
    if (!verifySqliteBackup(snapshot).ok) throw new Error("memory backup failed verification");
    if (!(await ops.isOldStopped())) throw new Error("old memory daemon restarted during backup");
  } catch (error) {
    try {
      if (await ops.isOldStopped()) await ops.startOld();
    } catch {
      // Preserve the database and snapshot; the caller must report recovery failure.
      return { ok: false, stage: "backup", snapshot, error: `${errorMessage(error)}; old daemon recovery failed` };
    }
    return { ok: false, stage: "backup", snapshot, error: errorMessage(error) };
  }

  try {
    await ops.startCandidate(snapshot);
    if (!(await ops.candidateHealthy())) throw new Error("candidate memory daemon is not healthy");
    return { ok: true, stage: "complete", snapshot };
  } catch (error) {
    // The candidate may have migrated or written data. Never restore over that database here.
    return { ok: false, stage: "candidate", snapshot, error: errorMessage(error) };
  }
}
