import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { logSkipped } from "../core/logger.js";
import { MCP_INTERSECTION_AGENTS } from "../core/mcp-agent-map.js";
import { delegateMcpUninstall, listMcpmServerNames } from "../sync/mcp-delegate.js";
import type { AgentConfig, McpServer } from "../types.js";
import { expandHome } from "../utils.js";

const nativeRequire = createRequire(import.meta.url);

/** Lazy — avoids agents→state→state-manager→mcpm-hygiene→types→agents init cycle. */
function loadAgentDefinitionsForHygiene(): Omit<AgentConfig, "detected">[] {
  const { loadAgentDefinitions } = nativeRequire("../core/agents.js") as typeof import("../core/agents.js");
  return loadAgentDefinitions();
}

import { readGooseYaml, readMcpJson, writeGooseYaml, writeMcpJson } from "./mcp.js";

export const MCPM_PREFIX = "mcpm_";

/** mcpm registry servers that fail probe and have no agentbrew-managed bare equivalent.
 *  A team overlay adds its own names via `broken_mcpm_registry_servers:` in
 *  `catalog-overlay.yaml`; see `withExtraBrokenRegistryServers`. */
export const BROKEN_MCPM_REGISTRY_SERVERS = ["ask-human", "jira-mcp"] as const;

/** The generic list plus extra names, such as a team overlay's list.
 *  Blank and non-string entries are ignored. */
export function withExtraBrokenRegistryServers(extra: unknown): readonly string[] {
  const names = Array.isArray(extra)
    ? extra.filter((name): name is string => typeof name === "string").map((name) => name.trim())
    : [];
  return [...new Set([...BROKEN_MCPM_REGISTRY_SERVERS, ...names.filter(Boolean)])];
}

const DEPRECATED_GITHUB_NPM = "@modelcontextprotocol/server-github";

export interface McpmHygieneFileResult {
  path: string;
  agentName: string;
  removedKeys: string[];
  fixedGithub: boolean;
  fixedMemory: boolean;
}

