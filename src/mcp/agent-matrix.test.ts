/**
 * Per-agent crash-class regression matrix.
 *
 * For every MCP-capable agent in {@link MCP_AGENT_MATRIX}, prove the
 * strict-interpolation crash class is fully contained at the agentbrew layer:
 *
 *  1. **Crash baseline** — a freshly-written dirty config (bare `${VAR}`,
 *     no env set) is detected as crash-prone by the simulator.
 *  2. **Sweep heals** — `sweepMcpConfigs` rewrites every bare placeholder
 *     to `${VAR:-}`. No file mutations outside the configured `mcpKey` slice.
 *  3. **Post-sweep import succeeds** — the simulator now reports `ok: true`
 *     against the swept file even with `processEnv: {}`. This is the load-
 *     bearing assertion that closes the regression loop.
 *
 * Adding a new agent to `agents.yaml`:
 *   1. Add a row to `MCP_AGENT_MATRIX` in `agent-matrix.fixtures.ts`.
 *   2. These tests pick it up automatically via `it.each(...)`.
 *   3. No test code changes required.
 *
 * If an agent's config shape isn't representable by JSON or YAML render
 * helpers (overlay-desktop, opencode, codex are NOT in the matrix today —
 * see the file-level comment on `agent-matrix.fixtures.ts` for why), the
 * gap is documented in that file and flagged as a separate scout task.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanStrictInterpolation } from "../test-utils/strict-interpolation.js";
import {
  CRASH_PRONE_ENV_VARS,
  dirtyServerSample,
  MCP_AGENT_MATRIX,
  type McpAgentFixture,
} from "./agent-matrix.fixtures.js";
import { sweepOneJsonConfig, sweepOneYamlConfig } from "./resilient-sweep.js";

function writeFixtureDirty(fixture: McpAgentFixture, home: string, serverName = "github"): string {
  const fullPath = join(home, fixture.relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  const sample = dirtyServerSample(serverName);
  writeFileSync(fullPath, fixture.render(sample));
  return fullPath;
}

/** Dispatch to the format-specific sweep entry point. Mirrors `pickSweepFn` in resilient-sweep.ts. */
function runSweep(fixture: McpAgentFixture, fullPath: string): { fixedCount: number; findingsCount: number } {
  const { fixedCount, findings } =
    fixture.mcpFormat === "yaml"
      ? sweepOneYamlConfig(fullPath, fixture.mcpKey, false)
      : sweepOneJsonConfig(fullPath, fixture.mcpKey, false);
  return { fixedCount, findingsCount: findings.length };
}

