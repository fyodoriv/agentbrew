import { describe, expect, it, vi } from "vitest";
import {
  AGENTBREW_ONLY_AGENTS,
  AGENTBREW_ONLY_AGENTS_RATIONALE,
  AGENTBREW_TO_SKILLS_CLI,
  buildSkillsCliAgentArgs,
  toSkillsCliAgent,
} from "./agent-name-map.js";
import { loadAgentDefinitions } from "./agents.js";

vi.mock("../state.js", () => ({
  loadState: () => ({ agents: [], team: undefined }),
}));

describe("AGENTBREW_TO_SKILLS_CLI", () => {
  it("matches AGENTBREW_TO_SKILLS_CLI rename entries", () => {
    expect(Object.keys(AGENTBREW_TO_SKILLS_CLI).sort()).toEqual(["copilot", "kiro", "roo-code"]);
  });

  it("maps agentbrew names to skills-CLI names per the 2026-05-02 measurement", () => {
    expect(AGENTBREW_TO_SKILLS_CLI.copilot).toBe("github-copilot");
    expect(AGENTBREW_TO_SKILLS_CLI.kiro).toBe("kiro-cli");
    expect(AGENTBREW_TO_SKILLS_CLI["roo-code"]).toBe("roo");
  });

  it("is frozen (immutable) at runtime", () => {
    expect(Object.isFrozen(AGENTBREW_TO_SKILLS_CLI)).toBe(true);
  });
});

describe("AGENTBREW_ONLY_AGENTS", () => {
  it("matches AGENTBREW_ONLY_SKILLS_CLI_AGENTS", () => {
    expect(new Set(AGENTBREW_ONLY_AGENTS)).toEqual(new Set(["claude-desktop", "qodo"]));
  });

  it("every carve-out exists in agents.yaml", () => {
    const defs = loadAgentDefinitions();
    const names = new Set(defs.map((d) => d.name));
    for (const carveOut of AGENTBREW_ONLY_AGENTS) {
      expect(names.has(carveOut)).toBe(true);
    }
  });

  it("is derived from AGENTBREW_ONLY_AGENTS_RATIONALE keys (no orphan entries either way)", () => {
    // Slice 6 invariant: a carve-out without a documented rationale is a
    // silent drift bug. The Set is constructed from the Record's keys, so
    // this test pins both directions: every Set member has a rationale, and
    // every rationale has a Set entry.
    expect(new Set(AGENTBREW_ONLY_AGENTS)).toEqual(new Set(Object.keys(AGENTBREW_ONLY_AGENTS_RATIONALE)));
  });
});

describe("AGENTBREW_ONLY_AGENTS_RATIONALE", () => {
  it("has a rationale for each AGENTBREW_ONLY_SKILLS_CLI_AGENTS entry", () => {
    expect(Object.keys(AGENTBREW_ONLY_AGENTS_RATIONALE).sort()).toEqual(["claude-desktop", "qodo"]);
  });

  it("every rationale is a non-empty single-sentence string", () => {
    for (const [agent, reason] of Object.entries(AGENTBREW_ONLY_AGENTS_RATIONALE)) {
      expect(reason, `rationale for ${agent} is empty`).toBeTruthy();
      expect(reason.length, `rationale for ${agent} is too short`).toBeGreaterThan(20);
      // Single sentence in user-facing CLI warning context: keep it ≤ 200
      // chars so it fits on one terminal line under realistic widths.
      expect(reason.length, `rationale for ${agent} is too long for a one-line CLI warning`).toBeLessThanOrEqual(200);
    }
  });

  it("each rationale names skills CLI specifically (or explains the organization-internal scope)", () => {
    // The rationale must reference the upstream tool by name OR explain why
    // the agent is out-of-scope for an upstream-general tool. This pins the
    // doc shape — a future "claude-desktop: legacy" one-word entry would
    // fail the test.
    for (const [agent, reason] of Object.entries(AGENTBREW_ONLY_AGENTS_RATIONALE)) {
      const mentionsSkillsCli = /skills\s*CLI/i.test(reason);
      const mentionsOrganizationInternal = /organization/i.test(reason);
      expect(
        mentionsSkillsCli || mentionsOrganizationInternal,
        `rationale for ${agent} should reference 'skills CLI' or 'organization'`,
      ).toBe(true);
    }
  });

  it("is frozen (immutable) at runtime", () => {
    expect(Object.isFrozen(AGENTBREW_ONLY_AGENTS_RATIONALE)).toBe(true);
  });
});

describe("toSkillsCliAgent", () => {
  it("translates the rename pairs", () => {
    expect(toSkillsCliAgent("copilot")).toBe("github-copilot");
    expect(toSkillsCliAgent("kiro")).toBe("kiro-cli");
    expect(toSkillsCliAgent("roo-code")).toBe("roo");
  });

  it("returns null for agentbrew-only agents (carve-outs)", () => {
    expect(toSkillsCliAgent("claude-desktop")).toBeNull();
  });

  it("passes through intersection agents unchanged", () => {
    expect(toSkillsCliAgent("claude-code")).toBe("claude-code");
    expect(toSkillsCliAgent("cursor")).toBe("cursor");
    expect(toSkillsCliAgent("windsurf")).toBe("windsurf");
    expect(toSkillsCliAgent("amp")).toBe("amp");
    expect(toSkillsCliAgent("goose")).toBe("goose");
    expect(toSkillsCliAgent("bob")).toBe("bob"); // absorbed 2026-04-24
    expect(toSkillsCliAgent("deepagents")).toBe("deepagents");
    expect(toSkillsCliAgent("devin")).toBe("devin");
    expect(toSkillsCliAgent("firebender")).toBe("firebender");
  });

  it("passes unknown names through unchanged (caller validates)", () => {
    expect(toSkillsCliAgent("nonexistent-agent")).toBe("nonexistent-agent");
  });

  it("never throws for any agentbrew canonical name", () => {
    const defs = loadAgentDefinitions();
    for (const d of defs) {
      expect(() => toSkillsCliAgent(d.name)).not.toThrow();
    }
  });
});

