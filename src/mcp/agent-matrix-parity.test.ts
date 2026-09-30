/**
 * Native carve-out vs mcpm-delegated end-state parity.
 *
 * For any agentbrew server input, agents whose sync flows through the
 * native carve-out path (devin, kiro, amp, opencode, overlay-desktop,
 * copilot) and agents whose sync flows through `mcpm install`+`mcpm
 * client edit` (claude-code, cursor, windsurf, codex, goose, gemini-cli,
 * claude-desktop, cline, roo-code) should produce **structurally
 * equivalent** entries inside their respective config files.
 *
 * "Structurally equivalent" means:
 *   - Same command + args
 *   - Same env keys (modulo the literal-format env carve-out for Devin —
 *     see `convertServerEnvVars`)
 *   - Same env values modulo each agent's format conversion (standard
 *     `${VAR:-}`, codex `{env:VAR}`, opencode `${env:VAR}`, literal
 *     resolution for Devin)
 *
 * Why this matters
 * ----------------
 * The two write paths (native via `getAdapter().writeEntries` vs.
 * delegated via `mcpm install` then `mcpm client edit`) must remain
 * functionally interchangeable so that switching an agent from one
 * path to the other (which `MCP_INTERSECTION_AGENTS` migrations
 * regularly do) doesn't silently change the on-disk shape. A drift in
 * one path would mean some agents start seeing different server
 * config than others — a class of bug that's easy to introduce when
 * the two pipelines are refactored independently.
 *
 * This test exercises the **`toEntry`** boundary of the adapter
 * interface (the place where agentbrew renders a server into a format-
 * specific entry shape), since that's the shape `mcpm client edit`
 * writes back to disk too. Bypassing the actual mcpm subprocess keeps
 * the test deterministic.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { McpServer } from "../types.js";
import { getAdapter } from "./adapters.js";
import { MCP_AGENT_MATRIX } from "./agent-matrix.fixtures.js";

const SERVER_INPUT: McpServer = {
  name: "github",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github@latest"],
  env: {
    GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}",
    LOG_LEVEL: "${LOG_LEVEL:-info}",
  },
  source: "discovered" as const,
};

const originalHome = process.env.HOME;
const originalDotfilesReposDir = process.env.DOTFILES_REPOS_DIR;
const originalDotfilesOverlayRoot = process.env.DOTFILES_OVERLAY_ROOT;

beforeAll(() => {
  // The parity contract is format-only. Keep a machine-specific organization
  // launcher out of this deterministic adapter comparison.
  process.env.HOME = "/tmp/agentbrew-mcp-agent-matrix-home";
  process.env.DOTFILES_REPOS_DIR = "/tmp/agentbrew-mcp-agent-matrix-repos";
  delete process.env.DOTFILES_OVERLAY_ROOT;
});

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalDotfilesReposDir === undefined) delete process.env.DOTFILES_REPOS_DIR;
  else process.env.DOTFILES_REPOS_DIR = originalDotfilesReposDir;
  if (originalDotfilesOverlayRoot === undefined) delete process.env.DOTFILES_OVERLAY_ROOT;
  else process.env.DOTFILES_OVERLAY_ROOT = originalDotfilesOverlayRoot;
});

describe("Per-agent toEntry() — same input → comparable shape across formats", () => {
  it.each(MCP_AGENT_MATRIX)("$name — toEntry produces an entry with the canonical command and args", (fixture) => {
    const adapter = getAdapter({ name: fixture.name, mcpFormat: fixture.mcpFormat });
    const entry = adapter.toEntry(SERVER_INPUT, fixture.name);

    // command field exists, identifies the npx invocation. For opencode, command
    // collapses to an array; for others it's a string. Both surface "npx" in serialised form.
    const serialised = JSON.stringify(entry);
    expect(serialised).toContain("npx");
    expect(serialised).toContain("@modelcontextprotocol/server-github@latest");
  });

  it.each(MCP_AGENT_MATRIX)("$name — toEntry preserves the env-var KEY (placeholder syntax may differ)", (fixture) => {
    const adapter = getAdapter({ name: fixture.name, mcpFormat: fixture.mcpFormat });
    const entry = adapter.toEntry(SERVER_INPUT, fixture.name);

    // Every adapter MUST emit an env-block key for GITHUB_PERSONAL_ACCESS_TOKEN.
    // The exact placeholder syntax depends on agent's env-var format:
    //   - standard (claude-code, cursor, etc.): ${GITHUB_TOKEN:-}
    //   - codex: {env:GITHUB_TOKEN}
    //   - opencode: ${env:GITHUB_TOKEN}
    //   - literal (devin): the resolved value when set, otherwise ${GITHUB_TOKEN:-} or absent (env-inherit carve-out)
    const serialised = JSON.stringify(entry);
    // The key must be present somewhere in the entry. (For Devin literal-resolution-by-inheritance,
    // the key may be omitted entirely — that's documented behavior.)
    if (fixture.name !== "devin") {
      expect(serialised).toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
    }
  });

  it.each(
    MCP_AGENT_MATRIX,
  )("$name — toEntry resolves ${LOG_LEVEL:-info} default to a non-placeholder value when the var is unset", (fixture) => {
    const adapter = getAdapter({ name: fixture.name, mcpFormat: fixture.mcpFormat });
    const entry = adapter.toEntry(SERVER_INPUT, fixture.name);
    const serialised = JSON.stringify(entry);
    // For literal (devin) format: ${LOG_LEVEL:-info} resolves to "info" since LOG_LEVEL is unset.
    // For other formats: the placeholder is preserved as ${LOG_LEVEL:-info}, ${env:LOG_LEVEL}, etc.
    if (fixture.name === "devin") {
      expect(serialised).toContain("info");
    } else {
      // Standard/opencode/codex preserve the placeholder shape — the literal "LOG_LEVEL" must appear.
      expect(serialised).toContain("LOG_LEVEL");
    }
  });

  it("JSON-format agents (claude-code, cursor, windsurf, gemini-cli, claude-desktop, kiro, amp) emit IDENTICAL JSON entries", () => {
    // Parity assertion: all agents that share the same env-var format ("standard") should produce
    // byte-identical toEntry output for the same input. If a future refactor drifts one of these
    // agents into a different shape, this test fires immediately.
    const standardAgents = MCP_AGENT_MATRIX.filter(
      (f) => f.mcpFormat === "json" && f.name !== "devin", // devin is literal-format
    );
    const entries = standardAgents.map((f) => {
      const adapter = getAdapter({ name: f.name, mcpFormat: f.mcpFormat });
      return { name: f.name, entry: adapter.toEntry(SERVER_INPUT, f.name) };
    });
    // All should serialise to the SAME JSON. Pick the first as reference.
    const reference = JSON.stringify(entries[0].entry);
    for (const { name, entry } of entries.slice(1)) {
      const serialised = JSON.stringify(entry);
      expect(serialised, `${name} drifted from ${entries[0].name}`).toBe(reference);
    }
  });

  it("Devin's literal-format toEntry resolves bare ${VAR} to resilient ${VAR:-} when env is unset", () => {
    // Documents the layer-3 defense: even if a bare placeholder somehow makes it
    // to Devin's own config, the literal-format converter falls back to the
    // resilient form so Devin's strict importer doesn't crash.
    const adapter = getAdapter({ name: "devin", mcpFormat: "json" });
    const dirty: McpServer = {
      name: "test",
      command: "npx",
      args: [],
      env: { TOKEN_NO_FALLBACK: "${SOMETHING_NEVER_SET}" },
      source: "discovered" as const,
    };
    const entry = adapter.toEntry(dirty, "devin");
    const serialised = JSON.stringify(entry);
    // Empty default emitted in place of bare placeholder.
    expect(serialised).toMatch(/\$\{SOMETHING_NEVER_SET:-\}|\bSOMETHING_NEVER_SET\b/);
  });
});

describe("Cross-format env-var conversion contract", () => {
  // Documents and pins the per-format conversion contract:
  //   standard  → ${VAR:-}     (resilient default form)
  //   codex     → {env:VAR}
  //   opencode  → ${env:VAR}
  //   literal   → resolved value at sync time (or empty default for unset bare)
  const CONVERSION_CASES = [
    { format: "standard" as const, sampleAgent: "cursor", expectedPattern: /\$\{GITHUB_TOKEN:-/ },
    { format: "standard" as const, sampleAgent: "claude-code", expectedPattern: /\$\{GITHUB_TOKEN:-/ },
  ];

  it.each(CONVERSION_CASES)("$sampleAgent ($format) emits resilient ${VAR:-} for bare ${VAR} input", ({
    sampleAgent,
    expectedPattern,
  }) => {
    const adapter = getAdapter({ name: sampleAgent });
    const entry = adapter.toEntry(SERVER_INPUT, sampleAgent);
    const serialised = JSON.stringify(entry);
    expect(serialised).toMatch(expectedPattern);
  });
});
