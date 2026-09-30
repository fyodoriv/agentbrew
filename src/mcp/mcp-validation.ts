import chalk from "chalk";
import { requireState } from "../state.js";
import type { McpServer } from "../types.js";
import { resolveEnvVar } from "./env-vars.js";

// ── Setup instruction types ──────────────────────────────────────────────────

/** Catalog-provided setup instructions for a single env var. */
export interface EnvVarSetupInfo {
  description: string;
  link?: string;
  steps?: string[];
}

// ── Env var extraction ───────────────────────────────────────────────────────

/** Matches ${VAR} placeholder syntax in server config strings. */
export const ENV_VAR_PATTERN = /\$\{([^}:]+)\}/g;

/** Extract all ${VAR} references from a server's args, env values, url, and headers. */
export function extractEnvVars(server: {
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}): string[] {
  const vars = new Set<string>();
  const scan = (value: string) => {
    for (const match of value.matchAll(ENV_VAR_PATTERN)) {
      vars.add(match[1]);
    }
  };

  for (const arg of server.args ?? []) scan(arg);
  for (const value of Object.values(server.env ?? {})) scan(value);
  if (server.url) scan(server.url);
  for (const value of Object.values(server.headers ?? {})) scan(value);

  return [...vars];
}

/**
 * Check if an env var is resolved — delegates to resolveEnvVar() so that
 * Keychain, gh-auth, and other well-known fallbacks are considered.
 * This keeps health/status checks consistent with the literal-format sync path.
 */
export function isEnvVarResolved(varName: string): boolean {
  const alwaysAvailable = new Set(["HOME", "USER", "PATH", "SHELL", "TERM"]);
  if (alwaysAvailable.has(varName)) return true;
  return resolveEnvVar(varName) !== undefined;
}

// ── Validation: check env vars before sync ───────────────────────────────────

/** Warning returned when an installed MCP server has unresolved env var placeholders. */
export interface McpValidationWarning {
  serverName: string;
  missingVars: string[];
}

/** Validate all installed MCP servers have their env vars set. Returns warnings. */
export function validateMcpEnvVars(servers?: McpServer[]): McpValidationWarning[] {
  const state = requireState({ quiet: true });
  const toCheck = servers ?? state?.mcpServers ?? [];
  const warnings: McpValidationWarning[] = [];

  for (const server of toCheck) {
    const requiredVars = extractEnvVars(server);
    const missingVars = requiredVars.filter((v) => !isEnvVarResolved(v));
    if (missingVars.length > 0) {
      warnings.push({ serverName: server.name, missingVars });
    }
  }

  return warnings;
}

/**
 * Checks whether an MCP server entry is structurally valid and safe to write to
 * an agent config. Rejects stdio-based servers with empty or whitespace-only
 * commands — these crash agent MCP loaders (e.g. Devin) and are never valid.
 * URL-based servers are valid as long as the url is non-empty.
 */
export function isValidMcpServer(server: McpServer): boolean {
  if (server.url) return server.url.trim().length > 0;
  return !!server.command && server.command.trim().length > 0;
}

/**
 * Filter out structurally invalid servers from a list. Logs a warning per
 * skipped server. Prevents broken entries (empty commands, blank URLs) from
 * being written to any agent config and crashing their MCP loader.
 */
export function filterInvalidServers(servers: McpServer[], log: (msg: string) => void): McpServer[] {
  return servers.filter((server) => {
    if (isValidMcpServer(server)) return true;
    log(
      `  ⚠ skipping "${server.name}" — invalid config (empty command). Edit ~/.config/agentbrew/state.yaml to fix the entry, or run \`agentbrew remove ${server.name}\` to drop it.`,
    );
    return false;
  });
}

/** Print validation warnings to stdout. Returns true if there are any warnings. */
export function printValidationWarnings(warnings: McpValidationWarning[]): boolean {
  if (warnings.length === 0) return false;

  console.log(chalk.yellow(`\n  ⚠ ${warnings.length} MCP server(s) have missing env vars:\n`));
  for (const warning of warnings) {
    console.log(`    ${chalk.cyan(warning.serverName)} — missing: ${chalk.yellow(warning.missingVars.join(", "))}`);
  }
  console.log(chalk.dim(`\n  Run ${chalk.white("agentbrew setup")} to configure.\n`));
  return true;
}
