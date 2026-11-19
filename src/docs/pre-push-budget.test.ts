import { describe, expect, it } from "vitest";
import { LIMIT_MS, samplePasses } from "../../scripts/check-pre-push-budget.mjs";

describe("pre-push budget verdict", () => {
  it("accepts a successful check at the time limit", () => {
    expect(samplePasses({ code: 0, elapsedMs: LIMIT_MS, ranHook: true })).toBe(true);
  });

  it("rejects a slow, failed or skipped check", () => {
    expect(samplePasses({ code: 0, elapsedMs: LIMIT_MS + 1, ranHook: true })).toBe(false);
    expect(samplePasses({ code: 1, elapsedMs: LIMIT_MS, ranHook: true })).toBe(false);
    expect(samplePasses({ code: null, elapsedMs: LIMIT_MS, ranHook: false })).toBe(false);
    expect(samplePasses({ code: 0, elapsedMs: LIMIT_MS, ranHook: false })).toBe(false);
  });
});