export interface McpmHygieneSweepOptions {
  dryRun?: boolean;
  detected?: AgentConfig[];
  stateServerNames?: ReadonlySet<string>;
  /** Pass from callers that already import agent definitions. The lazy
   *  fallback resolves `../core/agents.js` relative to this file, which
   *  does not exist next to the bundled `dist/cli.js`. */
  agentDefinitions?: readonly Omit<AgentConfig, "detected">[];
  /** Defaults to `BROKEN_MCPM_REGISTRY_SERVERS`. */
  brokenRegistryServers?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mcpmBareName(entryName: string): string | undefined {
  if (!entryName.startsWith(MCPM_PREFIX)) return undefined;
  return entryName.slice(MCPM_PREFIX.length);
}

/** Drop `mcpm_playwright` when bare `playwright` already exists and works. */
export function findRedundantMcpmKeys(servers: Record<string, unknown>): string[] {
  const keys = Object.keys(servers);
  return keys.filter((key) => {
    const bare = mcpmBareName(key);
    return bare !== undefined && keys.includes(bare);
  });
}

/** True when the blocklist may act on this name — state definitions always win.
 *
 *  The blocklist targets mcpm's *community registry* copies of these servers,
 *  which have no working command on this machine. Once agentbrew state defines
 *  the same name (an Agentfile wrapper, a local URL), that definition is the
 *  authoritative one and removing it would leave the agent with no entry at
 *  all — the failure mode that hid `jira-mcp` from every intersection client. */
export function isBlocklistedRegistryServer(
  name: string,
  stateNames: ReadonlySet<string>,
  brokenNames: readonly string[] = BROKEN_MCPM_REGISTRY_SERVERS,
): boolean {
  if (stateNames.has(name)) return false;
  return brokenNames.includes(name);
}

/** Drop broken mcpm-only wrappers such as `mcpm_ask-human`. */
export function findBrokenMcpmOnlyKeys(
  servers: Record<string, unknown>,
  stateNames: ReadonlySet<string>,
  brokenNames: readonly string[] = BROKEN_MCPM_REGISTRY_SERVERS,
): string[] {
  return Object.keys(servers).filter((key) => {
    const bare = mcpmBareName(key);
    return bare !== undefined && isBlocklistedRegistryServer(bare, stateNames, brokenNames);
  });
}

export function findRemovableStaleKeys(servers: Record<string, unknown>, stateNames: ReadonlySet<string>): string[] {
  const removable: string[] = [];
  if (stateNames.has("composio") && "jira-mcp" in servers && !stateNames.has("jira-mcp")) {
    removable.push("jira-mcp");
  }
  if ("ask-human" in servers && !stateNames.has("ask-human")) removable.push("ask-human");
  return removable;
}

const GITHUB_LAUNCHER_NAMES = ["organization-github-mcp", "github-mcp"] as const;

/** mcp-memory-service deprecated `memory-server` subcommand — slow init + probe timeouts on amp. */
export function fixDeprecatedMemoryServerArgs(args: unknown): boolean {
  if (!Array.isArray(args)) return false;
  const index = args.indexOf("memory-server");
  if (index === -1) return false;
  args.splice(index, 1, "memory", "server");
  return true;
}

export function fixMemoryEntry(entry: Record<string, unknown>): boolean {
  return fixDeprecatedMemoryServerArgs(entry.args);
}

export function resolveGithubLauncherPath(
  homeDir: string = homedir(),
  exists: (path: string) => boolean = existsSync,
  listBinDir: (binDir: string) => string[] = (binDir) => {
    try {
      return readdirSync(binDir);
    } catch {
      return [];
    }
  },
): string {
  if (process.env.AGENTBREW_GITHUB_MCP_BIN) return process.env.AGENTBREW_GITHUB_MCP_BIN;
  const binDir = join(homeDir, ".local/bin");
  for (const name of GITHUB_LAUNCHER_NAMES) {
    const candidate = join(binDir, name);
    if (exists(candidate)) return candidate;
  }
  const discovered = listBinDir(binDir).find(
    (name) =>
      name.endsWith("-github-mcp") && !GITHUB_LAUNCHER_NAMES.includes(name as (typeof GITHUB_LAUNCHER_NAMES)[number]),
  );
  if (discovered) return join(binDir, discovered);
  return join(binDir, GITHUB_LAUNCHER_NAMES[0]);
}

export function githubLauncherPath(): string {
  return resolveGithubLauncherPath();
}

export function isDeprecatedGithubEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  if (typeof entry.command === "string") {
    if (entry.command.includes("github-mcp")) return false;
    if (entry.command === "npx" && Array.isArray(entry.args)) {
      return entry.args.some((arg) => typeof arg === "string" && arg.includes(DEPRECATED_GITHUB_NPM));
    }
  }
  if (Array.isArray(entry.command)) {
    return entry.command.some((part) => typeof part === "string" && part.includes(DEPRECATED_GITHUB_NPM));
  }
  return false;
}

export function fixBrokenGithubLauncherEntry(entry: Record<string, unknown>, launcherPath: string): boolean {
  if (typeof entry.command !== "string") return false;
  if (!entry.command.includes("github-mcp")) return false;
  if (existsSync(entry.command)) return false;
  if (entry.command === launcherPath) return false;
  for (const key of ["args", "env", "environment"]) {
    delete entry[key];
  }
  entry.command = launcherPath;
  return true;
}

export function fixDeprecatedGithubEntry(entry: Record<string, unknown>, launcherPath: string): boolean {
  if (!isDeprecatedGithubEntry(entry)) return false;
  for (const key of ["args", "env", "environment"]) {
    delete entry[key];
  }
  if (Array.isArray(entry.command)) {
    entry.command = [launcherPath];
    return true;
  }
  entry.command = launcherPath;
  return true;
}

