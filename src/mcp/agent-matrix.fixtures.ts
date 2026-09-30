/**
 * Agent × MCP-config × placeholder fixture matrix.
 *
 * Single source of truth for every MCP-capable agent's config shape and the
 * representative dirty/clean states. Tests in `src/mcp/*.test.ts` and
 * `src/integration/*.test.ts` consume this matrix via `it.each(MCP_AGENT_MATRIX)`
 * so adding a new agent to `agents.yaml` only requires one fixture entry to
 * propagate across the regression suite.
 *
 * ## Why this exists
 *
 * The bare-placeholder crash class — where Devin's strict-interpolation MCP
 * importer aborts the entire MCP load on a single unset `${VAR}` — needs to
 * be tested for every (agent × format × env-var) combination. Hand-writing
 * one test per combination produces a large cartesian matrix that drifts the
 * moment a new agent or env var lands. This file lets every regression test
 * be a one-liner against the matrix instead.
 *
 * ## Scope
 *
 * Includes only agents whose configs use bash-style `${VAR}` placeholders
 * — i.e. agents subject to Devin's crash class:
 *
 * | Format           | Crash-prone? | Included? |
 * |------------------|--------------|-----------|
 * | json (standard)  | yes          | yes       |
 * | yaml (goose)     | yes          | yes       |
 * | overlay-desktop   | yes          | **no** — sweep doesn't handle its `servers` array shape yet (scout task) |
 * | opencode         | no (`${env:VAR}`) | no — placeholder syntax preserved by design |
 * | toml (codex)     | no (`{env:VAR}`)  | no — placeholder syntax preserved by design |
 *
 * VS Code-globalStorage agents (cline, roo-code) and VS Code-settings agents
 * (copilot) are also excluded — their MCP config paths route through
 * `mcpConfigVscodeExt` / `mcpConfigVscodeSettings` and the resilient sweep
 * doesn't traverse those today. Filed as a separate scout task.
 *
 * The fixture's `relativePath` field is the path *under HOME* (no leading
 * `~`). Tests are responsible for joining it with whatever home they use
 * (tmpdir, mocked `homedir()`, etc.).
 */

import { dump as yamlDump } from "js-yaml";

/** A representative MCP server entry rendered into each format's native shape. */
export interface ServerSample {
  /** Name as it appears in the config's servers record. */
  name: string;
  /** Env block — values use bash-style `${VAR}` (dirty) or `${VAR:-}` (clean). */
  env: Record<string, string>;
  /** Optional command + args + url for tested fields beyond env. */
  command?: string;
  args?: string[];
  url?: string;
}

/** One row in the agent × MCP fixture matrix. */
export interface McpAgentFixture {
  /** Agent name — must match `src/core/agents.yaml`. */
  name: string;
  /** Path under HOME (no leading `~`) — e.g. `.cursor/mcp.json`. */
  relativePath: string;
  /** Servers-record key — defaults match `agents.yaml`. */
  mcpKey: string;
  /** Config-file format — restricted to the formats the resilient sweep supports today. */
  mcpFormat: "json" | "yaml";
  /**
   * Render a single server entry into a complete config-file string.
   *
   * Each format wraps the servers record differently:
   * - json (default): `{ "mcpServers": { "<name>": { env, command, args, url? } } }`
   * - yaml (goose): `extensions:\n  <name>:\n    name: …\n    type: stdio\n    cmd: …\n    envs: { … }`
   *
   * The function returns the formatted file content ready to write to disk.
   */
  render(server: ServerSample): string;
  /**
   * Notes about why this fixture matters — surface here so a failing test
   * tells the reader what they're protecting (not just "agent X bare TOKEN").
   */
  notes: string;
}

// ── Format-specific renderers ───────────────────────────────────────────────

/** Build a single server entry's record shape from a {@link ServerSample}. */
function jsonEntry(server: ServerSample): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    command: server.command ?? "npx",
    args: server.args ?? ["-y", `@example/${server.name}@latest`],
    env: server.env,
  };
  if (server.url) entry.url = server.url;
  return entry;
}

/**
 * Render JSON with the servers record under a possibly-dotted `mcpKey`.
 *
 * Amp's `amp.mcpServers` is the live case — the key contains a literal dot
 * because the namespacing happens in the JSON parent, not in a nested path.
 * `getServers` in `mcp.ts` reads `config[mcpKey]` verbatim, so we render the
 * same way (one top-level property whose key is literally `amp.mcpServers`).
 */
function renderJson(mcpKey: string, server: ServerSample): string {
  const wrapped = { [mcpKey]: { [server.name]: jsonEntry(server) } };
  return `${JSON.stringify(wrapped, null, 2)}\n`;
}

function renderYaml(mcpKey: string, server: ServerSample): string {
  const wrapped = {
    [mcpKey]: {
      [server.name]: {
        name: server.name,
        type: "stdio",
        cmd: server.command ?? "npx",
        args: server.args ?? ["-y", `@example/${server.name}@latest`],
        envs: server.env,
        enabled: true,
        timeout: 300,
      },
    },
  };
  return yamlDump(wrapped);
}

// ── The matrix ──────────────────────────────────────────────────────────────

