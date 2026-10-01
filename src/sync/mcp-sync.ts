import { existsSync } from "node:fs";
import { getStateServers } from "../agentfile.js";
import type { Context } from "../core/context.js";
import { createContext } from "../core/context.js";
import { errorMessage } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import { logSkipped } from "../core/logger.js";
import { buildMcpmClientList, MCP_INTERSECTION_AGENTS, STDIO_ONLY_MCP_AGENTS } from "../core/mcp-agent-map.js";
import type { SecretFinding } from "../core/secret-detector.js";
import { detectSecretsInServers } from "../core/secret-detector.js";
import type { Manifest } from "../manifest.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { getAdapter } from "../mcp/adapters.js";
import { sweepCatalogPins } from "../mcp/catalog-pin-sweep.js";
import { finalizeCursorGuiMcpEntries } from "../mcp/cursor-gui-launch.js";
import {
  type EndpointRepairFileResult,
  type EndpointRepairKind,
  sweepMcpEndpointRepairs,
} from "../mcp/endpoint-repair.js";
import { getEnvFormat, hasUnresolvedLiterals, resolveEnvVar } from "../mcp/env-vars.js";
import { getServers, readMcpJson, setServers, writeMcpJson } from "../mcp/mcp.js";
import { filterInvalidServers } from "../mcp/mcp-validation.js";
import {
  reconcileIntersectionClientEntries,
  sweepMcpmHygiene,
  uninstallBrokenMcpmRegistryServers,
  uninstallNativeOnlyMcpmServers,
  uninstallQuarantinedMcpmServers,
} from "../mcp/mcpm-hygiene.js";
import { sweepPlaywrightIsolated } from "../mcp/playwright-isolated-sweep.js";
import { formatQuarantineNotice, partitionQuarantined, quarantinedEntryKeys } from "../mcp/quarantine.js";
import { sweepMcpConfigs } from "../mcp/resilient-sweep.js";
import { validateMcpEntriesAgainstSchema } from "../mcp/schema-contract.js";
import { ensureMemoryMcpServer, isMemoryEnabled } from "../memory/enable.js";
import { prepareMemoryForMcpSync, syncInstalledMemoryPacks } from "../memory/sync-hooks.js";
import { requireState, saveState } from "../state.js";
import type { AgentBrewState, AgentConfig, McpFormatAdapter, McpServer, SyncOptions } from "../types.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { expandHome } from "../utils.js";
import { delegateMcpClientEdit, delegateMcpNew, mcpServerConfigEquals, readMcpmServer } from "./mcp-delegate.js";

/**
 * Carve-out: shared (mcpm-bridge informational logging).
 *
 * Log a one-line dim note listing intersection agents (`MCP_INTERSECTION_AGENTS`) that are detected
 * but skipped by native sync — they're populated by `mcpm install` +
 * `mcpm client edit`. Stays silent when no intersection agents are detected
 * (most non-organization-specific setups). Users call `agentbrew install <name>` for
 * the catalog or `mcpm install <name>` for the raw mcpm registry.
 */
function logMcpDelegatedAgents(stateAgents: AgentConfig[], log: Logger): void {
  const detectedNames = new Set(stateAgents.filter((a) => a.detected).map((a) => a.name));
  const delegated = AGENT_DEFINITIONS.filter(
    (def) => def.mcpConfig && detectedNames.has(def.name) && MCP_INTERSECTION_AGENTS.has(def.name),
  ).map((def) => def.name);
  if (delegated.length === 0) return;
  log.log(
    log.dim(
      `  Note: ${delegated.join(", ")} → mcpm-managed (run \`agentbrew install <name>\` for the catalog or \`mcpm install <name>\` for raw registry).\n`,
    ),
  );
}

/**
 * Carve-out: shared (warns for any carve-out whose mcpConfig file is absent).
 *
 * Warn about agents that are detected (installed) but have no MCP config file.
 * These agents won't receive MCP server configuration until their config file is created
 * (usually by running the agent once).
 */
function warnUnconfiguredAgents(stateAgents: AgentConfig[], log: Logger): void {
  const detected = new Set(stateAgents.filter((a) => a.detected).map((a) => a.name));
  for (const def of AGENT_DEFINITIONS) {
    if (!def.mcpConfig || !detected.has(def.name)) continue;
    const configPath = expandHome(def.mcpConfig);
    if (!existsSync(configPath)) {
      log.warn(`  ${def.name}: installed but not configured — run ${def.name} once to create its config, then re-sync`);
    }
  }
}

/** Carve-out: shared (filters in {@link AGENTBREW_ONLY_MCP_AGENTS} that receive native MCP writes).
 *  Get MCP-capable agents that should receive native sync writes — the
 *  {@link MCP_INTERSECTION_AGENTS} set is filtered out so those
 *  clients flow through `mcpm install` + `mcpm client edit` instead. Reads
 *  fresh from `AGENT_DEFINITIONS` so new `mcpConfig` fields in `agents.yaml`
 *  are picked up without re-init, while still respecting which agents are
 *  actually installed (from state). */
export function getMcpTargetAgents(stateAgents: AgentConfig[]): AgentConfig[] {
  const detectedNames = new Set(stateAgents.filter((a) => a.detected).map((a) => a.name));
  return AGENT_DEFINITIONS.filter(
    (def) => def.mcpConfig && detectedNames.has(def.name) && !MCP_INTERSECTION_AGENTS.has(def.name),
  ).map((def) => ({
    ...def,
    detected: true,
  }));
}

/**
 * Detected intersection clients, which normally receive servers through mcpm.
 *
 * Used only for the remote-HTTPS carve-out below, where mcpm cannot be the
 * carrier and the entry has to be written natively instead.
 */
export function getMcpmIntersectionAgents(stateAgents: AgentConfig[]): AgentConfig[] {
  const detectedNames = new Set(stateAgents.filter((a) => a.detected).map((a) => a.name));
  return AGENT_DEFINITIONS.filter(
    (def) => def.mcpConfig && detectedNames.has(def.name) && MCP_INTERSECTION_AGENTS.has(def.name),
  ).map((def) => ({ ...def, detected: true }));
}

/** Intersection clients that can load a remote HTTPS entry from their MCP config file. */
export function getNativeHttpTargetAgents(stateAgents: AgentConfig[]): AgentConfig[] {
  return getMcpmIntersectionAgents(stateAgents).filter((agent) => !STDIO_ONLY_MCP_AGENTS.has(agent.name));
}

/**
 * Remove remote entries agentbrew wrote into a stdio-only client's config
 * (see `STDIO_ONLY_MCP_AGENTS`). Entries agentbrew does not manage stay.
 * Returns the removed names; on dry run, the names it would remove.
 */
