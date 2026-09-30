import { readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";
import { logSkipped } from "./core/logger.js";
import { loadState } from "./state.js";
import type { Source } from "./types.js";

type SourceProvides = "skills" | "mcp" | "rules";

interface CatalogSource {
  name: string;
  description: string;
  provides: SourceProvides[];
  category: string;
  recommended: boolean;
}

export function loadSources(): CatalogSource[] {
  const candidates = [
    join(import.meta.dirname, "sources.yaml"),
    join(import.meta.dirname, "..", "src", "sources.yaml"),
  ];

  for (const path of candidates) {
    try {
      const content = readFileSync(path, "utf-8");
      const all = yaml.load(content) as CatalogSource[];
      return all;
    } catch (e) {
      logSkipped("sources/load", e);
      // Path not found or YAML parse error — try next candidate
    }
  }

  return [];
}

function matchesSearch(text: string, search: string): boolean {
  const lower = search.toLowerCase();
  return text.toLowerCase().includes(lower);
}

interface SourcesData {
  registry: CatalogSource[];
  personal: Array<{ url: string; type: string; skills: string[]; commitSha?: string; addedAt: string }>;
}

function collectSourcesData(options?: { search?: string }): SourcesData {
  const sources = loadSources();
  const state = loadState();
  const search = options?.search;
  const personalSources = state?.sources ?? [];
  const registryNames = new Set(sources.map((s) => s.name));

  const registry = search
    ? sources.filter((s) => matchesSearch(`${s.name} ${s.description} ${s.category}`, search))
    : sources;

  const uniquePersonal = personalSources.filter((s) => !registryNames.has(s.url));
  const personal = (
    search ? uniquePersonal.filter((s) => matchesSearch(`${s.url} ${s.type}`, search)) : uniquePersonal
  ).map((s) => ({
    url: s.url,
    type: s.type,
    skills: s.skillsInstalled,
    commitSha: s.commitSha,
    addedAt: s.addedAt,
  }));

  return { registry, personal };
}

function printRegistrySource(source: CatalogSource, addedSourceUrls: Set<string>): void {
  const rec = source.recommended ? chalk.green(" ★") : "";
  const added = addedSourceUrls.has(source.name) ? chalk.green(" ✓") : "";
  const provides = chalk.dim(` [${source.provides.join(", ")}]`);
  console.log(`    ${chalk.cyan(source.name)}${rec}${added}${provides}`);
  console.log(chalk.dim(`      ${source.description}`));
}

function printRegistryCategory(
  sources: CatalogSource[],
  category: string,
  search: string | undefined,
  addedSourceUrls: Set<string>,
): void {
  const filtered = sources.filter((s) => {
    if (search && !matchesSearch(`${s.name} ${s.description} ${s.category}`, search)) return false;
    return s.category === category;
  });
  if (filtered.length === 0) return;
  console.log(chalk.dim(`  ${category}`));
  for (const source of filtered) {
    printRegistrySource(source, addedSourceUrls);
  }
}

function printRegistrySources(
  sources: CatalogSource[],
  search: string | undefined,
  addedSourceUrls: Set<string>,
): void {
  if (sources.length === 0) return;
  console.log(chalk.bold("\nRegistry Sources\n"));
  const categories = [...new Set(sources.map((s) => s.category))];
  for (const category of categories) {
    printRegistryCategory(sources, category, search, addedSourceUrls);
  }
}

function printPersonalSource(source: Source): void {
  const skills = source.skillsInstalled.length > 0 ? chalk.dim(` (${source.skillsInstalled.join(", ")})`) : "";
  const version = source.commitSha ? chalk.dim(` @${source.commitSha.slice(0, 8)}`) : "";
  const originTag = formatOriginTag(source.origin);
  console.log(`  ${chalk.cyan(source.url)} [${source.type}]${originTag}${skills}${version}`);
  console.log(chalk.dim(`    Added: ${source.addedAt}`));
}

/** Render a colored tag distinguishing user-added from overlay/Agentfile sources.
 *  `[overlay]` flags catalog auto-registrations (`agentbrew team set <overlay-url>`) so users
 *  know which sources will disappear on `team unset` and which survive. */
function formatOriginTag(origin: Source["origin"]): string {
  if (origin === "catalog") return chalk.magenta(" [overlay]");
  if (origin === "agentfile") return chalk.blue(" [agentfile]");
  return "";
}

function printPersonalSources(personalSources: Source[], registryNames: Set<string>, search: string | undefined): void {
  const uniquePersonal = personalSources.filter((s) => !registryNames.has(s.url));
  const filtered = search ? uniquePersonal.filter((s) => matchesSearch(`${s.url} ${s.type}`, search)) : uniquePersonal;
  if (filtered.length === 0) return;
  console.log(chalk.bold("\nPersonal Sources\n"));
  for (const source of filtered) {
    printPersonalSource(source);
  }
}

export function showSources(options?: { search?: string; showFooter?: boolean; json?: boolean }): void {
  if (options?.json) {
    const data = collectSourcesData({ search: options.search });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const sources = loadSources();
  const state = loadState();
  const search = options?.search;
  const personalSources = state?.sources ?? [];

  const registryNames = new Set(sources.map((s) => s.name));
  const addedSourceUrls = new Set(personalSources.map((s) => s.url));
  const uniquePersonal = personalSources.filter((s) => !registryNames.has(s.url));

  printRegistrySources(sources, search, addedSourceUrls);
  printPersonalSources(personalSources, registryNames, search);

  if (sources.length === 0 && uniquePersonal.length === 0) {
    console.log(chalk.yellow("\nNo sources found.\n"));
    console.log(chalk.dim("  Add one: agentbrew install <repo>"));
    return;
  }

  if (options?.showFooter !== false) {
    console.log(chalk.dim("\n  ★ = recommended  ✓ = added"));
    console.log(chalk.dim(`  ${sources.length} registry, ${uniquePersonal.length} personal`));
    console.log(chalk.dim("  Add source: agentbrew install <repo>"));
    console.log();
  }
}
