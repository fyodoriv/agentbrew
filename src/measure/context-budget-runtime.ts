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

export interface TokscaleRuntimeResult {
  available: boolean;
  skippedReason?: string;
  today?: unknown;
}

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

/** Optional Cursor IDE usage via tokscale API cache (`tokscale cursor login` first). */
export function tryTokscaleToday(): TokscaleRuntimeResult {
  const attempts: Array<{ command: string; args: string[] }> = [
    { command: "bunx", args: ["tokscale@latest", "--today", "--client", "cursor", "--json"] },
    { command: "npx", args: ["-y", "tokscale", "--today", "--client", "cursor", "--json"] },
    { command: "tokscale", args: ["--today", "--client", "cursor", "--json"] },
  ];
  for (const { command, args } of attempts) {
    try {
      const stdout = execFileSync(command, args, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 45_000,
      });
      return { available: true, today: JSON.parse(stdout) as unknown };
    } catch (error) {
      logSkipped(`measure/context-budget/tokscale/${command}`, error);
    }
  }
  return {
    available: false,
    skippedReason: "tokscale not available (optional: tokscale cursor login && tokscale cursor sync)",
  };
}

/** Multi-provider daily rollup via OpenUsage.sh (`openusage daily --json`). */
export function tryOpenusageDaily(today = new Date().toISOString().slice(0, 10)): OpenusageRuntimeResult {
  const attempts: Array<{ command: string; args: string[] }> = [
    { command: "openusage", args: ["daily", "--json", "--since", today] },
  ];
  for (const { command, args } of attempts) {
    try {
      const stdout = execFileSync(command, args, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      });
      const daily = JSON.parse(stdout) as unknown;
      return {
        available: true,
        daily,
        today: extractRuntimeTodayFromOpenusage(daily, today),
      };
    } catch (error) {
      logSkipped(`measure/context-budget/openusage/${command}`, error);
    }
  }
  return {
    available: false,
    skippedReason:
      "openusage not available (optional: brew install janekbaraniewski/tap/openusage or openusage daily --json)",
  };
}
