import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

export interface UpgradeIntentInput {
  databasePath: string;
  databaseDevice: string;
  databaseInode: string;
  snapshotPath: string;
  snapshotDevice: string;
  snapshotInode: string;
  oldJobLabel: string;
  candidateSpec: string;
  attemptId: string;
}

export interface UpgradeIntent extends UpgradeIntentInput {
  schemaVersion: 1;
  phase: "candidate-may-have-run";
}

export type UpgradeIntentStatus = { state: "absent" } | { state: "recovery-required"; record?: UpgradeIntent };

function validInput(value: unknown): value is UpgradeIntentInput {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.databasePath === "string" &&
    isAbsolute(v.databasePath) &&
    typeof v.snapshotPath === "string" &&
    isAbsolute(v.snapshotPath) &&
    [v.databaseDevice, v.databaseInode, v.snapshotDevice, v.snapshotInode].every(
      (item) => typeof item === "string" && /^\d+$/.test(item),
    ) &&
    [v.oldJobLabel, v.candidateSpec, v.attemptId].every((item) => typeof item === "string" && item.length > 0)
  );
}

function parseIntent(bytes: string): UpgradeIntentStatus {
  const value: unknown = JSON.parse(bytes);
  if (!validInput(value)) return { state: "recovery-required" };
  const record = value as UpgradeIntent;
  if (record.schemaVersion !== 1 || record.phase !== "candidate-may-have-run") return { state: "recovery-required" };
  return { state: "recovery-required", record };
}

/** Any present or unreadable intent requires recovery; this function never removes one. */
export function readUpgradeIntent(path: string): UpgradeIntentStatus {
  if (!isAbsolute(path)) return { state: "recovery-required" };
  let fd: number | undefined;
  let status: UpgradeIntentStatus = { state: "recovery-required" };
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (stat.isFile() && stat.size <= 16_384) status = parseIntent(readFileSync(fd, "utf8"));
  } catch (error) {
    if (fd === undefined && (error as NodeJS.ErrnoException).code === "ENOENT") status = { state: "absent" };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        status = { state: "recovery-required" };
      }
    }
  }
  return status;
}

/** Create a conservative intent without replacing an earlier attempt. The parent directory must exist. */
export function createUpgradeIntent(path: string, input: UpgradeIntentInput): void {
  if (!isAbsolute(path) || !validInput(input)) throw new Error("Invalid memory upgrade intent");
  const record: UpgradeIntent = {
    schemaVersion: 1,
    phase: "candidate-may-have-run",
    databasePath: input.databasePath,
    databaseDevice: input.databaseDevice,
    databaseInode: input.databaseInode,
    snapshotPath: input.snapshotPath,
    snapshotDevice: input.snapshotDevice,
    snapshotInode: input.snapshotInode,
    oldJobLabel: input.oldJobLabel,
    candidateSpec: input.candidateSpec,
    attemptId: input.attemptId,
  };
  const bytes = `${JSON.stringify(record)}\n`;
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, bytes, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const dirFd = openSync(dirname(path), "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
  const status = readUpgradeIntent(path);
  if (status.state !== "recovery-required" || JSON.stringify(status.record) !== JSON.stringify(record)) {
    throw new Error("Memory upgrade intent readback failed");
  }
}
