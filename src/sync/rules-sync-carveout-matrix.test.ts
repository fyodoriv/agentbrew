import { describe, expect, it } from "vitest";
import { AGENTBREW_ONLY_RULES_AGENTS } from "../core/rules-agent-map.js";
import { AGENT_DEFINITIONS, type AgentConfig } from "../types.js";
import { CANARY_DELEGATED_AGENTS } from "./rules-sync.js";

/**
 * Per-agent carve-out × delegated matrix tests for rules sync.
 *
 * Sister to `src/sync/mcp-sync-carveout-matrix.test.ts` (PR #1078). Same
 * pattern: locks in the metadata invariants that define which agents get
 * native rules writes (carve-outs) vs which get ai-rules delegation
 * (CANARY_DELEGATED_AGENTS).
 *
 * The 36K-LOC `rules-sync.test.ts` extensively covers per-rule SYNC behavior
 * (merged content, replaceManagedSection, dedup, drift detection). This file
 * is the orthogonal lock: per-AGENT METADATA correctness, so a future change
 * that flips an agent's rulesFile / rulesDir or moves an agent across the
 * delegation boundary fails loudly here even when the integration tests pass.
 *
 * Surfaced 2026-05-25 ecosystem audit (subagent report § "Test Coverage Holes").
 * Membership is pinned by `CARVEOUT_MATRIX` / `DELEGATED_MATRIX` below and must
 * stay aligned with {@link AGENTBREW_ONLY_RULES_AGENTS} and
 * `CANARY_DELEGATED_AGENTS` in `rules-sync.ts`.
 */

/**
 * Helper: look up an agent's static def from AGENT_DEFINITIONS.
 *
 * AGENT_DEFINITIONS is typed `Omit<AgentConfig, "detected">[]` — `detected`
 * is populated at agentbrew runtime by `detectInstalledAgents`, not at
 * static-config load time. Preserves that omission so the matrix doesn't
 * accidentally assert against a runtime-only field.
 */
function defOf(name: string): Omit<AgentConfig, "detected"> {
  const def = AGENT_DEFINITIONS.find((a) => a.name === name);
  if (!def) {
    throw new Error(`Agent '${name}' not found in AGENT_DEFINITIONS. The matrix below is stale.`);
  }
  return def;
}

// ── Carve-out matrix (native rules write target) ──────────────────────────
//
// Each row pins (a) the expected rulesFile and/or rulesDir paths, (b) the
// classification (in AGENTBREW_ONLY_RULES_AGENTS, NOT in CANARY_DELEGATED_AGENTS).
// A carve-out that drifts on either path silently breaks rules sync for that
// agent — this matrix is the regression fence.

interface CarveoutRow {
  /** Agent name as it appears in agents.yaml + AGENT_DEFINITIONS. */
  name: string;
  /**
   * Expected rulesFile (tilde-prefixed). `undefined` when the agent
   * doesn't use a single-file rules surface (e.g. cursor uses rulesDir only).
   */
  expectedRulesFile?: string;
  /**
   * Expected rulesDir (tilde-prefixed). `undefined` when the agent
   * doesn't have a per-file rules dir (e.g. augment has only
   * a single rules file).
   */
  expectedRulesDir?: string;
}

const CARVEOUT_MATRIX: CarveoutRow[] = [
  {
    name: "augment",
    // Single-file rules surface. Native because not in ai-rules'
    // supported list (potential upstream PR — see AGENTBREW_ONLY_RULES_RATIONALE).
    expectedRulesFile: "~/.augment/guidelines.md",
  },
  {
    name: "claude-desktop",
    // Shares ~/.claude/CLAUDE.md with claude-code via the readsFrom mechanism
    // in agents.yaml. ai-rules conflates them under `claude` so claude-desktop
    // appears in AGENTBREW_ONLY_RULES_RATIONALE as a "carve-out at the
    // delegation boundary" — the actual file write happens via claude-code's
    // path. Pin both the rulesFile and the classification so a future
    // un-sharing surfaces here.
    expectedRulesFile: "~/.claude/CLAUDE.md",
  },
];

describe("Rules carve-out matrix — per-agent metadata invariants", () => {
  describe.each(CARVEOUT_MATRIX)("$name", (row) => {
    it("appears in AGENT_DEFINITIONS (sourced from agents.yaml)", () => {
      expect(() => defOf(row.name)).not.toThrow();
    });

    it(`rulesFile is ${row.expectedRulesFile ?? "(none — rulesDir-only agent)"}`, () => {
      const def = defOf(row.name);
      expect(def.rulesFile).toBe(row.expectedRulesFile);
    });

    it(`rulesDir is ${row.expectedRulesDir ?? "(none — rulesFile-only agent)"}`, () => {
      const def = defOf(row.name);
      expect(def.rulesDir).toBe(row.expectedRulesDir);
    });

    it("is classified as native carve-out (in AGENTBREW_ONLY_RULES_AGENTS, NOT in CANARY_DELEGATED_AGENTS)", () => {
      expect(AGENTBREW_ONLY_RULES_AGENTS.has(row.name)).toBe(true);
      expect(CANARY_DELEGATED_AGENTS.has(row.name)).toBe(false);
    });
  });

  it("CARVEOUT_MATRIX covers every name in AGENTBREW_ONLY_RULES_AGENTS (no carve-out goes unmatrixed)", () => {
    const matrixNames = new Set(CARVEOUT_MATRIX.map((r) => r.name));
    const missing = [...AGENTBREW_ONLY_RULES_AGENTS].filter((name) => !matrixNames.has(name));
    expect(missing).toEqual([]);
  });

  it("CARVEOUT_MATRIX has no name that isn't actually a carve-out (catches stale matrix entries)", () => {
    const stale = CARVEOUT_MATRIX.filter((r) => !AGENTBREW_ONLY_RULES_AGENTS.has(r.name)).map((r) => r.name);
    expect(stale).toEqual([]);
  });
});