export function pruneManagedRemoteEntries(
  agent: AgentConfig,
  managedNames: ReadonlySet<string>,
  dryRun: boolean,
): string[] {
  if (!agent.mcpConfig) return [];
  const configPath = expandHome(agent.mcpConfig);
  if (!existsSync(configPath)) return [];
  const adapter = getAdapter(agent);
  const mcpKey = agent.mcpKey ?? "mcpServers";
  const entries = adapter.readEntries(configPath, mcpKey);
  const removed = Object.keys(entries).filter(
    (name) => managedNames.has(name) && typeof entries[name]?.url === "string" && entries[name].url !== "",
  );
  if (removed.length === 0 || dryRun) return removed;
  for (const name of removed) delete entries[name];
  adapter.writeEntries(configPath, entries, mcpKey);
  return removed;
}

/**
 * True when the server is a remote MCP the client must reach over TLS itself.
 *
 * These cannot go through mcpm, for two independent reasons:
 *
 *   1. **OAuth belongs to the client.** A remote MCP such as Figma authenticates
 *      per client, and the token lands in that client's own credential store.
 *      mcpm has no way to run the consent flow on the client's behalf, so a
 *      proxied entry can never become authorized.
 *   2. **mcpm's TLS stack is Python.** Behind a TLS-inspecting proxy, Python
 *      3.13 verifies strictly and rejects the corporate root
 *      (`CERTIFICATE_VERIFY_FAILED: Basic Constraints of CA cert not marked
 *      critical`), which no CA-bundle env var can work around.
 *
 * Loopback URLs are excluded: those are local bridges (the memory server, the
 * remote-MCP proxy) that speak plain HTTP and work fine through mcpm today.
 */
