import chalk from "chalk";
import { getStateSources } from "./agentfile.js";
import { indexSource } from "./catalog/index-source.js";
import { errorMessage } from "./core/errors.js";
import { detectSourceType } from "./git-source-url.js";
import { loadSources } from "./sources.js";
import { requireState, saveState } from "./state.js";
import type { Source } from "./types.js";
import { ICON_SUCCESS } from "./ui/output.js";

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function isCacheFresh(source: Source): boolean {
  if (!source.indexedAt) return false;
  const age = Date.now() - new Date(source.indexedAt).getTime();
  return age < CACHE_MAX_AGE_MS;
}

interface FetchResult {
  source: string;
  itemCount: number;
  newItems: number;
  skipped: boolean;
  error?: string;
}

/** Fetch a single source, index items, and return the result. */
function fetchSingleSource(source: Source): FetchResult {
  // "Fetching <url>" is logged inside cloneOrPull / indexSource only when an
  // actual network call is made; no per-call log here so we don't double-print.
  try {
    const previousNames = new Set((source.availableItems ?? []).map((i) => i.name));
    const items = indexSource(source);
    source.availableItems = items;
    source.indexedAt = new Date().toISOString();

    const newCount = items.filter((i) => !previousNames.has(i.name)).length;

    if (items.length > 0) {
      const newLabel = newCount > 0 ? chalk.green(` (+${newCount} new)`) : "";
      console.log(`  ${ICON_SUCCESS} ${source.url} — ${items.length} items${newLabel}`);
    } else {
      console.log(`  ${chalk.dim("○")} ${source.url} — no items found`);
    }

    return { source: source.url, itemCount: items.length, newItems: newCount, skipped: false };
  } catch (error) {
    const message = errorMessage(error);
    console.log(chalk.yellow(`  ⚠ ${source.url} — ${message}`));
    return { source: source.url, itemCount: 0, newItems: 0, skipped: false, error: message };
  }
}

/** Print fetch summary. */
function printFetchSummary(results: FetchResult[]): void {
  const totalNew = results.reduce((sum, r) => sum + r.newItems, 0);
  const fetched = results.filter((r) => !r.skipped && !r.error).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => r.error).length;
  const totalItems = results.reduce((sum, r) => sum + r.itemCount, 0);

  console.log(
    `\n${ICON_SUCCESS} Fetched ${fetched} source(s), ${totalItems} items available${totalNew > 0 ? `, ${totalNew} new since last fetch` : ""}${skipped > 0 ? chalk.dim(` (${skipped} cached)`) : ""}${failed > 0 ? chalk.yellow(` (${failed} failed)`) : ""}`,
  );
}

export async function fetchSources(options?: { force?: boolean }): Promise<FetchResult[]> {
  const state = requireState();
  if (!state) return [];

  const force = options?.force ?? false;
  const registrySources = loadSources();

  if (!state.sources) state.sources = [];
  for (const reg of registrySources) {
    const existing = getStateSources(state).find((s) => s.url === reg.name);
    if (!existing) {
      state.sources.push({
        url: reg.name,
        type: detectSourceType(reg.name),
        skillsInstalled: [],
        availableItems: [],
        addedAt: new Date().toISOString(),
      });
    }
  }

  const results: FetchResult[] = [];

  for (const source of getStateSources(state)) {
    if (!force && isCacheFresh(source)) {
      results.push({ source: source.url, itemCount: source.availableItems?.length ?? 0, newItems: 0, skipped: true });
      console.log(chalk.dim(`  ○ ${source.url} — cached (skip)`));
      continue;
    }
    results.push(fetchSingleSource(source));
  }

  saveState(state);
  printFetchSummary(results);

  return results;
}

export { isCacheFresh };
