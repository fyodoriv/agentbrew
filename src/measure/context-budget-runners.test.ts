import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tryCcusageDaily, tryOpenusageDaily } from "./context-budget-runtime.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("../core/logger.js", () => ({ logSkipped: vi.fn() }));

const run = vi.mocked(execFileSync);

afterEach(() => {
  run.mockReset();
});

function failFor(...commands: string[]): void {
  run.mockImplementation(((command: string) => {
    if (commands.includes(command)) throw new Error(`${command} missing`);
    return JSON.stringify({ via: command, totals: { tokens: 7, cost_usd: 0.5 } });
  }) as typeof execFileSync);
}

describe("context-budget runtime runners", () => {
  it("ccusage falls back from bunx to npx and keeps the parsed JSON", () => {
    failFor("bunx");
    expect(tryCcusageDaily()).toEqual({ available: true, daily: { via: "npx", totals: { tokens: 7, cost_usd: 0.5 } } });
    expect(run.mock.calls.map((call) => call[0])).toEqual(["bunx", "npx"]);
    expect(run.mock.calls[1]?.[1]).toEqual(["-y", "ccusage", "claude", "daily", "--json"]);
  });

  it("ccusage reports a skip reason when every runner fails", () => {
    failFor("bunx", "npx");
    const result = tryCcusageDaily();
    expect(result.available).toBe(false);
    expect(result.skippedReason).toContain("ccusage not available");
  });

  it("openusage passes --since today, uses a 60s timeout, and adds the today rollup", () => {
    failFor();
    const result = tryOpenusageDaily("2026-10-12");
    expect(run.mock.calls[0]?.[1]).toEqual(["daily", "--json", "--since", "2026-10-12"]);
    expect(run.mock.calls[0]?.[2]).toMatchObject({ timeout: 60_000 });
    expect(result.today).toMatchObject({ date: "2026-10-12", totalTokens: 7, totalCost: 0.5 });
  });

  it("openusage reports a skip reason when it is missing", () => {
    failFor("openusage");
    const result = tryOpenusageDaily("2026-10-12");
    expect(result.available).toBe(false);
    expect(result.skippedReason).toContain("openusage not available");
  });

  it("treats unparseable output as a failed runner", () => {
    run.mockReturnValue("not json" as never);
    expect(tryCcusageDaily().available).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
