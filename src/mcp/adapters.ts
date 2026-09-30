import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename } from "node:path";
import { loadState } from "../state.js";
import type { AgentConfig, McpFormatAdapter, McpServer, McpServerEntry } from "../types.js";
import { expandHome } from "../utils.js";
import { wrapCursorGuiStdioEntry } from "./cursor-gui-launch.js";
import {
  applyEntryUpdate,
  convertEnvVars,
  convertServerEnvVars,
  getInheritedServerEnvKeys,
  toCanonical,
} from "./env-vars.js";
import {
  extractServersFromGoose,
  extractServersFromJson,
  extractServersFromToml,
  getServers,
  readGooseYaml,
  readMcpJson,
  readToml,
  readTomlStrict,
  setServers,
  writeMcpJson,
  writeToml,
} from "./mcp.js";

// Slice 4b of `delegate-mcp-to-mcpm`: the `claude mcp add-json` /
// `claude mcp remove` CLI bridge (`ClaudeAdapter.syncViaCli`,
// `ClaudeAdapter.removeServer`) is gone — claude-code is filtered out
// of `getMcpTargetAgents` (slice 4a) so the bridge code is unreachable.
// `CLAUDE_CLI_TIMEOUT_MS` and the `node:child_process` import went with it.
//
// goose (yaml) and codex (toml) are in `MCP_INTERSECTION_AGENTS`, so their
// stdio servers go through mcpm. The remote-HTTPS carve-out in
// `syncMcpServers` still writes natively to every intersection client:
// `TomlAdapter` supports that for codex; `YamlAdapter` stays read-only.

// McpFormatAdapter is defined in types.ts — import it from there directly.
const INHERITED_ENV_KEYS = Symbol("agentbrewInheritedEnvKeys");

type JsonEntry = Record<string, unknown> & { [INHERITED_ENV_KEYS]?: string[] };

function markInheritedEnvKeys(entry: JsonEntry, inheritedKeys: string[]): void {
  if (inheritedKeys.length === 0) return;
  Object.defineProperty(entry, INHERITED_ENV_KEYS, {
    value: inheritedKeys,
    enumerable: false,
  });
}