export function requiresNativeHttpTransport(server: McpServer): boolean {
  const url = typeof server.url === "string" ? server.url : "";
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:") return false;
    return !["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

// ── Pure types ──────────────────────────────────────────────────────────────

/**
 * A single action to apply to an agent's MCP config during a sync pass.
 * Keeping this as a discriminated union (add/update/prune) lets the diff step
 * remain pure and testable before any filesystem writes occur.
 */
interface McpDiffAction {
  type: "add" | "update" | "prune";
  serverName: string;
  entry?: Record<string, unknown>;
}

/**
 * The complete diff between desired state and an agent's current MCP config.
 * Aggregated counts drive the sync summary output; actions drive the writes.
 */
interface McpAgentDiff {
  agentName: string;
  actions: McpDiffAction[];
  added: number;
  updated: number;
  pruned: number;
}

// ── Pure functions (no I/O, trivially testable) ─────────────────────────────

/** Carve-out: shared (pure pass-through used by every carve-out's sync path).
 *  Return the user-state server list verbatim. Per-project overrides flow
 *  through the per-project Agentfile.yaml (which `applyAgentfile` already
 *  merges into state before sync runs), not via a parallel project layer. */
export function computeServerList(options: { userServers: McpServer[] }): McpServer[] {
  return [...options.userServers];
}

/** Carve-out: shared (used by every carve-out's diff via {@link computeDiffWithAdapter}). */
function collectPruneActions(
  existingEntries: Record<string, Record<string, unknown>>,
  serverNames: Set<string>,
  forcePruneNames: Set<string>,
  managedNames: Set<string> | undefined,
  adapter: Pick<McpFormatAdapter, "isPrunable">,
): McpDiffAction[] {
  const actions: McpDiffAction[] = [];

  for (const name of forcePruneNames) {
    if (existingEntries[name] && adapter.isPrunable(name, existingEntries[name])) {
      actions.push({ type: "prune", serverName: name });
    }
  }

  for (const name of Object.keys(existingEntries)) {
    if (!serverNames.has(name) && !forcePruneNames.has(name) && adapter.isPrunable(name, existingEntries[name])) {
      // Only prune servers that agentbrew previously managed (tracked in manifest).
      // User-added servers (not in managedNames) are preserved.
      if (!managedNames || managedNames.has(name)) {
        actions.push({ type: "prune", serverName: name });
      }
    }
  }

  return actions;
}

/** Carve-out: devin (literal-format adapter — recursively detects ${VAR} placeholders). */
function entryHasUnresolvedLiterals(value: unknown): boolean {
  if (typeof value === "string") return hasUnresolvedLiterals(value);
  if (Array.isArray(value)) return value.some(entryHasUnresolvedLiterals);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(entryHasUnresolvedLiterals);
  }
  return false;
}

/** Carve-out: devin (literal-format env inheritance check used by `filterServersForLiteralAgent`).
 *  Resolves through {@link resolveEnvVar} (process.env + ENV_FALLBACKS like macOS Keychain +
 *  `gh auth token`) — same path the literal-format substitution uses — so the filter cannot
 *  drop a server whose value WOULD resolve at write time. See the regression test
 *  in `mcp-sync.test.ts` for the historical false-negative this aligns away. */
function hasUnresolvedInheritedEnv(value: string): boolean {
  for (const match of value.matchAll(VAR_PATTERN)) {
    const hasDefault = match[2] !== undefined;
    if (!hasDefault && resolveEnvVar(match[1]) === undefined) return true;
  }
  return false;
}

/** Carve-out: devin (sweeps stale literal-mode entries whose ${VAR} no longer resolves). */
function collectUnsafePruneActions(
  existingEntries: Record<string, Record<string, unknown>>,
  unsafePruneNames: Set<string>,
  adapter: Pick<McpFormatAdapter, "isPrunable">,
): McpDiffAction[] {
  const actions: McpDiffAction[] = [];
  for (const name of unsafePruneNames) {
    const entry = existingEntries[name];
    if (entry && adapter.isPrunable(name, entry) && entryHasUnresolvedLiterals(entry)) {
      actions.push({ type: "prune", serverName: name });
    }
  }
  return actions;
}

/** Carve-out: shared (every carve-out runs through this diff via its adapter).
 *  Compute add/update/prune diff using adapter methods for format-specific comparison. */
export function computeDiffWithAdapter(
  agentName: string,
  desiredServers: McpServer[],
  existingEntries: Record<string, Record<string, unknown>>,
  adapter: Pick<McpFormatAdapter, "toEntry" | "entriesMatch" | "isPrunable">,
  options?: {
    prune?: boolean;
    forcePruneNames?: Set<string>;
    managedNames?: Set<string>;
    unsafePruneNames?: Set<string>;
  },
): McpAgentDiff {
  // Cursor GUI wrapping is persisted in mcp.json — normalize bare npx/bash -lc
  // entries before diff so idempotent sync does not emit spurious updates.
  const existingForDiff =
    agentName === "cursor"
      ? (() => {
          const normalized = structuredClone(existingEntries);
          finalizeCursorGuiMcpEntries(normalized);
          return normalized;
        })()
      : existingEntries;

  const prune = options?.prune ?? false;
  const forcePruneNames = options?.forcePruneNames ?? new Set<string>();
  const managedNames = options?.managedNames;
  const unsafePruneNames = options?.unsafePruneNames ?? new Set<string>();
  const actions: McpDiffAction[] = [];
  const serverNames = new Set(desiredServers.map((s) => s.name));
  const unsafePruneCandidates = new Set([...unsafePruneNames].filter((name) => !serverNames.has(name)));
  const unsafePruneActions = collectUnsafePruneActions(existingForDiff, unsafePruneCandidates, adapter);
  const alreadyPruned = new Set(unsafePruneActions.map((a) => a.serverName));
  actions.push(...unsafePruneActions);

  for (const server of desiredServers) {
    const entry = adapter.toEntry(server, agentName);
    const existing = existingForDiff[server.name];

    if (!existing) {
      actions.push({ type: "add", serverName: server.name, entry });
    } else if (!adapter.entriesMatch(existing, entry)) {
      actions.push({ type: "update", serverName: server.name, entry });
    }
  }

  // Force-prune names only when --prune is set.
  // Without --prune, these entries are left in place — filterServersForLiteralAgent
  // already logs a warning per skipped server, so the user knows they need setup.
  if (prune) {
    actions.push(
      ...collectPruneActions(existingForDiff, serverNames, forcePruneNames, managedNames, adapter).filter(
        (action) => !alreadyPruned.has(action.serverName),
      ),
    );
  }

  return {
    agentName,
    actions,
    added: actions.filter((a) => a.type === "add").length,
    updated: actions.filter((a) => a.type === "update").length,
    pruned: actions.filter((a) => a.type === "prune").length,
  };
}

// ── Adapter-based sync ──────────────────────────────────────────────────────

/** Carve-out: shared (every carve-out's adapter applyUpdate flows through here). */
function applyDiffToEntries(
  entries: Record<string, Record<string, unknown>>,
  actions: McpDiffAction[],
  adapter: Pick<McpFormatAdapter, "applyUpdate">,
): void {
  for (const action of actions) {
    if (action.type === "prune") {
      delete entries[action.serverName];
    } else {
      adapter.applyUpdate(entries, action.serverName, action.entry ?? {});
    }
  }
}

/** Carve-out: shared (post-write integrity check; runs for every carve-out's adapter).
 *  Readback validation: re-read the config after writing and verify expected servers are present. */
function validateReadback(
  adapter: McpFormatAdapter,
  agentName: string,
  expanded: string,
  mcpKey: string,
  expectedNames: Set<string>,
): string | undefined {
  let readback: Record<string, Record<string, unknown>>;
  try {
    readback = adapter.readEntries(expanded, mcpKey);
  } catch (err) {
    return `readback failed after write: ${errorMessage(err)}`;
  }

  const missing = [...expectedNames].filter((name) => !readback[name]);
  if (missing.length > 0) {
    return `readback validation failed: missing servers after write: ${missing.join(", ")}`;
  }
  const schemaError = validateMcpEntriesAgainstSchema(agentName, readback);
  if (schemaError) return schemaError;
  return undefined;
}

/** Carve-out: shared (every carve-out's per-agent native write goes through this). */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: adapter reconciliation keeps all write outcomes in one transaction
export function syncWithAdapter(
  adapter: McpFormatAdapter,
  configPath: string,
  servers: McpServer[],
  agentName: string,
  options?: {
    dryRun?: boolean;
    prune?: boolean;
    mcpKey?: string;
    forcePruneNames?: Set<string>;
    managedNames?: Set<string>;
    unsafePruneNames?: Set<string>;
  },
): { added: number; updated: number; pruned: number; error?: string } {
  const dryRun = options?.dryRun ?? false;
  const mcpKey = options?.mcpKey ?? "mcpServers";
  const expanded = expandHome(configPath);

  let entries: Record<string, Record<string, unknown>>;
  try {
    entries = adapter.readEntries(expanded, mcpKey);
  } catch (err) {
    return { added: 0, updated: 0, pruned: 0, error: `read failed: ${errorMessage(err)}` };
  }

  const entriesSnapshot = JSON.stringify(entries);
  if (agentName === "cursor") {
    finalizeCursorGuiMcpEntries(entries);
  }
  const entriesChangedByFinalize = JSON.stringify(entries) !== entriesSnapshot;

  const diff = computeDiffWithAdapter(agentName, servers, entries, adapter, {
    prune: options?.prune,
    forcePruneNames: options?.forcePruneNames,
    managedNames: options?.managedNames,
    unsafePruneNames: options?.unsafePruneNames,
  });

  if (!dryRun && (diff.actions.length > 0 || entriesChangedByFinalize)) {
    if (diff.actions.length > 0) {
      applyDiffToEntries(entries, diff.actions, adapter);
      if (agentName === "cursor") {
        finalizeCursorGuiMcpEntries(entries);
      }
    }
    try {
      adapter.writeEntries(expanded, entries, mcpKey);
    } catch (err) {
      return { added: 0, updated: 0, pruned: 0, error: `write failed: ${errorMessage(err)}` };
    }

    // Post-write readback: verify the config file is parseable and contains expected servers.
    // The expected set is all servers that should be present after the write (desired + unpruned existing).
    const expectedNames = new Set(Object.keys(entries));
    const readbackError = validateReadback(adapter, agentName, expanded, mcpKey, expectedNames);
    if (readbackError) {
      return { added: 0, updated: 0, pruned: 0, error: readbackError };
    }
  }

  return { added: diff.added, updated: diff.updated, pruned: diff.pruned };
}

const MCP_PERMISSION_PATTERN = /^mcp__(.+)__\*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function getPermissionAllowList(config: Record<string, unknown>): string[] {
  const permissions = isRecord(config.permissions) ? config.permissions : {};
  return getStringArray(permissions.allow);
}

function setPermissionAllowList(config: Record<string, unknown>, allow: string[]): void {
  const permissions = isRecord(config.permissions) ? config.permissions : {};
  config.permissions = { ...permissions, allow };
}

function getConfiguredServerNames(config: Record<string, unknown>, mcpKey = "mcpServers"): string[] {
  const servers = config[mcpKey];
  return isRecord(servers) ? Object.keys(servers) : [];
}

interface SyncMcpPermissionsOptions {
  dryRun?: boolean;
  deployedServerNames?: Iterable<string>;
  mcpKey?: string;
}

export function syncMcpPermissions(
  configPath: string,
  servers: McpServer[],
  options: SyncMcpPermissionsOptions = {},
): number {
  const expanded = expandHome(configPath);
  const config = readMcpJson(expanded);
  const existing = getPermissionAllowList(config);
  const deployedServerNames = options.deployedServerNames ?? [];
  const desiredNames = new Set([
    ...servers.map((server) => server.name),
    ...getConfiguredServerNames(config, options.mcpKey),
    ...deployedServerNames,
  ]);
  const desiredPermissions = new Set([...desiredNames].map((name) => `mcp__${name}__*`));
  const existingPermissions = new Set(existing);
  const toAdd = [...desiredPermissions].filter((permission) => !existingPermissions.has(permission));
  const pruned = existing.filter((entry) => {
    const match = MCP_PERMISSION_PATTERN.exec(entry);
    return !match || desiredNames.has(match[1]);
  });
  const updated = [...pruned, ...toAdd];

  if (options.dryRun || (toAdd.length === 0 && updated.length === existing.length)) {
    return toAdd.length;
  }

  setPermissionAllowList(config, updated);
  writeMcpJson(expanded, config);
  return toAdd.length;
}

export function syncDevinPermissions(configPath: string, servers: McpServer[], dryRun = false): number {
  return syncMcpPermissions(configPath, servers, { dryRun });
}

/** Result of scanning one server for unresolved ${VAR} references. */
interface UnresolvedEnvVar {
  serverName: string;
  varName: string;
  field: string;
}

const VAR_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)(?::-(.*?))?\}/g;

