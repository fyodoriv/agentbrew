import { existsSync, readFileSync } from "node:fs";
import TOML from "@iarna/toml";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import type { Context } from "../core/context.js";
import { createContext } from "../core/context.js";
import type { Logger } from "../core/logger.js";
import { logSkipped } from "../core/logger.js";
import { loadState } from "../state.js";
import type { AgentConfig, ModelConfig, SyncOptions } from "../types.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { expandHome } from "../utils.js";

// ── Pure functions (no I/O, trivially testable) ─────────────────────────────

/**
 * Resolve the model id to deploy for one agent.
 *
 * Returns the override string when the Agentfile names the agent (providers
 * name the same model differently), `undefined` when the override is `null`
 * (the model is not available on that agent's provider/gateway — leave the
 * agent's own setting alone), and the machine default otherwise.
 */
export function resolveTargetModel(
  agentName: string,
  defaultModel: string,
  overrides: Record<string, string | null> | undefined,
): string | undefined {
  if (overrides && agentName in overrides) {
    return overrides[agentName] ?? undefined;
  }
  return defaultModel;
}

/** Read the value at a dot-separated key path. Returns undefined when any segment is missing. */
export function getValueAtPath(obj: Record<string, unknown>, dotPath: string): unknown {
  let current: unknown = obj;
  for (const segment of dotPath.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Set the value at a dot-separated key path, creating intermediate objects.
 * Returns false (without writing) when an intermediate segment exists but is
 * not an object — overwriting it could destroy unrelated user config.
 */
export function setValueAtPath(obj: Record<string, unknown>, dotPath: string, value: unknown): boolean {
  const segments = dotPath.split(".");
  let current = obj;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (next === undefined) {
      const created: Record<string, unknown> = {};
      current[segment] = created;
      current = created;
    } else if (typeof next === "object" && next !== null && !Array.isArray(next)) {
      current = next as Record<string, unknown>;
    } else {
      return false;
    }
  }
  current[segments.at(-1) ?? dotPath] = value;
  return true;
}

/** Human-readable "model (effort effort)" label for logs and status. */
export function formatModelLabel(model: string, effort: string | undefined): string {
  return effort ? `${model}, ${effort} effort` : model;
}

// ── Sync engine ──────────────────────────────────────────────────────────────

interface ModelTarget {
  agentName: string;
  modelConfig: ModelConfig;
}

/** Detected agents that declare a `modelConfig` surface in agents.yaml. */
function getModelTargets(agents: AgentConfig[]): ModelTarget[] {
  const detectedNames = new Set(agents.filter((agent) => agent.detected).map((agent) => agent.name));
  return AGENT_DEFINITIONS.filter((a) => a.modelConfig !== undefined && detectedNames.has(a.name)).map((a) => ({
    agentName: a.name,
    // biome-ignore lint/style/noNonNullAssertion: filtered to defined above
    modelConfig: a.modelConfig!,
  }));
}

function readConfigFile(filePath: string, format: ModelConfig["format"]): Record<string, unknown> | undefined {
  const raw = readFileSync(filePath, "utf-8");
  const parsed: unknown = format === "toml" ? TOML.parse(raw) : JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  return parsed as Record<string, unknown>;
}

function serializeConfigFile(config: Record<string, unknown>, format: ModelConfig["format"]): string {
  if (format === "toml") return TOML.stringify(config as TOML.JsonMap);
  return `${JSON.stringify(config, null, 2)}\n`;
}

type TargetOutcome =
  | { kind: "updated"; changes: string[] }
  | { kind: "up-to-date" }
  | { kind: "skipped"; reason: string };

interface DesiredSetting {
  label: string;
  path: string;
  value: string;
}

function describeChange(label: string, from: unknown, to: string): string {
  return typeof from === "string" ? `${label} ${from} → ${to}` : `${label} ${to}`;
}

/** Settings to write for one agent: the model, plus effort when the agent stores it separately. */
function desiredSettings(target: ModelTarget, model: string, effort: string | undefined): DesiredSetting[] {
  const settings: DesiredSetting[] = [{ label: "model", path: target.modelConfig.path, value: model }];
  if (effort && target.modelConfig.effortPath) {
    settings.push({ label: "effort", path: target.modelConfig.effortPath, value: effort });
  }
  return settings;
}

/**
 * Apply the resolved model (and effort) to one agent's config file.
 * Read–compare–write is fully synchronous so a parallel sync module can never
 * interleave between our read and write of a shared file (e.g. hooks-sync
 * also writes ~/.claude/settings.json).
 */
function syncSingleTarget(target: ModelTarget, run: ModelSyncRun): TargetOutcome {
  const model = resolveTargetModel(target.agentName, run.defaultModel, run.overrides);
  if (model === undefined) return { kind: "skipped", reason: "override: keep agent's own model" };

  const filePath = expandHome(target.modelConfig.file);
  if (!existsSync(filePath)) return { kind: "skipped", reason: "config file not found" };

  const config = readConfigFile(filePath, target.modelConfig.format);
  if (!config) return { kind: "skipped", reason: "config file is not a key/value object" };

  const changes: string[] = [];
  for (const setting of desiredSettings(target, model, run.defaultEffort)) {
    const current = getValueAtPath(config, setting.path);
    if (current === setting.value) continue;
    if (!setValueAtPath(config, setting.path, setting.value)) {
      return { kind: "skipped", reason: `key path '${setting.path}' blocked by a non-object value` };
    }
    changes.push(describeChange(setting.label, current, setting.value));
  }
  if (changes.length === 0) return { kind: "up-to-date" };

  if (!run.dryRun) {
    writeFileAtomicSync(filePath, serializeConfigFile(config, target.modelConfig.format), "utf-8");
  }
  return { kind: "updated", changes };
}

interface ModelSyncRun {
  defaultModel: string;
  defaultEffort: string | undefined;
  overrides: Record<string, string | null> | undefined;
  quiet: boolean;
  verbose: boolean;
  dryRun: boolean;
  log: Logger;
}

function logTargetOutcome(outcome: TargetOutcome, agentName: string, run: ModelSyncRun): void {
  if (run.quiet) return;
  if (outcome.kind === "updated") {
    const icon = run.dryRun ? run.log.blue("~") : run.log.green("✓");
    run.log.log(`  ${icon} ${agentName} — ${outcome.changes.join(", ")}`);
    return;
  }
  if (!run.verbose) return;
  if (outcome.kind === "up-to-date") {
    run.log.log(`  ${run.log.green("✓")} ${agentName} — up to date`);
    return;
  }
  run.log.log(`  ${run.log.dim("-")} ${agentName} — skipped (${outcome.reason})`);
}

/** Apply the run to every target, log outcomes, and return the update count. */
function processModelTargets(targets: ModelTarget[], run: ModelSyncRun): number {
  let updates = 0;
  for (const target of targets) {
    try {
      const outcome = syncSingleTarget(target, run);
      if (outcome.kind === "updated") updates += 1;
      logTargetOutcome(outcome, target.agentName, run);
    } catch (e) {
      logSkipped(`sync/model-sync/${target.agentName}`, e);
      run.log.warn(`  ⚠ ${target.agentName} — model sync failed (see debug log)`);
    }
  }
  return updates;
}

/**
 * Sync the Agentfile's `defaultModel` to every detected agent that declares a
 * `modelConfig` surface in agents.yaml (claude-code, devin, codex today —
 * Cursor and Windsurf keep the model in app-managed/UI state, so there is no
 * file surface to manage). `defaultEffort` is written alongside for agents
 * that declare an `effortPath`. Per-agent `modelOverrides` rename or skip
 * individual agents (a skipped agent keeps its own effort too). No-op when
 * state has no `defaultModel`.
 */
export async function syncModels(options?: SyncOptions, ctx?: Partial<Context>): Promise<void> {
  const quiet = options?.quiet ?? false;
  const dryRun = options?.dryRun ?? false;
  const log = ctx?.logger ?? createContext({ quiet, compact: options?.compact }).logger;

  const state = loadState();
  if (!state?.defaultModel) return;

  const targets = getModelTargets(state.agents);
  if (targets.length === 0) return;

  if (!quiet) {
    const label = dryRun
      ? "Dry run — default model"
      : `Syncing default model (${formatModelLabel(state.defaultModel, state.defaultEffort)})...`;
    log.log(log.bold(`\n${label}\n`));
  }

  const run: ModelSyncRun = {
    defaultModel: state.defaultModel,
    defaultEffort: state.defaultEffort,
    overrides: state.modelOverrides,
    quiet,
    verbose: options?.verbose ?? false,
    dryRun,
    log,
  };
  const updates = processModelTargets(targets, run);

  if (!quiet && updates > 0) {
    log.log(log.bold(`\n${dryRun ? "Would apply:" : "Done."} ${updates} model change(s).\n`));
  }
}
