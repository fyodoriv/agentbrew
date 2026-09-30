import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readProjectMemorySyncSchedulerReceipt,
  writeProjectMemorySyncErrorReceipt,
  writeProjectMemorySyncResultReceipt,
} from "./project-sync-scheduler-receipt.js";

const tempDirs: string[] = [];

function receiptPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentbrew-project-sync-receipt-"));
  tempDirs.push(dir);
  return join(dir, "state", "receipt.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("project-memory scheduler receipt", () => {
  it("reads an in-flight receipt written by the non-blocking shell scheduler", () => {
    const path = receiptPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        scheduledAt: "2026-09-24T12:00:00Z",
        startedAt: null,
        completedAt: null,
        elapsedMs: null,
        outcome: "scheduled",
        stores: 0,
        synced: 0,
        skipped: 0,
        unchanged: 0,
      }),
      "utf-8",
    );

    expect(readProjectMemorySyncSchedulerReceipt(path)).toMatchObject({ outcome: "scheduled", startedAt: null });
  });

  it("persists only bounded scheduling and outcome metadata", () => {
    const path = receiptPath();
    const receipt = writeProjectMemorySyncResultReceipt(
      {
        stores: 3,
        synced: 1,
        skipped: 1,
        unchanged: 1,
        status: "degraded",
        results: [
          { slug: "private-project", files: 2, status: "synced", chunksStored: 4 },
          { slug: "private-project", files: 1, status: "skipped", detail: "daemon-unavailable" },
          { slug: "another-project", files: 1, status: "unchanged" },
        ],
      },
      {
        path,
        scheduledAt: "2026-09-24T12:00:00.000Z",
        startedAt: "2026-09-24T12:00:01.000Z",
        completedAt: new Date("2026-09-24T12:00:03.000Z"),
      },
    );

    expect(receipt).toEqual({
      version: 1,
      scheduledAt: "2026-09-24T12:00:00.000Z",
      startedAt: "2026-09-24T12:00:01.000Z",
      completedAt: "2026-09-24T12:00:03.000Z",
      elapsedMs: 2_000,
      outcome: "degraded",
      stores: 3,
      synced: 1,
      skipped: 1,
      unchanged: 1,
    });
    expect(readProjectMemorySyncSchedulerReceipt(path)).toEqual(receipt);
    expect(JSON.stringify(readProjectMemorySyncSchedulerReceipt(path))).not.toContain("private-project");
  });

  it("records elapsed time for an error without persisting error details", () => {
    const receipt = writeProjectMemorySyncErrorReceipt({
      path: receiptPath(),
      scheduledAt: "2026-09-24T12:00:00.000Z",
      startedAt: "2026-09-24T12:00:01.000Z",
      completedAt: new Date("2026-09-24T12:00:03.000Z"),
    });

    expect(receipt).toMatchObject({
      outcome: "error",
      elapsedMs: 2_000,
      stores: 0,
      synced: 0,
      skipped: 0,
      unchanged: 0,
    });
  });
});