// ── Delegated matrix (ai-rules-managed; native rules skips) ───────────────
//
// Each row asserts the agent IS in CANARY_DELEGATED_AGENTS (so native rules
// sync defers to ai-rules) and NOT in the carve-out set. Together with the
// carve-out matrix, this pins the delegation boundary — a single agent
// landing in BOTH (or NEITHER) is a sync bug.

interface DelegatedRow {
  /** Agent name. */
  name: string;
  /**
   * Whether this agent expects a single-file rules surface (rulesFile only)
   * or a per-file dir (rulesDir only) or both. Pinned per-row because the
   * shape varies and a structural change should surface as a focused
   * per-row failure rather than a sweeping integration regression.
   */
  shape: "rulesFile-only" | "rulesDir-only" | "both";
}

const DELEGATED_MATRIX: DelegatedRow[] = [
  // claude-code: single CLAUDE.md (no per-file dir for global rules).
  { name: "claude-code", shape: "rulesFile-only" },
  // codex: single AGENTS.md.
  { name: "codex", shape: "rulesFile-only" },
  // gemini-cli: single GEMINI.md.
  { name: "gemini-cli", shape: "rulesFile-only" },
  // cursor: rulesDir-only — Cursor IDE reads .mdc files from .cursor/rules/
  // and has no notion of a single global rules file.
  { name: "cursor", shape: "rulesDir-only" },
  // amp: single AGENTS.md.
  { name: "amp", shape: "rulesFile-only" },
  // cline: single AGENTS.md.
  { name: "cline", shape: "rulesFile-only" },
  // copilot: single AGENTS.md.
  { name: "copilot", shape: "rulesFile-only" },
  // firebender: single AGENTS.md.
  { name: "firebender", shape: "rulesFile-only" },
  // goose: single AGENTS.md.
  { name: "goose", shape: "rulesFile-only" },
  // kilo (kilocode): single AGENTS.md.
  { name: "kilo", shape: "rulesFile-only" },
  // roo-code (roo): single AGENTS.md.
  { name: "roo-code", shape: "rulesFile-only" },
];

describe("Rules delegated matrix — ai-rules-managed agents", () => {
  describe.each(DELEGATED_MATRIX)("$name", (row) => {
    it("appears in AGENT_DEFINITIONS (agents.yaml)", () => {
      expect(() => defOf(row.name)).not.toThrow();
    });

    it("is classified as ai-rules-delegated (in CANARY_DELEGATED_AGENTS, NOT in AGENTBREW_ONLY_RULES_AGENTS)", () => {
      expect(CANARY_DELEGATED_AGENTS.has(row.name)).toBe(true);
      expect(AGENTBREW_ONLY_RULES_AGENTS.has(row.name)).toBe(false);
    });

    it(`has expected rules-surface shape: ${row.shape}`, () => {
      const def = defOf(row.name);
      switch (row.shape) {
        case "rulesFile-only":
          expect(def.rulesFile).toBeDefined();
          expect(def.rulesDir).toBeUndefined();
          break;
        case "rulesDir-only":
          expect(def.rulesFile).toBeUndefined();
          expect(def.rulesDir).toBeDefined();
          break;
        case "both":
          expect(def.rulesFile).toBeDefined();
          expect(def.rulesDir).toBeDefined();
          break;
      }
    });
  });

  it("DELEGATED_MATRIX covers every name in CANARY_DELEGATED_AGENTS (no delegated agent unmatrixed)", () => {
    const matrixSet = new Set(DELEGATED_MATRIX.map((r) => r.name));
    const missing = [...CANARY_DELEGATED_AGENTS].filter((name) => !matrixSet.has(name));
    expect(missing).toEqual([]);
  });
});

// ── Boundary invariants (carve-out + delegated are disjoint, matrix-aligned) ─

describe("Rules carve-out + delegated boundary invariants", () => {
  it("the two sets are disjoint (no agent is in both)", () => {
    const overlap = [...AGENTBREW_ONLY_RULES_AGENTS].filter((name) => CANARY_DELEGATED_AGENTS.has(name));
    expect(overlap).toEqual([]);
  });

  it("AGENTBREW_ONLY_RULES_AGENTS matches CARVEOUT_MATRIX names", () => {
    expect([...AGENTBREW_ONLY_RULES_AGENTS].sort()).toEqual(CARVEOUT_MATRIX.map((row) => row.name).sort());
  });

  it("CANARY_DELEGATED_AGENTS matches DELEGATED_MATRIX names", () => {
    expect([...CANARY_DELEGATED_AGENTS].sort()).toEqual(DELEGATED_MATRIX.map((row) => row.name).sort());
  });
});
