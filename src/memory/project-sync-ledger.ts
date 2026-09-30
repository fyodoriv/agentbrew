import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { memoryProjectSyncLedgerPath } from "./paths.js";

export type ProjectMemorySyncStatus = "none" | "ok" | "degraded";

export interface ProjectMemorySyncStoreLedger {
  fingerprint: string;
  fileCount: number;
  lastSyncedAt: string;
  chunksStored: number;
}

export interface ProjectMemorySyncLedger {
  version: 1;
  lastAttemptedAt: string;
  lastSuccessfulAt?: string;
  status: ProjectMemorySyncStatus;
  stores: Record<string, ProjectMemorySyncStoreLedger>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoreLedger(value: unknown): value is ProjectMemorySyncStoreLedger {
  if (!isRecord(value)) return false;
  return (
    typeof value.fingerprint === "string" &&
    typeof value.fileCount === "number" &&
    typeof value.lastSyncedAt === "string" &&
    typeof value.chunksStored === "number"
  );
}

function parseLedger(value: unknown): ProjectMemorySyncLedger | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.lastAttemptedAt !== "string") return undefined;
  if (value.lastSuccessfulAt !== undefined && typeof value.lastSuccessfulAt !== "string") return undefined;
  if (value.status !== "none" && value.status !== "ok" && value.status !== "degraded") return undefined;
  if (!isRecord(value.stores) || !Object.values(value.stores).every(isStoreLedger)) return undefined;
  return value as unknown as ProjectMemorySyncLedger;
}

/**
 * Read only non-content project-memory sync evidence. The ledger deliberately
 * contains hashes, counts, and timestamps, never project-memory text or paths.
 */
export function readProjectMemorySyncLedger(path = memoryProjectSyncLedgerPath()): ProjectMemorySyncLedger | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return parseLedger(JSON.parse(readFileSync(path, "utf-8")) as unknown);
  } catch {
    return undefined;
  }
}

export function writeProjectMemorySyncLedger(
  ledger: ProjectMemorySyncLedger,
  path = memoryProjectSyncLedgerPath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomicSync(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
}