function removeInheritedEnvKeys(existing: Record<string, unknown>, inheritedKeys: string[]): void {
  if (inheritedKeys.length === 0 || !existing.env || typeof existing.env !== "object") return;
  const env = existing.env as Record<string, unknown>;
  for (const key of inheritedKeys) {
    delete env[key];
  }
  if (Object.keys(env).length === 0) delete existing.env;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function desiredKeysMatch(existingValue: unknown, desiredValue: unknown): boolean {
  const existing = asRecord(existingValue);
  const desired = asRecord(desiredValue);
  return Object.keys(desired).every((key) => existing[key] === desired[key]);
}

function envEntriesMatch(existing: Record<string, unknown>, desired: Record<string, unknown>): boolean {
  const existingEnv = asRecord(existing.env);
  const inheritedEnvKeys = (desired as JsonEntry)[INHERITED_ENV_KEYS] ?? [];
  const inheritedKeysAlreadyRemoved = inheritedEnvKeys.every((key) => !Object.hasOwn(existingEnv, key));
  return inheritedKeysAlreadyRemoved && desiredKeysMatch(existing.env, desired.env);
}

/** URL-based servers (SSE/HTTP transport with optional auth headers). */
function toJsonRemoteEntry(server: McpServer, url: string, agentName: string, inheritedEnvKeys: string[]): JsonEntry {
  const entry: JsonEntry = { url };
  // Claude Code requires an explicit transport type for remote MCP servers.
  // Cursor and other JSON clients infer it from the URL.
  if (agentName === "claude-code" || agentName === "claude-desktop") {
    entry.type = "http";
  }
  if (server.headers && Object.keys(server.headers).length > 0) {
    entry.headers = convertEnvVars(server.headers, agentName);
  }
  if (Object.keys(server.env).length > 0) {
    const env = convertServerEnvVars(server.env, agentName);
    if (Object.keys(env).length > 0) entry.env = env;
  }
  markInheritedEnvKeys(entry, inheritedEnvKeys);
  return entry;
}

// ── JSON adapter ────────────────────────────────────────────────────────────

/**
 * Handles the standard JSON MCP config format used by Claude Code, Cursor, Windsurf,
 * and most other agents — servers stored as a name-keyed map under a configurable
 * `mcpKey` (e.g. `mcpServers`).
 */
export class JsonAdapter implements McpFormatAdapter {
  readEntries(configPath: string, mcpKey: string): Record<string, Record<string, unknown>> {
    const config = readMcpJson(configPath);
    return getServers(config, mcpKey) as Record<string, Record<string, unknown>>;
  }

  writeEntries(configPath: string, entries: Record<string, Record<string, unknown>>, mcpKey: string): void {
    const config = readMcpJson(configPath);
    setServers(config, entries as Record<string, McpServerEntry>, mcpKey);
    writeMcpJson(configPath, config);
  }

  toEntry(server: McpServer, agentName: string): Record<string, unknown> {
    const inheritedEnvKeys = getInheritedServerEnvKeys(server.env, agentName);
    if (server.url) return toJsonRemoteEntry(server, server.url, agentName, inheritedEnvKeys);

    // stdio-based servers
    const entry: JsonEntry = { command: server.command };
    if (server.args.length > 0) entry.args = server.args;
    if (Object.keys(server.env).length > 0) {
      const env = convertServerEnvVars(server.env, agentName);
      if (Object.keys(env).length > 0) entry.env = env;
    }
    markInheritedEnvKeys(entry, inheritedEnvKeys);
    return wrapCursorGuiStdioEntry(server, entry, agentName);
  }

  /** Compares only agentbrew-managed fields (command, args, env, url, headers).
   *  For nested objects (env, headers), only compares the keys present in `desired` —
   *  user-added keys in `existing` are ignored so they don't trigger spurious updates. */
  entriesMatch(existing: Record<string, unknown>, desired: Record<string, unknown>): boolean {
    if (existing.command !== desired.command) return false;
    if (JSON.stringify(existing.args) !== JSON.stringify(desired.args)) return false;
    if ((existing.url ?? undefined) !== (desired.url ?? undefined)) return false;
    if ("type" in desired && existing.type !== desired.type) return false;

    // Compare only agentbrew-managed env/header keys; user-added keys don't trigger updates.
    return envEntriesMatch(existing, desired) && desiredKeysMatch(existing.headers, desired.headers);
  }

  /** Merges agentbrew-managed fields into existing entry, preserving user-added
   *  fields (e.g. autoApprove, description, disabled).  For nested objects like
   *  `env` and `headers`, user-added keys survive — agentbrew keys are applied on top. */
  applyUpdate(
    entries: Record<string, Record<string, unknown>>,
    serverName: string,
    entry: Record<string, unknown>,
  ): void {
    // Pre-merge headers before delegating to the shared env-merge helper.
    // Headers use a simple spread (incoming wins) rather than the placeholder-aware merge.
    if (entries[serverName]) {
      const existing = entries[serverName];
      removeInheritedEnvKeys(existing, (entry as JsonEntry)[INHERITED_ENV_KEYS] ?? []);
      if (
        entry.headers &&
        typeof entry.headers === "object" &&
        existing.headers &&
        typeof existing.headers === "object"
      ) {
        entry = {
          ...entry,
          headers: { ...(existing.headers as Record<string, unknown>), ...(entry.headers as Record<string, unknown>) },
        };
      }
    }
    applyEntryUpdate(entries, serverName, entry);
  }

  isPrunable(_name: string, _entry: Record<string, unknown>): boolean {
    return true;
  }

  discoverServers(configPath: string, mcpKey: string): McpServer[] {
    const config = readMcpJson(configPath);
    return extractServersFromJson(config, mcpKey);
  }

  removeServer(configPath: string, serverName: string, mcpKey: string): boolean {
    const config = readMcpJson(configPath);
    const servers = getServers(config, mcpKey);
    if (!servers[serverName]) return false;
    delete servers[serverName];
    setServers(config, servers, mcpKey);
    writeMcpJson(configPath, config);
    return true;
  }
}

// ── OpenCode adapter ────────────────────────────────────────────────────────

/**
 * opencode 1.14+ rejects the standard MCP stdio shape (`{command, args, env}`)
 * — its config schema requires `{ type: "local", command: [cmd, ...args] }`
 * with `environment` (not `env`), or `{ type: "remote", url, headers? }`. The
 * schema sets `additionalProperties: false`, so any stray `args`/`env`/scalar
 * `command` key from the old shape blocks opencode-serve from starting.
 *
 * This adapter only overrides the shape conversion (toEntry / entriesMatch /
 * applyUpdate / discoverServers); file I/O is inherited from JsonAdapter since
 * the opencode config file is still a JSON object keyed by server name under
 * `mcp`. See [agents.yaml] (`mcpFormat: opencode`) and the schema at
 * https://opencode.ai/config.json (`McpLocalConfig` / `McpRemoteConfig`).
 */
export class OpenCodeAdapter extends JsonAdapter {
  /** Keys agentbrew owns end-to-end — when applyUpdate runs, anything else on
   *  an existing entry that is NOT user-set metadata (`enabled`, `timeout`) is
   *  stripped, because opencode's schema is `additionalProperties: false`. */
  private static readonly PRESERVED_USER_KEYS = new Set(["enabled", "timeout"]);

  override toEntry(server: McpServer, agentName: string): Record<string, unknown> {
    const inheritedEnvKeys = getInheritedServerEnvKeys(server.env, agentName);

    if (server.url) {
      const entry: JsonEntry = { type: "remote", url: server.url };
      if (server.headers && Object.keys(server.headers).length > 0) {
        entry.headers = convertEnvVars(server.headers, agentName);
      }
      // Remote schema has additionalProperties:false and no `environment` field;
      // env on a URL server is dropped to keep the entry valid.
      markInheritedEnvKeys(entry, inheritedEnvKeys);
      return entry;
    }

    // stdio: collapse command + args into a single string array.
    const command = [server.command, ...server.args];
    const entry: JsonEntry = { type: "local", command };
    if (Object.keys(server.env).length > 0) {
      const env = convertServerEnvVars(server.env, agentName);
      if (Object.keys(env).length > 0) entry.environment = env;
    }
    markInheritedEnvKeys(entry, inheritedEnvKeys);
    return entry;
  }

  override entriesMatch(existing: Record<string, unknown>, desired: Record<string, unknown>): boolean {
    if (existing.type !== desired.type) return false;
    if (JSON.stringify(existing.command) !== JSON.stringify(desired.command)) return false;
    if ((existing.url ?? undefined) !== (desired.url ?? undefined)) return false;

    const inheritedEnvKeys = (desired as JsonEntry)[INHERITED_ENV_KEYS] ?? [];
    const existingEnvironment = asRecord(existing.environment);
    const inheritedAlreadyRemoved = inheritedEnvKeys.every((key) => !Object.hasOwn(existingEnvironment, key));
    if (!inheritedAlreadyRemoved) return false;
    if (!desiredKeysMatch(existing.environment, desired.environment)) return false;
    return desiredKeysMatch(existing.headers, desired.headers);
  }

  override applyUpdate(
    entries: Record<string, Record<string, unknown>>,
    serverName: string,
    entry: Record<string, unknown>,
  ): void {
    const existing = entries[serverName];
    if (!existing) {
      entries[serverName] = entry;
      return;
    }

    // Strip legacy/extra keys from the existing entry — opencode's schema is
    // additionalProperties:false, so a leftover `args` or scalar `command` from
    // the old format would block opencode-serve. Preserve only the user-set
    // metadata keys (`enabled`, `timeout`).
    for (const key of Object.keys(existing)) {
      if (!OpenCodeAdapter.PRESERVED_USER_KEYS.has(key)) delete existing[key];
    }

    // Merge environment with user-resolved-wins semantics (same as JsonAdapter
    // env merge, but on the `environment` field).
    applyEntryUpdate(entries, serverName, entry, "environment");
  }

  override discoverServers(configPath: string, mcpKey: string): McpServer[] {
    const config = readMcpJson(configPath);
    const servers = getServers(config, mcpKey) as Record<string, Record<string, unknown>>;
    if (Object.keys(servers).length === 0) return [];

    return Object.entries(servers).map(([name, raw]) => {
      const commandArray = Array.isArray(raw.command) ? (raw.command as string[]) : [];
      const [command = "", ...args] = commandArray;
      const environment = (raw.environment as Record<string, string> | undefined) ?? {};
      const headers = raw.headers as Record<string, string> | undefined;
      const url = typeof raw.url === "string" ? raw.url : undefined;
      const mcpServer: McpServer = {
        name,
        command,
        args,
        env: environment,
        source: "discovered" as const,
      };
      if (url) mcpServer.url = url;
      if (headers && Object.keys(headers).length > 0) mcpServer.headers = headers;
      return mcpServer;
    });
  }
}

// ── Yaml / Toml adapters (read-only) ────────────────────────────────────────

/**
 * Goose-style yaml MCP config (`extensions:` record). Today goose is in
 * `MCP_INTERSECTION_AGENTS`, so the native write path is unreachable —
 * `getMcpTargetAgents` filters it out and writes go through `mcpm client edit`.
 * Only `discoverServers` runs against it (during `agentbrew init` and
 * `agentbrew import`), so write/match/update inherit from JsonAdapter where
 * they'd never be called; if they ever are, the surfaced error makes the
 * regression obvious instead of silently corrupting the yaml file with JSON.
 */
class YamlAdapter extends JsonAdapter {
  override discoverServers(configPath: string): McpServer[] {
    return extractServersFromGoose(readGooseYaml(configPath));
  }

  override readEntries(): never {
    throw new Error("YamlAdapter is read-only — write paths go through mcpm for goose-class agents");
  }

  override writeEntries(): never {
    throw new Error("YamlAdapter is read-only — write paths go through mcpm for goose-class agents");
  }
}

const CODEX_REMOTE_FIELDS = ["http_headers", "env_http_headers", "bearer_token_env_var"] as const;
const PLACEHOLDER = /\$\{[A-Z_][A-Z0-9_]*(?::-[^}]*)?\}/;
const ENV_ONLY_VALUE = /^\$\{([A-Z_][A-Z0-9_]*)(?::-[^}]*)?\}$/;
const BEARER_ENV_VALUE = /^Bearer \$\{([A-Z_][A-Z0-9_]*)(?::-[^}]*)?\}$/;

