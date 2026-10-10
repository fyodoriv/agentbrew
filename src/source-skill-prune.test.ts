import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pruneDroppedAgentfileSkills, removeInstalledSkillStaging } from "./source-skill-prune.js";
import type { AgentBrewState } from "./types.js";

function stateWith(skillsInstalled: string[], extra: Partial<AgentBrewState> = {}): AgentBrewState {
  return {
    agents: [],
    catalogVersion: "test",
    sources: [
      { url: "owner/repo", type: "github", skillsInstalled: [...skillsInstalled], availableItems: [], addedAt: "x" },
    ],
    ...extra,
  } as AgentBrewState;
}

describe("pruneDroppedAgentfileSkills", () => {
  it("records the Agentfile skills on first run and prunes nothing", () => {
    const state = stateWith(["a", "b"]);
    const removeStaging = vi.fn();
    expect(pruneDroppedAgentfileSkills({ skills: ["b", "a"] }, state, { removeStaging })).toEqual([]);
    expect(state.agentfileSkills).toEqual(["a", "b"]);
    expect(removeStaging).not.toHaveBeenCalled();
  });

  it("prunes a skill that the Agentfile dropped, from state and staging", () => {
    const state = stateWith(["a", "b", "manual"], { agentfileSkills: ["a", "b"] });
    const removeStaging = vi.fn();
    expect(pruneDroppedAgentfileSkills({ skills: ["a"] }, state, { removeStaging })).toEqual(["b"]);
    expect(state.sources?.[0].skillsInstalled).toEqual(["a", "manual"]);
    expect(state.agentfileSkills).toEqual(["a"]);
    expect(removeStaging).toHaveBeenCalledWith("b");
  });

  it("never prunes a skill the Agentfile never listed (installed by hand)", () => {
    const state = stateWith(["a", "manual"], { agentfileSkills: ["a"] });
    expect(pruneDroppedAgentfileSkills({ skills: ["a"] }, state, { removeStaging: vi.fn() })).toEqual([]);
    expect(state.sources?.[0].skillsInstalled).toEqual(["a", "manual"]);
  });

  it("leaves team-overlay sources alone", () => {
    const state = stateWith([], { agentfileSkills: ["t"] });
    state.sources?.push({
      url: "team/skills",
      type: "github",
      skillsInstalled: ["t"],
      availableItems: [],
      addedAt: "x",
      origin: "team:acme",
    } as never);
    pruneDroppedAgentfileSkills({ skills: [] }, state, { removeStaging: vi.fn() });
    expect(state.sources?.[1].skillsInstalled).toEqual(["t"]);
  });

  it("does nothing when the Agentfile has no skills key", () => {
    const state = stateWith(["a"], { agentfileSkills: ["a"] });
    expect(pruneDroppedAgentfileSkills({}, state, { removeStaging: vi.fn() })).toEqual([]);
    expect(state.agentfileSkills).toEqual(["a"]);
  });
});

describe("removeInstalledSkillStaging", () => {
  it("removes the staging folder, and keeps it in dry-run", () => {
    const home = mkdtempSync(join(tmpdir(), "prune-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const dir = join(home, ".config", "agentbrew", "installed-skills", "gone");
      mkdirSync(dir, { recursive: true });
      removeInstalledSkillStaging("gone", true);
      expect(existsSync(dir)).toBe(true);
      removeInstalledSkillStaging("gone", false);
      expect(existsSync(dir)).toBe(false);
    } finally {
      process.env.HOME = previousHome;
    }
  });
});
