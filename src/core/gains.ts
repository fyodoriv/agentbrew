/**
 * Estimated time that agentbrew saves, against one baseline: a person who has
 * several AI coding agents and edits each agent's config by hand.
 *
 * The values are estimates, chosen low. Durations (`ms`) are measured; saved
 * time is not. docs/observability.md ("How much it helps") shows this table.
 * Change a value here and there together.
 */
import { NUMBER_MAX } from "./events.js";

export const SAVED_SECONDS = {
  /** One sync, per agent detected on this machine (the set a sync targets). Copying one config to one agent by hand takes longer. */
  syncPerAgent: 3,
  /** One repair, per drift item it fixed. Finding and fixing one broken config by hand takes longer. */
  repairPerItem: 60,
} as const;

const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** Gain fields of a `sync` event. A failed sync saves 0. */
export function syncGain(ok: boolean, agents: number): { agents: number; secondsSaved: number } {
  const n = count(agents);
  return { agents: n, secondsSaved: ok ? n * SAVED_SECONDS.syncPerAgent : 0 };
}

/** Gain field of a `repair` event. A failed repair (drift is left) saves 0. */
export function repairGain(ok: boolean, repaired: number): { secondsSaved: number } {
  return { secondsSaved: ok ? count(repaired) * SAVED_SECONDS.repairPerItem : 0 };
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
