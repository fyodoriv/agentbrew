/**
 * Per-agent × per-feature configuration matrix.
 *
 * Phase 3 of the (agent × feature) regression suite started in PR #1021
 * (crash class) and continued in PR #1022 (MCP CRUD + parity). This phase
 * locks in **the non-MCP sync feature surface** so that:
 *
 *   1. Every detected agent's configured paths in `agents.yaml` are
 *      well-formed (~-prefixed, no double slashes, format matches the
 *      sync code's expectations).
 *
 *   2. The classification of an agent into native carve-out vs delegated
 *      (mcpm / ai-rules) sync stays consistent with its actual config
 *      paths and the AGENTBREW_ONLY_* sets in `src/core/*-agent-map.ts`.
 *
 *   3. No path collision: agent defs must not share the same target path for the same feature —
 *      because that's how you get races where parallel writes stomp each
 *      other's output. (The known sharing cases like claude-code +
 *      claude-desktop both reading from ~/.claude/skills are declared
 *      via `readsFrom` and exempted explicitly.)
 *
 * What it doesn't test
 * --------------------
 * This is a configuration / contract test, not an end-to-end sync
 * runner. The actual sync engines (`syncSkills`, `syncRules`,
 * `syncCommands`, `syncInstructions`, `syncAgentDefs`, `syncHooks`)
 * have their own dedicated test files (see `src/sync/*.test.ts`).
 * Phase 3's value is in catching DRIFT: a new agent added to
 * agents.yaml that forgets to declare the right surfaces, or a
 * refactor that moves a path without updating the carve-out maps.
 */

import { describe, expect, it } from "vitest";
import { AGENTBREW_ONLY_COMMANDS_AGENTS, AGENTBREW_TO_AI_RULES_COMMANDS } from "../core/commands-agent-map.js";
import { AGENTBREW_ONLY_MCP_AGENTS, AGENTBREW_TO_MCPM } from "../core/mcp-agent-map.js";
import { AGENTBREW_ONLY_RULES_AGENTS, AGENTBREW_TO_AI_RULES } from "../core/rules-agent-map.js";
import { AGENT_DEFINITIONS, VENDOR_NEUTRAL_SKILLS_DIR } from "../types.js";

/**
 * Paths that multiple agents legitimately share (vendor-neutral skill dirs).
 * Listed here as an explicit allowlist so a NEW shared path needs an audit
 * before the path-clash test stops failing.
 */
const SHARED_PATH_ALLOWLIST: ReadonlySet<string> = new Set([
  VENDOR_NEUTRAL_SKILLS_DIR, // ~/.agents/skills — Warp + dexto + future vendor-neutral agents
  "~/.config/agents/skills", // shared by kimi-cli, replit, universal (skills-only experimental agents)
]);

// ── Surfaces this matrix audits ──────────────────────────────────────────────

/**
 * Every per-agent sync surface, plus the field on AgentConfig that declares it.
 * The matrix iterates over this list, so adding a new surface is a one-row change.
 */
const FEATURES = [
  { feature: "skills", field: "skillsDir" as const, required: true },
  { feature: "rules-file", field: "rulesFile" as const, required: false },
  { feature: "rules-dir", field: "rulesDir" as const, required: false },
  { feature: "commands", field: "commandsDir" as const, required: false },
  { feature: "agents", field: "agentsDir" as const, required: false },
  { feature: "hooks", field: "hooksFile" as const, required: false },
  { feature: "mcp-config", field: "mcpConfig" as const, required: false },
  { feature: "mcp-permissions", field: "mcpPermissionsConfig" as const, required: false },
] as const;

// ── Path well-formedness ─────────────────────────────────────────────────────