/** Codex rejects `env`, `args`, and `bearer_token` next to `url`, and never
 *  expands `${VAR}` inside a header value, so each header maps to the one
 *  Codex field that can carry it. */
function toCodexRemoteEntry(server: McpServer, url: string): Record<string, unknown> {
  const entry: Record<string, unknown> = { url };
  const httpHeaders: Record<string, string> = {};
  const envHttpHeaders: Record<string, string> = {};
  for (const [header, raw] of Object.entries(server.headers ?? {})) {
    const value = toCanonical(raw);
    const bearer = header.toLowerCase() === "authorization" ? BEARER_ENV_VALUE.exec(value) : null;
    const envOnly = ENV_ONLY_VALUE.exec(value);
    if (bearer) entry.bearer_token_env_var = bearer[1];
    else if (envOnly) envHttpHeaders[header] = envOnly[1];
    else if (!PLACEHOLDER.test(value)) httpHeaders[header] = value;
    else {
      throw new Error(
        `Codex cannot express header "${header}" of MCP server "${server.name}": it mixes literal text with an env var`,
      );
    }
  }
  if (Object.keys(httpHeaders).length > 0) entry.http_headers = httpHeaders;
  if (Object.keys(envHttpHeaders).length > 0) entry.env_http_headers = envHttpHeaders;
  return entry;
}

