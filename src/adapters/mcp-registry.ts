/**
 * Read-only resolver for the official MCP Registry
 * (`registry.modelcontextprotocol.io`, API `v0`, pre-1.0).
 *
 * Opt-in: `AGENTBREW_MCP_REGISTRY=1`. The local `src/catalog.yaml` stays
 * authoritative; the install path asks the registry only for a name the
 * catalog does not have. Every failure returns a reason; nothing throws,
 * so a registry outage never blocks an install.
 */

import type { CatalogMcpServer } from "../catalog/types.js";

export const MCP_REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io/v0";
const TIMEOUT_MS = 8_000;
const GENERIC_SEGMENTS = new Set(["mcp", "server", "mcp-server"]);

interface RegistryEnvVar {
  name: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

interface RegistryPackage {
  registryType?: string;
  identifier?: string;
  version?: string;
  transport?: { type?: string };
  environmentVariables?: RegistryEnvVar[];
}

interface RegistryRemote {
  type?: string;
  url?: string;
  headers?: Array<{ name: string; value?: string }>;
}

export interface RegistryServer {
  name: string;
  description?: string;
  version?: string;
  packages?: RegistryPackage[] | null;
  remotes?: RegistryRemote[] | null;
}

export type RegistryResolution =
  | { ok: true; registryName: string; server: CatalogMcpServer }
  | { ok: false; reason: "not-found" | "ambiguous" | "unsupported" | "unreachable"; detail: string };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function mcpRegistryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTBREW_MCP_REGISTRY === "1";
}

/** Last path segment of a registry name, as a local server name (`io.github.upstash/context7` → `context7`). */
function localName(registryName: string): string {
  const last = registryName.split("/").pop() ?? registryName;
  // "mcp" or "server" alone would collide across publishers; keep the namespace.
  const name = GENERIC_SEGMENTS.has(last.toLowerCase()) ? registryName : last;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `{docs_api_key}` → `${DOCS_API_KEY}`, the env-placeholder form catalog entries use. */
function envPlaceholders(value: string): string {
  return value.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key: string) => `\${${key.toUpperCase()}}`);
}

function stdioCommand(pkg: RegistryPackage): { command: string; args: string[] } | undefined {
  if (!pkg.identifier || (pkg.transport?.type ?? "stdio") !== "stdio") return undefined;
  const pinned = (separator: string) => (pkg.version ? `${pkg.identifier}${separator}${pkg.version}` : pkg.identifier);
  if (pkg.registryType === "npm") return { command: "npx", args: ["-y", pinned("@") ?? ""] };
  if (pkg.registryType === "pypi") return { command: "uvx", args: [pinned("==") ?? ""] };
  return undefined;
}

function fromPackage(base: CatalogMcpServer, pkg: RegistryPackage): CatalogMcpServer | undefined {
  const entry = stdioCommand(pkg);
  if (!entry) return undefined;
  const vars = pkg.environmentVariables ?? [];
  const required = vars.filter((v) => v.isRequired);
  const optional = vars.filter((v) => !v.isRequired).map((v) => v.name);
  return {
    ...base,
    ...entry,
    ...(required.length > 0 ? { env: Object.fromEntries(required.map((v) => [v.name, `\${${v.name}}`])) } : {}),
    ...(optional.length > 0 ? { note: `Optional env vars: ${optional.join(", ")}.` } : {}),
  };
}

function fromRemote(base: CatalogMcpServer, remote: RegistryRemote): CatalogMcpServer | undefined {
  if (!remote.url || !["streamable-http", "sse"].includes(remote.type ?? "")) return undefined;
  const headers = Object.fromEntries(
    (remote.headers ?? []).filter((h) => h.value).map((h) => [h.name, envPlaceholders(h.value ?? "")]),
  );
  return { ...base, url: remote.url, ...(Object.keys(headers).length > 0 ? { headers } : {}) };
}

/** Map a registry server to a catalog MCP entry, or undefined when no package or remote is usable here. */
export function toCatalogMcpServer(server: RegistryServer): CatalogMcpServer | undefined {
  const base: CatalogMcpServer = {
    name: localName(server.name),
    description: server.description ?? "",
    category: "registry",
    recommended: false,
    rationale: `Resolved from the official MCP Registry: ${server.name}@${server.version ?? "latest"}.`,
  };
  for (const pkg of server.packages ?? []) {
    const mapped = fromPackage(base, pkg);
    if (mapped) return mapped;
  }
  for (const remote of server.remotes ?? []) {
    const mapped = fromRemote(base, remote);
    if (mapped) return mapped;
  }
  return undefined;
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<{ status: number; body?: unknown }> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 404) return { status: 404 };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { status: response.status, body: await response.json() };
}

function pickByShortName(name: string, body: unknown): RegistryServer[] {
  const servers = (body as { servers?: Array<{ server?: RegistryServer }> } | undefined)?.servers ?? [];
  return servers
    .map((entry) => entry.server)
    .filter((server): server is RegistryServer => Boolean(server?.name))
    .filter((server) => server.name === name || server.name.endsWith(`/${name}`));
}

/** Resolve a full registry name (`owner/name`) or a short name to a catalog MCP entry. */
export async function resolveRegistryServer(
  name: string,
  options: { fetchImpl?: FetchLike; baseUrl?: string } = {},
): Promise<RegistryResolution> {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const baseUrl = options.baseUrl ?? MCP_REGISTRY_BASE_URL;
  let found: RegistryServer;
  try {
    if (name.includes("/")) {
      const result = await getJson(fetchImpl, `${baseUrl}/servers/${encodeURIComponent(name)}/versions/latest`);
      const server = (result.body as { server?: RegistryServer } | undefined)?.server;
      if (!server) return { ok: false, reason: "not-found", detail: `${name} is not in the MCP Registry` };
      found = server;
    } else {
      const result = await getJson(fetchImpl, `${baseUrl}/servers?search=${encodeURIComponent(name)}&version=latest`);
      const matches = pickByShortName(name, result.body);
      if (matches.length === 0) return { ok: false, reason: "not-found", detail: `${name} is not in the MCP Registry` };
      if (matches.length > 1) {
        return { ok: false, reason: "ambiguous", detail: `use a full name: ${matches.map((s) => s.name).join(", ")}` };
      }
      found = matches[0] as RegistryServer;
    }
  } catch (error) {
    return { ok: false, reason: "unreachable", detail: error instanceof Error ? error.message : String(error) };
  }
  const server = toCatalogMcpServer(found);
  if (!server) {
    return { ok: false, reason: "unsupported", detail: `${found.name} has no npm/pypi stdio package or http remote` };
  }
  return { ok: true, registryName: found.name, server };
}
