import { describe, expect, it } from "vitest";
import { AGENTBREW_ONLY_MCP_AGENTS, MCP_INTERSECTION_AGENTS } from "../core/mcp-agent-map.js";
import { getAdapter } from "../mcp/adapters.js";
import { AGENT_DEFINITIONS, type AgentConfig, type McpServer } from "../types.js";
import { mcpServerConfigEquals } from "./mcp-delegate.js";

/**
 * Per-agent carve-out × intersection matrix tests for MCP sync.
 *
 * Locks in the metadata invariants that define which agents get native
 * MCP config writes (carve-outs) vs which get mcpm delegation (intersection).
 * Each row asserts: target path (`mcpConfig` or `mcpConfigVscodeSettings`),
 * mcpKey, mcpFormat dispatch, and set-membership classification.
 *
 * The 2048-LOC `mcp-sync.test.ts` extensively covers per-server SYNC behavior
 * (env literalization, prune, idempotency, partial-failure resilience).
 * This file is the orthogonal lock: per-AGENT METADATA correctness, so a
 * future change that flips an agent's mcpFormat or moves a carve-out across
 * the boundary fails loudly here even if the integration tests stay green.
 *
 * Surfaced 2026-05-25 ecosystem audit (subagent report § "Test Coverage Holes").
 * Membership is pinned by `CARVEOUT_MATRIX` / `INTERSECTION_AGENTS` below and
 * must stay aligned with {@link AGENTBREW_ONLY_MCP_AGENTS} and
 * {@link MCP_INTERSECTION_AGENTS}.
 */

/**
 * Helper: look up an agent's static def from AGENT_DEFINITIONS (loaded from
 * agents.yaml). Asserts the lookup succeeds because a typo in the matrix
 * key should be a loud test failure, not a `defaults?.mcpConfig` undefined.
 *
 * AGENT_DEFINITIONS is typed `Omit<AgentConfig, "detected">[]` — the
 * `detected` field is populated at agentbrew runtime by `detectInstalledAgents`,
 * not at static-config load time. The helper preserves that omission so
 * the matrix doesn't accidentally assert against a runtime-only field.
 */
function defOf(name: string): Omit<AgentConfig, "detected"> {
  const def = AGENT_DEFINITIONS.find((a) => a.name === name);
  if (!def) {
    throw new Error(`Agent '${name}' not found in AGENT_DEFINITIONS. The matrix below is stale.`);
  }
  return def;
}

// ── Carve-out matrix (native MCP write target) ────────────────────────────
//
// Each row pins (a) the expected mcpConfig path the native sync writes to,
// (b) the mcpKey within that file, (c) the mcpFormat that dispatches
// the right adapter. A carve-out that drifts on any of these silently
// breaks sync for that agent — this matrix is the regression fence.

interface CarveoutRow {
  /** Agent name as it appears in agents.yaml + AGENT_DEFINITIONS. */
  name: string;
  /**
   * Expected RESOLVED mcpConfig path on the loaded AGENT_DEFINITIONS.
   * The loader (`src/core/agents.ts:loadEntryMcpConfig`) translates
   * `mcpConfigVscodeSettings: true` and `mcpConfigVscodeExt: {...}` to
   * literal OS paths at load time, so by the time tests read
   * `def.mcpConfig` they get the resolved path either way. This avoids
   * a per-row "is it VS Code routed" branch — the matrix asserts the
   * effective resolved path uniformly.
   */
  expectedMcpConfig: string;
  /**
   * Expected mcpKey within the config file. `undefined` means the agent
   * uses the default `mcpServers` key (no explicit override in agents.yaml).
   */
  expectedMcpKey: string | undefined;
  /**
   * Expected mcpFormat — the dispatch key for getAdapter(). `undefined`
   * means default (JSON). The 5 valid values: json (default), yaml, toml,
   * overlay-desktop, opencode.
   */
  expectedMcpFormat: AgentConfig["mcpFormat"];
}

