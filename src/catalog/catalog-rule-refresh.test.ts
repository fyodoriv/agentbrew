import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../sync/rules-sync.js", () => ({
  loadSharedRules: vi.fn(),
  saveSharedRules: vi.fn(),
}));

vi.mock("../mcp/mcp-setup.js", () => ({
  extractEnvVars: vi.fn(() => []),
  isEnvVarResolved: vi.fn(() => true),
}));

vi.mock("../mcp/mcp-status.js", () => ({
  getSetupInstructions: vi.fn(() => ({})),
}));

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
import { refreshOwnedCatalogRuleBlock, refreshRecommendedCatalogRules } from "./install-other.js";
import type { CatalogRule } from "./types.js";

const mockLoadSharedRules = vi.mocked(loadSharedRules);
const mockSaveSharedRules = vi.mocked(saveSharedRules);

const sampleRule: CatalogRule = {
  name: "modern-cli-cohort",
  description: "Prefer modern CLI tools",
  category: "shell-tools",
  recommended: true,
  content: "Use fd over find when both installed.",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("refreshOwnedCatalogRuleBlock", () => {
  it("returns not-installed when marker is absent", () => {
    mockLoadSharedRules.mockReturnValue("# Shared rules\n");
    expect(refreshOwnedCatalogRuleBlock(sampleRule)).toBe("not-installed");
    expect(mockSaveSharedRules).not.toHaveBeenCalled();
  });

  it("returns unchanged when catalog body matches installed block", () => {
    mockLoadSharedRules.mockReturnValue(
      "## Catalog rule markers\n\n<!-- rule: modern-cli-cohort -->\nUse fd over find when both installed.\n\n## Pull/fetch latest workflow\n",
    );
    expect(refreshOwnedCatalogRuleBlock(sampleRule)).toBe("unchanged");
    expect(mockSaveSharedRules).not.toHaveBeenCalled();
  });

  it("replaces block content when catalog body changed", () => {
    mockLoadSharedRules.mockReturnValue(
      "## Catalog rule markers\n\n<!-- rule: modern-cli-cohort -->\nOld bulky table here.\n\n## Pull/fetch latest workflow\n",
    );
    expect(refreshOwnedCatalogRuleBlock(sampleRule)).toBe("refreshed");
    expect(mockSaveSharedRules).toHaveBeenCalledOnce();
    const saved = mockSaveSharedRules.mock.calls[0]?.[0] ?? "";
    expect(saved).toContain("Use fd over find when both installed.");
    expect(saved).not.toContain("Old bulky table");
  });
});

describe("refreshRecommendedCatalogRules", () => {
  it("refreshes only installed recommended rules with changed bodies", () => {
    mockLoadSharedRules.mockReturnValue(
      [
        "## Catalog rule markers",
        "<!-- rule: modern-cli-cohort -->",
        "Old body",
        "<!-- rule: minimal-changes -->",
        "Prefer minimal, focused edits over large rewrites.",
        "",
        "## Pull/fetch latest workflow",
      ].join("\n"),
    );

    const rules: CatalogRule[] = [sampleRule];

    const { refreshed, unchanged } = refreshRecommendedCatalogRules(rules);
    expect(refreshed).toEqual(["modern-cli-cohort"]);
    expect(unchanged).toBe(0);
  });
});