export function collectHygieneRemovals(
  servers: Record<string, unknown>,
  stateNames: ReadonlySet<string>,
  brokenNames: readonly string[] = BROKEN_MCPM_REGISTRY_SERVERS,
): string[] {
  return [
    ...new Set([
      ...findRedundantMcpmKeys(servers),
      ...findBrokenMcpmOnlyKeys(servers, stateNames, brokenNames),
      ...findRemovableStaleKeys(servers, stateNames),
    ]),
  ];
}

interface FormatHandler {
  read(path: string): Record<string, unknown>;
  write(path: string, config: Record<string, unknown>): void;
  logTag: string;
}

const JSON_HANDLER: FormatHandler = {
  read: (path) => readMcpJson(path) as Record<string, unknown>,
  write: writeMcpJson,
  logTag: "mcp/mcpm-hygiene/json",
};

const YAML_HANDLER: FormatHandler = {
  read: (path) => readGooseYaml(path) as Record<string, unknown>,
  write: writeGooseYaml,
  logTag: "mcp/mcpm-hygiene/yaml",
};

function pickHandler(mcpFormat: string | undefined): FormatHandler | undefined {
  switch (mcpFormat) {
    case undefined:
    case "json":
    case "opencode":
      return JSON_HANDLER;
    case "yaml":
      return YAML_HANDLER;
    default:
      return undefined;
  }
}

function fixServersInConfig(servers: Record<string, unknown>): { fixedGithub: boolean; fixedMemory: boolean } {
  let fixedGithub = false;
  let fixedMemory = false;
  const launcherPath = githubLauncherPath();
  const githubEntry = servers.github;
  if (isRecord(githubEntry)) {
    if (fixDeprecatedGithubEntry(githubEntry, launcherPath)) fixedGithub = true;
    else if (fixBrokenGithubLauncherEntry(githubEntry, launcherPath)) fixedGithub = true;
  }
  for (const entry of Object.values(servers)) {
    if (isRecord(entry) && fixMemoryEntry(entry)) fixedMemory = true;
  }
  return { fixedGithub, fixedMemory };
}

function sweepOneConfig(
  path: string,
  mcpKey: string,
  collectRemovals: (servers: Record<string, unknown>) => string[],
  dryRun: boolean,
  handler: FormatHandler,
): { removedKeys: string[]; fixedGithub: boolean; fixedMemory: boolean } {
  if (!existsSync(path)) return { removedKeys: [], fixedGithub: false, fixedMemory: false };
  let config: Record<string, unknown>;
  try {
    config = handler.read(path);
  } catch (error) {
    logSkipped(`${handler.logTag}/read`, error);
    return { removedKeys: [], fixedGithub: false, fixedMemory: false };
  }

  const servers = config[mcpKey];
  if (!isRecord(servers)) return { removedKeys: [], fixedGithub: false, fixedMemory: false };

  const removable = collectRemovals(servers);
  const { fixedGithub, fixedMemory } = fixServersInConfig(servers);

  if (removable.length === 0 && !fixedGithub && !fixedMemory) {
    return { removedKeys: [], fixedGithub: false, fixedMemory: false };
  }

  for (const key of removable) {
    delete servers[key];
  }

  if (dryRun) return { removedKeys: removable, fixedGithub, fixedMemory };

  try {
    handler.write(path, config);
    return { removedKeys: removable, fixedGithub, fixedMemory };
  } catch (error) {
    logSkipped(`${handler.logTag}/write`, error);
    return { removedKeys: [], fixedGithub: false, fixedMemory: false };
  }
}

