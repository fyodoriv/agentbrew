import { existsSync, readFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import chalk from "chalk";
import type { CatalogMcpProbeSuppression } from "../catalog/types.js";
import { loadAgentDefinitions } from "../core/agents.js";
import { logSkipped } from "../core/logger.js";
import { expandHome } from "../utils.js";
import { buildSchedulerDeepSmokeMap, buildSchedulerProbeSuppressionMap } from "./catalog-smoke.js";
import { appendMcpFollowupTasks } from "./followup-tasks.js";
import {
  categorizeProbeResult,
  HEAL_ACTIONS,
  type HealAction,
  isProbeFailure,
  type ProbeStatusCategory,
} from "./heal-actions.js";
import {
  isSuppressedFailure,
  type McpHealAttempt,
  type McpHealDeferral,
  type McpHealthSuppression,
  resolveProbeSuppressions,
  type SnapshotProbeResult,
  saveMcpHealthSnapshot,
} from "./health-snapshot.js";
import { BUILTIN_ENV_STRIP_BY_SERVER, type McpProbeSpec, type ProbeResult, probeAllServers } from "./probe.js";
import { normalizeMcpProbeServerMap } from "./probe-spec.js";

export interface ProbeSurface {
  agent: string;
  servers: Record<string, McpProbeSpec>;
}

export interface McpHealCycleResult {
  initial: ProbeResult[];
  final: ProbeResult[];
  attempts: McpHealAttempt[];
}

type ProbeAll = typeof probeAllServers;
type SnapshotWriter = (
  results: SnapshotProbeResult[],
  attempts: McpHealAttempt[],
  generatedAt?: string,
  suppressions?: ReadonlyMap<string, McpHealthSuppression>,
) => unknown;
type FollowupWriter = (results: ProbeResult[], attempts: McpHealAttempt[]) => unknown;

interface McpHealCycleOptions {
  surfaces?: ProbeSurface[];
  probeAll?: ProbeAll;
  healActions?: ReadonlyMap<ProbeStatusCategory, HealAction>;
  writeSnapshot?: SnapshotWriter;
  writeFollowups?: FollowupWriter;
  suppressionByServer?: ReadonlyMap<string, CatalogMcpProbeSuppression>;
  now?: () => Date;
  /** 1-minute load average divided by core count. Injectable for tests. */
  loadPerCore?: () => number;
}

/**
 * Load per core above which timeout failures are not healed.
 *
 * 1.0 is the saturation point: more runnable tasks than cores. On a 10-core
 * machine, loads of 13-20 (1.3-2.0 per core) produced many deep-probe
 * timeouts and a load of 6 (0.6 per core) produced none.
 */
export const HIGH_LOAD_PER_CORE = 1.0;

const TIMEOUT_STATUSES: ReadonlySet<string> = new Set(["init_timeout", "tools_list_timeout"]);

const isTimeoutFailure = (failure: ProbeResult): boolean => TIMEOUT_STATUSES.has(failure.status);

function currentLoadPerCore(): number {
  return loadavg()[0] / Math.max(1, availableParallelism());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMcpServersForAgent(agentName: string): ProbeSurface | undefined {
  const def = loadAgentDefinitions().find((agent) => agent.name === agentName);
  if (!def?.mcpConfig || def.mcpFormat === "toml") return undefined;
  const configPath = expandHome(def.mcpConfig);
  if (!existsSync(configPath)) return undefined;
  try {
    const raw: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!isRecord(raw)) return { agent: agentName, servers: {} };
    const servers = raw[def.mcpKey ?? "mcpServers"];
    return {
      agent: agentName,
      servers: normalizeMcpProbeServerMap(servers),
    };
  } catch (error) {
    logSkipped(`mcp-heal/read ${configPath}`, error);
    return undefined;
  }
}

export function buildMcpProbeSurfaces(): ProbeSurface[] {
  const surfaces: ProbeSurface[] = [];
  for (const def of loadAgentDefinitions()) {
    if (!def.mcpConfig || def.mcpFormat === "toml") continue;
    const surface = readMcpServersForAgent(def.name);
    if (surface) surfaces.push(surface);
  }
  return surfaces;
}

function probeOptions(): Parameters<ProbeAll>[1] {
  return {
    deep: buildSchedulerDeepSmokeMap(),
    stripEnvByServer: BUILTIN_ENV_STRIP_BY_SERVER,
    unattended: true,
  };
}

// Suppression resolution is shared with the `mcp probe` CLI path so both write
// the same snapshot shape — see `resolveProbeSuppressions`.
const suppressionsForResults = resolveProbeSuppressions;

function writeSnapshotResult(
  writeSnapshot: SnapshotWriter,
  results: SnapshotProbeResult[],
  attempts: McpHealAttempt[],
  generatedAt: string,
  suppressions: ReadonlyMap<string, McpHealthSuppression>,
): void {
  if (suppressions.size > 0) {
    writeSnapshot(results, attempts, generatedAt, suppressions);
    return;
  }
  writeSnapshot(results, attempts, generatedAt);
}

async function collectHealAttempts(
  failures: ProbeResult[],
  suppressionByServer: ReadonlyMap<string, CatalogMcpProbeSuppression>,
  healActions: ReadonlyMap<ProbeStatusCategory, HealAction>,
  attemptedAt: string,
  deferred: ReadonlySet<ProbeResult>,
): Promise<McpHealAttempt[]> {
  const attempts: McpHealAttempt[] = [];
  for (const failure of failures) {
    if (deferred.has(failure)) continue;
    if (isSuppressedFailure(failure, suppressionByServer)) continue;
    const category = categorizeProbeResult(failure);
    const action = category ? healActions.get(category) : undefined;
    if (!category || !action) continue;
    attempts.push(await runHealAction(failure, action, category, attemptedAt));
  }
  return attempts;
}

function reportUnresolvedFailures(
  results: ProbeResult[],
  attempts: McpHealAttempt[],
  writeFollowups: FollowupWriter,
  deferred: ReadonlySet<string>,
): void {
  const unresolved = results.filter(isProbeFailure).filter((r) => !deferred.has(pairKey(r)));
  if (unresolved.length === 0) return;
  writeFollowups(unresolved, attempts);
  console.log(chalk.yellow(`MCP auto-heal left ${unresolved.length} probe failure(s); see agentbrew status.`));
}

async function runHealAction(
  result: ProbeResult,
  action: HealAction,
  category: ProbeStatusCategory,
  attemptedAt: string,
): Promise<McpHealAttempt> {
  try {
    const outcome = await action(result);
    return {
      name: result.name,
      agent: result.agent,
      status: result.status,
      category,
      action: outcome.action,
      healed: outcome.healed,
      attemptedAt,
      followupTask: outcome.followupTask,
      error: outcome.error,
    };
  } catch (error) {
    return {
      name: result.name,
      agent: result.agent,
      status: result.status,
      category,
      action: "heal-action-threw",
      healed: false,
      attemptedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runMcpHealCycle(options: McpHealCycleOptions = {}): Promise<McpHealCycleResult> {
  const surfaces = options.surfaces ?? buildMcpProbeSurfaces();
  const probeAll = options.probeAll ?? probeAllServers;
  const writeSnapshot = options.writeSnapshot ?? saveMcpHealthSnapshot;
  const writeFollowups = options.writeFollowups ?? appendMcpFollowupTasks;
  const now = options.now ?? (() => new Date());
  const suppressionByServer = options.suppressionByServer ?? buildSchedulerProbeSuppressionMap();
  if (surfaces.length === 0) {
    writeSnapshot([], [], now().toISOString());
    return { initial: [], final: [], attempts: [] };
  }

  const initial = await probeAll(surfaces, probeOptions());
  const failures = initial.filter(isProbeFailure);
  if (failures.length === 0) {
    writeSnapshot(initial, [], now().toISOString());
    return { initial, final: initial, attempts: [] };
  }

  const healActions = options.healActions ?? HEAL_ACTIONS;
  const attemptedAt = now().toISOString();
  const { deferred, reason } = deferTimeoutsUnderLoad(failures, options.loadPerCore ?? currentLoadPerCore);
  const deferredKeys = new Set([...deferred].map(pairKey));
  const deferral = reason ? { at: attemptedAt, reason } : undefined;
  const attempts = await collectHealAttempts(failures, suppressionByServer, healActions, attemptedAt, deferred);

  if (attempts.length === 0) {
    writeSnapshotResult(
      writeSnapshot,
      markHealDeferred(initial, deferredKeys, deferral),
      attempts,
      now().toISOString(),
      suppressionsForResults(initial, suppressionByServer),
    );
    reportUnresolvedFailures(initial, attempts, writeFollowups, deferredKeys);
    return { initial, final: initial, attempts };
  }

  const final = await reprobeFailures(probeAll, surfaces, initial, failures);
  const gatedAttempts = gateHealedOnReprobe(attempts, final);
  writeSnapshotResult(
    writeSnapshot,
    markHealDeferred(final, deferredKeys, deferral),
    gatedAttempts,
    now().toISOString(),
    suppressionsForResults(final, suppressionByServer),
  );
  reportUnresolvedFailures(final, gatedAttempts, writeFollowups, deferredKeys);
  return { initial, final, attempts: gatedAttempts };
}

/** Timeout failures to leave alone this tick because the machine is overloaded. */
function deferTimeoutsUnderLoad(
  failures: ProbeResult[],
  loadPerCore: () => number,
): { deferred: Set<ProbeResult>; reason?: string } {
  const timeouts = failures.filter(isTimeoutFailure);
  if (timeouts.length === 0) return { deferred: new Set() };
  const load = loadPerCore();
  if (load <= HIGH_LOAD_PER_CORE) return { deferred: new Set() };
  const reason = `load per core ${load.toFixed(2)} is above ${HIGH_LOAD_PER_CORE}`;
  console.log(chalk.yellow(`MCP auto-heal deferred ${timeouts.length} timeout failure(s): ${reason}.`));
  return { deferred: new Set(timeouts), reason };
}

/** Tag deferred pairs so the snapshot can tell a deferred timeout from one that was never considered. */
function markHealDeferred(
  results: ProbeResult[],
  deferredKeys: ReadonlySet<string>,
  deferral: McpHealDeferral | undefined,
): SnapshotProbeResult[] {
  if (!deferral) return results;
  return results.map((r) => (deferredKeys.has(pairKey(r)) ? { ...r, healDeferred: deferral } : r));
}

const pairKey = (value: { agent: string; name: string }): string => `${value.agent}\u0000${value.name}`;

/**
 * Probe again only the pairs that failed the first pass.
 *
 * A healthy server keeps its first result. Starting it twice per tick adds
 * load and, for browser servers, a second launch. The merged list keeps the
 * order of the first pass so the snapshot stays stable.
 */
async function reprobeFailures(
  probeAll: ProbeAll,
  surfaces: ProbeSurface[],
  initial: ProbeResult[],
  failures: ProbeResult[],
): Promise<ProbeResult[]> {
  const failed = new Set(failures.map(pairKey));
  const failedSurfaces = surfaces
    .map((surface) => ({
      agent: surface.agent,
      servers: Object.fromEntries(
        Object.entries(surface.servers).filter(([name]) => failed.has(pairKey({ agent: surface.agent, name }))),
      ),
    }))
    .filter((surface) => Object.keys(surface.servers).length > 0);
  const fresh = new Map((await probeAll(failedSurfaces, probeOptions())).map((r) => [pairKey(r), r]));
  return initial.map((r) => fresh.get(pairKey(r)) ?? r);
}

/** A heal counts only when its server/agent pair passes the re-probe. */
function gateHealedOnReprobe(attempts: McpHealAttempt[], final: ProbeResult[]): McpHealAttempt[] {
  const stillFailing = new Set(final.filter(isProbeFailure).map((r) => `${r.name}\u0000${r.agent}`));
  return attempts.map((attempt) =>
    attempt.healed && stillFailing.has(`${attempt.name}\u0000${attempt.agent}`)
      ? { ...attempt, healed: false }
      : attempt,
  );
}
