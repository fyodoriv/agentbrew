import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "@iarna/toml";
import yaml from "js-yaml";
import { sync as writeFileSync } from "write-file-atomic";
import { errorMessage } from "../core/errors.js";
import { logSkipped } from "../core/logger.js";
import type { McpJsonConfig, McpServer, McpServerEntry } from "../types.js";
import { parseJsonc } from "../utils.js";

/**
 * Goose extension entry in config.yaml.
 *
 * Internal-only after the `delete-dead-goose-toml-adapters` follow-up to
 * slice 4a of `delegate-mcp-to-mcpm`: `GooseAdapter` was the only external
 * consumer of this shape, and it was deleted because goose is in
 * `MCP_INTERSECTION_AGENTS` and never reaches the native sync path.
 * `GooseConfig` (line below) still references it for the `extensions:`
 * record `discoverMcpServers` reads during `agentbrew import`, so the
 * interface stays — just no longer exported.
 */
interface GooseExtension {
  name?: string;
  type?: string;
  cmd?: string;
  args?: string[];
  envs?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
  description?: string;
  bundled?: boolean;
  display_name?: string;
}

export interface GooseConfig {
  extensions?: Record<string, GooseExtension>;
  [key: string]: unknown;
}

export function readMcpJson(path: string): McpJsonConfig {
  if (!existsSync(path)) return {};
  try {
    return parseJsonc<McpJsonConfig>(readFileSync(path, "utf-8"));
  } catch (e) {
    logSkipped("mcp/mcp/readFileSync", e);
    return {};
  }
}

export function writeMcpJson(path: string, config: McpJsonConfig): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  } catch (error) {
    throw new Error(`Failed to write MCP config to ${path}: ${errorMessage(error)}`);
  }
}

/** Read the servers record from a config object using a configurable key. */
export function getServers(
  config: McpJsonConfig | Record<string, unknown>,
  mcpKey = "mcpServers",
): Record<string, McpServerEntry> {
  const raw = config as Record<string, unknown>;
  return (raw[mcpKey] as Record<string, McpServerEntry>) ?? {};
}

/** Write the servers record into a config object using a configurable key. */
export function setServers(
  config: McpJsonConfig | Record<string, unknown>,
  servers: Record<string, McpServerEntry>,
  mcpKey = "mcpServers",
): void {
  const raw = config as Record<string, unknown>;
  raw[mcpKey] = servers;
}

export function extractServersFromJson(
  config: McpJsonConfig | Record<string, unknown> | undefined,
  mcpKey = "mcpServers",
): McpServer[] {
  if (!config) return [];
  const servers = getServers(config, mcpKey);
  if (Object.keys(servers).length === 0) return [];

  return Object.entries(servers).map(([name, server]) => {
    const mcpServer: McpServer = {
      name,
      command: server.command ?? "",
      args: server.args ?? [],
      env: server.env ?? {},
      source: "discovered" as const,
    };
    if (server.url) mcpServer.url = server.url;
    if (server.headers && Object.keys(server.headers).length > 0) mcpServer.headers = server.headers;
    return mcpServer;
  });
}

export function readGooseYaml(path: string): GooseConfig {
  if (!existsSync(path)) return {};
  try {
    return (yaml.load(readFileSync(path, "utf-8")) as GooseConfig) ?? {};
  } catch (e) {
    logSkipped("mcp/mcp/readGooseYaml", e);
    return {};
  }
}

/**
 * Atomically rewrite a goose-style yaml config. The general MCP write path
 * for goose still goes through `mcpm client edit` (goose is in
 * `MCP_INTERSECTION_AGENTS`), so this writer is intentionally narrow — its
 * one live caller is `sweepOneYamlConfig` in `resilient-sweep.ts`, which
 * rewrites bare `${VAR}` placeholders to `${VAR:-}` after mcpm writes them.
 * Without this writer, goose's `extensions.<name>.envs.<KEY>: ${GITHUB_TOKEN}`
 * shape stays bare and crashes Devin's MCP loader on import.
 */
export function writeGooseYaml(path: string, config: GooseConfig): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, yaml.dump(config), "utf-8");
  } catch (error) {
    throw new Error(`Failed to write goose yaml to ${path}: ${errorMessage(error)}`);
  }
}

export function extractServersFromGoose(config: GooseConfig): McpServer[] {
  const extensions = config.extensions;
  if (!extensions) return [];

  return Object.entries(extensions)
    .filter(([, ext]) => ext.type === "stdio" && ext.cmd)
    .map(([name, ext]) => {
      const parts = (ext.cmd ?? "").split(/\s+/);
      const command = parts[0];
      const cmdArgs = [...parts.slice(1), ...(ext.args ?? [])];
      return {
        name,
        command,
        args: cmdArgs,
        env: ext.envs ?? {},
        source: "discovered" as const,
      };
    });
}

export interface TomlConfig {
  [key: string]: unknown;
}

export function readToml(path: string): TomlConfig {
  if (!existsSync(path)) return {};
  try {
    return parseToml(readFileSync(path, "utf-8")) as TomlConfig;
  } catch (e) {
    logSkipped("mcp/mcp/parseToml", e);
    return {};
  }
}

/** Read for write paths: a parse error must abort the write. `readToml`
 *  returns `{}` on error, which a round-trip would write back over the file. */
export function readTomlStrict(path: string): TomlConfig {
  if (!existsSync(path)) return {};
  return parseToml(readFileSync(path, "utf-8")) as TomlConfig;
}

export function writeToml(path: string, config: TomlConfig): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringifyToml(config as Parameters<typeof stringifyToml>[0]), "utf-8");
  } catch (error) {
    throw new Error(`Failed to write MCP config to ${path}: ${errorMessage(error)}`);
  }
}

/** Codex remote-server fields (`[mcp_servers.<name>]`), mapped back to the
 *  canonical `headers` shape so import round-trips what `TomlAdapter` writes. */
interface TomlServerEntry extends McpServerEntry {
  http_headers?: Record<string, string>;
  env_http_headers?: Record<string, string>;
  bearer_token_env_var?: string;
}

function codexHeaders(server: TomlServerEntry): Record<string, string> {
  const headers: Record<string, string> = { ...server.headers, ...server.http_headers };
  for (const [header, envVar] of Object.entries(server.env_http_headers ?? {})) {
    headers[header] = `\${${envVar}}`;
  }
  if (server.bearer_token_env_var) headers.Authorization = `Bearer \${${server.bearer_token_env_var}}`;
  return headers;
}

export function extractServersFromToml(config: TomlConfig, mcpKey = "mcpServers"): McpServer[] {
  const servers = config[mcpKey] as Record<string, TomlServerEntry> | undefined;
  if (!servers || typeof servers !== "object") return [];

  return Object.entries(servers).map(([name, server]) => {
    const mcpServer: McpServer = {
      name,
      command: server.command ?? "",
      args: server.args ?? [],
      env: server.env ?? {},
      source: "discovered" as const,
    };
    if (server.url) mcpServer.url = server.url;
    const headers = codexHeaders(server);
    if (Object.keys(headers).length > 0) mcpServer.headers = headers;
    return mcpServer;
  });
}

// `discoverMcpServers` (and its `readServersFromAgent` helper) moved to
// `./adapters.ts` so the `mcpFormat` dispatch lives in exactly one place —
// the `getAdapter` factory. It is re-exported from there for the existing
// consumers of `./mcp.js`.
export { discoverMcpServers } from "./adapters.js";