/**
 * Codex `config.toml` (`[mcp_servers.<name>]` tables). Codex stays in
 * `MCP_INTERSECTION_AGENTS`, so stdio servers reach it through
 * `mcpm client edit`. This adapter writes the remote HTTPS servers that
 * `requiresNativeHttpTransport` withholds from mcpm, and rewrites the whole
 * file (other top-level keys preserved) the same way `model-sync` does.
 */
class TomlAdapter extends JsonAdapter {
  override readEntries(configPath: string, mcpKey: string): Record<string, Record<string, unknown>> {
    return getServers(readTomlStrict(configPath), mcpKey) as Record<string, Record<string, unknown>>;
  }

  override writeEntries(configPath: string, entries: Record<string, Record<string, unknown>>, mcpKey: string): void {
    const config = readTomlStrict(configPath);
    setServers(config, entries as Record<string, McpServerEntry>, mcpKey);
    writeToml(configPath, config);
  }

  override toEntry(server: McpServer, agentName: string): Record<string, unknown> {
    return server.url ? toCodexRemoteEntry(server, server.url) : super.toEntry(server, agentName);
  }

  override entriesMatch(existing: Record<string, unknown>, desired: Record<string, unknown>): boolean {
    if (!("url" in desired)) return super.entriesMatch(existing, desired);
    return (
      existing.url === desired.url &&
      existing.command === undefined &&
      existing.bearer_token_env_var === desired.bearer_token_env_var &&
      desiredKeysMatch(existing.http_headers, desired.http_headers) &&
      desiredKeysMatch(existing.env_http_headers, desired.env_http_headers)
    );
  }