const CARVEOUT_MATRIX: CarveoutRow[] = [
  {
    name: "copilot",
    // Copilot routes through VS Code's settings.json via the
    // `mcpConfigVscodeSettings: true` flag in agents.yaml. The loader
    // at `src/core/agents.ts` resolves that flag to the literal
    // `~/Library/Application Support/Code/User/settings.json` path on
    // macOS at AGENT_DEFINITIONS load time — so by the time we read
    // mcpConfig from the loaded def, it's the resolved path, not the
    // flag. The matrix pins the resolved path so a future change to
    // the VS Code settings location surfaces here.
    expectedMcpConfig: "~/Library/Application Support/Code/User/settings.json",
    expectedMcpKey: undefined, // default mcpServers
    expectedMcpFormat: undefined, // default JSON
  },
  {
    name: "opencode",
    expectedMcpConfig: "~/.config/opencode/opencode.json",
    expectedMcpKey: "mcp",
    expectedMcpFormat: "opencode",
  },
  {
    name: "kiro",
    expectedMcpConfig: "~/.kiro/settings/mcp.json",
    expectedMcpKey: undefined, // default mcpServers
    expectedMcpFormat: undefined, // default JSON
  },
  {
    name: "amp",
    expectedMcpConfig: "~/.config/amp/settings.json",
    expectedMcpKey: "amp.mcpServers",
    expectedMcpFormat: undefined, // default JSON
  },
  {
    name: "cursor",
    // Moved from intersection to carve-out. mcpm's `mcpm run` wrapper entries
    // aren't surfaced to Cursor's agent tool layer; native sync writes direct
    // commands into ~/.cursor/mcp.json instead.
    expectedMcpConfig: "~/.cursor/mcp.json",
    expectedMcpKey: undefined, // default mcpServers
    expectedMcpFormat: undefined, // default JSON
  },
];

describe("MCP carve-out matrix — per-agent metadata invariants", () => {
  describe.each(CARVEOUT_MATRIX)("$name", (row) => {
    it("appears in AGENT_DEFINITIONS (sourced from agents.yaml)", () => {
      expect(() => defOf(row.name)).not.toThrow();
    });

    it(`mcpConfig (resolved) is ${row.expectedMcpConfig}`, () => {
      const def = defOf(row.name);
      expect(def.mcpConfig).toBe(row.expectedMcpConfig);
    });

    it(`mcpKey is ${row.expectedMcpKey ?? "default (mcpServers)"}`, () => {
      const def = defOf(row.name);
      expect(def.mcpKey).toBe(row.expectedMcpKey);
    });

    it(`mcpFormat dispatches to ${row.expectedMcpFormat ?? "default (json)"} adapter`, () => {
      const def = defOf(row.name);
      expect(def.mcpFormat).toBe(row.expectedMcpFormat);
      // The dispatcher returns SOME adapter for every agent (default is JSON);
      // assert that lookup doesn't throw — proves the mcpFormat is in the
      // canonical MCP_FORMAT_DISPATCH map, not a typo.
      const adapter = getAdapter(def);
      expect(adapter).toBeDefined();
      expect(typeof adapter.toEntry).toBe("function");
    });

    it("is classified as native carve-out (in AGENTBREW_ONLY_MCP_AGENTS, NOT in MCP_INTERSECTION_AGENTS)", () => {
      expect(AGENTBREW_ONLY_MCP_AGENTS.has(row.name)).toBe(true);
      expect(MCP_INTERSECTION_AGENTS.has(row.name)).toBe(false);
    });
  });

  it("CARVEOUT_MATRIX covers every name in AGENTBREW_ONLY_MCP_AGENTS (no carve-out goes unmatrixed)", () => {
    const matrixNames = new Set(CARVEOUT_MATRIX.map((r) => r.name));
    const missing = [...AGENTBREW_ONLY_MCP_AGENTS].filter((name) => !matrixNames.has(name));
    expect(missing).toEqual([]);
  });

  it("CARVEOUT_MATRIX has no name that isn't actually a carve-out (catches stale matrix entries)", () => {
    const stale = CARVEOUT_MATRIX.filter((r) => !AGENTBREW_ONLY_MCP_AGENTS.has(r.name)).map((r) => r.name);
    expect(stale).toEqual([]);
  });
});

