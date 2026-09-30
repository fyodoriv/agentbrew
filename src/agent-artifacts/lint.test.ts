import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentArtifact, AgentArtifactKind } from "./inventory.js";
import { collectAgentArtifacts, lintAgentArtifacts } from "./inventory.js";

const temporaryRoots: string[] = [];

function artifact(overrides: Partial<AgentArtifact> & { kind: AgentArtifactKind; name: string }): AgentArtifact {
  return {
    sourcePath: `${overrides.name}.md`,
    targetAgents: ["claude-code"],
    risk: "medium",
    coverage: { deterministicTests: ["src/example.test.ts"], behavioralEvals: [] },
    description: "Useful prompt artifact",
    ...overrides,
  };
}

function temporaryRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "agentbrew-artifact-lint-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("lintAgentArtifacts", () => {
  it("fails duplicate command and subagent names", () => {
    const diagnostics = lintAgentArtifacts([
      artifact({ kind: "command", name: "deploy", sourcePath: "src/cli-commands/a/deploy.md" }),
      artifact({ kind: "command", name: "deploy", sourcePath: "src/cli-commands/b/deploy.md" }),
      artifact({ kind: "agent-source", name: "reviewer", sourcePath: "agents/reviewer.md" }),
      artifact({ kind: "agent-source", name: "reviewer", sourcePath: "more-agents/reviewer.md" }),
    ]);

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ artifactName: "deploy", code: "duplicate-name", kind: "command" }),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ artifactName: "reviewer", code: "duplicate-name", kind: "agent-source" }),
    );
  });

  it("fails prompt-like artifacts missing description or target-agent metadata", () => {
    const diagnostics = lintAgentArtifacts([
      artifact({ kind: "command", name: "missing-description", description: undefined }),
      artifact({ kind: "hook", name: "missing-targets", targetAgents: [] }),
    ]);

    expect(diagnostics).toEqual([
      expect.objectContaining({ artifactName: "missing-description", code: "missing-metadata" }),
      expect.objectContaining({ artifactName: "missing-targets", code: "missing-metadata" }),
    ]);
  });

  it("fails artifacts missing a required name", () => {
    const diagnostics = lintAgentArtifacts([artifact({ kind: "catalog-mcp", name: "" })]);

    expect(diagnostics).toEqual([expect.objectContaining({ code: "missing-name", kind: "catalog-mcp" })]);
  });

  it("fails high-risk artifacts without deterministic tests, behavioral evals, or exemption", () => {
    const diagnostics = lintAgentArtifacts([
      artifact({
        kind: "mcp-reference",
        name: "dangerous-mcp",
        risk: "high",
        coverage: { deterministicTests: [], behavioralEvals: [] },
      }),
    ]);

    expect(diagnostics).toEqual([
      expect.objectContaining({ artifactName: "dangerous-mcp", code: "high-risk-without-coverage" }),
    ]);
  });

  it("allows high-risk artifacts with an explicit exemption", () => {
    const diagnostics = lintAgentArtifacts([
      artifact({
        kind: "mcp-reference",
        name: "exempt-mcp",
        risk: "high",
        coverage: { deterministicTests: [], behavioralEvals: [], exemption: "manual-only docs pointer" },
      }),
    ]);

    expect(diagnostics).toEqual([]);
  });

  it("fails generated output paths treated as source artifacts", () => {
    const diagnostics = lintAgentArtifacts([
      artifact({ kind: "command", name: "generated", sourcePath: ".claude/commands/generated.md" }),
    ]);

    expect(diagnostics).toEqual([expect.objectContaining({ code: "generated-output-source" })]);
  });

  it("fails instruction templates that contradict source-of-truth policy", () => {
    const diagnostics = lintAgentArtifacts([
      artifact({
        kind: "instruction-template",
        name: "AGENTS.md",
        sourcePath: "templates/AGENTS.md",
        content: "Edit generated agent files directly.",
      }),
    ]);

    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "policy-contradiction" }));
  });
});

describe("collectAgentArtifacts diagnostics", () => {
  it("reports malformed YAML with a path-specific diagnostic", () => {
    const repoRoot = temporaryRepoRoot();
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    writeFileSync(join(repoRoot, "src", "catalog.yaml"), "skills:\n  - name: broken\n    description: [\n");

    const inventory = collectAgentArtifacts({ repoRoot, agentDefinitions: [] });

    expect(inventory.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unparseable-source", sourcePath: "src/catalog.yaml" }),
    );
  });

  it("reports malformed built-in skill frontmatter through lint with a path-specific diagnostic", () => {
    const repoRoot = temporaryRepoRoot();
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    mkdirSync(join(repoRoot, "hooks"), { recursive: true });
    mkdirSync(join(repoRoot, "skill-plugins", "dev", "bad-skill"), { recursive: true });
    writeFileSync(join(repoRoot, "src", "catalog.yaml"), "skills: []\nmcp_servers: []\nrules: []\ncli_tools: []\n");
    writeFileSync(join(repoRoot, "hooks", "manifest.yaml"), "version: 1\nhooks: []\n");
    writeFileSync(join(repoRoot, "skill-plugins", "dev", "bad-skill", "SKILL.md"), "---\nname:\n---\n# Bad\n");

    const inventory = collectAgentArtifacts({
      repoRoot,
      agentDefinitions: [{ name: "claude-code", skillsDir: "~/.claude/skills" }],
    });

    expect(lintAgentArtifacts(inventory.artifacts)).toContainEqual(
      expect.objectContaining({
        artifactName: "bad-skill",
        code: "missing-metadata",
        sourcePath: "skill-plugins/dev/bad-skill/SKILL.md",
      }),
    );
  });
});
