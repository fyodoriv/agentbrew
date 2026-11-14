import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { verifySqliteBackup } from "./backup.js";
import { MEMORY_UPGRADE_SNAPSHOT_DIR } from "./constants.js";
import { acquireMemoryControlLock, memoryControlPaths } from "./control-lock.js";
import { createUpgradeIntent, readUpgradeIntent } from "./upgrade-intent.js";
import { type MemoryUpgradeResult, upgradeMemoryWithSnapshot } from "./upgrade-sequence.js";

export interface MemoryUpgradeOrchestration {
  dbPath: string;
  backupsDir: string;
  intentPath: string;
  oldJobLabel: string;
  candidateSpec: string;
  attemptId: string;
  /** The caller must establish and retain real control of every daemon mutator. */
  assertControl: () => Promise<void>;
  /** Visible evidence only; this is not proof of exclusive control. */
  inspect: () => { visibleEvidenceConsistent: boolean };
  stopOld: () => Promise<void>;
  isOldStopped: () => Promise<boolean>;
  startOld: () => Promise<void>;
  startCandidate: (snapshot: string) => Promise<void>;
  candidateHealthy: () => Promise<boolean>;
}

type OrchestrationResult = MemoryUpgradeResult | { ok: false; stage: "preflight"; error: string };

/** The caller must still control older and non-cooperating service mutators. */
export async function orchestrateCoordinatedMemoryUpgrade(
  ops: Omit<MemoryUpgradeOrchestration, "intentPath">,
): Promise<OrchestrationResult> {
  const paths = memoryControlPaths();
  let lock: ReturnType<typeof acquireMemoryControlLock>;
  try {
    mkdirSync(paths.dir, { mode: 0o700, recursive: true });
    lock = acquireMemoryControlLock(paths.lock);
  } catch {
    return { ok: false, stage: "preflight", error: "memory upgrade control unavailable" };
  }
  try {
    return await orchestrateMemoryUpgrade({
      ...ops,
      intentPath: paths.intent,
      assertControl: async () => {
        lock.assertHeld();
        await ops.assertControl();
        lock.assertHeld();
      },
    });
  } finally {
    lock();
  }
}

/** Not a live adapter: callers must verify job identity and hold an actual maintenance window. */
export async function orchestrateMemoryUpgrade(ops: MemoryUpgradeOrchestration): Promise<OrchestrationResult> {
  const protectedBackups = join(dirname(ops.intentPath), MEMORY_UPGRADE_SNAPSHOT_DIR);
  try {
    if (![ops.dbPath, ops.backupsDir, ops.intentPath].every(isAbsolute)) throw new Error("paths must be absolute");
    const dir = lstatSync(dirname(ops.intentPath));
    if (
      !dir.isDirectory() ||
      (dir.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && dir.uid !== process.getuid())
    )
      throw new Error("intent directory is not private");
    if (readUpgradeIntent(ops.intentPath).state !== "absent") throw new Error("recovery intent already exists");
    await ops.assertControl();
    mkdirSync(protectedBackups, { mode: 0o700, recursive: true });
    const protectedDir = lstatSync(protectedBackups);
    if (
      !protectedDir.isDirectory() ||
      (protectedDir.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && protectedDir.uid !== process.getuid())
    )
      throw new Error("snapshot directory is not private");
    if (
      resolve(ops.backupsDir) === resolve(protectedBackups) ||
      (existsSync(ops.backupsDir) && realpathSync(ops.backupsDir) === realpathSync(protectedBackups))
    ) {
      throw new Error("ordinary backups cannot share the protected snapshot directory");
    }
  } catch {
    return { ok: false, stage: "preflight", error: "memory upgrade preflight failed" };
  }

  let original: { dev: bigint; ino: bigint } | undefined;
  let verifiedSnapshot: { path: string; dev: bigint; ino: bigint } | undefined;
  const sameFile = (path: string, expected: { dev: bigint; ino: bigint } | undefined): boolean => {
    if (!expected) return false;
    const current = lstatSync(path, { bigint: true });
    return current.isFile() && current.dev === expected.dev && current.ino === expected.ino;
  };
  return upgradeMemoryWithSnapshot({
    dbPath: ops.dbPath,
    backupsDir: protectedBackups,
    stopOld: async () => {
      await ops.assertControl();
      if (readUpgradeIntent(ops.intentPath).state !== "absent" || !ops.inspect().visibleEvidenceConsistent) {
        throw new Error("memory upgrade preflight changed");
      }
      const db = lstatSync(ops.dbPath, { bigint: true });
      if (!db.isFile()) throw new Error("invalid database");
      original = { dev: db.dev, ino: db.ino };
      await ops.stopOld();
    },
    isOldStopped: async () => {
      await ops.assertControl();
      return ops.isOldStopped();
    },
    startOld: async () => {
      await ops.assertControl();
      if (!sameFile(ops.dbPath, original) || readUpgradeIntent(ops.intentPath).state !== "absent") {
        throw new Error("old daemon recovery identity is uncertain");
      }
      await ops.startOld();
    },
    persistCandidateIntent: async (snapshot) => {
      await ops.assertControl();
      const db = lstatSync(ops.dbPath, { bigint: true });
      const backup = lstatSync(snapshot, { bigint: true });
      if (
        !original ||
        !db.isFile() ||
        db.dev !== original.dev ||
        db.ino !== original.ino ||
        !backup.isFile() ||
        !verifySqliteBackup(snapshot).ok
      )
        throw new Error("memory snapshot identity changed");
      if (!sameFile(snapshot, backup) || !sameFile(ops.dbPath, original)) {
        throw new Error("memory snapshot identity changed");
      }
      verifiedSnapshot = { path: snapshot, dev: backup.dev, ino: backup.ino };
      createUpgradeIntent(ops.intentPath, {
        databasePath: ops.dbPath,
        databaseDevice: String(db.dev),
        databaseInode: String(db.ino),
        snapshotPath: snapshot,
        snapshotDevice: String(backup.dev),
        snapshotInode: String(backup.ino),
        oldJobLabel: ops.oldJobLabel,
        candidateSpec: ops.candidateSpec,
        attemptId: ops.attemptId,
      });
    },
    startCandidate: async (snapshot) => {
      await ops.assertControl();
      const intent = readUpgradeIntent(ops.intentPath);
      if (
        !verifiedSnapshot ||
        snapshot !== verifiedSnapshot.path ||
        !sameFile(snapshot, verifiedSnapshot) ||
        !sameFile(ops.dbPath, original) ||
        intent.state !== "recovery-required" ||
        intent.record?.attemptId !== ops.attemptId ||
        intent.record.snapshotPath !== snapshot ||
        intent.record.snapshotDevice !== String(verifiedSnapshot.dev) ||
        intent.record.snapshotInode !== String(verifiedSnapshot.ino) ||
        intent.record.databasePath !== ops.dbPath ||
        intent.record.databaseDevice !== String(original?.dev) ||
        intent.record.databaseInode !== String(original?.ino) ||
        intent.record.oldJobLabel !== ops.oldJobLabel ||
        intent.record.candidateSpec !== ops.candidateSpec ||
        !verifySqliteBackup(snapshot).ok ||
        !sameFile(snapshot, verifiedSnapshot)
      )
        throw new Error("candidate recovery identity is uncertain");
      await ops.startCandidate(snapshot);
    },
    candidateHealthy: ops.candidateHealthy,
  });
}
