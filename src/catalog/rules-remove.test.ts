import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the rules-sync module so we can drive load/save without touching disk.
vi.mock("../sync/rules-sync.js", () => ({
  loadSharedRules: vi.fn(),
  saveSharedRules: vi.fn(),
}));

// Mock mcp-setup too — install-other.ts imports extractEnvVars / isEnvVarResolved,
// and the module's side effects (env-var detection) are irrelevant to rule removal.
vi.mock("../mcp/mcp-setup.js", () => ({
  extractEnvVars: vi.fn(() => []),
  isEnvVarResolved: vi.fn(() => true),
}));

vi.mock("../mcp/mcp-status.js", () => ({
  getSetupInstructions: vi.fn(() => ({})),
}));

// addToAgentfile / addMcpServer are pulled in transitively via install-other.ts —
// stub them so importing the module under test doesn't trigger state writes.
vi.mock("../agentfile.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../agentfile.js")>();
  return {
    ...original,
    addToAgentfile: vi.fn(() => true),
    globalAgentfileDir: vi.fn(() => "/mock/config/agentbrew"),
  };
});

vi.mock("../sync/mcp-sync.js", () => ({
  addMcpServer: vi.fn(),
}));

import { loadSharedRules, saveSharedRules } from "../sync/rules-sync.js";
import { removeRuleFromSharedRules } from "./install-other.js";

const mockLoadSharedRules = vi.mocked(loadSharedRules);
const mockSaveSharedRules = vi.mocked(saveSharedRules);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("removeRuleFromSharedRules — edge cases from rules-remove-subcommand task", () => {
  it("returns 'no-rules-file' when shared-rules.md does not exist", () => {
    mockLoadSharedRules.mockReturnValue(undefined);
    const status = removeRuleFromSharedRules("any-rule");
    expect(status).toBe("no-rules-file");
    expect(mockSaveSharedRules).not.toHaveBeenCalled();
  });

  it("returns 'not-installed' when the marker is not in shared-rules.md", () => {
    mockLoadSharedRules.mockReturnValue("# Rules\n\n<!-- rule: other-rule -->\nOther content\n");
    const status = removeRuleFromSharedRules("missing-rule");
    expect(status).toBe("not-installed");
    expect(mockSaveSharedRules).not.toHaveBeenCalled();
  });

  it("removes the marker and content block when the marker is present", () => {
    mockLoadSharedRules.mockReturnValue(
      [
        "# Rules",
        "",
        "<!-- rule: target-rule -->",
        "Target rule content line 1",
        "Target rule content line 2",
        "",
        "<!-- rule: keeper -->",
        "Keeper rule content",
        "",
      ].join("\n"),
    );

    const status = removeRuleFromSharedRules("target-rule");
    expect(status).toBe("removed");
    expect(mockSaveSharedRules).toHaveBeenCalledTimes(1);

    const written = mockSaveSharedRules.mock.calls[0][0];
    // The target marker + its content are gone; the keeper rule survives verbatim.
    expect(written).not.toContain("<!-- rule: target-rule -->");
    expect(written).not.toContain("Target rule content line 1");
    expect(written).not.toContain("Target rule content line 2");
    expect(written).toContain("<!-- rule: keeper -->");
    expect(written).toContain("Keeper rule content");
    // Preamble before any rule marker is preserved.
    expect(written).toMatch(/^# Rules/);
  });

  it("removes the last rule block cleanly when no subsequent rule marker exists", () => {
    mockLoadSharedRules.mockReturnValue(
      [
        "# Rules",
        "",
        "<!-- rule: first -->",
        "First content",
        "",
        "<!-- rule: last -->",
        "Last content line 1",
        "Last content line 2",
        "",
      ].join("\n"),
    );

    const status = removeRuleFromSharedRules("last");
    expect(status).toBe("removed");
    const written = mockSaveSharedRules.mock.calls[0][0];
    expect(written).toContain("<!-- rule: first -->");
    expect(written).toContain("First content");
    expect(written).not.toContain("<!-- rule: last -->");
    expect(written).not.toContain("Last content line");
    // File still ends with exactly one newline — no trailing-whitespace drift.
    expect(written.endsWith("\n")).toBe(true);
    expect(written.endsWith("\n\n")).toBe(false);
  });

  it("removes all blocks when multiple markers share the same name (defensive)", () => {
    mockLoadSharedRules.mockReturnValue(
      [
        "# Rules",
        "",
        "<!-- rule: dup -->",
        "First duplicate content",
        "",
        "<!-- rule: other -->",
        "Unrelated rule",
        "",
        "<!-- rule: dup -->",
        "Second duplicate content",
        "",
      ].join("\n"),
    );

    const status = removeRuleFromSharedRules("dup");
    expect(status).toBe("removed");

    const written = mockSaveSharedRules.mock.calls[0][0];
    expect(written).not.toContain("<!-- rule: dup -->");
    expect(written).not.toContain("First duplicate content");
    expect(written).not.toContain("Second duplicate content");
    // Unrelated rule survives — the `other` block between the two `dup` markers
    // is preserved because the skipping logic resets on any other-rule marker.
    expect(written).toContain("<!-- rule: other -->");
    expect(written).toContain("Unrelated rule");
  });

  it("is idempotent — removing twice in a row returns 'not-installed' the second time", () => {
    // First call: marker present.
    mockLoadSharedRules.mockReturnValueOnce("# Rules\n\n<!-- rule: target -->\nContent\n");
    let status = removeRuleFromSharedRules("target");
    expect(status).toBe("removed");

    // Second call: loadSharedRules now returns the post-remove state (no marker).
    // Real users see this after the first successful remove because saveSharedRules
    // persisted the change — simulated here by returning the written content.
    mockLoadSharedRules.mockReturnValueOnce("# Rules\n");
    status = removeRuleFromSharedRules("target");
    expect(status).toBe("not-installed");
  });

  it("preserves rule content whose name contains hyphens (e.g. conventional-commits)", () => {
    // Regression guard: the internal marker-matching regex must use \S+, not
    // [^-]+, so hyphenated rule names parse correctly as other-rule markers
    // and stop the skip region when appropriate.
    mockLoadSharedRules.mockReturnValue(
      [
        "<!-- rule: conventional-commits -->",
        "Use feat:, fix:, docs:, etc.",
        "",
        "<!-- rule: test-before-commit -->",
        "Run tests before every commit.",
        "",
      ].join("\n"),
    );

    const status = removeRuleFromSharedRules("conventional-commits");
    expect(status).toBe("removed");

    const written = mockSaveSharedRules.mock.calls[0][0];
    expect(written).not.toContain("conventional-commits");
    expect(written).not.toContain("Use feat:");
    expect(written).toContain("<!-- rule: test-before-commit -->");
    expect(written).toContain("Run tests before every commit.");
  });
});
