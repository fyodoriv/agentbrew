import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { collectAgentArtifacts, lintAgentArtifacts } from "./inventory.js";

describe("collectAgentArtifacts", () => {
  it("inventories only the checkout's base catalog, not overlay-only entries", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "agentbrew-inventory-"));
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    mkdirSync(join(repoRoot, "hooks"), { recursive: true });
    writeFileSync(join(repoRoot, "hooks/manifest.yaml"), "hooks: []\n");
    writeFileSync(
      join(repoRoot, "src/catalog.yaml"),
      [
        "skills:",
        "  - name: base-static-analysis-fixture",
        "    description: Base fixture",
        "    source: test/source",
        "    category: test",
        "    recommended: false",
        "",
      ].join("\n"),
    );

    try {
      const inventory = collectAgentArtifacts({ repoRoot, agentDefinitions: [] });

      expect(inventory.diagnostics).toEqual([]);
      expect(inventory.artifacts.map((artifact) => artifact.name)).toContain("base-static-analysis-fixture");
      expect(inventory.artifacts.map((artifact) => artifact.name)).not.toContain(
        "overlay-only-static-analysis-fixture",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("lists every repo-owned agent artifact surface", () => {
    const inventory = collectAgentArtifacts();
    const kinds = new Set(inventory.artifacts.map((artifact) => artifact.kind));

    expect(kinds).toEqual(
      new Set([
        "agent-definition-catalog",
        "agent-source",
        "builtin-skill",
        "catalog-command",
        "catalog-mcp",
        "catalog-rule",
        "catalog-skill",
        "command",
        "command-source",
        "hook",
        "instruction-template",
        "mcp-reference",
        "skill-reference",
        "source-reference",
      ]),
    );
    expect(inventory.diagnostics).toEqual([]);
  });

  it("includes known source artifacts with repo-relative source paths", () => {
    const inventory = collectAgentArtifacts();

    expect(inventory.artifacts).toContainEqual(
      expect.objectContaining({
        kind: "instruction-template",
        name: "AGENTS.md",
        sourcePath: "templates/AGENTS.md",
      }),
    );
    expect(inventory.artifacts).toContainEqual(
      expect.objectContaining({
        kind: "hook",
        name: "gh-pr-skill-requires-evals",
        sourcePath: "hooks/manifest.yaml",
      }),
    );
    expect(inventory.artifacts).toContainEqual(
      expect.objectContaining({
        kind: "command",
        name: "jenkins-log",
        sourcePath: "src/cli-commands/jenkins-cli/jenkins-log.md",
      }),
    );
    expect(inventory.artifacts).toContainEqual(
      expect.objectContaining({
        kind: "builtin-skill",
        name: "agentbrew-status",
        sourcePath: "skill-plugins/dev/agentbrew-status/SKILL.md",
      }),
    );
  });

  it("does not treat generated agent output paths as source artifacts", () => {
    const inventory = collectAgentArtifacts();
    const generatedPrefixes = [".claude/", ".codex/", ".cursor/", "~/"];

    for (const sourcePath of inventory.artifacts.map((artifact) => artifact.sourcePath)) {
      expect(generatedPrefixes.some((prefix) => sourcePath.startsWith(prefix))).toBe(false);
    }
  });

  it("populates target agents from the existing agent matrix", () => {
    const inventory = collectAgentArtifacts();
    const command = inventory.artifacts.find(
      (artifact) => artifact.kind === "command" && artifact.name === "jenkins-log",
    );
    const hook = inventory.artifacts.find(
      (artifact) => artifact.kind === "hook" && artifact.name === "verify-before-completion",
    );

    expect(command?.targetAgents).toContain("claude-code");
    expect(hook?.targetAgents).toEqual(["claude-code", "cursor"]);
  });

  it("passes the static lint contract for the current repo inventory", () => {
    const inventory = collectAgentArtifacts();

    expect(lintAgentArtifacts(inventory.artifacts)).toEqual([]);
  });

  it("reports Promptfoo behavioral coverage for pilot command and instruction artifacts", () => {
    const inventory = collectAgentArtifacts();
    const covered = [
      { kind: "instruction-template", name: "AGENTS.md" },
      { kind: "command", name: "storybook-screenshot" },
      { kind: "command", name: "jenkins-status" },
    ];

    for (const expected of covered) {
      const artifact = inventory.artifacts.find(
        (candidate) => candidate.kind === expected.kind && candidate.name === expected.name,
      );

      expect(artifact?.coverage.behavioralEvals).toContain("agent-artifact-evals/promptfoo.yaml");
    }
  });
});
