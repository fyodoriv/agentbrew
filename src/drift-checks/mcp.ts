import { existsSync, readFileSync } from "node:fs";
import { getConfigServers, getStateServers } from "../agentfile.js";
import { logSkipped } from "../core/logger.js";
import { MCP_INTERSECTION_AGENTS } from "../core/mcp-agent-map.js";
import { getAdapter } from "../mcp/adapters.js";
import { sweepCatalogPins } from "../mcp/catalog-pin-sweep.js";
import { getEnvFormat, hasUnresolvedLiterals } from "../mcp/env-vars.js";
import { validateMcpEnvVars } from "../mcp/mcp-setup.js";
import { sweepPlaywrightIsolated } from "../mcp/playwright-isolated-sweep.js";
import { isQuarantined } from "../mcp/quarantine.js";
import { sweepMcpConfigs } from "../mcp/resilient-sweep.js";
import { MEMORY_MANAGED_SERVER_NAME } from "../memory/constants.js";
import { isManagedMemoryServer } from "../memory/enable.js";
import { loadState } from "../state.js";
import type { AgentConfig, McpServer } from "../types.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { expandHome } from "../utils.js";
import type { DriftItem } from "./types.js";

type AgentDefWithMcp = Omit<AgentConfig, "detected"> & { mcpConfig: string };

/**
 * State servers that sync will actually deploy.
 *
 * A quarantined server is held out of the fanout on purpose, so measuring the
 * agent configs against the raw state list reports it missing from every agent
 * forever. That turns one blocked endpoint into permanent red drift and an
 * auto-fix that can never succeed — the exact noise quarantine exists to end.
 */
function deployableServers(state: Parameters<typeof getStateServers>[0]): McpServer[] {
  return getStateServers(state).filter((server) => !isQuarantined(server));
}

export function checkMcpEnvVarsDrift(): DriftItem[] {
  const warnings = validateMcpEnvVars();
  return warnings.map((w) => ({
    agent: w.serverName,
    type: "mcp-env-vars" as const,
    detail: `missing env vars: ${w.missingVars.join(", ")} — Run: agentbrew setup`,
  }));
}

/**
 * Flag bare `${VAR}` placeholders in MCP configs that haven't been rewritten to
 * the resilient `${VAR:-}` form.
 *
 * Why this is a drift type, not a lint error:
 * - Strict env-var interpolators (the Devin CLI binary, plus any future agent
 *   that imports configs across clients) abort the entire MCP load when they hit
 *   a bare `${VAR}` whose env var is unset. The whole tool list — playwright,
 *   context7, every working MCP — silently disappears, with only an opaque
 *   "Failed to load MCP configuration" message to debug from.
 * - `agentbrew sync` (and its repair path `agentbrew status --fix`) auto-fixes
 *   the drift by running `sweepMcpConfigs`. That's why `mcp-bare-placeholder`
 *   belongs in `AUTO_FIXABLE_TYPES` in `repair.ts`.
 * - mcpm (which writes `MCP_INTERSECTION_AGENTS` clients'
 *   configs in slice 4a of `delegate-mcp-to-mcpm`) doesn't know about resilient
 *   placeholders. Drift detection here is the only signal a user gets that
 *   their next sync needs to re-sanitize.
 */
export function checkBarePlaceholdersDrift(): DriftItem[] {
  const state = loadState();
  if (!state || !Array.isArray(state.agents)) return [];
  const detected = state.agents.filter((a) => a.detected);
  // dryRun so we don't write — drift checks are read-only by contract.
  const sweep = sweepMcpConfigs({ dryRun: true, detected });
  return sweep.map((result) => {
    const uniqueVars = Array.from(new Set(result.findings.map((f) => f.varName))).sort();
    const varList =
      uniqueVars.length <= 4
        ? uniqueVars.join(", ")
        : `${uniqueVars.slice(0, 4).join(", ")}, +${uniqueVars.length - 4} more`;
    return {
      agent: result.agentName,
      type: "mcp-bare-placeholder" as const,
      detail: `${result.findings.length} bare \${VAR} placeholder(s) [${varList}] — Run: agentbrew sync`,
    };
  });
}

/**
 * Flag Playwright MCP entries (global + per-project) that are missing the
 * `--isolated` flag.
 *
 * Why this is a drift type, not a lint error:
 * - The fix is mechanical and matches the catalog's declared form, so
 *   `agentbrew sync` (and `agentbrew status --fix`) can auto-fix the drift
 *   by running `sweepPlaywrightIsolated`. That's why
 *   `mcp-playwright-isolated` belongs in `AUTO_FIXABLE_TYPES` in `repair.ts`.
 * - Per-project entries in Claude Code's `~/.claude.json` are typically
 *   created interactively (UI "Add MCP server") or by older agentbrew
 *   versions before `--isolated` was added to the catalog. Sync only writes
 *   the global block, so per-project drift accumulates over time and surfaces
 *   as `Browser is already in use for mcp-chrome-<hash>` errors when two
 *   agents run Playwright in the same repo concurrently (playwright #40419,
 *   playwright-mcp #1594).
 */
