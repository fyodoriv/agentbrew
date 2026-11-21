import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface FileState {
  digest: string;
  mode: number;
}

export interface NativeWriteIntent {
  path: string;
  before: FileState | null;
  after: FileState;
}

type BeginNativeMutation = (intent?: readonly NativeWriteIntent[]) => void;

const NATIVE_PUBLICATION_LOCK_NAME = ".agentbrew-native-publication.lock";

export type NativePublicationStatus = "owner-record-present" | "unavailable";

function isPrivateOwnerRecord(record: Stats, owner: number): boolean {
  return record.isFile() && record.uid === owner && record.nlink === 1 && (record.mode & 0o7777) === 0o600;
}

/** Inspect file metadata without opening the owner record or deciding whether its writer is active. */
export function inspectNativePublicationStatus(): NativePublicationStatus | undefined {
  try {
    const home = realpathSync.native(homedir());
    const record = lstatSync(join(home, NATIVE_PUBLICATION_LOCK_NAME), { throwIfNoEntry: false });
    if (!record) return undefined;

    const directory = lstatSync(home);
    if (
      !directory.isDirectory() ||
      directory.uid !== process.getuid?.() ||
      !isPrivateOwnerRecord(record, directory.uid)
    ) {
      return "unavailable";
    }
    return "owner-record-present";
  } catch {
    return "unavailable";
  }
}

function acquire(path: string): number {
  try {
    return openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error("Claude native publication is busy or has an earlier owner that needs verification.");
  }
}

/** The invoking process owns the lock through one synchronous publication. */
export function withNativePublicationLock<T>(publish: (beginMutation: BeginNativeMutation) => T): T {
  const home = realpathSync.native(homedir());
  const directory = lstatSync(home);
  if (!directory.isDirectory() || directory.uid !== process.getuid?.()) {
    throw new Error("Claude native publication cannot verify the home directory owner.");
  }

  const path = join(home, NATIVE_PUBLICATION_LOCK_NAME);
  const fd = acquire(path);
  try {
    const identity = fstatSync(fd);
    const owner = { pid: process.pid, token: randomUUID() };
    let record = Buffer.from(JSON.stringify(owner));
    writeFileSync(fd, record);
    fsyncSync(fd);
    const assertOwner = () => {
      const current = lstatSync(path, { throwIfNoEntry: false });
      if (
        !current ||
        !isPrivateOwnerRecord(current, directory.uid) ||
        current.dev !== identity.dev ||
        current.ino !== identity.ino ||
        current.size !== record.length ||
        !readFileSync(path).equals(record)
      ) {
        throw new Error("Claude native publication ownership changed. The current record was preserved.");
      }
    };

    let mutationStarted = false;
    let finished = false;
    assertOwner();
    try {
      const result = publish((intent) => {
        assertOwner();
        if (intent) {
          if (mutationStarted || intent.length === 0 || intent.length > 1024) {
            throw new Error("Claude native publication intent is outside its admitted bounds.");
          }
          const planned = Buffer.from(JSON.stringify({ ...owner, intent }));
          if (planned.length > 256 * 1024) {
            throw new Error("Claude native publication intent is outside its admitted bounds.");
          }
          // Keep the owner even if a short write or crash leaves a partial intent.
          mutationStarted = true;
          if (writeSync(fd, planned, 0, planned.length, 0) !== planned.length) {
            throw new Error("Claude native publication could not write the complete intent.");
          }
          fsyncSync(fd);
          record = planned;
          assertOwner();
        }
        mutationStarted = true;
      });
      finished = true;
      return result;
    } finally {
      assertOwner();
      if (!mutationStarted || finished) unlinkSync(path);
    }
  } finally {
    closeSync(fd);
  }
}
