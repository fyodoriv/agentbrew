import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { memoryProjectSyncSchedulerReceiptPath } from "./paths.js";
import type { ProjectMemorySyncResult } from "./project-sync.js";

export type ProjectMemorySyncSchedulerOutcome = ProjectMemorySyncResult["status"] | "scheduled" | "error";

export interface ProjectMemorySyncSchedulerReceipt {
  version: 1;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number | null;
  outcome: ProjectMemorySyncSchedulerOutcome;
  stores: number;
  synced: number;
  skipped: number;
  unchanged: number;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOptionalTimestamp(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isOptionalNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function isReceipt(value: unknown): value is ProjectMemorySyncSchedulerReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return (
    receipt.version === 1 &&
    typeof receipt.scheduledAt === "string" &&
    isOptionalTimestamp(receipt.startedAt) &&
    isOptionalTimestamp(receipt.completedAt) &&
    typeof receipt.outcome === "string" &&
    ["none", "ok", "degraded", "scheduled", "error"].includes(receipt.outcome) &&
    isOptionalNonNegativeInteger(receipt.elapsedMs) &&
    isNonNegativeInteger(receipt.stores) &&
    isNonNegativeInteger(receipt.synced) &&
    isNonNegativeInteger(receipt.skipped) &&
    isNonNegativeInteger(receipt.unchanged)
  );
}

export function readProjectMemorySyncSchedulerReceipt(
  path = memoryProjectSyncSchedulerReceiptPath(),
): ProjectMemorySyncSchedulerReceipt | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isReceipt(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeProjectMemorySyncSchedulerReceipt(
  receipt: ProjectMemorySyncSchedulerReceipt,
  path = memoryProjectSyncSchedulerReceiptPath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomicSync(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf-8");
}

function validIsoTimestamp(value: string | undefined, fallback: Date): string {
  return value && Number.isFinite(Date.parse(value)) ? value : fallback.toISOString();
}

export function writeProjectMemorySyncResultReceipt(
  result: ProjectMemorySyncResult,
  options: {
    path?: string;
    scheduledAt?: string;
    startedAt?: string;
    completedAt?: Date;
  } = {},
): ProjectMemorySyncSchedulerReceipt {
  const completed = options.completedAt ?? new Date();
  const completedAt = completed.toISOString();
  const startedAt = validIsoTimestamp(options.startedAt, completed);
  const scheduledAt = validIsoTimestamp(options.scheduledAt, completed);
  const elapsedMs = Math.max(0, completed.getTime() - Date.parse(startedAt));
  const receipt: ProjectMemorySyncSchedulerReceipt = {
    version: 1,
    scheduledAt,
    startedAt,
    completedAt,
    elapsedMs,
    outcome: result.status,
    stores: result.stores,
    synced: result.synced,
    skipped: result.skipped,
    unchanged: result.unchanged,
  };
  writeProjectMemorySyncSchedulerReceipt(receipt, options.path);
  return receipt;
}

export function writeProjectMemorySyncErrorReceipt(
  options: { path?: string; scheduledAt?: string; startedAt?: string; completedAt?: Date } = {},
): ProjectMemorySyncSchedulerReceipt {
  const completed = options.completedAt ?? new Date();
  const startedAt = validIsoTimestamp(options.startedAt, completed);
  const receipt: ProjectMemorySyncSchedulerReceipt = {
    version: 1,
    scheduledAt: validIsoTimestamp(options.scheduledAt, completed),
    startedAt,
    completedAt: completed.toISOString(),
    elapsedMs: Math.max(0, completed.getTime() - Date.parse(startedAt)),
    outcome: "error",
    stores: 0,
    synced: 0,
    skipped: 0,
    unchanged: 0,
  };
  writeProjectMemorySyncSchedulerReceipt(receipt, options.path);
  return receipt;
}
