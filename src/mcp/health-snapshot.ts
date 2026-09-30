import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import type { CatalogMcpProbeSuppression } from "../catalog/types.js";
import { logSkipped } from "../core/logger.js";
import { MCP_HEALTH_PATH } from "../paths.js";
import { expandHome } from "../utils.js";
import type { ProbeStatusCategory } from "./heal-actions.js";
import { MCPM_PREFIX } from "./mcpm-hygiene.js";
import type { ProbeResult, ProbeStatus } from "./probe.js";

export interface McpHealAttempt {
  name: string;
  agent: string;
  status: ProbeStatus;
  category: ProbeStatusCategory;
  action: string;
  healed: boolean;
  attemptedAt: string;
  followupTask?: string;
  error?: string;
}

export interface McpHealthSuppression {
  reason: string;
  retryPolicy: string;
}

export interface McpHealthEntry {
  name: string;
  agent: string;
  status: ProbeStatus;
  lastCheckedAt: string;
  lastOkAt?: string;
  lastError?: string;
  latencyMs?: number;
  healHistory: McpHealAttempt[];
  suppression?: McpHealthSuppression;
}

export interface McpHealthSnapshot {
  generatedAt: string;
  servers: McpHealthEntry[];
}

const PROBE_STATUSES: ReadonlySet<string> = new Set([
  "ok",
  "ok_deep_failed",
  "launch_failed",
  "init_timeout",
  "init_error",
  "tools_list_failed",
  "tools_list_empty",
  "tools_list_timeout",
  "smoke_call_failed",
  "skipped_no_command",
  "skipped_local_app_offline",
]);

function keyOf(value: { agent: string; name: string }): string {
  return `${value.agent}:${value.name}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProbeStatus(value: unknown): value is ProbeStatus {
  return typeof value === "string" && PROBE_STATUSES.has(value);
}

function isMcpHealthEntry(value: unknown): value is McpHealthEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    typeof value.agent === "string" &&
    isProbeStatus(value.status) &&
    typeof value.lastCheckedAt === "string" &&
    Array.isArray(value.healHistory)
  );
}

function isMcpHealthSnapshot(value: unknown): value is McpHealthSnapshot {
  return (
    isRecord(value) &&
    typeof value.generatedAt === "string" &&
    Array.isArray(value.servers) &&
    value.servers.every(isMcpHealthEntry)
  );
}

export function buildMcpHealthSnapshot(
  previous: McpHealthSnapshot | undefined,
  results: ProbeResult[],
  attempts: McpHealAttempt[],
  generatedAt: string,
  suppressions: ReadonlyMap<string, McpHealthSuppression> = new Map(),
): McpHealthSnapshot {
  const previousByKey = new Map((previous?.servers ?? []).map((entry) => [keyOf(entry), entry]));
  const attemptsByKey = new Map<string, McpHealAttempt[]>();
  for (const attempt of attempts) {
    const current = attemptsByKey.get(keyOf(attempt)) ?? [];
    current.push(attempt);
    attemptsByKey.set(keyOf(attempt), current);
  }

  return {
    generatedAt,
    servers: results.map((result) => {
      const previousEntry = previousByKey.get(keyOf(result));
      const isOk = result.status === "ok";
      const suppression = isOk ? undefined : suppressions.get(keyOf(result));
      const healHistory = [...(previousEntry?.healHistory ?? []), ...(attemptsByKey.get(keyOf(result)) ?? [])];
      return {
        name: result.name,
        agent: result.agent,
        status: result.status,
        lastCheckedAt: generatedAt,
        lastOkAt: isOk ? generatedAt : previousEntry?.lastOkAt,
        lastError: isOk ? undefined : result.error,
        latencyMs: result.latencyMs,
        healHistory,
        ...(suppression ? { suppression } : {}),
      };
    }),
  };
}

export function loadMcpHealthSnapshot(): McpHealthSnapshot | undefined {
  const path = expandHome(MCP_HEALTH_PATH);
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isMcpHealthSnapshot(parsed) ? parsed : undefined;
  } catch (error) {
    logSkipped("mcp-health/load", error);
    return undefined;
  }
}

export function saveMcpHealthSnapshot(
  results: ProbeResult[],
  attempts: McpHealAttempt[],
  generatedAt = new Date().toISOString(),
  suppressions: ReadonlyMap<string, McpHealthSuppression> = new Map(),
): McpHealthSnapshot {
  const snapshot = buildMcpHealthSnapshot(loadMcpHealthSnapshot(), results, attempts, generatedAt, suppressions);
  const path = expandHome(MCP_HEALTH_PATH);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileAtomicSync(path, JSON.stringify(snapshot, null, 2), "utf-8");
  } catch (error) {
    logSkipped("mcp-health/write", error);
  }
  return snapshot;
}

/**
 * Failures an operator can act on.
 *
 * A suppressed entry is excluded: the catalog already states that this status
 * is expected and unfixable from here (Figma's per-client OAuth, for example,
 * puts the token in each agent's own credential store where the probe cannot
 * see it). Counting those as errors trains people to ignore the number, which
 * costs more than the entry is worth.
 */
export function unhealthyMcpEntries(snapshot: McpHealthSnapshot | undefined): McpHealthEntry[] {
  return (snapshot?.servers ?? []).filter(
    (entry) => entry.status !== "ok" && !entry.status.startsWith("skipped_") && !entry.suppression,
  );
}

/** Entries held back by a catalog suppression, for `--verbose` style reporting. */
export function suppressedMcpEntries(snapshot: McpHealthSnapshot | undefined): McpHealthEntry[] {
  return (snapshot?.servers ?? []).filter((entry) => Boolean(entry.suppression));
}

/**
 * Catalog name behind a deployed entry.
 *
 * mcpm-managed clients get the server as `mcpm_<name>`, so a lookup by the
 * deployed name alone misses every suppression on those agents.
 */
export function catalogServerName(deployedName: string): string {
  return deployedName.startsWith(MCPM_PREFIX) ? deployedName.slice(MCPM_PREFIX.length) : deployedName;
}

function matchesSuppression(result: ProbeResult, suppression: CatalogMcpProbeSuppression): boolean {
  return !suppression.statuses?.length || suppression.statuses.includes(result.status);
}

/**
 * True when the catalog declares this failure expected, so the heal loop should
 * leave it alone instead of burning a repair attempt every tick.
 */
export function isSuppressedFailure(
  result: ProbeResult,
  suppressionByServer: ReadonlyMap<string, CatalogMcpProbeSuppression>,
): boolean {
  const suppression = suppressionByServer.get(catalogServerName(result.name));
  return Boolean(suppression && matchesSuppression(result, suppression));
}

/**
 * Turn the catalog's name-keyed suppression map into the `agent:name` keying
 * `buildMcpHealthSnapshot` looks up, keeping only failures whose status the
 * catalog actually declared.
 */
export function resolveProbeSuppressions(
  results: ProbeResult[],
  suppressionByServer: ReadonlyMap<string, CatalogMcpProbeSuppression>,
): Map<string, McpHealthSuppression> {
  const resolved = new Map<string, McpHealthSuppression>();
  for (const result of results) {
    if (result.status === "ok") continue;
    const suppression = suppressionByServer.get(catalogServerName(result.name));
    if (!suppression || !matchesSuppression(result, suppression)) continue;
    resolved.set(keyOf(result), { reason: suppression.reason, retryPolicy: suppression.retryPolicy });
  }
  return resolved;
}