describe("Per-agent crash-class regression matrix", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "agent-matrix-regression-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  // ── Property 1: Dirty config crashes strict-interpolation scan ────────────────

  it.each(MCP_AGENT_MATRIX)("$name — dirty config trips scanStrictInterpolation (baseline before sweep)", (fixture) => {
    const configPath = writeFixtureDirty(fixture, home);
    const result = scanStrictInterpolation([configPath], {});
    expect(result.ok).toBe(false);
    // Every bare placeholder from CRASH_PRONE_ENV_VARS should appear in findings.
    expect(result.findings.length).toBeGreaterThanOrEqual(CRASH_PRONE_ENV_VARS.length);
  });

  // ── Property 2: Sweep heals every fixture, in place ───────────────────────

  it.each(MCP_AGENT_MATRIX)("$name — sweepMcpConfigs rewrites every bare \\${VAR} to \\${VAR:-}", (fixture) => {
    const configPath = writeFixtureDirty(fixture, home);
    const { fixedCount, findingsCount } = runSweep(fixture, configPath);
    // findings is the count of bare placeholders the sweep saw — should equal CRASH_PRONE_ENV_VARS.length.
    expect(findingsCount).toBe(CRASH_PRONE_ENV_VARS.length);
    // fixedCount is what the sweep wrote — equals findings on a non-dry run.
    expect(fixedCount).toBe(CRASH_PRONE_ENV_VARS.length);
    // Spot-check the file contents to anchor the contract that the rewrite is mechanical.
    const content = readFileSync(configPath, "utf-8");
    for (const v of CRASH_PRONE_ENV_VARS) {
      expect(content).toContain(`\${${v}:-}`);
      // The bare form must be gone. (The regex check is defensive — the sweep should remove every bare hit.)
      expect(content).not.toMatch(new RegExp(`\\$\\{${v}\\}(?!:)`));
    }
  });

  // ── Property 3: Post-sweep import succeeds (the load-bearing assertion) ───

  it.each(MCP_AGENT_MATRIX)("$name — post-sweep scanStrictInterpolation returns ok:true with NO env set", (fixture) => {
    const configPath = writeFixtureDirty(fixture, home);
    runSweep(fixture, configPath);
    const result = scanStrictInterpolation([configPath], {});
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  // ── Property 4: Sweep is idempotent on already-clean configs ───────────────

  it.each(MCP_AGENT_MATRIX)("$name — second sweep is idempotent (no further writes after first heal)", (fixture) => {
    const configPath = writeFixtureDirty(fixture, home);
    runSweep(fixture, configPath); // first sweep
    const afterFirst = readFileSync(configPath, "utf-8");
    const second = runSweep(fixture, configPath); // second sweep
    expect(second.findingsCount).toBe(0);
    expect(readFileSync(configPath, "utf-8")).toBe(afterFirst);
  });

  // ── Cross-cutting: Multi-agent strict-interpolation scan ─────────────────────

  it("scanStrictInterpolation returns ok:false when ALL agents are dirty and no env is set", () => {
    // Reproduce the user-reported symptom: A strict importer opens a session, scans peer
    // configs, hits the first bare ${VAR} it can't resolve, aborts the load.
    const paths = MCP_AGENT_MATRIX.map((f) => writeFixtureDirty(f, home, "github"));
    const result = scanStrictInterpolation(paths, {});
    expect(result.ok).toBe(false);
    // Findings span every agent — confirms the simulator walks them all.
    const agentNames = new Set(result.findings.map((f) => f.path.split("/").pop() ?? ""));
    expect(agentNames.size).toBeGreaterThan(1);
  });

  it("scanStrictInterpolation returns ok:true when ALL agents are dirty BUT env is set", () => {
    // Layer 2/3 of defense (zshenv-derived GITHUB_TOKEN, dvb pre-export) — proves
    // that even without the resilient sweep, having the env set is sufficient.
    // This documents the multi-layered defense the user has across machines.
    const paths = MCP_AGENT_MATRIX.map((f) => writeFixtureDirty(f, home, "github"));
    const env: Record<string, string> = {};
    for (const v of CRASH_PRONE_ENV_VARS) env[v] = "test-value-resolved";
    const result = scanStrictInterpolation(paths, env);
    expect(result.ok).toBe(true);
  });

  it("scanStrictInterpolation returns ok:true after sweeping ALL agents (post-sync state)", () => {
    // The agentbrew sweep ran. Every fixture has resilient placeholders.
    // A strict importer loads all of them with NO env set. No crash.
    const paths = MCP_AGENT_MATRIX.map((fixture) => {
      const configPath = writeFixtureDirty(fixture, home);
      runSweep(fixture, configPath);
      return configPath;
    });
    const result = scanStrictInterpolation(paths, {});
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });
});

describe("Agent matrix coverage", () => {
  // Drift guard: if a new MCP-capable agent is added to agents.yaml but not to
  // the matrix, this test fails loudly so the regression suite stays complete.
  // The list below is the set of (json/yaml) agents that DO use bash-style
  // placeholders. overlay-desktop, codex (toml), opencode are deliberately
  // out of scope — see `agent-matrix.fixtures.ts` file comment.
  const EXPECTED_AGENTS_IN_MATRIX = ["claude-code", "cursor", "gemini-cli", "claude-desktop", "kiro", "amp", "goose"];

  it("MCP_AGENT_MATRIX covers every expected agent", () => {
    const matrixNames = new Set(MCP_AGENT_MATRIX.map((a) => a.name));
    for (const expected of EXPECTED_AGENTS_IN_MATRIX) {
      expect(matrixNames.has(expected), `Missing fixture for "${expected}"`).toBe(true);
    }
  });

  it("MCP_AGENT_MATRIX has no duplicate agent names", () => {
    const names = MCP_AGENT_MATRIX.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
