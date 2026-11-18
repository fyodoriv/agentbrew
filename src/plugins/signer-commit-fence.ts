import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export class SignerCommitBusyError extends Error {
  readonly exitCode = 75;
}

function lockCommand() {
  if (process.platform === "darwin") return { file: "/usr/bin/lockf", args: ["-s", "-t", "0", "3"] };
  if (process.platform === "linux") return { file: "/usr/bin/flock", args: ["-n", "-E", "75", "3"] };
  throw new Error("The shared plugin signer commit lock is unavailable on this platform.");
}

function acquireCommitLock(fd: number): void {
  const { file, args } = lockCommand();
  const result = spawnSync(file, args, { stdio: ["ignore", "ignore", "pipe", fd], timeout: 3000 });
  if (result.status === 75) {
    throw new SignerCommitBusyError("The shared plugin signer registry is busy. Retry after publication finishes.");
  }
  if (result.error || result.signal || result.status !== 0) {
    throw new Error("The shared plugin signer commit lock could not be obtained.");
  }
}

function assertFenceIdentity(path: string, fd: number, uid: number): void {
  const current = lstatSync(path, { throwIfNoEntry: false });
  const held = fstatSync(fd);
  if (
    !current?.isFile() ||
    current.dev !== held.dev ||
    current.ino !== held.ino ||
    current.uid !== uid ||
    current.nlink !== 1 ||
    (current.mode & 0o777) !== 0o600
  ) {
    throw new Error("The shared plugin signer commit lock ownership or file type is unknown.");
  }
}

/** One synchronous operation holds the shared registry descriptor until it finishes. */
export function withSignerCommitFence<T>(requested: string, action: (path: string, mode: number) => T): T {
  const parent = realpathSync.native(dirname(requested));
  const directory = lstatSync(parent);
  if (!directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o022) !== 0) {
    throw new Error("The shared plugin signer registry directory ownership is unknown.");
  }
  const registry = join(parent, basename(requested));
  const path = `${registry}.agentbrew-signer-v1.lock`;
  const flags = constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const fd = openSync(path, flags, 0o600);
  try {
    assertFenceIdentity(path, fd, directory.uid);
    acquireCommitLock(fd);
    assertFenceIdentity(path, fd, directory.uid);
    const original = lstatSync(registry, { throwIfNoEntry: false });
    if (
      original &&
      (!original.isFile() || original.uid !== directory.uid || original.nlink !== 1 || original.mode & 0o022)
    ) {
      throw new Error("The shared plugin signer registry ownership or file type is unknown.");
    }
    return action(registry, original ? original.mode & 0o777 : 0o600);
  } finally {
    closeSync(fd);
  }
}
