import { describe, expect, it } from "vitest";
import { loadAgentDefinitions } from "./agents.js";
import {
  AGENTBREW_ONLY_RULES_AGENTS,
  AGENTBREW_ONLY_RULES_RATIONALE,
  AGENTBREW_TO_AI_RULES,
  AI_RULES_TO_AGENTBREW,
  buildAiRulesAgentList,
  fromAiRulesAgent,
  toAiRulesAgent,
} from "./rules-agent-map.js";

describe("AGENTBREW_TO_AI_RULES", () => {
  it("matches AGENTBREW_TO_AI_RULES rename entries", () => {
    expect(Object.keys(AGENTBREW_TO_AI_RULES).sort()).toEqual(["claude-code", "gemini-cli", "kilo", "roo-code"]);
  });

  it("maps agentbrew names to ai-rules names per the 2026-04-27 measurement", () => {
    expect(AGENTBREW_TO_AI_RULES["claude-code"]).toBe("claude");
    expect(AGENTBREW_TO_AI_RULES["gemini-cli"]).toBe("gemini");
    expect(AGENTBREW_TO_AI_RULES.kilo).toBe("kilocode");
    expect(AGENTBREW_TO_AI_RULES["roo-code"]).toBe("roo");
  });

  it("is frozen (immutable) at runtime", () => {
    expect(Object.isFrozen(AGENTBREW_TO_AI_RULES)).toBe(true);
  });
});

describe("AI_RULES_TO_AGENTBREW", () => {
  it("inverts AGENTBREW_TO_AI_RULES", () => {
    expect(AI_RULES_TO_AGENTBREW.claude).toBe("claude-code");
    expect(AI_RULES_TO_AGENTBREW.gemini).toBe("gemini-cli");
    expect(AI_RULES_TO_AGENTBREW.kilocode).toBe("kilo");
    expect(AI_RULES_TO_AGENTBREW.roo).toBe("roo-code");
  });

  it("matches AGENTBREW_TO_AI_RULES forward map keys", () => {
    expect(Object.keys(AI_RULES_TO_AGENTBREW).sort()).toEqual(["claude", "gemini", "kilocode", "roo"]);
  });
});

describe("AGENTBREW_ONLY_RULES_AGENTS", () => {
  it("matches AGENTBREW_ONLY_RULES_AGENTS", () => {
    // AGENTBREW_ONLY_RULES_AGENTS (windsurf, augment, devin) + readsFrom-aliased
    // carve-out (claude-desktop, which shares ~/.claude/CLAUDE.md with
    // claude-code). Treated as a carve-out at the delegation boundary so
    // the dispatcher knows not to issue a separate `ai-rules generate
    // --agents claude-desktop` call.
    expect(new Set(AGENTBREW_ONLY_RULES_AGENTS)).toEqual(new Set(["windsurf", "augment", "devin", "claude-desktop"]));
  });

  it("every carve-out exists in agents.yaml", () => {
    const defs = loadAgentDefinitions();
    const names = new Set(defs.map((d) => d.name));
    for (const carveOut of AGENTBREW_ONLY_RULES_AGENTS) {
      expect(names.has(carveOut), `carve-out ${carveOut} should exist in agents.yaml`).toBe(true);
    }
  });

  it("is derived from AGENTBREW_ONLY_RULES_RATIONALE keys (no orphan entries either way)", () => {
    // Same invariant as the skills CLI / mcpm maps: a carve-out without a
    // documented rationale is a silent drift bug. The Set is constructed
    // from the Record's keys, so this test pins both directions.
    expect(new Set(AGENTBREW_ONLY_RULES_AGENTS)).toEqual(new Set(Object.keys(AGENTBREW_ONLY_RULES_RATIONALE)));
  });
});

describe("AGENTBREW_ONLY_RULES_RATIONALE", () => {
  it("has a rationale for each AGENTBREW_ONLY_RULES_AGENTS entry", () => {
    expect(Object.keys(AGENTBREW_ONLY_RULES_RATIONALE).sort()).toEqual([
      "augment",
      "claude-desktop",
      "devin",
      "windsurf",
    ]);
  });

  it("every rationale is a non-empty single-sentence string", () => {
    for (const [agent, reason] of Object.entries(AGENTBREW_ONLY_RULES_RATIONALE)) {
      expect(reason, `rationale for ${agent} is empty`).toBeTruthy();
      expect(reason.length, `rationale for ${agent} is too short`).toBeGreaterThan(20);
      // Single sentence in user-facing CLI warning context: keep it ≤ 200
      // chars so it fits on one terminal line under realistic widths.
      expect(reason.length, `rationale for ${agent} is too long for a one-line CLI warning`).toBeLessThanOrEqual(200);
    }
  });

  it("each rationale names ai-rules specifically (or explains the cross-tool / Cognition scope)", () => {
    for (const [agent, reason] of Object.entries(AGENTBREW_ONLY_RULES_RATIONALE)) {
      const mentionsAiRules = /ai-rules/i.test(reason);
      const mentionsScope = /skills-?CLI|mcpm|cognition|codeium|windsurf/i.test(reason);
      expect(mentionsAiRules || mentionsScope, `rationale for ${agent} should reference 'ai-rules' or scope`).toBe(
        true,
      );
    }
  });

  it("is frozen (immutable) at runtime", () => {
    expect(Object.isFrozen(AGENTBREW_ONLY_RULES_RATIONALE)).toBe(true);
  });
});