export function sweepMcpmHygiene(options: McpmHygieneSweepOptions = {}): McpmHygieneFileResult[] {
  const {
    dryRun = false,
    detected,
    stateServerNames = new Set<string>(),
    agentDefinitions,
    brokenRegistryServers = BROKEN_MCPM_REGISTRY_SERVERS,
  } = options;
  const collectRemovals = (servers: Record<string, unknown>) =>
    collectHygieneRemovals(servers, stateServerNames, brokenRegistryServers);
  const detectedNames = detected
    ? new Set(detected.filter((agent) => agent.detected).map((agent) => agent.name))
    : undefined;
  const results: McpmHygieneFileResult[] = [];

  for (const agent of agentDefinitions ?? loadAgentDefinitionsForHygiene()) {
    if (!agent.mcpConfig) continue;
    if (detectedNames && !detectedNames.has(agent.name)) continue;
    const handler = pickHandler(agent.mcpFormat);
    if (!handler) continue;
    const path = expandHome(agent.mcpConfig);
    const mcpKey = agent.mcpKey ?? "mcpServers";
    const { removedKeys, fixedGithub, fixedMemory } = sweepOneConfig(path, mcpKey, collectRemovals, dryRun, handler);
    if (removedKeys.length === 0 && !fixedGithub && !fixedMemory) continue;
    results.push({ path, agentName: agent.name, removedKeys, fixedGithub, fixedMemory });
  }

  return results;
}

/** Remove broken mcpm registry servers from intersection clients and global mcpm state.
 *
 *  `stateServerNames` protects servers agentbrew itself defines: the bridge
 *  publishes those to mcpm with a known-good command, so uninstalling them
 *  would strip the only entry the intersection clients have. */
export function uninstallBrokenMcpmRegistryServers(
  detectedAgents: readonly string[],
  dryRun: boolean,
  stateServerNames: ReadonlySet<string> = new Set<string>(),
  brokenNames: readonly string[] = BROKEN_MCPM_REGISTRY_SERVERS,
): string[] {
  const intersectionAgents = detectedAgents.filter((name) => MCP_INTERSECTION_AGENTS.has(name));
  if (intersectionAgents.length === 0) return [];
  const targets = brokenNames.filter((name) => isBlocklistedRegistryServer(name, stateServerNames, brokenNames));
  if (targets.length === 0) return [];
  if (dryRun) return [...targets];

  return uninstallFromIntersectionClients(targets, intersectionAgents);
}

/** Remove quarantined servers from mcpm so the bridge cannot republish them.
 *
 *  Pruning the config keys alone is not enough for intersection clients: mcpm
 *  keeps its own registry, and the next `mcpm client edit` would write the
 *  entry straight back. Unlike the blocklist above this takes no account of
 *  agentbrew state — a quarantined server is defined in state by design. */
export function uninstallQuarantinedMcpmServers(
  detectedAgents: readonly string[],
  quarantinedNames: readonly string[],
  dryRun: boolean,
): string[] {
  if (quarantinedNames.length === 0) return [];
  const intersectionAgents = detectedAgents.filter((name) => MCP_INTERSECTION_AGENTS.has(name));
  if (intersectionAgents.length === 0) return [];
  if (dryRun) return [...quarantinedNames];
  return uninstallFromIntersectionClients(quarantinedNames, intersectionAgents);
}

/**
 * Remove mcpm wrappers for servers that must be reached natively.
 *
 * A remote HTTPS MCP proxied through `mcpm run <name>` can never authorize
 * (the OAuth token belongs to the client) and, behind a TLS-inspecting proxy,
 * cannot even complete the handshake. Sync writes those entries natively
 * instead, so a leftover `mcpm_<name>` is a permanently failing duplicate.
 */
export function uninstallNativeOnlyMcpmServers(
  detectedAgents: readonly string[],
  nativeOnlyNames: readonly string[],
  dryRun: boolean,
): string[] {
  if (nativeOnlyNames.length === 0) return [];
  const intersectionAgents = detectedAgents.filter((name) => MCP_INTERSECTION_AGENTS.has(name));
  if (intersectionAgents.length === 0) return [];
  if (dryRun) return [...nativeOnlyNames];
  return uninstallFromIntersectionClients(nativeOnlyNames, intersectionAgents);
}

