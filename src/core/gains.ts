/**
 * Estimated time that agentbrew saves, against one baseline: a person who has
 * several AI coding agents and edits each agent's config by hand.
 *
 * The values are modelled, not timed with people: each is at or below the
 * Keystroke-Level Model total of the hand procedure in klm.ts, rounded down
 * to whole seconds. Durations (`ms`) are measured; saved time is not.
 * docs/observability.md ("How much it helps") shows this table.
 * Change a value here and there together.
 */
import { AGENT_DEFINITIONS, type AgentConfig } from "../types.js";
import { NUMBER_MAX } from "./events.js";

export const SAVED_SECONDS = {
  /** One sync, per agent detected on this machine (the set a sync targets). Model: 5.2 s; the earlier estimate of 3 s is lower, so it stays. */
  syncPerAgent: 3,
  /** One repair, per drift item it fixed. Model: 5.2 s for the cheapest drift type, rounded down. */
  repairPerItem: 5,
} as const;

const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** Gain fields of a `sync` event. A failed sync saves 0. */
export function syncGain(ok: boolean, agents: number): { agents: number; secondsSaved: number } {
  const n = count(agents);
  return { agents: n, secondsSaved: ok ? n * SAVED_SECONDS.syncPerAgent : 0 };
}

/** Gain field of a `repair` event. Every fixed item counts, also when other drift is left. */
export function repairGain(repaired: number): { secondsSaved: number } {
  return { secondsSaved: count(repaired) * SAVED_SECONDS.repairPerItem };
}

/** The agent setting that makes an agent a target of each sync module (the modules in buildSyncModules). */
const MODULE_TARGET_FIELD: Record<string, keyof Omit<AgentConfig, "detected">> = {
  mcp: "mcpConfig",
  rules: "rulesFile",
  commands: "commandsDir",
  agents: "agentsDir",
  skills: "skillsDir",
  hooks: "hooksFile",
  models: "modelConfig",
  instructions: "rulesFile",
};

/**
 * Detected agents that a sync touches. With a `--only` list (comma-separated
 * module names), only the agents that one of the named modules targets.
 * A module name that is not known counts no agent.
 */
export function targetedAgentCount(detected: ReadonlySet<string>, only?: string): number {
  if (!only) return detected.size;
  const present = AGENT_DEFINITIONS.filter((agent) => detected.has(agent.name));
  const fields = only
    .split(",")
    .map((name) => MODULE_TARGET_FIELD[name.trim().toLowerCase()])
    .filter((field): field is keyof Omit<AgentConfig, "detected"> => field !== undefined);
  return present.filter((agent) => fields.some((field) => agent[field] !== undefined)).length;
}

export interface GainSummary {
  /** False when the event log is missing or holds no sync or repair event in the window. */
  available: boolean;
  secondsSaved: number;
}

/** Sum `secondsSaved` over the sync and repair lines of the event log since `sinceMs`. Bad lines count as 0. */
export function summarizeGains(lines: string[], sinceMs: number): GainSummary {
  let available = false;
  let secondsSaved = 0;
  for (const line of lines) {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || (e.event !== "sync" && e.event !== "repair")) continue;
    if (!(Date.parse(String(e.ts)) >= sinceMs)) continue;
    available = true;
    // The same bound as sanitizeEvent: a larger value is an edited or broken line.
    const seconds = count(e.secondsSaved);
    if (seconds <= (NUMBER_MAX.secondsSaved ?? Number.POSITIVE_INFINITY)) secondsSaved += seconds;
  }
  return { available, secondsSaved };
}

/** The line that `agentbrew metrics` prints. */
export function gainLine(summary: GainSummary, days: number): string {
  const rates = `sync: ${SAVED_SECONDS.syncPerAgent} s per agent; repair: ${SAVED_SECONDS.repairPerItem} s per fixed item`;
  if (!summary.available) return `Estimated time saved: no data yet (${rates}).`;
  const s = summary.secondsSaved;
  const amount = s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
  return `Estimated time saved, last ${days} days: ${amount} (${rates})`;
}
