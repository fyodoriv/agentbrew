import { describe, expect, it } from "vitest";
import { DRIFT_FIXES, driftFix } from "./drift-fixes.js";

describe("drift fixes", () => {
  it("gives every drift type a fix (the Record type makes it required)", () => {
    for (const [type, fix] of Object.entries(DRIFT_FIXES)) {
      expect(fix.trim(), type).not.toBe("");
    }
  });

  it("returns the fix for one item", () => {
    expect(driftFix({ type: "rules-source" })).toBe("agentbrew rules dedupe && agentbrew sync");
  });
});