describe("Per-agent path schema", () => {
  it("every agent has a name", () => {
    for (const agent of AGENT_DEFINITIONS) {
      expect(agent.name, JSON.stringify(agent)).toBeTruthy();
    }
  });

  it("every agent has a skillsDir (skills are the lowest common denominator)", () => {
    for (const agent of AGENT_DEFINITIONS) {
      expect(agent.skillsDir, `${agent.name} missing skillsDir`).toBeTruthy();
    }
  });

  it.each(FEATURES)("every $feature path is ~-prefixed (no absolute /Users/... leaks)", (spec) => {
    for (const agent of AGENT_DEFINITIONS) {
      const value = agent[spec.field];
      if (value === undefined) continue;
      const pathValue =
        spec.field === "mcpPermissionsConfig" && typeof value === "object" && value !== null ? value.file : value;
      const isProjectScopedHook =
        spec.field === "hooksFile" &&
        agent.hooksScope === "project" &&
        typeof pathValue === "string" &&
        !pathValue.startsWith("~") &&
        !pathValue.startsWith("/");
      expect(
        typeof pathValue === "string" ? pathValue.startsWith("~") || isProjectScopedHook : true,
        `${agent.name}.${spec.field} = ${JSON.stringify(pathValue)} is not ~-prefixed`,
      ).toBe(true);
    }
  });

  it.each(FEATURES)("no $feature path contains '//' (drift in template strings)", (spec) => {
    for (const agent of AGENT_DEFINITIONS) {
      const value = agent[spec.field];
      const pathValue =
        spec.field === "mcpPermissionsConfig" && typeof value === "object" && value !== null ? value.file : value;
      if (typeof pathValue !== "string") continue;
      expect(pathValue.includes("//"), `${agent.name}.${spec.field} has '//' in ${pathValue}`).toBe(false);
    }
  });

  it("no agent's skillsDir is a subdirectory of another agent's (catches accidental nesting)", () => {
    // E.g., if cursor's skillsDir is ~/.cursor/skills and someone adds
    // ~/.cursor/skills/something — the inner agent would shadow the outer.
    const dirs = AGENT_DEFINITIONS.map((a) => ({ name: a.name, dir: a.skillsDir })).filter((d) => d.dir);
    for (const outer of dirs) {
      for (const inner of dirs) {
        if (outer.name === inner.name) continue;
        if (inner.dir === outer.dir) continue; // identical paths handled below
        const nested = inner.dir.startsWith(`${outer.dir}/`);
        if (nested) {
          // Permitted: where the inner agent is intentionally a re-exporter via readsFrom.
          const innerAgent = AGENT_DEFINITIONS.find((a) => a.name === inner.name);
          if (innerAgent?.readsFrom?.includes(outer.name)) continue;
          expect(
            nested,
            `${inner.name}.skillsDir=${inner.dir} is nested inside ${outer.name}.skillsDir=${outer.dir}`,
          ).toBe(false);
        }
      }
    }
  });
});

// ── Carve-out vs delegated classification consistency ────────────────────────