function bareEntryMatches(entry: Record<string, unknown>, server: McpServer): boolean {
  if (server.url) return entry.url === server.url;
  return entry.command === server.command && JSON.stringify(entry.args ?? []) === JSON.stringify(server.args ?? []);
}

/** Bare entries that shadow a state server with a different definition.
 *
 *  Native sync skips intersection clients, so a bare entry left there by an
 *  older sync never updates. It also makes `findRedundantMcpmKeys` delete
 *  the current `mcpm_<name>` entry, so the stale copy wins for good. */
export function findStaleBareKeys(servers: Record<string, unknown>, stateServers: readonly McpServer[]): string[] {
  return stateServers
    .filter((server) => {
      const entry = servers[server.name];
      return isRecord(entry) && !bareEntryMatches(entry, server);
    })
    .map((server) => server.name);
}

/**
 * Prune stale bare entries from detected JSON intersection clients, then
 * report which state servers some client cannot reach at all (no bare and
 * no `mcpm_` entry). The bridge re-wires those even when mcpm's own
 * `servers.json` already matches state.
 */
export function reconcileIntersectionClientEntries(
  agentDefinitions: readonly Omit<AgentConfig, "detected">[],
  detectedAgents: readonly string[],
  stateServers: readonly McpServer[],
): Set<string> {
  const detected = new Set(detectedAgents.filter((name) => MCP_INTERSECTION_AGENTS.has(name)));
  const unreachable = new Set<string>();
  const jsonClients = agentDefinitions.filter(
    (agent) => agent.mcpConfig && detected.has(agent.name) && (agent.mcpFormat ?? "json") === "json",
  );
  for (const agent of jsonClients) {
    const servers = pruneStaleBareEntries(
      expandHome(agent.mcpConfig ?? ""),
      agent.mcpKey ?? "mcpServers",
      stateServers,
    );
    if (!servers) continue;
    for (const server of stateServers) {
      if (!isReachable(servers, server.name)) unreachable.add(server.name);
    }
  }
  return unreachable;
}

function isReachable(servers: Record<string, unknown>, name: string): boolean {
  return name in servers || `${MCPM_PREFIX}${name}` in servers;
}

/** Returns the client's server map after pruning, or undefined when unreadable. */
function pruneStaleBareEntries(
  path: string,
  mcpKey: string,
  stateServers: readonly McpServer[],
): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  let config: Record<string, unknown>;
  try {
    config = JSON_HANDLER.read(path);
  } catch (error) {
    logSkipped("mcp/mcpm-hygiene/reconcile/read", error);
    return undefined;
  }
  const rawServers = config[mcpKey];
  const servers = isRecord(rawServers) ? rawServers : {};
  const stale = findStaleBareKeys(servers, stateServers);
  if (stale.length === 0) return servers;
  for (const key of stale) delete servers[key];
  try {
    JSON_HANDLER.write(path, config);
  } catch (error) {
    logSkipped("mcp/mcpm-hygiene/reconcile/write", error);
  }
  return servers;
}

/** Each uninstall spawns one `mcpm` process per intersection client, so a
 *  server mcpm no longer registers must be skipped: otherwise every sync pays
 *  that cost again. `sweepMcpmHygiene` still prunes leftover client keys. */
function uninstallFromIntersectionClients(
  serverNames: readonly string[],
  intersectionAgents: readonly string[],
): string[] {
  const registered = listMcpmServerNames();
  const removed: string[] = [];
  for (const serverName of serverNames) {
    if (!registered.has(serverName)) continue;
    const result = delegateMcpUninstall({ serverName, agents: [...intersectionAgents] });
    if (result.ok) removed.push(serverName);
  }
  return removed;
}