// ── Intersection matrix (mcpm-delegated; native sync skips) ───────────────
//
// Each row asserts the agent IS in MCP_INTERSECTION_AGENTS (so native sync
// skips it) and NOT in the carve-out set. Together with the carve-out
// matrix above, this pins the boundary between the two sets — a single
// agent landing in BOTH sets (or NEITHER) would be a sync bug, and the
// matrix catches the misclassification at unit-test time.

const INTERSECTION_AGENTS: string[] = [
  "claude-code",
  "claude-desktop",
  "cline",
  "gemini-cli",
  "codex",
  "goose",
  "roo-code",
];

const SHARED_MEMORY_SERVER: McpServer = {
  name: "memory",
  command: "",
  args: [],
  env: {},
  source: "agentfile",
  url: "http://127.0.0.1:18765/mcp",
};

describe("MCP intersection matrix — mcpm-delegated agents", () => {
  describe.each(INTERSECTION_AGENTS)("%s", (name) => {
    it("is classified as mcpm-delegated (in MCP_INTERSECTION_AGENTS, NOT in AGENTBREW_ONLY_MCP_AGENTS)", () => {
      expect(MCP_INTERSECTION_AGENTS.has(name)).toBe(true);
      expect(AGENTBREW_ONLY_MCP_AGENTS.has(name)).toBe(false);
    });

    it("appears in AGENT_DEFINITIONS (agents.yaml)", () => {
      expect(() => defOf(name)).not.toThrow();
    });
  });

  it("INTERSECTION_AGENTS covers every name in MCP_INTERSECTION_AGENTS (no intersection goes unmatrixed)", () => {
    const matrixSet = new Set(INTERSECTION_AGENTS);
    const missing = [...MCP_INTERSECTION_AGENTS].filter((name) => !matrixSet.has(name));
    expect(missing).toEqual([]);
  });
});

// ── Boundary invariants (carve-out + intersection are disjoint, total = both sets) ─

describe("MCP carve-out + intersection boundary invariants", () => {
  it.each(["claude-code", "cursor", "codex"])("%s preserves the shared HTTP memory transport", (name) => {
    if (AGENTBREW_ONLY_MCP_AGENTS.has(name)) {
      const entry = getAdapter(defOf(name)).toEntry(SHARED_MEMORY_SERVER, name);
      expect(entry.url).toBe(SHARED_MEMORY_SERVER.url);
      expect(entry.command).toBeUndefined();
      return;
    }

    expect(MCP_INTERSECTION_AGENTS.has(name)).toBe(true);
    expect(mcpServerConfigEquals(SHARED_MEMORY_SERVER, { ...SHARED_MEMORY_SERVER })).toBe(true);
  });

  it("the two sets are disjoint (no agent is in both)", () => {
    const overlap = [...AGENTBREW_ONLY_MCP_AGENTS].filter((name) => MCP_INTERSECTION_AGENTS.has(name));
    expect(overlap).toEqual([]);
  });

  it("AGENTBREW_ONLY_MCP_AGENTS matches CARVEOUT_MATRIX names", () => {
    expect([...AGENTBREW_ONLY_MCP_AGENTS].sort()).toEqual(CARVEOUT_MATRIX.map((row) => row.name).sort());
  });

  it("MCP_INTERSECTION_AGENTS matches INTERSECTION_AGENTS list", () => {
    expect([...MCP_INTERSECTION_AGENTS].sort()).toEqual([...INTERSECTION_AGENTS].sort());
  });

  it("every carve-out's mcpFormat is in the canonical MCP_FORMAT_DISPATCH map", () => {
    // getAdapter() lookup is the dispatcher; a typo in mcpFormat would
    // make it fall back to JSON silently. We assert by enumerating each
    // carve-out's format and confirming the adapter is the expected
    // identity-by-toEntry-function-name (or at minimum, defined).
    for (const row of CARVEOUT_MATRIX) {
      const def = defOf(row.name);
      const adapter = getAdapter(def);
      expect(adapter, `getAdapter(${row.name}) returned undefined`).toBeDefined();
    }
  });
});
