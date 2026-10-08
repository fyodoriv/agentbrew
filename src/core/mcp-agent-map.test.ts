import { describe, expect, it, vi } from "vitest";
import { loadAgentDefinitions } from "./agents.js";
import {
  AGENTBREW_ONLY_MCP_AGENTS,
  AGENTBREW_ONLY_MCP_RATIONALE,
  AGENTBREW_TO_MCPM,
  buildMcpmClientList,
  toMcpmClient,
} from "./mcp-agent-map.js";

vi.mock("../state.js", () => ({
  loadState: () => ({ agents: [], team: undefined }),
}));

describe("AGENTBREW_TO_MCPM", () => {
  it("matches AGENTBREW_TO_MCPM rename entries", () => {
    expect(Object.keys(AGENTBREW_TO_MCPM).sort()).toEqual(["codex", "goose"]);
  });

  it("maps agentbrew names to mcpm names per the 2026-04-26 measurement", () => {
    expect(AGENTBREW_TO_MCPM.codex).toBe("codex-cli");
    expect(AGENTBREW_TO_MCPM.goose).toBe("goose-cli");
  });

  it("is frozen (immutable) at runtime", () => {
    expect(Object.isFrozen(AGENTBREW_TO_MCPM)).toBe(true);
  });
});

describe("AGENTBREW_ONLY_MCP_AGENTS", () => {
  it("matches AGENTBREW_ONLY_MCP_AGENTS", () => {
    expect(new Set(AGENTBREW_ONLY_MCP_AGENTS)).toEqual(new Set(["copilot", "opencode", "kiro", "amp", "cursor"]));
  });

  it("every carve-out exists in agents.yaml", () => {
    const defs = loadAgentDefinitions();
    const names = new Set(defs.map((d) => d.name));
    for (const carveOut of AGENTBREW_ONLY_MCP_AGENTS) {
      expect(names.has(carveOut), `carve-out ${carveOut} should exist in agents.yaml`).toBe(true);
    }
  });

  it("is derived from AGENTBREW_ONLY_MCP_RATIONALE keys (no orphan entries either way)", () => {
    // Same invariant as the skills CLI map: a carve-out without a documented
    // rationale is a silent drift bug. The Set is constructed from the
    // Record's keys, so this test pins both directions.
    expect(new Set(AGENTBREW_ONLY_MCP_AGENTS)).toEqual(new Set(Object.keys(AGENTBREW_ONLY_MCP_RATIONALE)));
  });
});

describe("AGENTBREW_ONLY_MCP_RATIONALE", () => {
  it("has a rationale for each AGENTBREW_ONLY_MCP_AGENTS entry", () => {
    expect(Object.keys(AGENTBREW_ONLY_MCP_RATIONALE).sort()).toEqual(["amp", "copilot", "cursor", "kiro", "opencode"]);
  });

  it("every rationale is a non-empty single-sentence string", () => {
    for (const [agent, reason] of Object.entries(AGENTBREW_ONLY_MCP_RATIONALE)) {
      expect(reason, `rationale for ${agent} is empty`).toBeTruthy();
      expect(reason.length, `rationale for ${agent} is too short`).toBeGreaterThan(20);
      // Single sentence in user-facing CLI warning context: keep it ≤ 200
      // chars so it fits on one terminal line under realistic widths.
      expect(reason.length, `rationale for ${agent} is too long for a one-line CLI warning`).toBeLessThanOrEqual(200);
    }
  });

  it("each rationale names mcpm specifically (or explains the organization-internal scope)", () => {
    // The rationale must reference the upstream tool by name OR explain why
    // the agent is out-of-scope for an upstream-general tool. Pins the doc
    // shape — a future "kiro: legacy" one-word entry would fail the test.
    for (const [agent, reason] of Object.entries(AGENTBREW_ONLY_MCP_RATIONALE)) {
      const mentionsMcpm = /mcpm/i.test(reason);
      const mentionsOrganizationInternal = /organization/i.test(reason);
      expect(
        mentionsMcpm || mentionsOrganizationInternal,
        `rationale for ${agent} should reference 'mcpm' or 'organization'`,
      ).toBe(true);
    }
  });

  it("is frozen (immutable) at runtime", () => {
    expect(Object.isFrozen(AGENTBREW_ONLY_MCP_RATIONALE)).toBe(true);
  });
});

describe("toMcpmClient", () => {
  it("translates the rename pairs", () => {
    expect(toMcpmClient("codex")).toBe("codex-cli");
    expect(toMcpmClient("goose")).toBe("goose-cli");
  });

  it("returns null for agentbrew-only agents (carve-outs)", () => {
    expect(toMcpmClient("copilot")).toBeNull();
    expect(toMcpmClient("opencode")).toBeNull();
    expect(toMcpmClient("kiro")).toBeNull();
    expect(toMcpmClient("amp")).toBeNull();
    expect(toMcpmClient("cursor")).toBeNull();
  });

  it("passes through intersection agents unchanged", () => {
    expect(toMcpmClient("claude-code")).toBe("claude-code");
    expect(toMcpmClient("claude-desktop")).toBe("claude-desktop");
    expect(toMcpmClient("gemini-cli")).toBe("gemini-cli");
    expect(toMcpmClient("cline")).toBe("cline");
    expect(toMcpmClient("roo-code")).toBe("roo-code");
  });

  it("passes unknown names through unchanged (caller validates)", () => {
    expect(toMcpmClient("nonexistent-agent")).toBe("nonexistent-agent");
  });

  it("never throws for any agentbrew canonical name", () => {
    const defs = loadAgentDefinitions();
    for (const d of defs) {
      expect(() => toMcpmClient(d.name)).not.toThrow();
    }
  });
});

