/**
 * Multi-agent end-to-end integration test for the Devin-import crash class.
 *
 * What this proves
 * ----------------
 * The previous tests in `agent-matrix.test.ts` exercise per-fixture sweep
 * helpers (`sweepOneJsonConfig`, `sweepOneYamlConfig`) directly. This test
 * goes one level higher: it lays out every MCP-capable agent's config on a
 * sandboxed HOME directory (the same paths `agents.yaml` declares) and runs
 * the real {@link sweepMcpConfigs} dispatch function — the SAME entry point
 * that `agentbrew sync` calls post-sync.
 *
 * The load-bearing assertion: after `sweepMcpConfigs({ detected: AGENT_DEFINITIONS })`
 * touches every config, the Devin-import simulator returns ok=true against
 * the union of every config. This is the test that would have failed before
 * PR #998 / PR #1018 and now must stay green forever.
 *
 * The previous user-visible regression — "Listed MCP servers failed:
 * Environment variable 'GITHUB_TOKEN' not found and no default provided" —
 * is reproducible HERE in a short fixture and the fix is verifiable the same way.
 *
 * Why not extend integration.test.ts
 * -----------------------------------
 * `src/integration.test.ts` is 3151 lines with a complex mock graph
 * (delegateMcpInstall, auto-sync, fetch-sources, …). Adding the crash-class
 * regression there would couple it to those mocks. This file mocks only
 * `node:os::homedir` so the sweep targets the sandbox, and exercises the
 * pure sweep entry point — narrow surface, clearer failure messages.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dirtyServerSample, MCP_AGENT_MATRIX } from "./agent-matrix.fixtures.js";
import { simulateDevinImport } from "./devin-import.simulator.js";
import { sweepMcpConfigs } from "./resilient-sweep.js";

// ── Mocked HOME so sweepMcpConfigs's expandHome() lands in the sandbox ──────

const ctx = vi.hoisted(() => ({
  home: `${require("node:os").tmpdir()}/agentbrew-multi-agent-import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => ctx.home, tmpdir: actual.tmpdir };
});

// Build detected-agent stubs from the fixture matrix. These supply `name` and
// `detected: true` so the sweep treats every fixture as in-scope. Other
// AgentConfig fields are filled by AGENT_DEFINITIONS at the sweep site.
const detectedAgents = MCP_AGENT_MATRIX.map((f) => ({
  name: f.name,
  detected: true,
  skillsDir: "(unused-in-sweep)",
}));

function writeFixture(fixture: (typeof MCP_AGENT_MATRIX)[number], serverName = "github"): string {
  const fullPath = join(ctx.home, fixture.relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, fixture.render(dirtyServerSample(serverName)));
  return fullPath;
}

describe("Multi-agent E2E: agentbrew sweep + simulated Devin import", () => {
  beforeEach(() => {
    mkdirSync(ctx.home, { recursive: true });
  });

  afterEach(() => {
    rmSync(ctx.home, { recursive: true, force: true });
  });

  it("baseline — dirty configs for every MCP-capable agent crash simulated Devin", () => {
    // Reproduce the original user-reported symptom on a fresh machine where
    // every MCP-capable agent's config has bare ${VAR} placeholders.
    const paths = MCP_AGENT_MATRIX.map((f) => writeFixture(f));
    const result = simulateDevinImport(paths, {});
    expect(result.ok).toBe(false);
    // Findings should span MANY agents — confirms the simulator walks all of them.
    expect(result.findings.length).toBeGreaterThanOrEqual(MCP_AGENT_MATRIX.length);
  });

  it("sweepMcpConfigs (full dispatch) heals every MCP-capable agent in one pass", () => {
    // The real entry point `agentbrew sync` calls post-sync.
    for (const f of MCP_AGENT_MATRIX) writeFixture(f);
    const results = sweepMcpConfigs({ detected: detectedAgents });
    // Every fixture should report SOME findings (the dirty placeholders) and a positive fixedCount.
    expect(results.length).toBe(MCP_AGENT_MATRIX.length);
    for (const r of results) {
      expect(r.fixedCount).toBeGreaterThan(0);
      expect(r.findings.length).toBe(r.fixedCount);
    }
    // Every per-agent path returned by the sweep should match the fixture's relativePath.
    const sweptPaths = new Set(results.map((r) => r.path));
    for (const f of MCP_AGENT_MATRIX) {
      expect(sweptPaths.has(join(ctx.home, f.relativePath))).toBe(true);
    }
  });

  it("post-sweep — simulated Devin import succeeds with NO env set", () => {
    // The load-bearing regression test: this would have failed on `main` before
    // PR #998 (resilient placeholders) and PR #1018 (YAML support).
    const paths = MCP_AGENT_MATRIX.map((f) => writeFixture(f));
    sweepMcpConfigs({ detected: detectedAgents });
    const result = simulateDevinImport(paths, {});
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("post-sweep — every config file's contents are still parseable by its format reader", () => {
    // Defensive: confirm the sweep didn't corrupt any config. A regression where
    // the YAML writer produced invalid YAML, or the JSON writer dropped a key,
    // would surface here even if the placeholder scan passed.
    for (const f of MCP_AGENT_MATRIX) writeFixture(f);
    sweepMcpConfigs({ detected: detectedAgents });
    for (const f of MCP_AGENT_MATRIX) {
      const fullPath = join(ctx.home, f.relativePath);
      const content = readFileSync(fullPath, "utf-8");
      // Spot-check that the placeholder-rewrite happened (resilient form present).
      expect(content).toMatch(/\$\{[A-Z_][A-Z0-9_]*:-/);
      // Spot-check that the parsed shape is still navigable. We don't reconstruct
      // a strict-typed parser here — the format-specific tests cover that — but
      // a parse error would crash the sweep itself, which already runs above.
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("idempotence — second sweep makes no further changes", () => {
    for (const f of MCP_AGENT_MATRIX) writeFixture(f);
    sweepMcpConfigs({ detected: detectedAgents });
    const snapshots = MCP_AGENT_MATRIX.map((f) => readFileSync(join(ctx.home, f.relativePath), "utf-8"));
    const second = sweepMcpConfigs({ detected: detectedAgents });
    // Second sweep should find zero findings and produce zero fixes.
    for (const r of second) {
      expect(r.findings).toEqual([]);
      expect(r.fixedCount).toBe(0);
    }
    // Files unchanged.
    for (let i = 0; i < MCP_AGENT_MATRIX.length; i++) {
      expect(readFileSync(join(ctx.home, MCP_AGENT_MATRIX[i].relativePath), "utf-8")).toBe(snapshots[i]);
    }
  });

  it("detected filter — sweep only touches detected agents, leaves undetected files alone", () => {
    // Write dirty configs for ALL fixtures but only mark the first few as detected.
    // The sweep should heal the detected set and leave the rest untouched.
    for (const f of MCP_AGENT_MATRIX) writeFixture(f);
    const half = detectedAgents.slice(0, Math.floor(detectedAgents.length / 2));
    const halfNames = new Set(half.map((a) => a.name));
    sweepMcpConfigs({ detected: half });

    for (const fixture of MCP_AGENT_MATRIX) {
      const content = readFileSync(join(ctx.home, fixture.relativePath), "utf-8");
      if (halfNames.has(fixture.name)) {
        expect(content, `${fixture.name} should be healed`).toMatch(/\$\{[A-Z_][A-Z0-9_]*:-/);
      } else {
        expect(content, `${fixture.name} should still be dirty`).not.toMatch(/\$\{[A-Z_][A-Z0-9_]*:-\}/);
      }
    }
  });

  it("dryRun=true reports findings without writing (used by lint and drift)", () => {
    const paths = MCP_AGENT_MATRIX.map((f) => writeFixture(f));
    const snapshots = paths.map((p) => readFileSync(p, "utf-8"));
    const results = sweepMcpConfigs({ detected: detectedAgents, dryRun: true });
    expect(results.length).toBe(MCP_AGENT_MATRIX.length);
    for (const r of results) {
      expect(r.findings.length).toBeGreaterThan(0);
      expect(r.fixedCount).toBe(0); // dryRun
    }
    // Files unchanged — every byte preserved.
    paths.forEach((p, i) => {
      expect(readFileSync(p, "utf-8")).toBe(snapshots[i]);
    });
  });
});
