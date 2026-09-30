import { existsSync, readFileSync } from "node:fs";
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
  type McpHealthSuppression,
  resolveProbeSuppressions,
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
  results: ProbeResult[],
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
  results: ProbeResult[],
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
): Promise<McpHealAttempt[]> {
  const attempts: McpHealAttempt[] = [];
  for (const failure of failures) {
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
): void {
  const unresolved = results.filter(isProbeFailure);
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
  const attempts = await collectHealAttempts(failures, suppressionByServer, healActions, attemptedAt);

  if (attempts.length === 0) {
    writeSnapshotResult(
      writeSnapshot,
      initial,
      attempts,
      now().toISOString(),
      suppressionsForResults(initial, suppressionByServer),
    );
    reportUnresolvedFailures(initial, attempts, writeFollowups);
    return { initial, final: initial, attempts };
  }

  const final = await probeAll(surfaces, probeOptions());
  writeSnapshotResult(
    writeSnapshot,
    final,
    attempts,
    now().toISOString(),
    suppressionsForResults(final, suppressionByServer),
  );
  reportUnresolvedFailures(final, attempts, writeFollowups);
  return { initial, final, attempts };
}
