import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SHARED_RULES_PATH } from "../paths.js";
import { expandHome } from "../utils.js";
import { removeRuleFromSharedRules } from "./install-other.js";

// HOME is a scratch dir (vitest.isolated-home.ts), so this never touches real rules.
const sharedRules = expandHome(SHARED_RULES_PATH);

afterEach(() => {
  rmSync(sharedRules, { force: true });
});

describe("removeRuleFromSharedRules", () => {
  it("returns 'no-rules-file' when there is no shared rules file", () => {
    expect(removeRuleFromSharedRules("any-rule")).toBe("no-rules-file");
  });

  it("returns 'not-installed' for a rule that doesn't exist in shared rules", () => {
    mkdirSync(dirname(sharedRules), { recursive: true });
    writeFileSync(sharedRules, "<!-- rule: other-rule -->\nKeep this.\n");
    const result = removeRuleFromSharedRules(`nonexistent-rule-xyz-${Date.now()}`);
    expect(result).toBe("not-installed");
  });

  it("does not throw for any input", () => {
    expect(() => removeRuleFromSharedRules("")).not.toThrow();
    expect(() => removeRuleFromSharedRules("test")).not.toThrow();
  });
});
