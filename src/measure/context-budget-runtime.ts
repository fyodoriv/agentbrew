export interface CcusageDailyEntry {
  date?: string;
  totalTokens?: number;
  totalCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface RuntimeTodayRollup {
  date: string;
  totalTokens: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface CcusageDailyPayload {
  daily?: CcusageDailyEntry[];
}

/** Extract today's row from ccusage `claude daily --json` payload. */
export function extractRuntimeTodayFromCcusage(
  payload: unknown,
  today = new Date().toISOString().slice(0, 10),
): RuntimeTodayRollup | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const daily = (payload as CcusageDailyPayload).daily;
  if (!Array.isArray(daily)) return undefined;

  const row = daily.find((entry) => entry.date === today);
  if (!row) return undefined;

  return {
    date: row.date ?? today,
    totalTokens: row.totalTokens ?? 0,
    totalCost: row.totalCost ?? 0,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    cacheReadTokens: row.cacheReadTokens ?? 0,
    cacheCreationTokens: row.cacheCreationTokens ?? 0,
  };
}

import { execFileSync } from "node:child_process";
import { logSkipped } from "../core/logger.js";

export interface OpenusageDailyPayload {
  totals?: {
    cost_usd?: number;
    tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface OpenusageRuntimeResult {
  available: boolean;
  skippedReason?: string;
  daily?: unknown;
  today?: RuntimeTodayRollup;
}

/** Extract today's rollup from openusage `daily --json --since <today>` payload. */
export function extractRuntimeTodayFromOpenusage(
  payload: unknown,
  today = new Date().toISOString().slice(0, 10),
): RuntimeTodayRollup | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const totals = (payload as OpenusageDailyPayload).totals;
  if (!totals) return undefined;

  return {
    date: today,
    totalTokens: totals.tokens ?? 0,
    totalCost: totals.cost_usd ?? 0,
    inputTokens: totals.input_tokens ?? 0,
    outputTokens: totals.output_tokens ?? 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

type Attempt = { command: string; args: string[] };

/** Run each attempt in order; return the first stdout that parses as JSON. */
function runFirstJson(tool: string, attempts: Attempt[], timeout: number): { ok: true; json: unknown } | { ok: false } {
  for (const { command, args } of attempts) {
    try {
      const stdout = execFileSync(command, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout });
      return { ok: true, json: JSON.parse(stdout) as unknown };
    } catch (error) {
      logSkipped(`measure/context-budget/${tool}/${command}`, error);
    }
  }
  return { ok: false };
}

/** Claude Code usage via ccusage (`ccusage claude daily --json`). */
export function tryCcusageDaily(): { available: boolean; skippedReason?: string; daily?: unknown } {
  const result = runFirstJson(
    "ccusage",
    [
      { command: "bunx", args: ["ccusage", "claude", "daily", "--json"] },
      { command: "npx", args: ["-y", "ccusage", "claude", "daily", "--json"] },
    ],
    45_000,
  );
  if (result.ok) return { available: true, daily: result.json };
  return {
    available: false,
    skippedReason: "ccusage not available (install via bunx/npx ccusage or skip for static-only metrics)",
  };
}

/** Multi-provider daily rollup via OpenUsage.sh (`openusage daily --json`). */
export function tryOpenusageDaily(today = new Date().toISOString().slice(0, 10)): OpenusageRuntimeResult {
  const result = runFirstJson(
    "openusage",
    [{ command: "openusage", args: ["daily", "--json", "--since", today] }],
    60_000,
  );
  if (result.ok) {
    return { available: true, daily: result.json, today: extractRuntimeTodayFromOpenusage(result.json, today) };
  }
  return {
    available: false,
    skippedReason:
      "openusage not available (optional: brew install janekbaraniewski/tap/openusage or openusage daily --json)",
  };
}
