import { existsSync, readFileSync } from "node:fs";
import { CONTEXT_BUDGET_LATEST_PATH } from "../paths.js";
import { expandHome } from "../utils.js";

/** Minimal shape read from latest.json — avoids circular import with context-budget.ts. */
export interface LatestSnapshotRef {
  measuredAt?: string;
  static?: {
    softTokenHeadroom?: number;
    projectedDeployedTokens?: number;
    topSections?: Array<{ heading: string; tokens: number }>;
  };
}

/** Post-sync background capture — at most once per day. */
export const CONTEXT_BUDGET_POST_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** SessionStart hook — refresh at most every 6 hours across agent sessions. */
export const CONTEXT_BUDGET_SESSION_START_INTERVAL_MS = 6 * 60 * 60 * 1000;

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/iu;

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parse CLI durations like `6h`, `24h`, `30m`, `45000ms`. */
export function parseContextBudgetStaleDuration(input: string): number {
  const trimmed = input.trim();
  const match = DURATION_RE.exec(trimmed);
  if (!match) {
    throw new Error(`invalid --if-stale duration "${input}" (examples: 6h, 24h, 30m)`);
  }
  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? "ms";
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid --if-stale duration "${input}"`);
  }
  return Math.round(value * UNIT_MS[unit]);
}

export function readLatestSnapshot(latestPath = expandHome(CONTEXT_BUDGET_LATEST_PATH)): LatestSnapshotRef | undefined {
  if (!existsSync(latestPath)) return undefined;
  try {
    return JSON.parse(readFileSync(latestPath, "utf-8")) as LatestSnapshotRef;
  } catch {
    return undefined;
  }
}

export function readLatestMeasuredAt(latestPath = expandHome(CONTEXT_BUDGET_LATEST_PATH)): Date | undefined {
  const snapshot = readLatestSnapshot(latestPath);
  if (!snapshot?.measuredAt) return undefined;
  const measuredAt = new Date(snapshot.measuredAt);
  if (Number.isNaN(measuredAt.getTime())) return undefined;
  return measuredAt;
}

export function contextBudgetAgeMs(measuredAt: string | Date, now = Date.now()): number {
  const when = measuredAt instanceof Date ? measuredAt.getTime() : new Date(measuredAt).getTime();
  if (Number.isNaN(when)) return Number.POSITIVE_INFINITY;
  return now - when;
}

/** True when no snapshot exists or the last snapshot is older than minIntervalMs. */
export function shouldMeasureContextBudget(options: {
  minIntervalMs: number;
  latestPath?: string;
  now?: number;
}): boolean {
  const measuredAt = readLatestMeasuredAt(options.latestPath);
  if (!measuredAt) return true;
  return contextBudgetAgeMs(measuredAt, options.now) >= options.minIntervalMs;
}
