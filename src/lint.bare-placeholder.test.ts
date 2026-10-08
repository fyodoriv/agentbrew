/**
 * Tests for the bare-placeholder lint check via `validateConfig()`.
 *
 * `validateBarePlaceholdersSilent` is private (line ~462 of `src/lint.ts`),
 * but it's invoked by the exported `validateConfig()` and the resulting
 * error strings flow into `details`. Testing through the public surface
 * keeps the API surface minimal (per AGENTS.md rule #9 "Keep the external
 * API small") while still locking in the behavior:
 *
 * - When detected agents have bare `${VAR}` in their MCP configs, the lint
 *   detail list includes a "bare ${VAR} placeholder(s)" entry per agent
 *   and `errors` is positive.
 * - The error string includes "strict importers (Devin) crash on missing
 *   vars" so users can grep the message back to the root cause.
 *
 * Why this matters: CI (`npm run verify`) calls `lint()` and fails on any
 * positive error count. Without this regression test, a future refactor
 * that silently disables the bare-placeholder check could ship and we'd
 * lose the verify-gate protection against the crash class.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dirtyServerSample, MCP_AGENT_MATRIX } from "./mcp/agent-matrix.fixtures.js";

// ── Mocks ───────────────────────────────────────────────────────────────────

const ctx = vi.hoisted(() => ({
  home: `${require("node:os").tmpdir()}/agentbrew-lint-bare-placeholder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

vi.mock("./state.js", async () => ({
  loadState: () => ctx.state,
  requireState: () => ctx.state,
  invalidateState: () => {},
  getStatePath: () => join(ctx.home, ".config", "agentbrew", "state.yaml"),
  saveState: vi.fn(),
}));

// MCP env-var validation is independent of bare-placeholder lint — silence it.
// We use importOriginal to preserve the rest of mcp-setup's exports in case
// other lint helpers import from it transitively.
vi.mock("./mcp/mcp-setup.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mcp/mcp-setup.js")>();
  return { ...actual, validateMcpEnvVars: vi.fn(() => []) };
});

// We DO NOT mock ./agentfile.js — its lint check reads files from `process.cwd()`
// and the sandbox cwd has no Agentfile.yaml, so it cleanly returns no errors.
// Mocking it narrowly broke transitive imports of AGENTFILE_NAMES.

// Import AFTER mocks so the mocked node:os and state are picked up.
import { validateConfig } from "./lint.js";

function writeDirty(): void {
  for (const fixture of MCP_AGENT_MATRIX) {
    const fullPath = join(ctx.home, fixture.relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, fixture.render(dirtyServerSample("github")));
  }
}

describe("validateConfig() — bare placeholder lint integration", () => {
  beforeEach(() => {
    mkdirSync(ctx.home, { recursive: true });
    ctx.state.agents = MCP_AGENT_MATRIX.map((f) => ({ name: f.name, detected: true }));
  });

  afterEach(() => {
    rmSync(ctx.home, { recursive: true, force: true });
  });

  it("reports no bare-placeholder errors when configs are clean", () => {
    // No config files written → sweep finds nothing.
    const result = validateConfig();
    const barePlaceholderErrors = result.details.filter((d) => d.includes("bare ${VAR} placeholder"));
    expect(barePlaceholderErrors).toEqual([]);
  });

  it("emits one error line per detected agent with bare placeholders", () => {
    writeDirty();
    const result = validateConfig();
    const barePlaceholderErrors = result.details.filter((d) => d.includes("bare ${VAR} placeholder"));
    expect(barePlaceholderErrors.length).toBe(MCP_AGENT_MATRIX.length);
    // Every fixture's agent name should appear in some error line.
    for (const fixture of MCP_AGENT_MATRIX) {
      expect(barePlaceholderErrors.some((d) => d.startsWith(fixture.name))).toBe(true);
    }
  });

  it("error message names the strict-importer crash class so users can debug it", () => {
    writeDirty();
    const result = validateConfig();
    const barePlaceholderErrors = result.details.filter((d) => d.includes("bare ${VAR} placeholder"));
    for (const err of barePlaceholderErrors) {
      expect(err).toContain("strict importers crash on missing vars");
    }
  });

  it("errors count is positive when bare placeholders exist (CI fail signal)", () => {
    writeDirty();
    const result = validateConfig();
    expect(result.errors).toBeGreaterThan(0);
  });

  it("only flags agents that state marks as detected — skips undetected ones", () => {
    writeDirty();
    ctx.state.agents = MCP_AGENT_MATRIX.map((f, i) => ({ name: f.name, detected: i < 3 }));
    const result = validateConfig();
    const barePlaceholderErrors = result.details.filter((d) => d.includes("bare ${VAR} placeholder"));
    expect(barePlaceholderErrors.length).toBe(3);
  });

  it("does not modify any config file (lint is read-only by contract)", () => {
    writeDirty();
    const before = MCP_AGENT_MATRIX.map((f) => {
      return require("node:fs").readFileSync(join(ctx.home, f.relativePath), "utf-8");
    });
    validateConfig();
    for (let i = 0; i < MCP_AGENT_MATRIX.length; i++) {
      const after = require("node:fs").readFileSync(join(ctx.home, MCP_AGENT_MATRIX[i].relativePath), "utf-8");
      expect(after).toBe(before[i]);
    }
  });
});