/** Carve-out: devin (literal-format pre-flight check).
 *  Scan a single string value for unresolved ${VAR} references. */
function findUnresolvedInValue(value: string, serverName: string, field: string): UnresolvedEnvVar[] {
  const results: UnresolvedEnvVar[] = [];
  for (const match of value.matchAll(VAR_PATTERN)) {
    const hasDefault = match[2] !== undefined;
    if (!hasDefault && resolveEnvVar(match[1]) === undefined) {
      results.push({ serverName, varName: match[1], field });
    }
  }
  return results;
}

/**
 * Carve-out: devin (only literal-format agent today; called regardless to keep the API generic).
 *
 * Collect all unresolved ${VAR} references across all servers.
 * Pure function — checks env/args/url/headers for placeholders that cannot be resolved.
 * Used to print a pre-sync warning table for literal-format agents.
 */
export function collectUnresolvedEnvVars(servers: McpServer[]): UnresolvedEnvVar[] {
  const results: UnresolvedEnvVar[] = [];
  for (const server of servers) {
    for (const arg of server.args) {
      results.push(...findUnresolvedInValue(arg, server.name, "args"));
    }
    for (const [key, value] of Object.entries(server.env)) {
      results.push(...findUnresolvedInValue(value, server.name, `env.${key}`));
    }
    if (server.url) {
      results.push(...findUnresolvedInValue(server.url, server.name, "url"));
    }
    for (const [key, value] of Object.entries(server.headers ?? {})) {
      results.push(...findUnresolvedInValue(value, server.name, `headers.${key}`));
    }
  }
  return results;
}

/** Carve-out: devin (no-op when no literal-format agent is detected; otherwise warns).
 *  Pre-sync gate: scans all servers for unresolved ${VAR}s and prints a per-server
 *  warning table — those servers will be skipped for literal-format agents. */
function warnUnresolvedEnvVars(agents: AgentConfig[], servers: McpServer[], log: Logger): void {
  if (!agents.some((a) => getEnvFormat(a.name) === "literal")) return;
  const unresolved = collectUnresolvedEnvVars(servers);
  if (unresolved.length === 0) return;

  const byServer = new Map<string, string[]>();
  for (const entry of unresolved) {
    const list = byServer.get(entry.serverName) ?? [];
    list.push(entry.varName);
    byServer.set(entry.serverName, list);
  }
  log.warn("\n  ⚠ Unresolved env vars — these servers will be skipped for literal-format agents (e.g. Devin):\n");
  for (const [server, vars] of byServer) {
    log.warn(`    ${server}: ${[...new Set(vars)].join(", ")}`);
  }
  log.log(log.dim("\n    Run `agentbrew setup` to configure missing vars, or set them in your shell environment.\n"));
}

/** Carve-out: shared (every carve-out's pre-sync flow runs through this).
 *  Format secret findings into a human-readable warning table. */
export function formatSecretWarnings(findings: SecretFinding[]): string[] {
  const lines: string[] = [];
  lines.push("\n  ⚠ Hardcoded secrets detected — these will be synced to all agent configs:\n");
  for (const f of findings) {
    lines.push(`    ${f.location}.${f.field}: ${f.pattern} (${f.preview})`);
  }
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${VAR} example for users
  lines.push("\n    Use ${VAR} placeholders in state.yaml and set values in your shell environment.");
  lines.push("    Run `agentbrew lint` for full details.\n");
  return lines;
}

/** Carve-out: shared (every carve-out's pre-sync warning gate).
 *  Pre-sync gate: warn about hardcoded secrets before they propagate to agent configs. */
export function warnHardcodedSecrets(servers: McpServer[], log: Logger): void {
  const findings = detectSecretsInServers(servers);
  if (findings.length === 0) return;
  for (const line of formatSecretWarnings(findings)) {
    log.warn(line);
  }
}

/**
 * Carve-out: devin (only literal-format agent today; no-op pass-through for other carve-outs).
 *
 * Filters out servers that have unresolved ${VAR} placeholders in any field when
 * the target agent uses "literal" env-var format (e.g. Devin). Devin does not
 * expand placeholders in config values; direct MCP env placeholders are omitted
 * later and must be present in the launching shell so child processes inherit
 * them. Returns the filtered list and logs a warning per skipped server.
 */
export function filterServersForLiteralAgent(
  servers: McpServer[],
  agentName: string,
  log: (msg: string) => void,
): McpServer[] {
  if (getEnvFormat(agentName) !== "literal") return servers;

  return servers.filter((server) => {
    const literalValues = [...server.args, server.url ?? "", ...Object.values(server.headers ?? {})];
    const hasUnresolved =
      literalValues.some(hasUnresolvedLiterals) || Object.values(server.env).some(hasUnresolvedInheritedEnv);
    if (hasUnresolved) {
      log(`  ⚠ ${agentName}: skipping "${server.name}" — env vars not set (run: agentbrew setup)`);
    }
    return !hasUnresolved;
  });
}

/** Carve-out: shared (per-carve-out write loop body; runs once per detected carve-out). */
function syncSingleAgent(
  agent: AgentConfig,
  servers: McpServer[],
  options: { dryRun: boolean; prune: boolean; quiet: boolean; managedNames: Set<string> },
  log: Logger,
): { name: string; added: number; updated: number; pruned: number; error?: string } {
  if (!agent.mcpConfig) return { name: agent.name, added: 0, updated: 0, pruned: 0 };

  try {
    const agentLog = options.quiet ? () => {} : (msg: string) => log.log(msg);
    const agentServers = filterServersForLiteralAgent(servers, agent.name, agentLog);
    // Servers skipped due to unresolved env vars are NEVER force-pruned — the agent
    // may have a manually-fixed entry with resolved values that must be preserved.
    // Without this, `agentbrew sync --prune` would delete working Devin credentials
    // whenever Keychain/env vars are temporarily unavailable.
    const skippedNames = new Set(
      servers.filter((s) => !agentServers.some((a) => a.name === s.name)).map((s) => s.name),
    );
    // Remove skipped servers from managedNames so they also survive normal pruning.
    // The prune logic only removes servers in managedNames; by excluding skipped names,
    // any existing resolved entry is treated as user-owned and left untouched.
    const safeManagedNames =
      skippedNames.size > 0
        ? new Set([...options.managedNames].filter((n) => !skippedNames.has(n)))
        : options.managedNames;

    // Only AGENTBREW_ONLY_MCP_AGENTS carve-outs (devin, overlay-desktop, copilot, opencode, kiro,
    // amp) reach this path — see `getMcpTargetAgents`.
    const adapter = getAdapter(agent);
    const result = syncWithAdapter(adapter, agent.mcpConfig, agentServers, agent.name, {
      dryRun: options.dryRun,
      prune: options.prune,
      mcpKey: agent.mcpKey,
      // Exclude skipped servers from prune candidates so resolved entries survive.
      managedNames: safeManagedNames,
      unsafePruneNames: skippedNames,
    });

    return { name: agent.name, ...result };
  } catch (err) {
    return { name: agent.name, added: 0, updated: 0, pruned: 0, error: errorMessage(err) };
  }
}