describe("buildMcpmClientList", () => {
  describe('"all" mode', () => {
    it("emits the wildcard form", () => {
      // Same shape as buildSkillsCliAgentArgs("all") — the wildcard is
      // opaque to the dispatcher; carve-outs are not reported in this mode.
      expect(buildMcpmClientList("all")).toEqual({ clients: ["*"], carveOuts: [] });
    });
  });

  describe("rename-not-required path (intersection agents)", () => {
    it("emits one client name per intersection agent, names unchanged", () => {
      expect(buildMcpmClientList(["claude-code", "claude-desktop"])).toEqual({
        clients: ["claude-code", "claude-desktop"],
        carveOuts: [],
      });
    });

    it("preserves order of input agents in the emitted clients list", () => {
      expect(buildMcpmClientList(["gemini-cli", "cline", "roo-code"])).toEqual({
        clients: ["gemini-cli", "cline", "roo-code"],
        carveOuts: [],
      });
    });

    it("returns empty clients for an empty input list (no-op invocation)", () => {
      expect(buildMcpmClientList([])).toEqual({ clients: [], carveOuts: [] });
    });
  });

  describe("rename-required path", () => {
    it("translates each of the rename pairs at the boundary", () => {
      expect(buildMcpmClientList(["codex", "goose"])).toEqual({
        clients: ["codex-cli", "goose-cli"],
        carveOuts: [],
      });
    });

    it("translates a single rename pair without affecting other clients", () => {
      expect(buildMcpmClientList(["codex"])).toEqual({
        clients: ["codex-cli"],
        carveOuts: [],
      });
    });
  });

  describe("carve-out path", () => {
    it("skips agentbrew-only agents and reports them in carveOuts", () => {
      // The carve-outs (copilot, opencode, kiro, amp,
      // cursor) have no mcpm-delegated write — caller routes them to native.
      expect(buildMcpmClientList(["copilot", "opencode", "kiro", "amp", "cursor"])).toEqual({
        clients: [],
        carveOuts: ["copilot", "opencode", "kiro", "amp", "cursor"],
      });
    });
  });

  describe("mixed list (intersection + rename + carve-out)", () => {
    it("translates renames, passes intersection agents through, and reports carve-outs separately", () => {
      // Mixed AGENTBREW_ONLY_MCP_AGENTS + MCP_INTERSECTION_AGENTS + rename inputs.
      // The helper handles all three
      // classes in one pass.
      expect(
        buildMcpmClientList([
          "claude-code",
          "claude-desktop",
          "cursor",
          "codex",
          "gemini-cli",
          "goose",
          "cline",
          "roo-code",
          "copilot",
          "opencode",
          "kiro",
          "amp",
        ]),
      ).toEqual({
        clients: ["claude-code", "claude-desktop", "codex-cli", "gemini-cli", "goose-cli", "cline", "roo-code"],
        carveOuts: ["cursor", "copilot", "opencode", "kiro", "amp"],
      });
    });

    it("preserves carve-out order in the carveOuts array", () => {
      expect(buildMcpmClientList(["kiro", "claude-code", "copilot"])).toEqual({
        clients: ["claude-code"],
        carveOuts: ["kiro", "copilot"],
      });
    });
  });
});

describe("coverage invariant — every MCP-capable agent in agents.yaml is classified", () => {
  it("every loaded MCP-capable agent is either in mcpm intersection, a rename, or a carve-out", () => {
    // mcpm's supported clients as of 2026-04-26 (`mcpm client ls`).
    // Mirror in test; source-of-truth is the live mcpm registry.
    const mcpmClients = new Set([
      "claude-code",
      "claude-desktop",
      "cline",
      "continue",
      "cursor",
      "codex-cli",
      "goose-cli",
      "gemini-cli",
      "vscode",
      "5ire",
      "qwen-cli",
      "roo-code",
      "trae",
      "windsurf",
    ]);

    const defs = loadAgentDefinitions();
    // Filter to MCP-capable agents only. `loadAgentDefinitions()` collapses
    // all three input shapes (`mcpConfig`, `mcpConfigVscodeExt`,
    // `mcpConfigVscodeSettings`) into the resolved `mcpConfig` string field
    // on the loaded AgentConfig — so a single `d.mcpConfig !== undefined`
    // check covers all three cases.
    const mcpCapable = defs.filter((d) => d.mcpConfig !== undefined);

    const unclassified: string[] = [];
    for (const d of mcpCapable) {
      const remapped = toMcpmClient(d.name);
      const isCarveOut = remapped === null;
      const isIntersection = remapped !== null && mcpmClients.has(remapped);
      if (!isCarveOut && !isIntersection) {
        unclassified.push(d.name);
      }
    }
    expect(unclassified).toEqual([]);
  });
});

describe("primary-agent shared-memory transport parity", () => {
  const primaryAgents = ["claude-code", "cursor", "codex"];

  it("routes every primary agent through either mcpm or a native MCP config writer", () => {
    const definitions = loadAgentDefinitions();
    for (const name of primaryAgents) {
      expect(
        definitions.find((definition) => definition.name === name)?.mcpConfig,
        `${name} needs MCP transport`,
      ).toBeTruthy();
    }

    const transport = buildMcpmClientList(primaryAgents);
    expect(transport.clients).toEqual(["claude-code", "codex-cli"]);
    expect(transport.carveOuts).toEqual(["cursor"]);
  });
});