export function checkPlaywrightIsolatedDrift(): DriftItem[] {
  const state = loadState();
  if (!state || !Array.isArray(state.agents)) return [];
  const detected = state.agents.filter((a) => a.detected);
  // dryRun so we don't write — drift checks are read-only by contract.
  const sweep = sweepPlaywrightIsolated({ dryRun: true, detected });
  return sweep.map((result) => ({
    agent: result.agentName,
    type: "mcp-playwright-isolated" as const,
    detail: `${result.findings.length} playwright MCP entr${result.findings.length === 1 ? "y" : "ies"} missing --isolated — Run: agentbrew sync`,
  }));
}

export function checkCatalogPinDrift(): DriftItem[] {
  const state = loadState();
  if (!state || !Array.isArray(state.agents)) return [];
  const detected = state.agents.filter((agent) => agent.detected);
  const sweep = sweepCatalogPins({ dryRun: true, detected });
  return sweep.map(
    (result): DriftItem => ({
      agent: result.agentName,
      type: "mcp-catalog-pin",
      detail: `${result.findings.length} floating catalog MCP entr${result.findings.length === 1 ? "y" : "ies"} — Run: agentbrew sync`,
    }),
  );
}

const MCP_PERMISSION_PATTERN = /^mcp__(.+)__\*$/;
const MCPM_SERVER_PREFIX = "mcpm_";

function isKnownServerName(name: string, stateNames: Set<string>): boolean {
  if (stateNames.has(name)) return true;
  if (!name.startsWith(MCPM_SERVER_PREFIX)) return false;
  return stateNames.has(name.slice(MCPM_SERVER_PREFIX.length));
}

function serverHasUnresolvedLiterals(server: McpServer): boolean {
  return [...server.args, ...Object.values(server.env), server.url ?? "", ...Object.values(server.headers ?? {})].some(
    hasUnresolvedLiterals,
  );
}

function expectedServersForAgent(agent: AgentDefWithMcp, servers: McpServer[]): McpServer[] {
  if (getEnvFormat(agent.name) !== "literal") return servers;
  return servers.filter((server) => !serverHasUnresolvedLiterals(server));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function getServerNames(config: Record<string, unknown>, mcpKey = "mcpServers"): string[] {
  const servers = config[mcpKey];
  return isRecord(servers) ? Object.keys(servers) : [];
}

function getPermissionedNames(config: Record<string, unknown>): Set<string> {
  const permissions = isRecord(config.permissions) ? config.permissions : {};
  const allowList = getStringArray(permissions.allow);
  return new Set(
    allowList
      .map((entry) => MCP_PERMISSION_PATTERN.exec(entry)?.[1])
      .filter((name): name is string => name !== undefined),
  );
}

function readJsonConfig(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    logSkipped("drift/parse", error);
    return undefined;
  }
}

function getDeployedServerNames(agent: Omit<AgentConfig, "detected">): string[] {
  if (!agent.mcpConfig) return [];
  const configPath = expandHome(agent.mcpConfig);
  if (!existsSync(configPath)) return [];
  try {
    const adapter = getAdapter(agent);
    return Object.keys(adapter.readEntries(configPath, agent.mcpKey ?? "mcpServers"));
  } catch (error) {
    logSkipped("drift/readPermissionServerNames", error);
    return [];
  }
}

function getMcpPermissionAgents(stateAgents: AgentConfig[]): Array<Omit<AgentConfig, "detected">> {
  const detectedNames = new Set(stateAgents.filter((agent) => agent.detected).map((agent) => agent.name));
  return AGENT_DEFINITIONS.filter((agent) => agent.mcpPermissionsConfig && detectedNames.has(agent.name));
}

function checkMcpPermissionDriftForAgent(agent: Omit<AgentConfig, "detected">, stateNames: Set<string>): DriftItem[] {
  if (!agent.mcpPermissionsConfig) return [];
  const configPath = expandHome(agent.mcpPermissionsConfig.file);
  if (!existsSync(configPath)) return [];
  const config = readJsonConfig(configPath);
  if (!config) return [];

  const desiredPermissionNames = new Set([
    ...stateNames,
    ...getServerNames(config, agent.mcpKey),
    ...getDeployedServerNames(agent),
  ]);
  const permissionedNames = getPermissionedNames(config);
  const drift: DriftItem[] = [];

  for (const name of desiredPermissionNames) {
    if (permissionedNames.has(name)) continue;
    drift.push({
      agent: agent.name,
      type: "mcp-permissions",
      detail: `missing permission for "${name}" — Run: agentbrew sync`,
    });
  }

  for (const name of permissionedNames) {
    if (desiredPermissionNames.has(name)) continue;
    drift.push({
      agent: agent.name,
      type: "mcp-permissions",
      detail: `stale permission "mcp__${name}__*" — server not configured`,
    });
  }

  return drift;
}