function getMcpPermissionAgents(stateAgents: AgentConfig[]): AgentConfig[] {
  const detectedNames = new Set(stateAgents.filter((agent) => agent.detected).map((agent) => agent.name));
  return AGENT_DEFINITIONS.filter((def) => def.mcpPermissionsConfig && detectedNames.has(def.name)).map((def) => ({
    ...def,
    detected: true,
  }));
}

function readDeployedServerNames(agent: AgentConfig): string[] {
  if (!agent.mcpConfig) return [];
  try {
    const adapter = getAdapter(agent);
    const entries = adapter.readEntries(expandHome(agent.mcpConfig), agent.mcpKey ?? "mcpServers");
    return Object.keys(entries);
  } catch (error) {
    logSkipped("sync/mcp-sync/readPermissionServerNames", error);
    return [];
  }
}

function syncDetectedMcpPermissions(agents: AgentConfig[], servers: McpServer[], dryRun: boolean): void {
  for (const agent of getMcpPermissionAgents(agents)) {
    if (!agent.mcpPermissionsConfig) continue;
    syncMcpPermissions(agent.mcpPermissionsConfig.file, servers, {
      dryRun,
      deployedServerNames: readDeployedServerNames(agent),
      mcpKey: agent.mcpKey,
    });
  }
}

/** Carve-out: shared (per-agent output line; same shape across all carve-outs). */
function logAgentResult(
  result: { name: string; added: number; updated: number; pruned: number },
  log: Logger,
  options: { verbose: boolean; dryRun: boolean },
): void {
  const changes: string[] = [];
  if (result.added > 0) changes.push(`${result.added} added`);
  if (result.updated > 0) changes.push(`${result.updated} updated`);
  if (result.pruned > 0) changes.push(log.red(`${result.pruned} pruned`));
  if (!options.verbose && changes.length === 0) return;
  const summary = changes.length > 0 ? changes.join(", ") : "up to date";
  const icon = options.dryRun ? log.blue("~") : log.green("✓");
  log.log(`  ${icon} ${result.name} — ${summary}`);
}

/** Carve-out: shared (aggregates per-carve-out results into the final summary). */
function aggregateAndLogResults(
  agentResults: Array<{ name: string; added: number; updated: number; pruned: number; error?: string }>,
  log: Logger,
  options: { quiet: boolean; verbose: boolean; dryRun: boolean },
) {
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalPruned = 0;
  let errors = 0;

  for (const result of agentResults) {
    if (result.error) {
      errors++;
      if (!options.quiet) log.log(`  ${log.red("✗")} ${result.name} — ${log.red(result.error)}`);
      continue;
    }

    totalAdded += result.added;
    totalUpdated += result.updated;
    totalPruned += result.pruned;

    if (!options.quiet) logAgentResult(result, log, options);
  }

  return { totalAdded, totalUpdated, totalPruned, errors };
}

/** Carve-out: shared (best-effort `--discover` output; surfaces user-added
 *  entries on every carve-out, full list in verbose / brief one-liner otherwise). */
async function logUnmanagedServers(
  servers: McpServer[],
  log: Logger,
  discover: boolean,
  externalNames?: Set<string>,
): Promise<void> {
  try {
    const { discoverUnmanagedServers } = await import("../import.js");
    const stateNames = new Set(servers.map((s) => s.name));
    const unmanaged = discoverUnmanagedServers(stateNames, externalNames);

    if (unmanaged.length === 0) {
      if (discover) log.log(log.dim("\n  ✓ No unmanaged servers found — all agent configs match agentbrew state.\n"));
      return;
    }

    if (discover) {
      log.log(log.bold(`\n  Discovered ${unmanaged.length} server(s) not in agentbrew:\n`));
      for (const entry of unmanaged) {
        log.log(`    ${log.green("+")} ${entry.server} ${log.dim(`(found in ${entry.agent})`)}`);
      }
      log.log(log.dim("\n    Run `agentbrew import` to add them to all agents.\n"));
      return;
    }

    const names = unmanaged
      .map((u) => u.server)
      .slice(0, 5)
      .join(", ");
    const extra = unmanaged.length > 5 ? ` +${unmanaged.length - 5} more` : "";
    log.log(
      `  ${log.cyan("ℹ")} ${log.dim(`${unmanaged.length} server(s) in agent configs not in agentbrew: ${names}${extra}`)}`,
    );
    log.log(log.dim("    Run `agentbrew sync --discover` for details or `agentbrew import` to sync them.\n"));
  } catch (e) {
    logSkipped("sync/mcp-sync/log", e);
    // Discovery is best-effort — don't fail sync if it errors
  }
}

/** Carve-out: shared (final summary across all carve-outs). */
async function logSyncSummary(
  totals: { totalAdded: number; totalUpdated: number; totalPruned: number; errors: number },
  options: { dryRun: boolean; discover: boolean; externalNames?: Set<string> },
  agentCount: number,
  servers: McpServer[],
  log: Logger,
): Promise<void> {
  const parts = [`${totals.totalAdded} added`, `${totals.totalUpdated} updated`];
  if (totals.totalPruned > 0) parts.push(`${totals.totalPruned} pruned`);
  if (totals.errors > 0) parts.push(log.red(`${totals.errors} failed`));
  log.log(
    `${log.bold(options.dryRun ? "\nWould apply:" : "\nDone.")} ${parts.join(", ")} across ${agentCount} agents.\n`,
  );

  // Warn about user-added servers in agent configs that aren't in agentbrew state
  if (!options.dryRun) {
    await logUnmanagedServers(servers, log, options.discover, options.externalNames);
  }
}

/**
 * Carve-out: bridge (mcpm intersection — NOT a native carve-out; bridges state to
 * mcpm for clients listed in {@link MCP_INTERSECTION_AGENTS}).
 *
 * Closes the gap that opened when native sync stopped writing to intersection
 * clients: hand-edits to `state.yaml`, `Agentfile.yaml mcp:` imports, and any
 * other code path that mutates `state.mcpServers` need an idempotent way to
 * land in mcpm's `servers.json` + each client's config. Per-server it runs
 * `mcpm install <name>` + `mcpm client edit <client> --add-server <name>`.
 *
 * Latency: steady-state syncs read `servers.json` once and find every server
 * present (~constant overhead). Only the first sync after a state mutation
 * pays the per-server `mcpm install` tax (~1.5s warm).
 *
 * Failures are non-fatal — agentbrew state remains authoritative. mcpm
 * binary missing, server-not-in-registry, or per-client edit errors all
 * fall through to the next server in the loop. Native sync (see
 * {@link syncSingleAgent}) runs independently. Skipped on dry runs because
 * `mcpm install` / `mcpm client edit` write to mcpm's global config + each
 * client's config file.
 *
 * Re-register one exact state definition, verify it, then wire it to every
 * detected intersection client. State is authoritative; mcpm's community
 * registry must never replace a user-selected command, URL, or environment.
 */
