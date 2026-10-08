import { describe, expect, it } from "vitest";
import { loadAgentDefinitions } from "./agents.js";
import {
  AGENTBREW_ONLY_COMMANDS_AGENTS,
  AGENTBREW_ONLY_COMMANDS_RATIONALE,
  AGENTBREW_TO_AI_RULES_COMMANDS,
  AI_RULES_COMMANDS_TO_AGENTBREW,
  buildAiRulesCommandsAgentList,
  fromAiRulesCommandsAgent,
  toAiRulesCommandsAgent,
} from "./commands-agent-map.js";

describe("AGENTBREW_TO_AI_RULES_COMMANDS", () => {
  it("matches AGENTBREW_TO_AI_RULES_COMMANDS rename entries", () => {
    expect(Object.keys(AGENTBREW_TO_AI_RULES_COMMANDS).sort()).toEqual(["claude-code"]);
  });

  it("maps claude-code to claude per ai-rules' agent vocabulary", () => {
    expect(AGENTBREW_TO_AI_RULES_COMMANDS["claude-code"]).toBe("claude");
  });

  it("is frozen (immutable) at runtime", () => {
    expect(Object.isFrozen(AGENTBREW_TO_AI_RULES_COMMANDS)).toBe(true);
  });
});

describe("AI_RULES_COMMANDS_TO_AGENTBREW", () => {
  it("inverts AGENTBREW_TO_AI_RULES_COMMANDS", () => {
    expect(AI_RULES_COMMANDS_TO_AGENTBREW.claude).toBe("claude-code");
  });

  it("inverts every AGENTBREW_TO_AI_RULES_COMMANDS entry", () => {
    expect(Object.keys(AI_RULES_COMMANDS_TO_AGENTBREW).sort()).toEqual(["claude"]);
  });
});

describe("AGENTBREW_ONLY_COMMANDS_AGENTS", () => {
  it("matches AGENTBREW_ONLY_COMMANDS_AGENTS", () => {
    // Format/transform mismatch carve-outs (gemini-cli, opencode),
    // transitive carve-out
    // (claude-desktop, which shares ~/.claude/commands with claude-code).
    expect(new Set(AGENTBREW_ONLY_COMMANDS_AGENTS)).toEqual(new Set(["gemini-cli", "claude-desktop", "opencode"]));
  });

  it("every carve-out exists in agents.yaml", () => {
    const defs = loadAgentDefinitions();
    const names = new Set(defs.map((d) => d.name));
    for (const carveOut of AGENTBREW_ONLY_COMMANDS_AGENTS) {
      expect(names.has(carveOut), `carve-out ${carveOut} should exist in agents.yaml`).toBe(true);
    }
  });

  it("every carve-out has commandsDir set in agents.yaml (a non-commands-capable carve-out is meaningless)", () => {
    const defs = loadAgentDefinitions();
    const byName = new Map(defs.map((d) => [d.name, d]));
    for (const carveOut of AGENTBREW_ONLY_COMMANDS_AGENTS) {
      const def = byName.get(carveOut);
      expect(def?.commandsDir, `carve-out ${carveOut} should have commandsDir set in agents.yaml`).toBeTruthy();
    }
  });

  it("is derived from AGENTBREW_ONLY_COMMANDS_RATIONALE keys (no orphan entries either way)", () => {
    // Same invariant as the skills CLI / mcpm / rules maps: a carve-out
    // without a documented rationale is a silent drift bug. The Set is
    // constructed from the Record's keys, so this test pins both directions.
    expect(new Set(AGENTBREW_ONLY_COMMANDS_AGENTS)).toEqual(new Set(Object.keys(AGENTBREW_ONLY_COMMANDS_RATIONALE)));
  });
});

describe("AGENTBREW_ONLY_COMMANDS_RATIONALE", () => {
  it("has a rationale for each AGENTBREW_ONLY_COMMANDS_AGENTS entry", () => {
    expect(Object.keys(AGENTBREW_ONLY_COMMANDS_RATIONALE).sort()).toEqual(["claude-desktop", "gemini-cli", "opencode"]);
  });

  it("every rationale is a non-empty single-sentence string", () => {
    for (const [agent, reason] of Object.entries(AGENTBREW_ONLY_COMMANDS_RATIONALE)) {
      expect(reason, `rationale for ${agent} is empty`).toBeTruthy();
      expect(reason.length, `rationale for ${agent} is too short`).toBeGreaterThan(20);
      // Single sentence in user-facing CLI warning context: keep it ≤ 200
      // chars so it fits on one terminal line under realistic widths.
      expect(reason.length, `rationale for ${agent} is too long for a one-line CLI warning`).toBeLessThanOrEqual(200);
    }
  });

  it("each rationale names ai-rules specifically (or explains the cross-tool / readsFrom scope)", () => {
    for (const [agent, reason] of Object.entries(AGENTBREW_ONLY_COMMANDS_RATIONALE)) {
      const mentionsAiRules = /ai-rules/i.test(reason);
      const mentionsScope = /skills-?CLI|mcpm|readsFrom/i.test(reason);
      expect(mentionsAiRules || mentionsScope, `rationale for ${agent} should reference 'ai-rules' or scope`).toBe(
        true,
      );
    }
  });

  it("is frozen (immutable) at runtime", () => {
    expect(Object.isFrozen(AGENTBREW_ONLY_COMMANDS_RATIONALE)).toBe(true);
  });
});

