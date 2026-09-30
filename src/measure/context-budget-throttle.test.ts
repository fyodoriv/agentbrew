import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONTEXT_BUDGET_POST_SYNC_INTERVAL_MS,
  CONTEXT_BUDGET_SESSION_START_INTERVAL_MS,
  contextBudgetAgeMs,
  parseContextBudgetStaleDuration,
  readLatestMeasuredAt,
  shouldMeasureContextBudget,
} from "./context-budget-throttle.js";

describe("context-budget throttle", () => {
  let tempHome: string;
  let previousHome: string | undefined;
  let latestPath: string;

  beforeEach(() => {
    previousHome = process.env.HOME;
    tempHome = mkdtempSync(join(tmpdir(), "agentbrew-metrics-throttle-"));
    process.env.HOME = tempHome;
    const metricsDir = join(tempHome, ".config", "agentbrew", "metrics");
    mkdirSync(metricsDir, { recursive: true });
    latestPath = join(metricsDir, "latest.json");
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });

  it("exports stable interval constants", () => {
    expect(CONTEXT_BUDGET_POST_SYNC_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
    expect(CONTEXT_BUDGET_SESSION_START_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("parses duration strings for CLI --if-stale", () => {
    expect(parseContextBudgetStaleDuration("6h")).toBe(6 * 60 * 60 * 1000);
    expect(parseContextBudgetStaleDuration("24h")).toBe(24 * 60 * 60 * 1000);
    expect(parseContextBudgetStaleDuration("30m")).toBe(30 * 60 * 1000);
    expect(parseContextBudgetStaleDuration("45000")).toBe(45_000);
    expect(() => parseContextBudgetStaleDuration("not-a-duration")).toThrow(/invalid --if-stale/u);
  });

  it("returns true when latest.json is missing", () => {
    expect(shouldMeasureContextBudget({ minIntervalMs: CONTEXT_BUDGET_SESSION_START_INTERVAL_MS, latestPath })).toBe(
      true,
    );
  });

  it("skips when measuredAt is within the min interval", () => {
    const now = Date.parse("2026-06-15T12:00:00.000Z");
    writeFileSync(latestPath, `${JSON.stringify({ measuredAt: "2026-06-15T10:00:00.000Z" }, null, 2)}\n`, "utf-8");
    expect(
      shouldMeasureContextBudget({
        minIntervalMs: CONTEXT_BUDGET_SESSION_START_INTERVAL_MS,
        latestPath,
        now,
      }),
    ).toBe(false);
  });

  it("measures when measuredAt is older than the min interval", () => {
    const now = Date.parse("2026-06-15T12:00:00.000Z");
    writeFileSync(latestPath, `${JSON.stringify({ measuredAt: "2026-06-14T12:00:00.000Z" }, null, 2)}\n`, "utf-8");
    expect(
      shouldMeasureContextBudget({
        minIntervalMs: CONTEXT_BUDGET_SESSION_START_INTERVAL_MS,
        latestPath,
        now,
      }),
    ).toBe(true);
  });

  it("reads measuredAt from latest.json", () => {
    writeFileSync(latestPath, `${JSON.stringify({ measuredAt: "2026-06-15T08:30:00.000Z" })}\n`, "utf-8");
    expect(readLatestMeasuredAt(latestPath)?.toISOString()).toBe("2026-06-15T08:30:00.000Z");
    expect(contextBudgetAgeMs("2026-06-15T08:30:00.000Z", Date.parse("2026-06-15T10:30:00.000Z"))).toBe(
      2 * 60 * 60 * 1000,
    );
  });
});