function bridgeOneServer(server: McpServer, detectedAgents: string[]): "bridged" | "failed" {
  const registerResult = delegateMcpNew({
    serverName: server.name,
    command: server.command,
    args: server.args,
    env: server.env,
    url: server.url,
    headers: server.headers,
  });
  if (!registerResult.ok) return "failed";
  if (!mcpServerConfigEquals(server, readMcpmServer(server.name))) return "failed";

  const editResult = delegateMcpClientEdit({ serverName: server.name, agents: detectedAgents });
  return editResult.ok && editResult.perClient.length > 0 ? "bridged" : "failed";
}

/** Carve-out: bridge (mcpm intersection — sync-time bridge for {@link MCP_INTERSECTION_AGENTS}). */
function bridgeStateMcpToMcpm(
  servers: McpServer[],
  agents: AgentConfig[],
  log: Logger,
  options: { dryRun: boolean; quiet: boolean },
  manifest: Manifest,
): void {
  if (options.dryRun || servers.length === 0) return;

  const detectedAgents = agents.filter((a) => a.detected).map((a) => a.name);
  if (detectedAgents.length === 0) return;

  // Short-circuit when no intersection clients are detected — mcpm has
  // nothing to sync to and the subprocess spawn would be wasted.
  // Mirrors `bridgeCatalogMcpToMcpm` in `src/catalog/install-other.ts`
  // and `bridgeRemoveToMcpm` in `src/sync/mcp-sync-commands.ts`.
  const { clients } = buildMcpmClientList(detectedAgents);
  if (clients.length === 0) return;

  // Compare exact definitions, not only names. This keeps steady-state syncs
  // subprocess-free while repairing stale mcpm entries after an Agentfile
  // changes a server's backend or transport.
  const unreachable = reconcileIntersectionClientEntries(AGENT_DEFINITIONS, detectedAgents, servers);
  const changed = servers.filter(
    (server) => unreachable.has(server.name) || !mcpServerConfigEquals(server, readMcpmServer(server.name)),
  );
  if (changed.length === 0) return;

  const bridged: string[] = [];
  for (const server of changed) {
    const outcome = bridgeOneServer(server, detectedAgents);
    if (outcome === "bridged") bridged.push(server.name);
  }
  delete manifest.mcpmBridgeAttemptedMissing;

  if (!options.quiet && bridged.length > 0) {
    const clientNames = clients.join(", ");
    log.log(
      log.dim(`  Reconciled ${bridged.length} server(s) to mcpm clients (${clientNames}): ${bridged.join(", ")}.`),
    );
  }
}

/** Carve-out: shared (option resolution; runs before any per-carve-out path). */
function resolveSyncOptions(options?: SyncOptions) {
  return {
    quiet: options?.quiet ?? false,
    verbose: options?.verbose ?? false,
    dryRun: options?.dryRun ?? false,
    prune: options?.prune ?? false,
    discover: options?.discover ?? false,
  };
}

/** Carve-out: shared (manifest load + managedNames union; runs before bridge + native sync). */
function loadMcpManifest(servers: McpServer[], ctx: Partial<Context> | undefined) {
  const sharedManifest = ctx?.manifest !== undefined;
  const manifest = ctx?.manifest ?? loadManifest();
  const managedNames = new Set([...(manifest.managedMcpServers ?? []), ...servers.map((s) => s.name)]);
  return { manifest, managedNames, sharedManifest };
}

/** Carve-out: shared (persists union of managed names across all carve-outs for prune
 *  safety). Manifest save is non-fatal — failure shouldn't block the sync result.
 *  Skipped when a parent context owns the manifest (it saves once at the end). */
function persistManagedNames(manifest: Manifest, managedNames: Set<string>, sharedManifest: boolean): void {
  manifest.managedMcpServers = [...managedNames];
  if (sharedManifest) return;
  try {
    saveManifest(manifest);
  } catch (e) {
    logSkipped("sync/mcp-sync/saveManifest", e);
  }
}

/** Carve-out: shared (pre-sync header + warnings — same shape across every carve-out). */
function logPreSyncHeader(
  state: { agents: AgentConfig[] },
  detectedAgents: AgentConfig[],
  servers: McpServer[],
  log: Logger,
  options: { dryRun: boolean },
): void {
  const label = options.dryRun ? "Dry run — MCP servers" : `Syncing ${servers.length} MCP servers...`;
  log.log(log.bold(`\n${label}\n`));
  warnUnconfiguredAgents(state.agents, log);
  logMcpDelegatedAgents(state.agents, log);
  // Pre-sync gates: surface unresolved env vars + hardcoded secrets before
  // the per-agent writes propagate them.
  warnUnresolvedEnvVars(detectedAgents, servers, log);
  warnHardcodedSecrets(servers, log);
}

/**
 * Carve-out: shared (top-level entry point; orchestrates every carve-out + the mcpm bridge).
 *
 * Sync MCP server configuration to detected carve-out agents. Reads desired
 * state from agentbrew state, computes per-agent diffs, and applies
 * adds/updates/prunes to each agent's config file. Per-project MCP servers
 * flow into state via `applyAgentfile()` before sync runs — no parallel
 * project layer here.
 *
 * {@link MCP_INTERSECTION_AGENTS} is filtered out of {@link getMcpTargetAgents}
 * and bridged through `mcpm install` + `mcpm client edit` instead.
 * {@link AGENTBREW_ONLY_MCP_AGENTS} flow through native MCP config sync today
 * (see `mcp-sync-carveout-matrix.test.ts`). Permission allowlists declared via
 * `mcpPermissionsConfig` are synced after both paths.
 */
async function maybeRunMemorySyncBeforeMcpFanout(state: AgentBrewState, quiet: boolean, log: Logger): Promise<void> {
  try {
    await prepareMemoryForMcpSync(state);
    await syncInstalledMemoryPacks(state);
  } catch (error) {
    if (!quiet) log.log(log.dim(`  Memory sync skipped: ${errorMessage(error)}`));
  }
}

async function prepareEnabledMemoryForMcpFanout(
  state: AgentBrewState,
  dryRun: boolean,
  ctx: Partial<Context> | undefined,
  quiet: boolean,
  log: Logger,
): Promise<void> {
  if (dryRun || !isMemoryEnabled(state)) return;

  if (ensureMemoryMcpServer(state)) {
    if (ctx?.state) ctx.state.save(state);
    else saveState(state);
  }
  await maybeRunMemorySyncBeforeMcpFanout(state, quiet, log);
}

