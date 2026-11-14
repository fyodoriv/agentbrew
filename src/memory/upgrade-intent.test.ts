import { spawn, spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createUpgradeIntent, readUpgradeIntent } from "./upgrade-intent.js";

function input(dir: string) {
  return {
    databasePath: join(dir, "memory.db"),
    databaseDevice: "1",
    databaseInode: "2",
    snapshotPath: join(dir, "snapshot.db"),
    snapshotDevice: "1",
    snapshotInode: "3",
    oldJobLabel: "com.example.memory",
    candidateSpec: "example-memory==2.0.0",
    attemptId: "synthetic-1",
  };
}

describe("memory upgrade recovery intent", () => {
  it("persists and reads a private recovery record without replacing it", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-intent-"));
    try {
      const path = join(dir, "intent.json");
      const record = input(dir);
      expect(readUpgradeIntent(path)).toEqual({ state: "absent" });
      createUpgradeIntent(path, record);
      expect(lstatSync(path).mode & 0o777).toBe(0o600);
      expect(readUpgradeIntent(path)).toEqual({
        state: "recovery-required",
        record: { schemaVersion: 1, phase: "candidate-may-have-run", ...record },
      });
      const before = readFileSync(path, "utf8");
      expect(() => createUpgradeIntent(path, record)).toThrow();
      expect(readFileSync(path, "utf8")).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(["", "{partial", "{}"])("treats a partial or malformed record as unresolved", (contents) => {
    const dir = mkdtempSync(join(tmpdir(), "memory-intent-partial-"));
    try {
      const path = join(dir, "intent.json");
      writeFileSync(path, contents);
      expect(readUpgradeIntent(path)).toEqual({ state: "recovery-required" });
      expect(() => createUpgradeIntent(path, input(dir))).toThrow();
      expect(readFileSync(path, "utf8")).toBe(contents);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never follows or replaces a receipt symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-intent-symlink-"));
    try {
      const path = join(dir, "intent.json");
      const target = join(dir, "target");
      writeFileSync(target, "untouched");
      symlinkSync(target, path);
      expect(readUpgradeIntent(path)).toEqual({ state: "recovery-required" });
      expect(() => createUpgradeIntent(path, input(dir))).toThrow();
      expect(readFileSync(target, "utf8")).toBe("untouched");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats a dangling receipt symlink as unresolved", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-intent-dangling-"));
    try {
      const path = join(dir, "intent.json");
      symlinkSync(join(dir, "missing"), path);
      expect(readUpgradeIntent(path)).toEqual({ state: "recovery-required" });
      expect(() => createUpgradeIntent(path, input(dir))).toThrow();
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not block on a named pipe at the receipt path", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-intent-fifo-"));
    try {
      const path = join(dir, "intent.json");
      expect(spawnSync("mkfifo", [path]).status).toBe(0);
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          'import {readUpgradeIntent} from "./src/memory/upgrade-intent.ts"; console.log(JSON.stringify(readUpgradeIntent(process.argv[1])));',
          path,
        ],
        { timeout: 5000, encoding: "utf8" },
      );
      expect(child.status).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({ state: "recovery-required" });
      expect(() => createUpgradeIntent(path, input(dir))).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats a record left by a killed writer as unresolved", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-intent-crash-"));
    try {
      const path = join(dir, "intent.json");
      const child = spawnSync(process.execPath, [
        "-e",
        'const fs = require("node:fs"); const fd = fs.openSync(process.argv[1], "wx", 0o600); fs.writeFileSync(fd, "{partial"); fs.fsyncSync(fd); process.kill(process.pid, "SIGKILL");',
        path,
      ]);
      expect(child.signal).toBe("SIGKILL");
      expect(readUpgradeIntent(path)).toEqual({ state: "recovery-required" });
      expect(readFileSync(path, "utf8")).toBe("{partial");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows only one of two concurrent creators", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-intent-concurrent-"));
    try {
      const path = join(dir, "intent.json");
      const program =
        'import {createUpgradeIntent} from "./src/memory/upgrade-intent.ts"; createUpgradeIntent(process.argv[1], JSON.parse(process.argv[2]));';
      const run = () =>
        new Promise<number | null>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ["--import", "tsx", "--input-type=module", "-e", program, path, JSON.stringify(input(dir))],
            { stdio: "ignore" },
          );
          child.once("error", reject);
          child.once("exit", resolve);
        });
      const results = await Promise.all([run(), run()]);
      expect(results.filter((status) => status === 0)).toHaveLength(1);
      expect(results.filter((status) => status !== 0)).toHaveLength(1);
      expect(readUpgradeIntent(path)).toMatchObject({
        state: "recovery-required",
        record: { attemptId: "synthetic-1" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    "write",
    "file-sync",
    "close",
    "directory-sync",
    "readback",
    "killed-after-open",
  ])("leaves an unresolved record when the actual writer fails at %s", (fault) => {
    const dir = mkdtempSync(join(tmpdir(), "memory-intent-fault-"));
    try {
      const path = join(dir, "intent.json");
      const program = `
          import fs from "node:fs";
          import { syncBuiltinESMExports } from "node:module";
          import { createUpgradeIntent } from "./src/memory/upgrade-intent.ts";
          const [path, record, fault] = process.argv.slice(1);
          const original = { open: fs.openSync, write: fs.writeFileSync, sync: fs.fsyncSync, close: fs.closeSync, read: fs.readFileSync };
          let syncs = 0;
          fs.openSync = (...args) => { const fd = original.open(...args); if (fault === "killed-after-open" && args[0] === path && args[1] === "wx") process.kill(process.pid, "SIGKILL"); return fd; };
          fs.writeFileSync = (...args) => { if (fault === "write" && typeof args[0] === "number") throw Error("injected write failure"); return original.write(...args); };
          fs.fsyncSync = (...args) => { syncs++; if ((fault === "file-sync" && syncs === 1) || (fault === "directory-sync" && syncs === 2)) throw Error("injected sync failure"); return original.sync(...args); };
          fs.closeSync = (...args) => { const result = original.close(...args); if (fault === "close") throw Error("injected close failure"); return result; };
          fs.readFileSync = (...args) => { if (fault === "readback" && typeof args[0] === "number") throw Error("injected read failure"); return original.read(...args); };
          syncBuiltinESMExports();
          createUpgradeIntent(path, JSON.parse(record));
        `;
      const child = spawnSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", program, path, JSON.stringify(input(dir)), fault],
        { timeout: 10000, encoding: "utf8" },
      );
      if (fault === "killed-after-open") {
        expect(child.signal).toBe("SIGKILL");
      } else {
        expect(child.status).not.toBe(0);
        const expected =
          fault === "readback"
            ? "intent readback failed"
            : fault === "close"
              ? "injected close failure"
              : fault === "write"
                ? "injected write failure"
                : "injected sync failure";
        expect(child.stderr).toContain(expected);
      }
      expect(lstatSync(path).isFile()).toBe(true);
      expect(readUpgradeIntent(path).state).toBe("recovery-required");
      expect(() => createUpgradeIntent(path, input(dir))).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
