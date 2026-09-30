import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { buildAgentMatrix, renderAgentFeatureMatrix } from "./agent-matrix.js";

vi.mock("../state.js", () => ({
  loadState: () => ({ agents: [], team: undefined }),
}));

describe("buildAgentMatrix", () => {
  it("marks claude-code as full-stack (every surface)", () => {
    const row = buildAgentMatrix().find((r) => r.name === "claude-code");
    expect(row).toBeDefined();
    expect(row?.skills).toBe(true);
    expect(row?.mcp).toBe(true);
    expect(row?.rules).toBe(true);
    expect(row?.commands).toBe(true);
    expect(row?.agents).toBe(true);
    expect(row?.hooks).toBe(true);
    expect(row?.experimental).toBe(false);
  });

  it("marks augment as skills+rules only (no MCP, no commands, no agents, no hooks)", () => {
    const row = buildAgentMatrix().find((r) => r.name === "augment");
    expect(row?.skills).toBe(true);
    expect(row?.rules).toBe(true);
    expect(row?.mcp).toBe(false);
    expect(row?.commands).toBe(false);
    expect(row?.agents).toBe(false);
    expect(row?.hooks).toBe(false);
  });

  it("marks copilot as skills+mcp+rules (mcp via VS Code settings.json, rules added by rules-delegate slice 3c)", () => {
    const row = buildAgentMatrix().find((r) => r.name === "copilot");
    expect(row?.skills).toBe(true);
    expect(row?.mcp).toBe(true);
    // Slice 3c of `delegate-rules-to-ai-rules` added rulesFile at
    // ~/.copilot/AGENTS.md (upstream-contribution target).
    expect(row?.rules).toBe(true);
  });

  it("marks experimental agents as skills-only", () => {
    const matrix = buildAgentMatrix();
    for (const row of matrix) {
      if (!row.experimental) continue;
      expect(row.skills).toBe(true);
      expect(row.mcp).toBe(false);
      expect(row.rules).toBe(false);
      expect(row.commands).toBe(false);
      expect(row.agents).toBe(false);
      expect(row.hooks).toBe(false);
    }
  });

  it("marks claude-code as supporting every skill feature", () => {
    const row = buildAgentMatrix().find((r) => r.name === "claude-code");
    expect(row?.skillFeatures).toContain("allowed-tools");
    expect(row?.skillFeatures).toContain("context-fork");
    expect(row?.skillFeatures).toContain("hooks");
  });

  it("marks kiro as supporting hooks but not allowed-tools", () => {
    const row = buildAgentMatrix().find((r) => r.name === "kiro");
    expect(row?.skillFeatures).toEqual(["hooks"]);
  });
});

describe("renderAgentFeatureMatrix", () => {
  it("renders two tables and a paragraph", () => {
    const markdown = renderAgentFeatureMatrix();
    expect(markdown).toContain("### Sync surfaces per agent");
    expect(markdown).toContain("### SKILL.md feature support");
    expect(markdown).toContain("Skills-only (experimental;");
  });

  it("includes claude-code with every surface as ✓", () => {
    const markdown = renderAgentFeatureMatrix();
    expect(markdown).toMatch(/\| claude-code \| ✓ \| ✓ \| ✓ \| ✓ \| ✓ \| ✓ \|/u);
  });

  it("includes augment with MCP = —", () => {
    const markdown = renderAgentFeatureMatrix();
    expect(markdown).toMatch(/\| augment \| ✓ \| — \| ✓ \| — \| — \| — \|/u);
  });

  it("lists experimental agent names in the trailing paragraph", () => {
    const markdown = renderAgentFeatureMatrix();
    expect(markdown).toContain("trae");
    expect(markdown).toContain("junie");
  });
});

// README drift guard: if someone edits agents.yaml without running
// `npm run docs:agent-matrix`, this fails with a pointer at the fix command.
// Matches the behavior of `findCompetitionNarrativeDrift` for competition docs.
describe("README agent matrix freshness", () => {
  it("README.md content between <!-- agent-matrix:* --> matches the generated output", () => {
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
    const match = /<!-- agent-matrix:start -->\n([\s\S]*?)\n<!-- agent-matrix:end -->/u.exec(readme);
    expect(match).not.toBeNull();
    const embedded = match?.[1] ?? "";
    const expected = renderAgentFeatureMatrix();
    expect(embedded).toBe(expected);
  });
});
