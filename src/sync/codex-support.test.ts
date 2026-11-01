import { readFileSync } from "node:fs";
import TOML from "@iarna/toml";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { AGENT_DEFINITIONS } from "../types.js";
import { toCodexAgent } from "./agents-sync.js";
import { computeCommandsDiff, getCommandTargets } from "./command-sync.js";
import { filterHooksForTarget, toClaudeHooksConfig } from "./hooks-sync.js";

describe("Codex command deployment", () => {
  it("deploys commands as custom prompts with supported metadata and arguments", () => {
    const target = getCommandTargets().find((target) => target.agentName === "codex");
    expect(target?.dir).toBe("~/.codex/prompts");
    const source =
      "---\ndescription: Run a job\nargument-hint: '[job]'\nallowed-tools: Bash\ncontext: fork\n---\nRun $ARGUMENTS and $1.\n";
    const result = computeCommandsDiff(
      [{ filename: "job.md", content: source }],
      [
        {
          agentName: "codex",
          exists: true,
          transform: target?.transform ?? ((s) => s),
          fileExt: ".md",
          existingFiles: new Map(),
        },
      ],
    );
    expect(result[0].actions[0].content).toContain("description:");
    expect(result[0].actions[0].content).toContain("argument-hint:");
    expect(result[0].actions[0].content).toContain("Run $ARGUMENTS and $1.");
    expect(result[0].actions[0].content).not.toContain("allowed-tools:");
    expect(result[0].actions[0].content).not.toContain("context:");
  });
  it("declares Codex skill features explicitly instead of assuming Claude restrictions", () => {
    expect(AGENT_DEFINITIONS.find((agent) => agent.name === "codex")?.supportedSkillFeatures).toEqual([]);
  });
});

describe("Codex native formats", () => {
  it("writes custom agent TOML with required name, description, and instructions", () => {
    const output = TOML.parse(
      toCodexAgent("reviewer", "---\ndescription: Review code\nmodel: sonnet\ntools: Read\n---\nCheck bugs.\n"),
    );
    expect(output).toEqual({ name: "reviewer", description: "Review code", developer_instructions: "Check bugs.\n" });
  });
  it("filters unsupported events, handler types, and conditional behavior", () => {
    const hooks = filterHooksForTarget(
      [
        { event: "PreToolUse", matcher: "Bash", source: "agentfile", type: "command", command: "check" },
        { event: "Notification", source: "agentfile", type: "command", command: "notify" },
        { event: "Stop", source: "agentfile", type: "prompt", prompt: "review" },
        { event: "Stop", source: "agentfile", type: "command", command: "conditional", if: "some condition" },
      ],
      "codex",
    );
    expect(toClaudeHooksConfig(hooks)).toEqual({
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "check" }] }],
    });
  });
});

describe("Codex hook policy scope", () => {
  it("deploys audited Bash policies while keeping incompatible file and goal hooks Claude-only", () => {
    const manifest = yaml.load(readFileSync(new URL("../../hooks/manifest.yaml", import.meta.url), "utf-8")) as {
      hooks: Array<{ id: string; matcher?: string; agents: string[] }>;
    };
    const codex = manifest.hooks.filter((hook) => hook.agents.includes("codex"));
    expect(codex.map((hook) => hook.id)).toContain("no-git-add-all");
    expect(codex.every((hook) => hook.matcher === "Bash")).toBe(true);
    for (const id of ["goal-contract-before-edit", "goal-retro-before-stop", "poll-loop-hint"]) {
      expect(manifest.hooks.find((hook) => hook.id === id)?.agents).not.toContain("codex");
    }
  });
});