export async function syncMcpServers(options?: SyncOptions, ctx?: Partial<Context>): Promise<void> {
  const { quiet, verbose, dryRun, prune, discover } = resolveSyncOptions(options);
  const log = ctx?.logger ?? createContext({ quiet, compact: options?.compact }).logger;

  const state = ctx?.state ? ctx.state.require({ quiet }) : requireState({ quiet });
  if (!state) return;

  // Keep the non-memory path synchronous until its first existing await.
  // Several integrations call syncMcpServers without awaiting it.
  if (isMemoryEnabled(state)) {
    await prepareEnabledMemoryForMcpFanout(state, dryRun, ctx, quiet, log);
  }

  const allServers = filterInvalidServers(computeServerList({ userServers: getStateServers(state) }), (msg) => {
    if (!quiet) log.log(msg);
  });
  // Quarantined endpoints are dropped before the fanout rather than filtered
  // per-agent, so no code path downstream can reintroduce them.
  const { active: servers, quarantined } = partitionQuarantined(allServers);
  if (servers.length === 0 && !prune) {
    if (!quiet) log.log("No MCP servers to sync.");
    return;
  }

  const detectedAgents = getMcpTargetAgents(state.agents);
  if (!quiet) logPreSyncHeader(state, detectedAgents, servers, log, { dryRun });

  // Load manifest before the bridge so the attempted-missing cache filter applies
  // on the first call. The bridge runs before the carve-out native sync below;
  // the two paths are independent.
  const { manifest, managedNames, sharedManifest } = loadMcpManifest(servers, ctx);

  // Remote HTTPS servers are withheld from mcpm and written natively to every
  // client instead — see `requiresNativeHttpTransport`.
  const nativeOnly = servers.filter(requiresNativeHttpTransport);
  const viaMcpm = servers.filter((server) => !requiresNativeHttpTransport(server));
  bridgeStateMcpToMcpm(viaMcpm, state.agents, log, { dryRun, quiet }, manifest);

  const agentResults = await Promise.all([
    ...detectedAgents.map((agent) => syncSingleAgent(agent, servers, { dryRun, prune, quiet, managedNames }, log)),
    // Intersection clients get only the carve-out servers, and never with
    // `prune`, so this pass cannot disturb the entries mcpm owns for them.
    // Stdio-only clients are skipped: their config file cannot load them.
    ...(nativeOnly.length === 0
      ? []
      : getNativeHttpTargetAgents(state.agents).map((agent) =>
          syncSingleAgent(agent, nativeOnly, { dryRun, prune: false, quiet, managedNames }, log),
        )),
  ]);
  runStdioOnlyRemotePrune(state.agents, managedNames, log, { dryRun, quiet });
  syncDetectedMcpPermissions(state.agents, servers, dryRun);
  const totals = aggregateAndLogResults(agentResults, log, { quiet, verbose, dryRun });

  if (!dryRun) persistManagedNames(manifest, managedNames, sharedManifest);

  // Post-sync sweep: rewrite bare `${VAR}` → `${VAR:-}` in every detected agent's MCP
  // config. Catches placeholders mcpm wrote for intersection clients (slice 4a hands
  // them to `mcpm install` + `mcpm client edit`, neither of which knows about
  // resilient placeholders) so strict env-var interpolators downstream — chiefly
  // Devin importing `~/.claude.json` and `~/.cursor/mcp.json` — don't abort the
  // entire MCP load when a token isn't set in this shell.
  //
  // Skipped on dry-run so `agentbrew sync --dry-run` stays read-only. Failures
  // here are non-fatal: the sweep is best-effort and the drift check
  // (`checkBarePlaceholdersDrift`) will re-flag any leftovers on the next status.
  if (!dryRun) {
    runPostSyncResilientSweep(state.agents, log, quiet);
    runPostSyncCatalogPinSweep(state.agents, log, quiet);
    runPostSyncPlaywrightIsolatedSweep(state.agents, log, quiet);
    runPostSyncEndpointRepairSweep(servers, quarantined, log, quiet);
    runPostSyncMcpmHygieneSweep(state.agents, servers, quarantined, log, quiet);
    runPostSyncCursorGuiFinalize(state.agents, log, quiet);
  }

  if (!quiet) {
    const externalNames = state.externalMcpServers?.length ? new Set(state.externalMcpServers) : undefined;
    await logSyncSummary(totals, { dryRun, discover, externalNames }, detectedAgents.length, servers, log);
  }
}

/** Remove agentbrew-written remote entries from stdio-only clients (see `STDIO_ONLY_MCP_AGENTS`). */
function runStdioOnlyRemotePrune(
  agents: AgentConfig[],
  managedNames: ReadonlySet<string>,
  log: Logger,
  options: { dryRun: boolean; quiet: boolean },
): void {
  for (const agent of getMcpmIntersectionAgents(agents).filter((a) => STDIO_ONLY_MCP_AGENTS.has(a.name))) {
    try {
      const removed = pruneManagedRemoteEntries(agent, managedNames, options.dryRun);
      if (removed.length === 0 || options.quiet) continue;
      const verb = options.dryRun ? "Would remove" : "Removed";
      log.log(log.dim(`  ${verb} remote MCP entries from ${agent.name}: ${removed.join(", ")}`));
    } catch (e) {
      logSkipped("mcp-sync/stdio-only-prune", e);
    }
  }
}

function runPostSyncCatalogPinSweep(agents: AgentConfig[], log: Logger, quiet: boolean): void {
  try {
    const results = sweepCatalogPins({ detected: agents });
    const totalFixed = results.reduce((sum, result) => sum + result.fixedCount, 0);
    if (totalFixed === 0 || quiet) return;
    log.log(
      log.dim(
        `  Re-pinned ${totalFixed} floating catalog MCP entr${totalFixed === 1 ? "y" : "ies"} across ${results.length} agent config(s).`,
      ),
    );
  } catch (e) {
    logSkipped("mcp-sync/catalog-pin-sweep", e);
  }
}

/** Post-sync sweep that rewrites bare `${VAR}` to `${VAR:-}` in every detected agent's MCP config.
 *  See `src/mcp/resilient-sweep.ts` for the full rationale. */
function runPostSyncResilientSweep(agents: AgentConfig[], log: Logger, quiet: boolean): void {
  try {
    const results = sweepMcpConfigs({ detected: agents });
    const totalFixed = results.reduce((sum, r) => sum + r.fixedCount, 0);
    if (totalFixed === 0 || quiet) return;
    log.log(
      log.dim(
        `  Sanitized ${totalFixed} bare \${VAR} placeholder(s) across ${results.length} MCP config(s) — see docs/agents-guide.md#resilient-placeholders.`,
      ),
    );
  } catch (e) {
    // Non-fatal: drift check will surface any leftovers.
    logSkipped("mcp-sync/resilient-sweep", e);
  }
}

/** Post-sync sweep that appends `--isolated` to every Playwright MCP entry that lacks it.
 *  See `src/mcp/playwright-isolated-sweep.ts` for the full rationale. */
function runPostSyncPlaywrightIsolatedSweep(agents: AgentConfig[], log: Logger, quiet: boolean): void {
  try {
    const results = sweepPlaywrightIsolated({ detected: agents });
    const totalFixed = results.reduce((sum, r) => sum + r.fixedCount, 0);
    if (totalFixed === 0 || quiet) return;
    log.log(
      log.dim(
        `  Added --isolated to ${totalFixed} Playwright MCP entr${totalFixed === 1 ? "y" : "ies"} across ${results.length} agent config(s) — prevents profile-lock collisions when multiple agents share a repo.`,
      ),
    );
  } catch (e) {
    // Non-fatal: drift check will surface any leftovers.
    logSkipped("mcp-sync/playwright-isolated-sweep", e);
  }
}

