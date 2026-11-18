import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function acquire(path: string): number {
  try {
    return openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error("Claude native publication is busy or has an earlier owner that needs verification.");
  }
}

/** The invoking process owns the lock through one synchronous publication. */
export function withNativePublicationLock<T>(publish: () => T): T {
  const home = realpathSync.native(homedir());
  const directory = lstatSync(home);
  if (!directory.isDirectory() || directory.uid !== process.getuid?.()) {
    throw new Error("Claude native publication cannot verify the home directory owner.");
  }

  const path = join(home, ".agentbrew-native-publication.lock");
  const fd = acquire(path);
  try {
    const identity = fstatSync(fd);
    const record = Buffer.from(JSON.stringify({ pid: process.pid, token: randomUUID() }));
    writeFileSync(fd, record);
    fsyncSync(fd);
    const assertOwner = () => {
      const current = lstatSync(path, { throwIfNoEntry: false });
      if (
        !current?.isFile() ||
        current.dev !== identity.dev ||
        current.ino !== identity.ino ||
        current.uid !== directory.uid ||
        current.nlink !== 1 ||
        (current.mode & 0o777) !== 0o600 ||
        current.size !== record.length ||
        !readFileSync(path).equals(record)
      ) {
        throw new Error("Claude native publication ownership changed. The current record was preserved.");
      }
    };

    assertOwner();
    try {
      return publish();
    } finally {
      assertOwner();
      unlinkSync(path);
    }
  } finally {
    closeSync(fd);
  }
}
