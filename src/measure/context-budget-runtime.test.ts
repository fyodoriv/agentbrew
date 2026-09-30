import { describe, expect, it } from "vitest";
import { extractRuntimeTodayFromCcusage, extractRuntimeTodayFromOpenusage } from "./context-budget-runtime.js";

describe("context-budget runtime rollup", () => {
  it("extracts today's row from ccusage daily payload", () => {
    const rollup = extractRuntimeTodayFromCcusage(
      {
        daily: [
          { date: "2026-06-15", totalTokens: 84_945_880, totalCost: 90.13 },
          {
            date: "2026-06-16",
            totalTokens: 3_845_385,
            totalCost: 4.21,
            inputTokens: 23_322,
            outputTokens: 19_450,
            cacheReadTokens: 3_623_250,
            cacheCreationTokens: 179_363,
          },
        ],
      },
      "2026-06-16",
    );
    expect(rollup).toEqual({
      date: "2026-06-16",
      totalTokens: 3_845_385,
      totalCost: 4.21,
      inputTokens: 23_322,
      outputTokens: 19_450,
      cacheReadTokens: 3_623_250,
      cacheCreationTokens: 179_363,
    });
  });

  it("returns undefined when today is missing", () => {
    expect(extractRuntimeTodayFromCcusage({ daily: [] }, "2026-06-16")).toBeUndefined();
  });

  it("extracts today's totals from openusage daily payload", () => {
    const rollup = extractRuntimeTodayFromOpenusage(
      {
        kind: "daily",
        totals: {
          cost_usd: 12.34,
          tokens: 1_234_567,
          input_tokens: 900_000,
          output_tokens: 334_567,
        },
      },
      "2026-06-16",
    );
    expect(rollup).toEqual({
      date: "2026-06-16",
      totalTokens: 1_234_567,
      totalCost: 12.34,
      inputTokens: 900_000,
      outputTokens: 334_567,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });
});