describe("toAiRulesCommandsAgent", () => {
  it("translates the rename pairs (claude-code → claude)", () => {
    expect(toAiRulesCommandsAgent("claude-code")).toBe("claude");
  });

  it("returns null for agentbrew-only commands carve-outs", () => {
    expect(toAiRulesCommandsAgent("gemini-cli")).toBeNull();
    expect(toAiRulesCommandsAgent("claude-desktop")).toBeNull();
    expect(toAiRulesCommandsAgent("opencode")).toBeNull();
  });

  it("passes through cursor (the only intersection agent without rename)", () => {
    expect(toAiRulesCommandsAgent("cursor")).toBe("cursor");
  });

  it("passes through ai-rules-only commands agents that aren't in agentbrew today (amp, firebender)", () => {
    // amp + firebender are commands-capable in ai-rules but agentbrew
    // doesn't have commandsDir set for them today (slice 5's free-
    // capability-gain expansion). The helper passes them through so the
    // moment slice 5 lands and they enter agents.yaml as commands-capable,
    // they delegate immediately without further code change.
    expect(toAiRulesCommandsAgent("amp")).toBe("amp");
    expect(toAiRulesCommandsAgent("firebender")).toBe("firebender");
  });

  it("passes unknown names through unchanged (caller validates)", () => {
    expect(toAiRulesCommandsAgent("nonexistent-agent")).toBe("nonexistent-agent");
  });

  it("never throws for any agentbrew canonical name", () => {
    const defs = loadAgentDefinitions();
    for (const d of defs) {
      expect(() => toAiRulesCommandsAgent(d.name)).not.toThrow();
    }
  });
});

describe("fromAiRulesCommandsAgent", () => {
  it("translates the rename pairs back to the agentbrew name", () => {
    expect(fromAiRulesCommandsAgent("claude")).toBe("claude-code");
  });

  it("passes through unchanged for intersection agents", () => {
    expect(fromAiRulesCommandsAgent("cursor")).toBe("cursor");
    expect(fromAiRulesCommandsAgent("amp")).toBe("amp");
    expect(fromAiRulesCommandsAgent("firebender")).toBe("firebender");
  });

  it("passes through unchanged for unknown names", () => {
    expect(fromAiRulesCommandsAgent("nonexistent-agent")).toBe("nonexistent-agent");
  });
});

describe("roundtrip invariants", () => {
  it("toAiRulesCommandsAgent then fromAiRulesCommandsAgent returns the original for the rename", () => {
    for (const agentbrewName of Object.keys(AGENTBREW_TO_AI_RULES_COMMANDS)) {
      const forward = toAiRulesCommandsAgent(agentbrewName);
      expect(forward).not.toBeNull();
      expect(fromAiRulesCommandsAgent(forward as string)).toBe(agentbrewName);
    }
  });

  it("roundtrip for intersection agents is identity", () => {
    const intersection = ["cursor", "amp", "firebender"];
    for (const name of intersection) {
      const forward = toAiRulesCommandsAgent(name);
      expect(forward).toBe(name);
      expect(fromAiRulesCommandsAgent(forward as string)).toBe(name);
    }
  });
});

