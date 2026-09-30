import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  collectScanCandidates,
  findAgentCountClaims,
  resolveRepoRoot,
  USER_FACING_AGENT_COUNT_FILES,
} from "./agent-count-scan.js";

describe("agent count claims guard", () => {
  it("flags approximate agent counts in AgentBrew-facing prose", () => {
    expect(findAgentCountClaims("AgentBrew syncs skills across 50+ agents.", "README.md")).toEqual([
      expect.stringContaining('agent-count claim "50+ agents"'),
    ]);
  });

  it("flags exact agent counts in AgentBrew-facing prose", () => {
    expect(findAgentCountClaims("AgentBrew syncs skills across 48 agents.", "README.md")).toEqual([
      expect.stringContaining('agent-count claim "48 agents"'),
    ]);
  });

  it("flags single-digit agent counts in AgentBrew-facing prose", () => {
    expect(findAgentCountClaims("AgentBrew syncs skills across 8 agents.", "README.md")).toEqual([
      expect.stringContaining('agent-count claim "8 agents"'),
    ]);
  });

  it("allows prose without a count", () => {
    expect(findAgentCountClaims("AgentBrew syncs skills across every supported agent.", "README.md")).toEqual([]);
  });

  it("allows nearby historical measurement comments with an explicit reason", () => {
    const markdown = [
      "<!-- agent-count-allowlist: archived 2026-04 measurement -->",
      "AgentBrew synced skills across 48 agents during this historical snapshot.",
    ].join("\n");
    expect(findAgentCountClaims(markdown, "docs/audits/example.md")).toEqual([]);
  });

  it("flags agentbrew possessive inventory without scanning competitor-only agent counts", () => {
    const competitionRow = [
      "| syncode | donnes | CLI | 17 agents (Cursor, Codex). Tier 1 — overlaps agentbrew's 50+. | Done | Keep separate |",
    ].join("\n");
    expect(findAgentCountClaims(competitionRow, "docs/COMPETITION.md").some((v) => v.includes("50+"))).toBe(true);
    expect(findAgentCountClaims(competitionRow, "docs/COMPETITION.md").some((v) => v.includes("17 agents"))).toBe(
      false,
    );
  });

  it("flags delegation inventory in MILESTONES without blocking timeless milestone prose", () => {
    expect(
      findAgentCountClaims(
        "`npx skills add` is the primary install path for 54 of 56 delegated targets.",
        "MILESTONES.md",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      findAgentCountClaims(
        "`npx skills add` is the primary path for delegated targets per routing matrices.",
        "MILESTONES.md",
      ),
    ).toEqual([]);
  });

  it("flags numeric AgentBrew cells in the consolidated comparison matrix", () => {
    const matrix = ["| Capability | AgentBrew | vsync |", "|---|---|", "| **MCP sync** | 15+ agents | 4 agents |"].join(
      "\n",
    );
    expect(findAgentCountClaims(matrix, "docs/COMPETITION.md").some((v) => v.includes("15+ agents"))).toBe(true);
    expect(
      findAgentCountClaims(
        ["| Capability | AgentBrew |", "| **Skills sync** | All (agent matrix) |"].join("\n"),
        "docs/COMPETITION.md",
      ),
    ).toEqual([]);
  });

  it("skips generated competition freshness blockquotes", () => {
    const blockquote = "> Last updated: 2026-05-02 — agentbrew mirrored the matrix by adding 8 skills-only agents.";
    expect(findAgentCountClaims(blockquote, "docs/COMPETITION.md")).toEqual([]);
  });

  it("collectScanCandidates still scans README skills-sync matrix rows", () => {
    const readmeMatrix = [
      "| Capability | agentbrew | skills CLI |",
      "|---|---|",
      "| Skills sync | every supported agent | 50+ agents |",
    ].join("\n");
    const candidates = collectScanCandidates(readmeMatrix, "README.md");
    expect(candidates.some((c) => c.scope.includes("every supported"))).toBe(true);
    expect(findAgentCountClaims(readmeMatrix, "README.md").some((v) => v.includes("50+ agents"))).toBe(false);
  });

  it("keeps agent-count claims out of user-facing AgentBrew docs", () => {
    const repoRoot = resolveRepoRoot();
    const violations = USER_FACING_AGENT_COUNT_FILES.flatMap((relativePath) => {
      const markdown = readFileSync(join(repoRoot, relativePath), "utf-8");
      return findAgentCountClaims(markdown, relativePath);
    });

    expect(violations).toEqual([]);
  });
});