  override applyUpdate(
    entries: Record<string, Record<string, unknown>>,
    serverName: string,
    entry: Record<string, unknown>,
  ): void {
    super.applyUpdate(entries, serverName, entry);
    const updated = entries[serverName];
    for (const key of CODEX_REMOTE_FIELDS) {
      if (!(key in entry) && key in updated) delete updated[key];
    }
  }

  override discoverServers(configPath: string, mcpKey: string): McpServer[] {
    return extractServersFromToml(readToml(configPath), mcpKey);
  }

  override removeServer(configPath: string, serverName: string, mcpKey: string): boolean {
    const config = readTomlStrict(configPath);
    const servers = getServers(config, mcpKey);
    if (!servers[serverName]) return false;
    delete servers[serverName];
    setServers(config, servers, mcpKey);
    writeToml(configPath, config);
    return true;
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

const jsonAdapter = new JsonAdapter();
const opencodeAdapter = new OpenCodeAdapter();
const yamlAdapter = new YamlAdapter();
const tomlAdapter = new TomlAdapter();

/**
 * Returns the adapter for an agent's MCP config format.
 *
 * Single source of `mcpFormat` dispatch — `import.ts` (`readDiscoveredServers`)
 * and `mcp.ts` (`readServersFromAgent`) used to maintain parallel if-chains
 * that drifted (`fix-opencode-adapter-format` added the opencode branch to
 * one but missed the other, breaking `agentbrew init` against opencode 1.14+
 * configs). Both paths now call `getAdapter().discoverServers()` instead, so
 * registering a new `mcpFormat` is a one-line change here.
 *
 * The exhaustive switch over the `mcpFormat` union (typed via the
 * `MCP_FORMAT_DISPATCH satisfies` map) is the load-bearing property — adding
 * a literal to the `mcpFormat` union without a corresponding adapter is a
 * TypeScript compile error, not a runtime discovery silent-fall-through.
 *
 * Write-path note: after slice 4a/4b of `delegate-mcp-to-mcpm`, MCP_INTERSECTION_AGENTS
 * intersection gets stdio servers through mcpm. Only the remote-HTTPS
 * carve-out writes to them natively: TomlAdapter (codex) supports it, and
 * YamlAdapter (goose) still throws on `readEntries`/`writeEntries`.
 */
// Core formats are statically dispatched (exhaustiveness-checked via the
// `satisfies` below). Any other `mcpFormat` string is resolved at runtime from
// a team-overlay adapter dir — see `loadOverlayAdapter`. Product-specific
// formats (e.g. the team desktop app's `overlay-desktop`) ship in a
// team overlay's adapters/<format>/adapter.js, not in core.
type CoreMcpFormat = "json" | "yaml" | "toml" | "opencode";

const MCP_FORMAT_DISPATCH = {
  json: jsonAdapter,
  yaml: yamlAdapter,
  toml: tomlAdapter,
  opencode: opencodeAdapter,
} satisfies Record<CoreMcpFormat, McpFormatAdapter>;

// ── Team-overlay adapter loading ─────────────────────────────────────────────
const requireCjs = createRequire(import.meta.url);
const overlayAdapterCache = new Map<string, McpFormatAdapter | null>();

/** Duck-type check that a loaded module is a usable {@link McpFormatAdapter}. */
function isMcpFormatAdapter(value: unknown): value is McpFormatAdapter {
  const a = value as Partial<McpFormatAdapter> | null;
  return (
    !!a &&
    typeof a.readEntries === "function" &&
    typeof a.writeEntries === "function" &&
    typeof a.toEntry === "function" &&
    typeof a.entriesMatch === "function" &&
    typeof a.applyUpdate === "function" &&
    typeof a.isPrunable === "function" &&
    typeof a.discoverServers === "function" &&
    typeof a.removeServer === "function"
  );
}

/**
 * Resolve an MCP-format adapter shipped by the active team overlay. The overlay
 * declares adapter dirs in its Agentfile (`adapters:`), resolved into
 * `state.team.adapterDirs`; each dir's basename is the `mcpFormat` it serves and
 * contains a CommonJS `adapter.js` exporting an McpFormatAdapter class. Cached
 * per format (including negative results). Returns null if none matches.
 */
function loadOverlayAdapter(format: string): McpFormatAdapter | null {
  if (overlayAdapterCache.has(format)) return overlayAdapterCache.get(format) ?? null;

  let resolved: McpFormatAdapter | null = null;
  const dirs = loadState()?.team?.adapterDirs ?? [];
  for (const dir of dirs) {
    if (basename(dir) !== format) continue;
    try {
      const loaded = requireCjs(dir) as unknown;
      const AdapterClass = ((loaded as { default?: unknown }).default ?? loaded) as new () => unknown;
      const instance = typeof AdapterClass === "function" ? new AdapterClass() : loaded;
      if (isMcpFormatAdapter(instance)) {
        resolved = instance;
        break;
      }
      console.error(`Overlay MCP adapter "${format}" at ${dir} does not implement McpFormatAdapter — skipping`);
    } catch (error) {
      // Loud but non-fatal: a broken overlay adapter must not crash core sync.
      console.error(`Failed to load overlay MCP adapter "${format}" from ${dir}: ${error}`);
    }
  }

  overlayAdapterCache.set(format, resolved);
  return resolved;
}

/** Test-only: clear the cached overlay adapters (call after changing state.team). */
export function resetOverlayAdapterCache(): void {
  overlayAdapterCache.clear();
}

export function getAdapter(agent: Pick<AgentConfig, "name" | "mcpFormat">): McpFormatAdapter {
  const format = agent.mcpFormat ?? "json";
  const core = (MCP_FORMAT_DISPATCH as Record<string, McpFormatAdapter>)[format];
  if (core) return core;

  const overlay = loadOverlayAdapter(format);
  if (overlay) return overlay;

  throw new Error(
    `No MCP adapter for format "${format}" (agent "${agent.name}"). ` +
      `Core formats: ${Object.keys(MCP_FORMAT_DISPATCH).join(", ")}. ` +
      "Overlay formats are provided by a team adapter dir — run `agentbrew team set <url>` if this format ships in an overlay.",
  );
}

// ── Discovery (init / import) ───────────────────────────────────────────────

/**
 * Read every detected agent's MCP config via the format-specific adapter
 * and merge into a deduplicated server list. Used by `agentbrew init` (to
 * bootstrap state from existing configs) and re-exported from `./mcp.js`
 * for backward compatibility.
 */
export function discoverMcpServers(agents: AgentConfig[]): McpServer[] {
  const allServers = new Map<string, McpServer>();

  for (const agent of agents) {
    if (!agent.detected || !agent.mcpConfig) continue;
    const configPath = expandHome(agent.mcpConfig);
    if (!existsSync(configPath)) continue;

    for (const server of getAdapter(agent).discoverServers(configPath, agent.mcpKey ?? "mcpServers")) {
      if (!allServers.has(server.name)) {
        allServers.set(server.name, server);
      }
    }
  }

  return Array.from(allServers.values());
}