describe("toAiRulesAgent", () => {
  it("translates the rename pairs", () => {
    expect(toAiRulesAgent("claude-code")).toBe("claude");
    expect(toAiRulesAgent("gemini-cli")).toBe("gemini");
    expect(toAiRulesAgent("kilo")).toBe("kilocode");
    expect(toAiRulesAgent("roo-code")).toBe("roo");
  });

  it("returns null for agentbrew-only agents (carve-outs)", () => {
    expect(toAiRulesAgent("windsurf")).toBeNull();
    expect(toAiRulesAgent("augment")).toBeNull();
    expect(toAiRulesAgent("devin")).toBeNull();
    expect(toAiRulesAgent("claude-desktop")).toBeNull();
  });

  it("passes through intersection agents unchanged", () => {
    expect(toAiRulesAgent("cursor")).toBe("cursor");
    expect(toAiRulesAgent("codex")).toBe("codex");
  });

  it("passes through free-capability-gain agents unchanged (rules support gained on delegation)", () => {
    // These agents exist in agentbrew's agents.yaml but don't have rulesFile/
    // rulesDir today; they're rules-capable in ai-rules and gain rules
    // support automatically when the delegation lands.
    expect(toAiRulesAgent("amp")).toBe("amp");
    expect(toAiRulesAgent("cline")).toBe("cline");
    expect(toAiRulesAgent("copilot")).toBe("copilot");
    expect(toAiRulesAgent("firebender")).toBe("firebender");
    expect(toAiRulesAgent("goose")).toBe("goose");
  });

  it("passes unknown names through unchanged (caller validates)", () => {
    expect(toAiRulesAgent("nonexistent-agent")).toBe("nonexistent-agent");
  });

  it("never throws for any agentbrew canonical name", () => {
    const defs = loadAgentDefinitions();
    for (const d of defs) {
      expect(() => toAiRulesAgent(d.name)).not.toThrow();
    }
  });
});

describe("fromAiRulesAgent", () => {
  it("translates the rename pairs back to agentbrew names", () => {
    expect(fromAiRulesAgent("claude")).toBe("claude-code");
    expect(fromAiRulesAgent("gemini")).toBe("gemini-cli");
    expect(fromAiRulesAgent("kilocode")).toBe("kilo");
    expect(fromAiRulesAgent("roo")).toBe("roo-code");
  });

  it("passes through unchanged for intersection agents", () => {
    expect(fromAiRulesAgent("cursor")).toBe("cursor");
    expect(fromAiRulesAgent("codex")).toBe("codex");
    expect(fromAiRulesAgent("amp")).toBe("amp");
  });

  it("passes through unchanged for unknown names", () => {
    expect(fromAiRulesAgent("nonexistent-agent")).toBe("nonexistent-agent");
  });
});

describe("roundtrip invariants", () => {
  it("toAiRulesAgent then fromAiRulesAgent returns the original for renames", () => {
    for (const agentbrewName of Object.keys(AGENTBREW_TO_AI_RULES)) {
      const forward = toAiRulesAgent(agentbrewName);
      expect(forward).not.toBeNull();
      expect(fromAiRulesAgent(forward as string)).toBe(agentbrewName);
    }
  });

  it("roundtrip for intersection agents is identity", () => {
    const intersection = ["cursor", "codex", "amp", "cline", "copilot", "firebender", "goose"];
    for (const name of intersection) {
      const forward = toAiRulesAgent(name);
      expect(forward).toBe(name);
      expect(fromAiRulesAgent(forward as string)).toBe(name);
    }
  });
});

