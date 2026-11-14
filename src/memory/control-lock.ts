import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

export type MemoryControlLock = (() => void) & { assertHeld: () => void };

/** One location for cooperating service controls and a future live upgrade. */
export function memoryControlPaths(home = homedir()): { dir: string; lock: string; intent: string } {
  const dir = join(home, ".config/agentbrew/memory-control");
  return { dir, lock: join(dir, "control.lock"), intent: join(dir, "upgrade-intent.json") };
}

/** Acquire a cooperative macOS lock. Identity checks cannot exclude later replacement. */
export function acquireMemoryControlLock(path: string): MemoryControlLock {
  if (process.platform !== "darwin" || !isAbsolute(path)) throw new Error("memory control lock unavailable");
  const dir = lstatSync(dirname(path));
  if (!dir.isDirectory() || (dir.mode & 0o077) !== 0 || dir.uid !== process.getuid?.()) {
    throw new Error("memory control lock directory is not private");
  }
  const realDir = realpathSync(dirname(path));
  const fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  let released = false;
  const assertHeld = () => {
    if (released) throw new Error("memory control lock released");
    const currentDir = lstatSync(dirname(path));
    const file = fstatSync(fd);
    const entry = lstatSync(path);
    if (
      !currentDir.isDirectory() ||
      currentDir.dev !== dir.dev ||
      currentDir.ino !== dir.ino ||
      (currentDir.mode & 0o077) !== 0 ||
      currentDir.uid !== dir.uid ||
      realpathSync(dirname(path)) !== realDir ||
      !file.isFile() ||
      !entry.isFile() ||
      file.nlink !== 1 ||
      file.uid !== process.getuid?.() ||
      (file.mode & 0o077) !== 0 ||
      file.dev !== entry.dev ||
      file.ino !== entry.ino
    )
      throw new Error("memory control lock identity changed");
  };
  try {
    assertHeld();
    const result = spawnSync("/usr/bin/lockf", ["-t", "0", "3"], {
      stdio: ["ignore", "pipe", "pipe", fd],
      timeout: 10_000,
    });
    if (result.error || result.status !== 0) throw new Error("memory control lock unavailable");
    assertHeld();
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  const release = () => {
    if (released) return;
    released = true;
    closeSync(fd);
  };
  return Object.assign(release, { assertHeld });
}
