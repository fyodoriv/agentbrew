import { describe, expect, it } from "vitest";
import { removeRuleFromSharedRules } from "./install-other.js";

describe("removeRuleFromSharedRules", () => {
  it("returns 'not-found' for a rule that doesn't exist in shared rules", () => {
    const result = removeRuleFromSharedRules(`nonexistent-rule-xyz-${Date.now()}`);
    expect(result).toBe("not-installed");
  });

  it("does not throw for any input", () => {
    expect(() => removeRuleFromSharedRules("")).not.toThrow();
    expect(() => removeRuleFromSharedRules("test")).not.toThrow();
  });
});