describe("buildAiRulesAgentList", () => {
  describe('"all" mode', () => {
    it("emits the wildcard form", () => {
      // Same shape as buildSkillsCliAgentArgs("all") and
      // buildMcpmClientList("all") — the wildcard is opaque to the
      // dispatcher; carve-outs are not reported in this mode.
      expect(buildAiRulesAgentList("all")).toEqual({ agents: ["*"], carveOuts: [] });
    });
  });

  describe("rename-not-required path (intersection agents)", () => {
    it("emits one agent name per intersection agent, names unchanged", () => {
      expect(buildAiRulesAgentList(["cursor", "codex"])).toEqual({
        agents: ["cursor", "codex"],
        carveOuts: [],
      });
    });

    it("preserves order of input agents in the emitted agents list", () => {
      expect(buildAiRulesAgentList(["amp", "goose", "firebender"])).toEqual({
        agents: ["amp", "goose", "firebender"],
        carveOuts: [],
      });
    });

    it("returns empty agents for an empty input list (no-op invocation)", () => {
      expect(buildAiRulesAgentList([])).toEqual({ agents: [], carveOuts: [] });
    });
  });

  describe("rename-required path", () => {
    it("translates each of the rename pairs at the boundary", () => {
      expect(buildAiRulesAgentList(["claude-code", "gemini-cli", "kilo", "roo-code"])).toEqual({
        agents: ["claude", "gemini", "kilocode", "roo"],
        carveOuts: [],
      });
    });

    it("translates a single rename pair without affecting other agents", () => {
      expect(buildAiRulesAgentList(["claude-code"])).toEqual({
        agents: ["claude"],
        carveOuts: [],
      });
    });
  });

  describe("carve-out path", () => {
    it("skips agentbrew-only agents and reports them in carveOuts", () => {
      // The carve-outs (windsurf, augment, devin, claude-desktop) have
      // no separate ai-rules dispatch — caller must route them to native
      // OR (for claude-desktop) rely on the claude-code intersection
      // covering the same file via readsFrom.
      expect(buildAiRulesAgentList(["windsurf", "augment", "devin", "claude-desktop"])).toEqual({
        agents: [],
        carveOuts: ["windsurf", "augment", "devin", "claude-desktop"],
      });
    });
  });

  describe("mixed list (intersection + rename + carve-out + free-gain)", () => {
    it("translates renames, passes intersection/free-gain agents through, and reports carve-outs separately", () => {
      // The rules-capable + free-gain + carve-out matrix shape covering
      // every agent that comes into play. The helper handles all classes
      // in one pass.
      expect(
        buildAiRulesAgentList([
          "claude-code", // rename
          "cursor", // intersection
          "windsurf", // carve-out
          "augment", // carve-out
          "devin", // carve-out
          "codex", // intersection
          "gemini-cli", // rename
          "amp", // free gain (intersection in ai-rules)
          "cline", // free gain
          "copilot", // free gain
          "firebender", // free gain
          "goose", // free gain
          "kilo", // rename + free gain
          "roo-code", // rename + free gain
        ]),
      ).toEqual({
        agents: [
          "claude",
          "cursor",
          "codex",
          "gemini",
          "amp",
          "cline",
          "copilot",
          "firebender",
          "goose",
          "kilocode",
          "roo",
        ],
        carveOuts: ["windsurf", "augment", "devin"],
      });
    });

    it("preserves carve-out order in the carveOuts array", () => {
      expect(buildAiRulesAgentList(["devin", "claude-code", "windsurf"])).toEqual({
        agents: ["claude"],
        carveOuts: ["devin", "windsurf"],
      });
    });
  });
});

describe("coverage invariant — every rules-capable agent in agents.yaml is classified", () => {
  it("every rules-capable agent is either in ai-rules intersection, a rename, or a carve-out", () => {
    // ai-rules' supported agents as of 2026-04-27 (`ai-rules list-agents`).
    // Mirror in test; source-of-truth is the live ai-rules registry.
    const aiRulesAgents = new Set([
      "amp",
      "claude",
      "cline",
      "codex",
      "copilot",
      "cursor",
      "firebender",
      "gemini",
      "goose",
      "kilocode",
      "roo",
    ]);

    const defs = loadAgentDefinitions();
    // Filter to rules-capable agents only — agents with a rulesFile or
    // rulesDir field on the loaded AgentConfig.
    const rulesCapable = defs.filter((d) => d.rulesFile !== undefined || d.rulesDir !== undefined);

    const unclassified: string[] = [];
    for (const d of rulesCapable) {
      const remapped = toAiRulesAgent(d.name);
      const isCarveOut = remapped === null;
      const isInAiRules = remapped !== null && aiRulesAgents.has(remapped);
      if (!isCarveOut && !isInAiRules) {
        unclassified.push(d.name);
      }
    }
    expect(unclassified).toEqual([]);
  });
});
