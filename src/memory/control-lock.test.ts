import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, linkSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { acquireMemoryControlLock } from "./control-lock.js";

it.runIf(process.platform === "darwin")("holds the native lock until its owner releases it", () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-control-"));
  const path = join(dir, "control.lock");
  try {
    const release = acquireMemoryControlLock(path);
    try {
      expect(() => acquireMemoryControlLock(path)).toThrow();
      expect(spawnSync("/usr/bin/lockf", ["-k", "-t", "0", path, "/usr/bin/true"]).status).toBe(75);
    } finally {
      release();
    }
    const releaseAgain = acquireMemoryControlLock(path);
    releaseAgain();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.runIf(process.platform === "darwin")("refuses nonregular, shared, or nonprivate lock files", () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-control-"));
  try {
    const fifo = join(dir, "fifo");
    expect(spawnSync("/usr/bin/mkfifo", [fifo]).status).toBe(0);
    expect(() => acquireMemoryControlLock(fifo)).toThrow();
    const path = join(dir, "lock");
    writeFileSync(path, "fixture", { mode: 0o600 });
    const alias = join(dir, "alias");
    linkSync(path, alias);
    expect(() => acquireMemoryControlLock(path)).toThrow();
    rmSync(alias);
    chmodSync(path, 0o644);
    expect(() => acquireMemoryControlLock(path)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.runIf(process.platform === "darwin")("refuses a symlink as the lock file", () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-control-"));
  try {
    const target = join(dir, "target");
    const path = join(dir, "control.lock");
    writeFileSync(target, "fixture");
    symlinkSync(target, path);
    expect(() => acquireMemoryControlLock(path)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.runIf(process.platform === "darwin")("detects lock-file replacement before a guarded operation", () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-control-"));
  const path = join(dir, "control.lock");
  try {
    const release = acquireMemoryControlLock(path);
    try {
      release.assertHeld();
      rmSync(path);
      writeFileSync(path, "replacement", { mode: 0o600 });
      expect(() => release.assertHeld()).toThrow();
    } finally {
      release();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.runIf(process.platform === "darwin")(
  "releases the lock when its owning process is killed",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-control-"));
    const path = join(dir, "control.lock");
    const script = `import { acquireMemoryControlLock } from "./src/memory/control-lock.ts";
    acquireMemoryControlLock(process.argv[1]); console.log("ready"); setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, path], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });
    try {
      const [ready] = await once(child.stdout, "data", { signal: AbortSignal.timeout(10_000) });
      expect(String(ready)).toContain("ready");
      expect(spawnSync("/usr/bin/lockf", ["-k", "-t", "0", path, "/usr/bin/true"]).status).toBe(75);
      child.kill("SIGKILL");
      await exited;
      expect(spawnSync("/usr/bin/lockf", ["-k", "-t", "0", path, "/usr/bin/true"]).status).toBe(0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      rmSync(dir, { recursive: true, force: true });
    }
  },
  15_000,
);