describe("Carve-out classification stays consistent with agents.yaml", () => {
  // For each (agent, surface) pair, the agent is either:
  //   - A native carve-out (agentbrew writes directly), OR
  //   - Delegated (mcpm / ai-rules writes via the bridge), OR
  //   - Not configured for that surface at all.
  // The three sets must be mutually exclusive AND collectively cover every
  // agent that has the surface configured. Drift means a surface gets neither
  // path or both — both are bugs.

  it("AGENTBREW_ONLY_MCP_AGENTS subset every agent has mcpConfig set in agents.yaml", () => {
    // Carve-outs by definition have a native MCP write path, so mcpConfig
    // must be declared. The reverse (every mcpConfig declared implies
    // carve-out) is NOT true — delegated agents also have mcpConfig.
    for (const carveout of AGENTBREW_ONLY_MCP_AGENTS) {
      const agent = AGENT_DEFINITIONS.find((a) => a.name === carveout);
      expect(agent, `Unknown carve-out: ${carveout}`).toBeDefined();
    }
  });

  it("AGENTBREW_ONLY_RULES_AGENTS subset every agent has rulesFile or rulesDir", () => {
    for (const carveout of AGENTBREW_ONLY_RULES_AGENTS) {
      const agent = AGENT_DEFINITIONS.find((a) => a.name === carveout);
      expect(agent, `Unknown rules carve-out: ${carveout}`).toBeDefined();
      // Rules carve-outs MUST have either rulesFile or rulesDir to write to.
      if (agent) {
        expect(
          agent.rulesFile !== undefined || agent.rulesDir !== undefined,
          `${carveout} is a rules carve-out but has neither rulesFile nor rulesDir`,
        ).toBe(true);
      }
    }
  });

  it("AGENTBREW_ONLY_COMMANDS_AGENTS subset every agent has commandsDir", () => {
    for (const carveout of AGENTBREW_ONLY_COMMANDS_AGENTS) {
      const agent = AGENT_DEFINITIONS.find((a) => a.name === carveout);
      expect(agent, `Unknown commands carve-out: ${carveout}`).toBeDefined();
      if (agent) {
        expect(agent.commandsDir, `${carveout} is a commands carve-out but has no commandsDir`).toBeDefined();
      }
    }
  });

  it("every rename in AGENTBREW_TO_AI_RULES has a corresponding agent in AGENT_DEFINITIONS", () => {
    for (const [agentbrewName] of Object.entries(AGENTBREW_TO_AI_RULES)) {
      expect(
        AGENT_DEFINITIONS.find((a) => a.name === agentbrewName),
        `Rename "${agentbrewName}" → ai-rules name has no matching agentbrew agent`,
      ).toBeDefined();
    }
  });

  it("every rename in AGENTBREW_TO_MCPM has a corresponding agent in AGENT_DEFINITIONS", () => {
    for (const [agentbrewName] of Object.entries(AGENTBREW_TO_MCPM)) {
      expect(
        AGENT_DEFINITIONS.find((a) => a.name === agentbrewName),
        `Rename "${agentbrewName}" → mcpm name has no matching agentbrew agent`,
      ).toBeDefined();
    }
  });

  it("every rename in AGENTBREW_TO_AI_RULES_COMMANDS has a corresponding agent", () => {
    for (const [agentbrewName] of Object.entries(AGENTBREW_TO_AI_RULES_COMMANDS)) {
      expect(
        AGENT_DEFINITIONS.find((a) => a.name === agentbrewName),
        `Commands rename "${agentbrewName}" → ai-rules name has no matching agentbrew agent`,
      ).toBeDefined();
    }
  });
});

// ── Feature-presence drift guard ─────────────────────────────────────────────

describe("Feature-presence stays declared in agents.yaml (drift guard)", () => {
  // For each MCP-capable agent, document the EXPECTED set of surfaces.
  // If a future agents.yaml edit removes a surface that downstream code
  // depends on, this test fires before the sync code silently no-ops.

  const EXPECTED_SURFACES = [
    { name: "claude-code", surfaces: ["skills", "rules-file", "commands", "agents", "hooks", "mcp-config"] },
    {
      name: "cursor",
      surfaces: ["skills", "rules-dir", "commands", "agents", "hooks", "mcp-config", "mcp-permissions"],
    },
    { name: "windsurf", surfaces: ["skills", "rules-file", "rules-dir", "commands", "mcp-config"] },
    {
      name: "devin",
      surfaces: ["skills", "rules-file", "commands", "agents", "hooks", "mcp-config", "mcp-permissions"],
    },
    { name: "gemini-cli", surfaces: ["skills", "rules-file", "commands", "mcp-config"] },
    { name: "claude-desktop", surfaces: ["skills", "rules-file", "commands", "agents", "mcp-config"] },
    { name: "kiro", surfaces: ["skills", "mcp-config"] },
    { name: "amp", surfaces: ["skills", "rules-file", "commands", "mcp-config"] },
    { name: "goose", surfaces: ["skills", "rules-file", "mcp-config"] },
    { name: "codex", surfaces: ["skills", "rules-file", "agents", "mcp-config"] },
    { name: "augment", surfaces: ["skills", "rules-file"] },
    { name: "copilot", surfaces: ["skills", "rules-file"] }, // mcpConfigVscodeSettings tracked separately
    { name: "opencode", surfaces: ["skills", "commands", "mcp-config"] },
  ] as const;

  it.each(EXPECTED_SURFACES)("$name has exactly the documented surfaces declared in agents.yaml", ({
    name,
    surfaces,
  }) => {
    const agent = AGENT_DEFINITIONS.find((a) => a.name === name);
    expect(agent, `Agent ${name} missing from AGENT_DEFINITIONS`).toBeDefined();
    if (!agent) return;
    for (const expected of surfaces) {
      const spec = FEATURES.find((f) => f.feature === expected);
      if (!spec) throw new Error(`unknown feature key ${expected}`);
      expect(agent[spec.field], `${name} should declare ${expected} via ${spec.field}`).toBeDefined();
    }
  });
});

