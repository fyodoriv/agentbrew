import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
});
