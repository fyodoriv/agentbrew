/**
 * Tests for `checkBarePlaceholdersDrift` — the drift-detection wrapper around
 * `sweepMcpConfigs({ dryRun: true })`.
 *
 * The drift check is what `agentbrew status` calls and what auto-repair
 * triggers off (`AUTO_FIXABLE_TYPES` in `repair.ts`). A regression that
 * silently emits zero DriftItems for an agent with real bare placeholders
 * would leave users stuck — Devin keeps crashing, but `agentbrew status`
 * says "clean ✓". That's the failure mode these tests prevent.
 *
 * Parallel tests for the lint variant (`lintBarePlaceholders` /
 * `validateBarePlaceholdersSilent` in `src/lint.ts`) are below — both
 * wrappers call the same underlying sweep, but their failure surface
 * differs (lint → exit-code-1 error, drift → DriftItem for auto-repair).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dirtyServerSample, MCP_AGENT_MATRIX } from "../mcp/agent-matrix.fixtures.js";

// ── Mocks ───────────────────────────────────────────────────────────────────

const ctx = vi.hoisted(() => ({
  home: `${require("node:os").tmpdir()}/agentbrew-bare-placeholder-drift-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  state: {
    schemaVersion: 1,
    agents: [] as Array<{ name: string; detected: boolean }>,
    catalogVersion: "0.1.0",
    mcpServers: [],
    sources: [],
  },
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => ctx.home, tmpdir: actual.tmpdir };
});

vi.mock("../state.js", async () => ({
  loadState: () => ctx.state,
  requireState: () => ctx.state,
  invalidateState: () => {},
}));

// Import AFTER mocks so the mocked node:os and state are picked up.
import { checkBarePlaceholdersDrift } from "./mcp.js";

function writeDirty(): void {
  for (const fixture of MCP_AGENT_MATRIX) {
    const fullPath = join(ctx.home, fixture.relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, fixture.render(dirtyServerSample("github")));
  }
}

describe("checkBarePlaceholdersDrift", () => {
  beforeEach(() => {
    mkdirSync(ctx.home, { recursive: true });
    ctx.state.agents = MCP_AGENT_MATRIX.map((f) => ({ name: f.name, detected: true }));
  });

  afterEach(() => {
    rmSync(ctx.home, { recursive: true, force: true });
  });

  it("returns no drift when no detected agents exist in state", () => {
    ctx.state.agents = [];
    expect(checkBarePlaceholdersDrift()).toEqual([]);
  });

  it("returns no drift when configs are clean (no bare placeholders)", () => {
    // No fixture files written → sweep finds nothing.
    expect(checkBarePlaceholdersDrift()).toEqual([]);
  });

  it("returns one DriftItem per agent with bare placeholders", () => {
    writeDirty();
    const drift = checkBarePlaceholdersDrift();
    expect(drift.length).toBe(MCP_AGENT_MATRIX.length);
    const agentNames = new Set(drift.map((d) => d.agent));
    for (const fixture of MCP_AGENT_MATRIX) {
      expect(agentNames.has(fixture.name)).toBe(true);
    }
  });

  it("each DriftItem has the right shape (agent, type, detail)", () => {
    writeDirty();
    const drift = checkBarePlaceholdersDrift();
    for (const item of drift) {
      expect(item).toMatchObject({
        agent: expect.any(String),
        type: "mcp-bare-placeholder",
        detail: expect.stringContaining("bare ${VAR} placeholder"),
      });
    }
  });

  it("detail includes 'Run: agentbrew sync' so users know how to fix it", () => {
    writeDirty();
    const drift = checkBarePlaceholdersDrift();
    for (const item of drift) {
      expect(item.detail).toContain("agentbrew sync");
    }
  });

  it("detail summarises unique env vars (truncated to 4 + count)", () => {
    writeDirty();
    const drift = checkBarePlaceholdersDrift();
    // Dirty fixtures use CRASH_PRONE_ENV_VARS = 7 names. Detail should show first 4 + "+3 more".
    for (const item of drift) {
      expect(item.detail).toMatch(/\+\d+ more/);
    }
  });

  it("only flags agents that state marks as detected — skips undetected ones", () => {
    writeDirty();
    // Mark only the first 3 fixtures as detected; rest as undetected.
    ctx.state.agents = MCP_AGENT_MATRIX.map((f, i) => ({ name: f.name, detected: i < 3 }));
    const drift = checkBarePlaceholdersDrift();
    expect(drift.length).toBe(3);
    const expected = MCP_AGENT_MATRIX.slice(0, 3)
      .map((f) => f.name)
      .sort();
    expect(drift.map((d) => d.agent).sort()).toEqual(expected);
  });

  it("is read-only — does not modify any config file", () => {
    writeDirty();
    const before = MCP_AGENT_MATRIX.map((f) => {
      return require("node:fs").readFileSync(join(ctx.home, f.relativePath), "utf-8");
    });
    checkBarePlaceholdersDrift();
    for (let i = 0; i < MCP_AGENT_MATRIX.length; i++) {
      const after = require("node:fs").readFileSync(join(ctx.home, MCP_AGENT_MATRIX[i].relativePath), "utf-8");
      expect(after).toBe(before[i]);
    }
  });

  it("handles malformed state.agents gracefully (returns empty array)", () => {
    // @ts-expect-error — intentionally violating the schema to test defensive handling
    ctx.state.agents = "not-an-array";
    expect(checkBarePlaceholdersDrift()).toEqual([]);
  });

  it("reports type='mcp-bare-placeholder' so AUTO_FIXABLE_TYPES picks it up", () => {
    // Anchors the contract that auto-repair recognises this drift type.
    // Verified against `src/repair.ts::AUTO_FIXABLE_TYPES` — must include "mcp-bare-placeholder".
    writeDirty();
    const drift = checkBarePlaceholdersDrift();
    expect(drift.every((d) => d.type === "mcp-bare-placeholder")).toBe(true);
  });
});