/**
 * Every MCP-capable agent whose config can crash a Devin-style strict
 * interpolator with a bare `${VAR}` placeholder. Drives `it.each(...)` in
 * the regression tests.
 *
 * Adding a new agent to `agents.yaml`:
 * 1. Add a row here matching the agent's `mcpConfig`, `mcpKey`, `mcpFormat`.
 * 2. Choose the right `render` function (or add a new one if the format is
 *    different from JSON/YAML/overlay-desktop).
 * 3. The regression tests in `resilient-sweep.test.ts` and the multi-agent
 *    integration tests pick up the new row automatically.
 */
export const MCP_AGENT_MATRIX: McpAgentFixture[] = [
  {
    name: "claude-code",
    relativePath: ".claude.json",
    mcpKey: "mcpServers",
    mcpFormat: "json",
    render: (s) => renderJson("mcpServers", s),
    notes: "Devin explicitly imports ~/.claude.json — historic regression source #1.",
  },
  {
    name: "cursor",
    relativePath: ".cursor/mcp.json",
    mcpKey: "mcpServers",
    mcpFormat: "json",
    render: (s) => renderJson("mcpServers", s),
    notes: "Devin explicitly imports ~/.cursor/mcp.json — historic regression source #2.",
  },
  {
    name: "windsurf",
    relativePath: ".codeium/windsurf/mcp_config.json",
    mcpKey: "mcpServers",
    mcpFormat: "json",
    render: (s) => renderJson("mcpServers", s),
    notes: "mcpm-managed; bare placeholders re-introduced on every sync prior to resilient-sweep.",
  },
  {
    name: "devin",
    relativePath: ".config/devin/config.json",
    mcpKey: "mcpServers",
    mcpFormat: "json",
    render: (s) => renderJson("mcpServers", s),
    notes:
      "Devin's own config — literal format resolves at sync time, but bare placeholders here would crash imports if peer agents reuse the same env vars.",
  },
  {
    name: "gemini-cli",
    relativePath: ".gemini/settings.json",
    mcpKey: "mcpServers",
    mcpFormat: "json",
    render: (s) => renderJson("mcpServers", s),
    notes: "mcpm-managed; same crash risk as cursor.",
  },
  {
    name: "claude-desktop",
    relativePath: "Library/Application Support/Claude/claude_desktop_config.json",
    mcpKey: "mcpServers",
    mcpFormat: "json",
    render: (s) => renderJson("mcpServers", s),
    notes: "Imported by Devin alongside ~/.claude.json — same crash class.",
  },
  {
    name: "kiro",
    relativePath: ".kiro/settings/mcp.json",
    mcpKey: "mcpServers",
    mcpFormat: "json",
    render: (s) => renderJson("mcpServers", s),
    notes: "Native carve-out write path — agentbrew writes resilient placeholders directly.",
  },
  {
    name: "amp",
    relativePath: ".config/amp/settings.json",
    mcpKey: "amp.mcpServers",
    mcpFormat: "json",
    render: (s) => renderJson("amp.mcpServers", s),
    notes: "Non-default mcpKey — exercises the configurable key plumbing in the sweep.",
  },
  {
    name: "goose",
    relativePath: ".config/goose/config.yaml",
    mcpKey: "extensions",
    mcpFormat: "yaml",
    render: (s) => renderYaml("extensions", s),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: ${VAR} in a notes string IS the documented behavior; rewriting it would obscure the meaning
    notes: "YAML format with bash-style ${VAR} — root cause of the PR #1018 fix.",
  },
];

// ── Representative env-var samples ──────────────────────────────────────────

/**
 * Env vars whose unset state historically crashed Devin's MCP loader. Each
 * has a known fallback in `src/mcp/env-vars.ts::ENV_FALLBACKS`:
 * - `GITHUB_TOKEN` / `GITHUB_PERSONAL_ACCESS_TOKEN` — `gh auth token`
 * - `SLACK_BOT_TOKEN` / `SLACK_USER_TOKEN` — macOS Keychain
 * - `JIRA_URL` / `JIRA_USERNAME` / `JIRA_API_TOKEN` — macOS Keychain
 *
 * Tests parameterize over this list so a new fallback added to `ENV_FALLBACKS`
 * picks up coverage by appending one line here.
 */
export const CRASH_PRONE_ENV_VARS: readonly string[] = [
  "GITHUB_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_USER_TOKEN",
  "JIRA_URL",
  "JIRA_USERNAME",
  "JIRA_API_TOKEN",
] as const;

/**
 * Build a server sample with bare `${VAR}` env placeholders — the dirty
 * state mcpm and similar tools produce before agentbrew's resilient sweep.
 *
 * Returns a {@link ServerSample} suitable for `render(sample)` on any fixture.
 */
export function dirtyServerSample(serverName: string, envVars: readonly string[] = CRASH_PRONE_ENV_VARS): ServerSample {
  const env: Record<string, string> = {};
  for (const v of envVars) {
    env[v] = `\${${v}}`;
  }
  return { name: serverName, env };
}

/** Resilient counterpart to {@link dirtyServerSample} — env values use `${VAR:-}`. */
export function cleanServerSample(serverName: string, envVars: readonly string[] = CRASH_PRONE_ENV_VARS): ServerSample {
  const env: Record<string, string> = {};
  for (const v of envVars) {
    env[v] = `\${${v}:-}`;
  }
  return { name: serverName, env };
}
