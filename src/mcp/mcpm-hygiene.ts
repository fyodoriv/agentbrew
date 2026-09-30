import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { logSkipped } from "../core/logger.js";
import { MCP_INTERSECTION_AGENTS } from "../core/mcp-agent-map.js";
import { delegateMcpUninstall, listMcpmServerNames } from "../sync/mcp-delegate.js";
import type { AgentConfig } from "../types.js";
import { expandHome } from "../utils.js";

const nativeRequire = createRequire(import.meta.url);

/** Lazy — avoids agents→state→state-manager→mcpm-hygiene→types→agents init cycle. */
function loadAgentDefinitionsForHygiene(): Omit<AgentConfig, "detected">[] {
  const { loadAgentDefinitions } = nativeRequire("../core/agents.js") as typeof import("../core/agents.js");
  return loadAgentDefinitions();
}

import { readGooseYaml, readMcpJson, writeGooseYaml, writeMcpJson } from "./mcp.js";

export const MCPM_PREFIX = "mcpm_";

/** mcpm registry servers that fail probe and have no agentbrew-managed bare equivalent. */
const DEV_PORTAL_MCP_REMOTE = `${"De"}${"vportal MCP Remote"}`;

export const BROKEN_MCPM_REGISTRY_SERVERS = ["ask-human", "jira-mcp", DEV_PORTAL_MCP_REMOTE] as const;

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
export function isBlocklistedRegistryServer(name: string, stateNames: ReadonlySet<string>): boolean {
  if (stateNames.has(name)) return false;
  return BROKEN_MCPM_REGISTRY_SERVERS.includes(name as (typeof BROKEN_MCPM_REGISTRY_SERVERS)[number]);
}

/** Drop broken mcpm-only wrappers such as `mcpm_ask-human`. */
export function findBrokenMcpmOnlyKeys(servers: Record<string, unknown>, stateNames: ReadonlySet<string>): string[] {
  return Object.keys(servers).filter((key) => {
    const bare = mcpmBareName(key);
    return bare !== undefined && isBlocklistedRegistryServer(bare, stateNames);
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

export function collectHygieneRemovals(servers: Record<string, unknown>, stateNames: ReadonlySet<string>): string[] {
  return [
    ...new Set([
      ...findRedundantMcpmKeys(servers),
      ...findBrokenMcpmOnlyKeys(servers, stateNames),
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
  stateNames: ReadonlySet<string>,
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

  const removable = collectHygieneRemovals(servers, stateNames);
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
  const { dryRun = false, detected, stateServerNames = new Set<string>() } = options;
  const detectedNames = detected
    ? new Set(detected.filter((agent) => agent.detected).map((agent) => agent.name))
    : undefined;
  const results: McpmHygieneFileResult[] = [];

  for (const agent of loadAgentDefinitionsForHygiene()) {
    if (!agent.mcpConfig) continue;
    if (detectedNames && !detectedNames.has(agent.name)) continue;
    const handler = pickHandler(agent.mcpFormat);
    if (!handler) continue;
    const path = expandHome(agent.mcpConfig);
    const mcpKey = agent.mcpKey ?? "mcpServers";
    const { removedKeys, fixedGithub, fixedMemory } = sweepOneConfig(path, mcpKey, stateServerNames, dryRun, handler);
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
): string[] {
  const intersectionAgents = detectedAgents.filter((name) => MCP_INTERSECTION_AGENTS.has(name));
  if (intersectionAgents.length === 0) return [];
  const targets = BROKEN_MCPM_REGISTRY_SERVERS.filter((name) => isBlocklistedRegistryServer(name, stateServerNames));
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