export function checkMcpPermissionDrift(): DriftItem[] {
  const state = loadState();
  if (!state) return [];

  const stateNames = new Set(deployableServers(state).map((server) => server.name));
  return getMcpPermissionAgents(state.agents).flatMap((agent) => checkMcpPermissionDriftForAgent(agent, stateNames));
}

export function checkDevinPermissionDrift(): DriftItem[] {
  return checkMcpPermissionDrift().filter((item) => item.agent === "devin");
}

/** Check a single agent's MCP config for missing servers. */
function checkMcpDriftForAgent(
  agent: AgentDefWithMcp,
  servers: ReturnType<typeof getStateServers>,
): DriftItem | undefined {
  const configPath = expandHome(agent.mcpConfig);
  if (!existsSync(configPath)) return undefined;

  let deployed: Record<string, unknown> = {};
  const mcpKey = agent.mcpKey ?? "mcpServers";
  try {
    const adapter = getAdapter(agent);
    deployed = adapter.readEntries(configPath, mcpKey);
  } catch (e) {
    logSkipped("drift/readEntries", e);
    return { agent: agent.name, type: "mcp", detail: "config file unreadable — Run: agentbrew setup" };
  }
  const missing = expectedServersForAgent(agent, servers)
    .filter((s) => !(s.name in deployed))
    .map((s) => s.name);
  if (missing.length === 0) return undefined;
  return {
    agent: agent.name,
    type: "mcp",
    detail: `missing server${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
    diff: { added: missing },
  };
}

/**
 * Slice 4a of `delegate-mcp-to-mcpm` (TASKS.md): MCP_INTERSECTION_AGENTS
 * {@link MCP_INTERSECTION_AGENTS} set is skipped during native MCP sync
 * (`getMcpTargetAgents` filters them out). Drift detection follows the
 * same skip semantics — otherwise the drift checker would continuously
 * report "missing servers" for those agents even though sync correctly
 * skipped writing them. `AGENTBREW_ONLY_MCP_AGENTS` carve-outs (devin, overlay-desktop, copilot,
 * opencode, kiro, amp) are still drift-checked because native sync still
 * writes their configs.
 *
 * Mirrors the rules-to-ai-rules slice 4 precedent: see the canary skip
 * in `checkRulesDrift` (`src/drift-checks/rules.ts`).
 */
function isNativeMcpAgentName(name: string): boolean {
  return !MCP_INTERSECTION_AGENTS.has(name);
}

export function checkMcpDrift(): DriftItem[] {
  const state = loadState();
  if (!state) return [];

  const servers = deployableServers(state);
  const detectedNames = new Set(state.agents.filter((a) => a.detected).map((a) => a.name));
  const mcpAgents = AGENT_DEFINITIONS.filter(
    (def): def is AgentDefWithMcp => !!def.mcpConfig && detectedNames.has(def.name) && isNativeMcpAgentName(def.name),
  );
  const memoryServer = servers.find((server) => server.name === MEMORY_MANAGED_SERVER_NAME);
  const memoryDrift: DriftItem[] =
    state.memory?.enabled === true && !isManagedMemoryServer(memoryServer)
      ? [
          {
            agent: MEMORY_MANAGED_SERVER_NAME,
            type: "mcp",
            detail: `managed memory MCP server ${memoryServer ? "is malformed" : "is missing"} — Run: agentbrew sync`,
            diff: memoryServer ? { updated: [MEMORY_MANAGED_SERVER_NAME] } : { added: [MEMORY_MANAGED_SERVER_NAME] },
          },
        ]
      : [];

  return [
    ...memoryDrift,
    ...mcpAgents.map((agent) => checkMcpDriftForAgent(agent, servers)).filter((d): d is DriftItem => d !== undefined),
  ];
}

/** Detect MCP servers in agent configs that are NOT in agentbrew state.
 *  These are servers users added manually to one agent but haven't imported. */
export function checkUserAddedMcpServers(): DriftItem[] {
  const state = loadState();
  if (!state) return [];

  const drift: DriftItem[] = [];
  const stateNames = new Set(getConfigServers().map((s) => s.name));
  const detectedNames = new Set(state.agents.filter((a) => a.detected).map((a) => a.name));
  const mcpAgents = AGENT_DEFINITIONS.filter(
    (def): def is AgentDefWithMcp => !!def.mcpConfig && detectedNames.has(def.name) && isNativeMcpAgentName(def.name),
  );
  const seen = new Set<string>();

  for (const agent of mcpAgents) {
    const configPath = expandHome(agent.mcpConfig);
    if (!existsSync(configPath)) continue;

    try {
      const adapter = getAdapter(agent);
      const mcpKey = agent.mcpKey ?? "mcpServers";
      const deployed = adapter.readEntries(configPath, mcpKey);
      for (const name of Object.keys(deployed)) {
        if (!isKnownServerName(name, stateNames) && !seen.has(name)) {
          seen.add(name);
          drift.push({
            agent: agent.name,
            type: "mcp-user-added",
            detail: `user-added server: ${name} — Run: agentbrew import`,
          });
        }
      }
    } catch (e) {
      logSkipped("drift/push", e);
      // Skip unreadable configs
    }
  }

  return drift;
}
