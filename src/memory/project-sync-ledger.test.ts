import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  memoryMaintainMarkerPath,
  memoryProjectSyncLedgerPath,
  memoryProjectSyncSchedulerReceiptPath,
} from "./paths.js";
import {
  type ProjectMemorySyncLedger,
  readProjectMemorySyncLedger,
  writeProjectMemorySyncLedger,
} from "./project-sync-ledger.js";

const tempDirs: string[] = [];

function ledgerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentbrew-project-sync-ledger-"));
  tempDirs.push(dir);
  return join(dir, "state", "memory-project-sync.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("project-memory sync ledger", () => {
  it("round-trips non-content sync evidence", () => {
    const path = ledgerPath();
    const ledger: ProjectMemorySyncLedger = {
      version: 1,
      lastAttemptedAt: "2026-09-24T12:00:00.000Z",
      lastSuccessfulAt: "2026-09-24T12:00:00.000Z",
      status: "ok",
      stores: {
        "sha256:store": {
          fingerprint: "sha256:files",
          fileCount: 2,
          lastSyncedAt: "2026-09-24T12:00:00.000Z",
          chunksStored: 3,
        },
      },
    };

    writeProjectMemorySyncLedger(ledger, path);

    expect(readProjectMemorySyncLedger(path)).toEqual(ledger);
  });

  it("ignores malformed evidence instead of failing a non-blocking sync", () => {
    const path = ledgerPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{"version": 2}', "utf-8");

    expect(readProjectMemorySyncLedger(path)).toBeUndefined();
  });

  it("keeps stores another writer added since this run read the ledger, and still prunes its own", () => {
    const path = ledgerPath();
    const entry = (fingerprint: string, chunksStored: number, lastSyncedAt: string) => ({
      fingerprint,
      fileCount: 1,
      lastSyncedAt,
      chunksStored,
    });
    const base: ProjectMemorySyncLedger = {
      version: 1,
      lastAttemptedAt: "2026-10-01T00:00:00.000Z",
      status: "ok",
      stores: { gone: entry("sha256:gone", 1, "2026-10-01T00:00:00.000Z") },
    };
    writeProjectMemorySyncLedger(base, path);
    // Another run, which read the same base, records store "other".
    writeProjectMemorySyncLedger(
      { ...base, stores: { ...base.stores, other: entry("sha256:other", 2, "2026-10-02T00:00:00.000Z") } },
      path,
      { base },
    );
    // This run no longer finds "gone" and records "mine".
    writeProjectMemorySyncLedger(
      { ...base, stores: { mine: entry("sha256:mine", 3, "2026-10-03T00:00:00.000Z") } },
      path,
      { base },
    );

    expect(Object.keys(readProjectMemorySyncLedger(path)?.stores ?? {}).sort()).toEqual(["mine", "other"]);
  });

  it("keeps a store pruned by another run pruned when this run left it untouched", () => {
    const path = ledgerPath();
    const kept = {
      fingerprint: "sha256:kept",
      fileCount: 1,
      lastSyncedAt: "2026-10-01T00:00:00.000Z",
      chunksStored: 1,
    };
    const gone = { ...kept, fingerprint: "sha256:gone" };
    const base: ProjectMemorySyncLedger = {
      version: 1,
      lastAttemptedAt: "2026-10-01T00:00:00.000Z",
      status: "ok",
      stores: { kept, gone },
    };
    writeProjectMemorySyncLedger(base, path);
    // Another run no longer finds "gone" and prunes it.
    writeProjectMemorySyncLedger({ ...base, stores: { kept } }, path, { base });
    // This run still saw "gone" and did not sync it.
    writeProjectMemorySyncLedger({ ...base, stores: { kept, gone } }, path, { base });

    expect(Object.keys(readProjectMemorySyncLedger(path)?.stores ?? {})).toEqual(["kept"]);
  });
});

describe("project-memory sync ledger lock", () => {
  it("removes a lock left by a killed run", () => {
    const path = ledgerPath();
    mkdirSync(`${path}.lock`, { recursive: true });
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${path}.lock`, old, old);

    writeProjectMemorySyncLedger(
      { version: 1, lastAttemptedAt: "2026-10-01T00:00:00.000Z", status: "none", stores: {} },
      path,
      { base: undefined },
    );

    expect(readProjectMemorySyncLedger(path)?.status).toBe("none");
  });

  it("keeps every store when separate processes write the ledger at the same time", async () => {
    const path = ledgerPath();
    // Each process reads the ledger, waits, then writes one new store, 20 times.
    const writer = (name: string) => `
      import { readProjectMemorySyncLedger, writeProjectMemorySyncLedger } from "./src/memory/project-sync-ledger.ts";
      const path = ${JSON.stringify(path)};
      for (let i = 0; i < 20; i += 1) {
        const base = readProjectMemorySyncLedger(path);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3);
        const entry = { fingerprint: "sha256:x", fileCount: 1, lastSyncedAt: new Date().toISOString(), chunksStored: i };
        const stores = { ...(base?.stores ?? {}), ["${name}-" + i]: entry };
        writeProjectMemorySyncLedger({ version: 1, lastAttemptedAt: new Date().toISOString(), status: "ok", stores }, path, { base });
      }
    `;
    const run = (name: string) =>
      new Promise<number | null>((resolveRun) => {
        const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", writer(name)], {
          cwd: resolve(import.meta.dirname, "../.."),
          stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("exit", (code) => {
          if (code !== 0) console.error(`ledger writer ${name} failed:\n${stderr}`);
          resolveRun(code);
        });
      });

    const codes = await Promise.all([run("a"), run("b")]);

    expect(codes).toEqual([0, 0]);
    expect(Object.keys(readProjectMemorySyncLedger(path)?.stores ?? {})).toHaveLength(40);
  }, 60_000);
});

describe("memory state paths", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats an empty XDG_STATE_HOME as unset", () => {
    vi.stubEnv("XDG_STATE_HOME", undefined);
    const unset = [
      memoryProjectSyncLedgerPath("/home/test"),
      memoryProjectSyncSchedulerReceiptPath("/home/test"),
      memoryMaintainMarkerPath("/home/test"),
    ];
    vi.stubEnv("XDG_STATE_HOME", "");
    const empty = [
      memoryProjectSyncLedgerPath("/home/test"),
      memoryProjectSyncSchedulerReceiptPath("/home/test"),
      memoryMaintainMarkerPath("/home/test"),
    ];

    expect(empty).toEqual(unset);
    for (const path of empty) expect(path.startsWith("/home/test/.local/state/agentbrew/")).toBe(true);
  });
});
