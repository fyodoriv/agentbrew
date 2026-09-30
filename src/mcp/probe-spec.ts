import type { McpProbeSpec } from "./probe.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEnv(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") env[key] = entry;
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

function normalizeHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") headers[key] = entry;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Normalize an on-disk MCP entry into the shape {@link probeServer} expects.
 * Handles standard `{ command, args }` JSON, OpenCode 1.14+ `{ type, command: [] }`,
 * and HTTP `{ url }` entries.
 */
export function normalizeMcpProbeSpec(raw: unknown): McpProbeSpec | undefined {
  if (!isRecord(raw)) return undefined;

  if (typeof raw.url === "string") {
    return { url: raw.url, headers: normalizeHeaders(raw.headers) };
  }

  if (Array.isArray(raw.command)) {
    const parts = raw.command.filter((part): part is string => typeof part === "string");
    if (parts.length === 0) return undefined;
    const [command, ...args] = parts;
    return { command, args, env: normalizeEnv(raw.environment ?? raw.env) };
  }

  if (typeof raw.command !== "string") return undefined;

  const args = Array.isArray(raw.args) ? raw.args.filter((part): part is string => typeof part === "string") : [];
  return { command: raw.command, args, env: normalizeEnv(raw.env ?? raw.environment) };
}

/**
 * Normalize a full MCP server map from an agent config file.
 */
export function normalizeMcpProbeServerMap(raw: unknown): Record<string, McpProbeSpec> {
  if (!isRecord(raw)) return {};
  const normalized: Record<string, McpProbeSpec> = {};
  for (const [name, entry] of Object.entries(raw)) {
    const spec = normalizeMcpProbeSpec(entry);
    if (spec) normalized[name] = spec;
  }
  return normalized;
}