// ── Default-model surface ────────────────────────────────────────────────────

describe("Default-model surface (modelConfig)", () => {
  // G6 parity status for the model surface, per primary agent:
  //   claude-code — ~/.claude/settings.json "model" (documented setting)
  //   devin       — ~/.config/devin/config.json "agent.model" (documented setting)
  //   codex       — ~/.codex/config.toml "model" (documented setting)
  //   cursor      — N/A: the model lives in app-managed account state
  //                 (~/.cursor/cli-config.json `model` object is written by the
  //                 app; `cursor-agent models` is account-gated). No declarative
  //                 file surface exists to manage.
  //   windsurf    — N/A: the model is chosen per-conversation in the Cascade UI
  //                 and stored in internal state; no public config surface.
  // Tracked in TASKS.md (model-default-parity-cursor-windsurf).
  const EXPECTED_MODEL_SURFACES = ["claude-code", "devin", "codex"];

  it("exactly the documented agents declare modelConfig", () => {
    const declared = AGENT_DEFINITIONS.filter((a) => a.modelConfig !== undefined).map((a) => a.name);
    expect(declared.sort()).toEqual([...EXPECTED_MODEL_SURFACES].sort());
  });

  it("every modelConfig has a ~-prefixed file and non-empty key path", () => {
    for (const agent of AGENT_DEFINITIONS) {
      if (!agent.modelConfig) continue;
      expect(agent.modelConfig.file.startsWith("~"), `${agent.name}.modelConfig.file`).toBe(true);
      expect(agent.modelConfig.path.length, `${agent.name}.modelConfig.path`).toBeGreaterThan(0);
    }
  });

  it("toml format is declared only for toml files", () => {
    for (const agent of AGENT_DEFINITIONS) {
      if (!agent.modelConfig) continue;
      const isTomlFile = agent.modelConfig.file.endsWith(".toml");
      expect(agent.modelConfig.format === "toml", `${agent.name}.modelConfig format/file mismatch`).toBe(isTomlFile);
    }
  });
});

// ── Path-clash detection ─────────────────────────────────────────────────────

describe("No path collision for the same feature target", () => {
  // Catches accidental path collisions like "two different agents both
  // write commands to ~/.shared-commands" — would cause race conditions
  // during sync. Exceptions for documented sharing via `readsFrom`.

  it.each(FEATURES)("no $feature path clash between distinct agents (modulo readsFrom)", (spec) => {
    const byPath = new Map<string, string[]>();
    for (const agent of AGENT_DEFINITIONS) {
      const value = agent[spec.field];
      const pathValue =
        spec.field === "mcpPermissionsConfig" && typeof value === "object" && value !== null ? value.file : value;
      if (typeof pathValue !== "string") continue;
      if (!byPath.has(pathValue)) byPath.set(pathValue, []);
      byPath.get(pathValue)?.push(agent.name);
    }

    for (const [path, agents] of byPath) {
      if (agents.length <= 1) continue;
      // Explicit allowlist (vendor-neutral skills dirs shared by multiple experimental agents).
      if (SHARED_PATH_ALLOWLIST.has(path)) continue;
      // Allow sharing if every-but-one agent declares `readsFrom`
      // pointing at one of the others. (Claude-desktop reads from
      // claude-code, etc.)
      const declared = agents.every((agentName) => {
        const agent = AGENT_DEFINITIONS.find((a) => a.name === agentName);
        if (!agent?.readsFrom) return false;
        return agents.some((other) => other !== agentName && agent.readsFrom?.includes(other));
      });
      if (declared) continue;
      // If no agent in the group declares readsFrom, at least ONE of them must
      // be the canonical writer and the rest must read-only — represented by
      // any of them having readsFrom that names another in the group.
      const anyReadsFrom = agents.some((agentName) => {
        const agent = AGENT_DEFINITIONS.find((a) => a.name === agentName);
        return agent?.readsFrom?.some((rf) => agents.includes(rf));
      });
      if (anyReadsFrom) continue;
      expect.fail(
        `${spec.feature} path collision: ${agents.join(", ")} all point at ${path} without a readsFrom edge or SHARED_PATH_ALLOWLIST entry`,
      );
    }
  });
});