describe("buildSkillsCliAgentArgs", () => {
  describe('"all" mode', () => {
    it("emits the wildcard form preserving historical delegateRemoteSkill behaviour", () => {
      // The current `delegateRemoteSkill` call site passes `"all"`. This test
      // pins the wildcard form so a future refactor can't accidentally flip
      // the dispatcher to per-agent install without updating this test.
      expect(buildSkillsCliAgentArgs("all")).toEqual({ args: ["--agent", "*"], carveOuts: [] });
    });
  });

  describe("rename-not-required path (intersection agents)", () => {
    it("emits one --agent <name> pair per intersection agent, names unchanged", () => {
      // `claude-code` and `cursor` are in the name-overlap; no
      // translation needed.
      expect(buildSkillsCliAgentArgs(["claude-code", "cursor"])).toEqual({
        args: ["--agent", "claude-code", "--agent", "cursor"],
        carveOuts: [],
      });
    });

    it("preserves order of input agents in the emitted args", () => {
      expect(buildSkillsCliAgentArgs(["windsurf", "amp", "goose"])).toEqual({
        args: ["--agent", "windsurf", "--agent", "amp", "--agent", "goose"],
        carveOuts: [],
      });
    });

    it("returns empty args for an empty input list (no-op invocation)", () => {
      expect(buildSkillsCliAgentArgs([])).toEqual({ args: [], carveOuts: [] });
    });
  });

  describe("rename-required path", () => {
    it("translates each of the rename pairs at the boundary", () => {
      expect(buildSkillsCliAgentArgs(["copilot", "kiro", "roo-code"])).toEqual({
        args: ["--agent", "github-copilot", "--agent", "kiro-cli", "--agent", "roo"],
        carveOuts: [],
      });
    });

    it("translates a single rename pair without affecting other args", () => {
      expect(buildSkillsCliAgentArgs(["copilot"])).toEqual({
        args: ["--agent", "github-copilot"],
        carveOuts: [],
      });
    });
  });

  describe("carve-out path", () => {
    it("skips agentbrew-only agents and reports them in carveOuts", () => {
      // `claude-desktop` (AGENTBREW_ONLY_AGENTS) has no skills CLI equivalent —
      // caller must route it to native install.
      expect(buildSkillsCliAgentArgs(["claude-desktop", "devin"])).toEqual({
        args: ["--agent", "devin"],
        carveOuts: ["claude-desktop"],
      });
    });
  });

  describe("mixed list (intersection + rename + carve-out)", () => {
    it("translates renames, passes intersection agents through, and reports carve-outs separately", () => {
      // This is the slice-3-onward shape: a real detection set will mix
      // all three classes. The helper must handle them in one pass.
      expect(buildSkillsCliAgentArgs(["claude-code", "copilot", "claude-desktop", "kiro", "windsurf"])).toEqual({
        args: ["--agent", "claude-code", "--agent", "github-copilot", "--agent", "kiro-cli", "--agent", "windsurf"],
        carveOuts: ["claude-desktop"],
      });
    });

    it("preserves carve-out order in the carveOuts array", () => {
      expect(buildSkillsCliAgentArgs(["claude-desktop", "claude-code", "devin"])).toEqual({
        args: ["--agent", "claude-code", "--agent", "devin"],
        carveOuts: ["claude-desktop"],
      });
    });
  });
});

describe("coverage invariant — every agent in agents.yaml is classified", () => {
  it("every loaded agent is either in skills CLI intersection, a rename, or a carve-out", () => {
    // Skills CLI's AgentType union as of 2026-05-02 (mirror in test; source-of-truth is the live vercel-labs/skills repo)
    const skillsCliAgents = new Set([
      "adal",
      "aider-desk",
      "amp",
      "antigravity",
      "augment",
      "bob",
      "claude-code",
      "cline",
      "codearts-agent",
      "codebuddy",
      "codemaker",
      "codestudio",
      "codex",
      "command-code",
      "continue",
      "cortex",
      "crush",
      "cursor",
      "deepagents",
      "devin",
      "dexto",
      "droid",
      "firebender",
      "forgecode",
      "gemini-cli",
      "github-copilot",
      "goose",
      "iflow-cli",
      "junie",
      "kilo",
      "kimi-cli",
      "kiro-cli",
      "kode",
      "mcpjam",
      "mistral-vibe",
      "mux",
      "neovate",
      "openclaw",
      "opencode",
      "openhands",
      "pi",
      "pochi",
      "qoder",
      "qwen-code",
      "replit",
      "roo",
      "rovodev",
      "tabnine-cli",
      "trae",
      "trae-cn",
      "universal",
      "warp",
      "windsurf",
      "zencoder",
    ]);

    const defs = loadAgentDefinitions();
    const unclassified: string[] = [];
    for (const d of defs) {
      const remapped = toSkillsCliAgent(d.name);
      const isCarveOut = remapped === null;
      const isIntersection = remapped !== null && skillsCliAgents.has(remapped);
      if (!isCarveOut && !isIntersection) {
        unclassified.push(d.name);
      }
    }
    expect(unclassified).toEqual([]);
  });
});