describe("buildAiRulesCommandsAgentList", () => {
  describe('"all" mode', () => {
    it("emits the wildcard form", () => {
      // Same shape as buildAiRulesAgentList("all") and buildMcpmClientList("all")
      // — the wildcard is opaque to the dispatcher; carve-outs are not
      // reported in this mode.
      expect(buildAiRulesCommandsAgentList("all")).toEqual({ agents: ["*"], carveOuts: [] });
    });
  });

  describe("rename-not-required path (intersection agents)", () => {
    it("emits cursor unchanged (the only commands-intersection agent without rename)", () => {
      expect(buildAiRulesCommandsAgentList(["cursor"])).toEqual({
        agents: ["cursor"],
        carveOuts: [],
      });
    });

    it("emits free-capability-gain agents (amp, firebender) unchanged", () => {
      // Slice 5's free-capability-gain expansion candidates pass through
      // even before agents.yaml gets their commandsDir.
      expect(buildAiRulesCommandsAgentList(["amp", "firebender"])).toEqual({
        agents: ["amp", "firebender"],
        carveOuts: [],
      });
    });

    it("returns empty agents for an empty input list (no-op invocation)", () => {
      expect(buildAiRulesCommandsAgentList([])).toEqual({ agents: [], carveOuts: [] });
    });
  });

  describe("rename-required path", () => {
    it("translates claude-code → claude at the boundary", () => {
      expect(buildAiRulesCommandsAgentList(["claude-code"])).toEqual({
        agents: ["claude"],
        carveOuts: [],
      });
    });

    it("translates a single rename pair plus an intersection agent in one call", () => {
      expect(buildAiRulesCommandsAgentList(["claude-code", "cursor"])).toEqual({
        agents: ["claude", "cursor"],
        carveOuts: [],
      });
    });
  });

  describe("carve-out path", () => {
    it("skips AGENTBREW_ONLY_COMMANDS_AGENTS and reports them in carveOuts", () => {
      // The carve-outs (gemini-cli, claude-desktop,
      // opencode) have no separate ai-rules dispatch — caller must route
      // them to native OR (for claude-desktop) rely on the claude-code
      // intersection covering the same file via readsFrom.
      expect(buildAiRulesCommandsAgentList(["gemini-cli", "claude-desktop", "opencode"])).toEqual({
        agents: [],
        carveOuts: ["gemini-cli", "claude-desktop", "opencode"],
      });
    });
  });

  describe("mixed list (intersection + rename + carve-out + free-gain)", () => {
    it("translates renames, passes intersection/free-gain agents through, and reports carve-outs separately", () => {
      // Covers all three classes in one pass.
      expect(
        buildAiRulesCommandsAgentList([
          "claude-code", // rename
          "cursor", // intersection
          "gemini-cli", // carve-out
          "claude-desktop", // carve-out
          "opencode", // carve-out
          "amp", // free gain
          "firebender", // free gain
        ]),
      ).toEqual({
        agents: ["claude", "cursor", "amp", "firebender"],
        carveOuts: ["gemini-cli", "claude-desktop", "opencode"],
      });
    });

    it("preserves carve-out order in the carveOuts array", () => {
      expect(buildAiRulesCommandsAgentList(["opencode", "claude-code", "gemini-cli"])).toEqual({
        agents: ["claude"],
        carveOuts: ["opencode", "gemini-cli"],
      });
    });

    it("preserves agent order in the agents array (renames don't reorder)", () => {
      expect(buildAiRulesCommandsAgentList(["cursor", "claude-code"])).toEqual({
        agents: ["cursor", "claude"],
        carveOuts: [],
      });
    });
  });
});

describe("coverage invariant — every commands-capable agent in agents.yaml is classified", () => {
  it("every commands-capable agent is either in ai-rules' commands intersection, the rename, or a carve-out", () => {
    // ai-rules' supported commands agents per
    // [docs/commands-and-skills.md](https://raw.githubusercontent.com/block/ai-rules/main/docs/commands-and-skills.md)
    // (CANARY_DELEGATED_AGENTS at ai-rules v1.6.0). Mirror in test; source-of-truth
    // is the live ai-rules docs.
    const aiRulesCommandsAgents = new Set(["amp", "claude", "cursor", "firebender"]);

    const defs = loadAgentDefinitions();
    // Filter to commands-capable agents only — agents with a commandsDir
    // field on the loaded AgentConfig.
    const commandsCapable = defs.filter((d) => d.commandsDir !== undefined);

    const unclassified: string[] = [];
    for (const d of commandsCapable) {
      const remapped = toAiRulesCommandsAgent(d.name);
      const isCarveOut = remapped === null;
      const isInAiRules = remapped !== null && aiRulesCommandsAgents.has(remapped);
      if (!isCarveOut && !isInAiRules) {
        unclassified.push(d.name);
      }
    }
    // The current commands-capable agents in agentbrew (claude-code,
    // cursor, gemini-cli, claude-desktop, opencode) split
    // intersection + carve-outs. If a new commands-capable agent lands
    // in agents.yaml without an entry in this map (intersection / rename /
    // carve-out), this test fails — preventing silent drift.
    expect(unclassified).toEqual([]);
  });
});
