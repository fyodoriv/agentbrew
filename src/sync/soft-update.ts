import chalk from "chalk";
import { getSourceCachePath } from "../catalog/index-source.js";
import { logSkipped } from "../core/logger.js";
import { loadState, saveState } from "../state.js";
import type { Source } from "../types.js";

/**
 * How old a catalog-origin source's `indexedAt` timestamp must be before
 * `agentbrew sync` triggers a background refetch. Matches the launchagent
 * auto-repair cadence (30 min) so a user who has the scheduler installed
 * doesn't trip a second refetch when they run `sync` manually between ticks.
 *
 * Within the TTL window `sync` does NOT hit the network for catalog-origin
 * sources — that's the "quiet on repeat runs" contract.
 */
export const CATALOG_SOURCE_CACHE_TTL_MS = 30 * 60 * 1000;

interface SoftUpdateResult {
  /** Catalog-origin sources successfully refreshed this call. */
  refreshed: string[];
  /** Catalog-origin sources whose `indexedAt` was within the TTL — skipped. */
  fresh: string[];
  /** Catalog-origin sources that tried to refetch but failed (offline, auth, etc.). */
  failed: string[];
}

function isStale(source: Source, nowMs: number): boolean {
  if (!source.indexedAt) return true;
  const indexedAtMs = Date.parse(source.indexedAt);
  if (Number.isNaN(indexedAtMs)) return true;
  return nowMs - indexedAtMs > CATALOG_SOURCE_CACHE_TTL_MS;
}

/**
 * Skill sources agentbrew owns and keeps fresh on plain `agentbrew sync`:
 * catalog overlay repos, team overlay repos (`team:<label>`), and the global
 * Agentfile (`origin: "global"`). User-, project-, and agentfile-added sources
 * refresh only on explicit `agentbrew sync --pull`.
 */
export function isAgentbrewProvidedSkillSource(source: Source): boolean {
  if (source.origin === "catalog" || source.origin === "global") return true;
  if (typeof source.origin === "string" && source.origin.startsWith("team:")) return true;
  return false;
}

/**
 * Refetch stale agentbrew-provided skill sources (catalog, team overlay, global
 * Agentfile). Uses the existing `getSourceCachePath` → `pullLatest` path so
 * offline/auth failures log a single warning and return gracefully — this never
 * crashes `agentbrew sync`.
 *
 * User-origin, project-origin, and agentfile-origin sources are NOT touched
 * here — they refresh on explicit `agentbrew sync --pull` only, preserving the
 * "I added this, I control the refresh cadence" contract.
 *
 * Only sources older than `CATALOG_SOURCE_CACHE_TTL_MS` are refetched.
 * The `options.now` seam is for tests — production callers should use the
 * default (real `Date.now()`).
 */
export function softUpdateStaleOverlaySources(options?: { now?: number }): SoftUpdateResult {
  const result: SoftUpdateResult = { refreshed: [], fresh: [], failed: [] };

  const state = loadState();
  if (!state?.sources || state.sources.length === 0) return result;

  const nowMs = options?.now ?? Date.now();
  const managedSources = state.sources.filter(isAgentbrewProvidedSkillSource);
  if (managedSources.length === 0) return result;

  let stateMutated = false;
  for (const source of managedSources) {
    if (!isStale(source, nowMs)) {
      result.fresh.push(source.url);
      continue;
    }

    try {
      // getSourceCachePath triggers pullLatest for github sources. pullLatest
      // already prints "⚠ Could not refresh <url> — using cached data" on
      // network/auth failure and returns without throwing, so one failure
      // does not abort the rest of the loop.
      const cachePath = getSourceCachePath(source);
      if (cachePath) {
        source.indexedAt = new Date(nowMs).toISOString();
        stateMutated = true;
        result.refreshed.push(source.url);
      } else {
        result.failed.push(source.url);
      }
    } catch (e) {
      logSkipped("sync/soft-update/getSourceCachePath", e);
      result.failed.push(source.url);
    }
  }

  if (stateMutated) saveState(state);
  return result;
}

/** Render a one-line summary of a soft-update pass for CLI output. */
export function formatSoftUpdateSummary(result: SoftUpdateResult): string | undefined {
  const total = result.refreshed.length + result.fresh.length + result.failed.length;
  if (total === 0) return undefined;
  if (result.refreshed.length === 0 && result.failed.length === 0) {
    // Everything fresh — no need to broadcast.
    return undefined;
  }
  const parts: string[] = [];
  if (result.refreshed.length > 0) parts.push(`${result.refreshed.length} refreshed`);
  if (result.fresh.length > 0) parts.push(`${result.fresh.length} cached`);
  if (result.failed.length > 0) parts.push(chalk.yellow(`${result.failed.length} offline`));
  return `Managed skill sources: ${parts.join(", ")}`;
}