/** Post-sync sweep that prunes MCP entries whose command no longer exists and adds the
 *  corporate CA bundle to Python-runner entries, across global and per-project scopes.
 *  See `src/mcp/endpoint-repair.ts` for the full rationale. */
function runPostSyncEndpointRepairSweep(
  servers: McpServer[],
  quarantined: McpServer[],
  log: Logger,
  quiet: boolean,
): void {
  try {
    const stateServerNames = new Set(servers.map((server) => server.name));
    // Deliberately not filtered to detected agents. `buildMcpProbeSurfaces`
    // probes every agent that has a config file on disk, so restricting the
    // repair to detected agents would report failures the sweep can never fix.
    // The sweep is a no-op for agents whose config file does not exist.
    const results = sweepMcpEndpointRepairs({
      stateServerNames,
      quarantinedEntryKeys: quarantinedEntryKeys(quarantined),
    });
    if (quiet) return;
    logEndpointRepairSummary(results, log);
    logQuarantineNotices(quarantined, log);
  } catch (e) {
    // Non-fatal: the next status/drift check re-flags anything left behind.
    logSkipped("mcp-sync/endpoint-repair-sweep", e);
  }
}

function countRepairs(results: EndpointRepairFileResult[], kind: EndpointRepairKind): number {
  return results.reduce((sum, result) => sum + result.findings.filter((finding) => finding.kind === kind).length, 0);
}

function logEndpointRepairSummary(results: EndpointRepairFileResult[], log: Logger): void {
  const pruned = countRepairs(results, "prune-unresolvable-command");
  const trusted = countRepairs(results, "inject-corporate-ca");
  const held = countRepairs(results, "prune-quarantined-server");
  if (pruned + trusted + held === 0) return;

  const parts: string[] = [];
  if (pruned > 0) parts.push(`pruned ${pruned} MCP entr${pruned === 1 ? "y" : "ies"} with a missing command`);
  if (held > 0) parts.push(`withdrew ${held} quarantined MCP entr${held === 1 ? "y" : "ies"}`);
  if (trusted > 0)
    parts.push(`added the corporate CA bundle to ${trusted} Python-runner entr${trusted === 1 ? "y" : "ies"}`);
  log.log(log.dim(`  ${parts.join("; ")} across ${results.length} agent config(s).`));
}

function logQuarantineNotices(quarantined: McpServer[], log: Logger): void {
  // Report on every sync: the block stays in force until its owner lifts it.
  for (const notice of formatQuarantineNotice(quarantined)) {
    log.log(log.dim(`  MCP quarantined — ${notice}`));
  }
}

/** Re-apply Cursor GUI stdio wrapping after post-sync sweeps (playwright-isolated only
 *  touches bare `npx` entries; hygiene/github fixes can also leave bare commands). */
function runPostSyncCursorGuiFinalize(agents: AgentConfig[], log: Logger, quiet: boolean): void {
  const cursor = agents.find((agent) => agent.name === "cursor" && agent.detected);
  if (!cursor?.mcpConfig) return;

  const mcpKey = cursor.mcpKey ?? "mcpServers";
  const configPath = expandHome(cursor.mcpConfig);
  if (!existsSync(configPath)) return;

  try {
    const config = readMcpJson(configPath);
    const entries = getServers(config, mcpKey) as Record<string, Record<string, unknown>>;
    const snapshot = JSON.stringify(entries);
    finalizeCursorGuiMcpEntries(entries);
    if (JSON.stringify(entries) === snapshot) return;
    setServers(config, entries as Record<string, import("../types.js").McpServerEntry>, mcpKey);
    writeMcpJson(configPath, config);
    if (!quiet) {
      log.log(log.dim("  Re-wrapped Cursor MCP stdio entries for GUI-minimal PATH."));
    }
  } catch (e) {
    logSkipped("mcp-sync/cursor-gui-finalize", e);
  }
}

/** Post-sync sweep that removes redundant/broken mcpm wrappers and stale MCP entries.
 *  See `src/mcp/mcpm-hygiene.ts` for the full rationale. */
function runPostSyncMcpmHygieneSweep(
  agents: AgentConfig[],
  servers: McpServer[],
  quarantined: McpServer[],
  log: Logger,
  quiet: boolean,
): void {
  try {
    const stateServerNames = new Set(servers.map((server) => server.name));
    const detectedAgents = agents.filter((agent) => agent.detected).map((agent) => agent.name);
    const removedFromMcpm = [
      ...uninstallBrokenMcpmRegistryServers(detectedAgents, false, stateServerNames),
      ...uninstallQuarantinedMcpmServers(
        detectedAgents,
        quarantined.map((server) => server.name),
        false,
      ),
      ...uninstallNativeOnlyMcpmServers(
        detectedAgents,
        servers.filter(requiresNativeHttpTransport).map((server) => server.name),
        false,
      ),
    ];
    const results = sweepMcpmHygiene({ stateServerNames, agentDefinitions: AGENT_DEFINITIONS });
    const removedKeys = results.reduce((sum, result) => sum + result.removedKeys.length, 0);
    const fixedGithub = results.filter((result) => result.fixedGithub).length;
    const fixedMemory = results.filter((result) => result.fixedMemory).length;
    if (removedFromMcpm.length === 0 && removedKeys === 0 && fixedGithub === 0 && fixedMemory === 0) return;
    if (quiet) return;
    const parts: string[] = [];
    if (removedFromMcpm.length > 0) {
      parts.push(`uninstalled ${removedFromMcpm.length} broken mcpm registry server(s)`);
    }
    if (removedKeys > 0) {
      parts.push(`removed ${removedKeys} redundant/stale MCP entr${removedKeys === 1 ? "y" : "ies"}`);
    }
    if (fixedGithub > 0) {
      parts.push(
        `repointed ${fixedGithub} deprecated github MCP entr${fixedGithub === 1 ? "y" : "ies"} to the GHE launcher`,
      );
    }
    if (fixedMemory > 0) {
      parts.push(
        `updated ${fixedMemory} memory MCP entr${fixedMemory === 1 ? "y" : "ies"} from memory-server to memory server`,
      );
    }
    log.log(log.dim(`  MCP hygiene: ${parts.join("; ")}.`));
  } catch (e) {
    logSkipped("mcp-sync/mcpm-hygiene-sweep", e);
  }
}

// ── CLI mutation commands (extracted to mcp-sync-commands.ts) ────────────────
// Intentional facade: every consumer of the MCP API enters via this module,
// so the add/list/remove mutations are re-exported here even though they live
// in the sibling file. Keeps `import ... from "./sync/mcp-sync.js"` as the one
// public entry point. Drop only if/when the sync surface is reshaped wholesale.
export { addMcpServer, removeMcpServer } from "./mcp-sync-commands.js";
