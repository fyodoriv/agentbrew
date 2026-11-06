import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  backsHandInstalledSkill,
  pruneDroppedAgentfileSkills,
  removeInstalledSkillStaging,
} from "./source-skill-prune.js";
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

  it.each([
    false,
    true,
  ])("cleans deferred owned staging only when no team source retains it (team owner: %s)", (teamOwner) => {
    const state = stateWith([], { agentfileSkills: ["gone"], sources: [] });
    if (teamOwner) {
      state.sources!.push({
        url: "team/skills",
        type: "github",
        skillsInstalled: ["gone"],
        availableItems: [],
        addedAt: "x",
        origin: "team:fixture",
      } as never);
    }
    const removeStaging = vi.fn();
    const result = pruneDroppedAgentfileSkills({ skills: [] }, state, { removeStaging });
    expect(result).toEqual(teamOwner ? [] : ["gone"]);
    expect(removeStaging).toHaveBeenCalledTimes(teamOwner ? 0 : 1);
    if (teamOwner) expect(state.sources?.[0].skillsInstalled).toEqual(["gone"]);
    else expect(removeStaging).toHaveBeenCalledWith("gone");
    expect(state.agentfileSkills).toEqual([]);
  });

  it("does nothing when the Agentfile has no skills key", () => {
    const state = stateWith(["a"], { agentfileSkills: ["a"] });
    expect(pruneDroppedAgentfileSkills({}, state, { removeStaging: vi.fn() })).toEqual([]);
    expect(state.agentfileSkills).toEqual(["a"]);
  });
});

describe("removeInstalledSkillStaging", () => {
  it("cannot delete outside staging through a forged prior skill name", () => {
    const home = mkdtempSync(join(tmpdir(), "prune-containment-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    const staging = join(home, ".config", "agentbrew", "installed-skills");
    const outside = join(home, ".config", "agentbrew", "outside-fixture");
    mkdirSync(staging, { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(outside, "owner.txt"), "OUTSIDE_OWNER_FIXTURE\n");
    try {
      try {
        removeInstalledSkillStaging("../outside-fixture", false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
      expect(existsSync(join(outside, "owner.txt"))).toBe(true);
      expect(readFileSync(join(outside, "owner.txt"), "utf8")).toBe("OUTSIDE_OWNER_FIXTURE\n");
    } finally {
      process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

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

describe("backsHandInstalledSkill", () => {
  const byHand = (state: AgentBrewState) => ({ ...state.sources![0], origin: "user" });

  it("is true for a hand-added source whose skill no Agentfile listed", () => {
    const state = stateWith(["manual"]);
    expect(backsHandInstalledSkill(byHand(state), state)).toBe(true);
  });

  it("is false for a hand-added source whose skills all came from the last Agentfile", () => {
    const state = stateWith(["a"], { agentfileSkills: ["a"] });
    expect(backsHandInstalledSkill(byHand(state), state)).toBe(false);
  });

  it("is false for a hand-added source with no installed skills", () => {
    const state = stateWith([]);
    expect(backsHandInstalledSkill(byHand(state), state)).toBe(false);
  });

  it("is false for a source that was not added by hand", () => {
    const state = stateWith(["manual"]);
    expect(backsHandInstalledSkill(state.sources![0], state)).toBe(false);
  });
});
