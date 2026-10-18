import { describe, expect, it } from "vitest";
import { keepsClaudePermissions } from "./claude-permissions.js";

describe("keepsClaudePermissions", () => {
  it("is true only for claudePermissions: keep", () => {
    expect(keepsClaudePermissions({ claudePermissions: "keep" })).toBe(true);
    expect(keepsClaudePermissions({ claudePermissions: "manage" })).toBe(false);
    expect(keepsClaudePermissions({})).toBe(false);
    expect(keepsClaudePermissions(undefined)).toBe(false);
  });
});
