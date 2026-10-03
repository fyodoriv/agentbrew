import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { logSkipped } from "../core/logger.js";
import type { ProbeStatus } from "../mcp/probe.js";
import { loadState } from "../state.js";
import type { Source } from "../types.js";

/**
 * Sunset marker for a catalog entry the user should stop installing.
 *
 * Surfaced on `agentbrew install <name>` as a stderr warning naming the
 * deprecation date, the reason, and (when available) the replacement
 * id-or-URL so the user can switch in one step. Entries without this
 * field are treated as current and install silently.
 *
 * The field is OPTIONAL on every catalog interface that includes it —
 * deprecation is a sunset path, not a default. To deprecate an entry,
 * add this object inline in `src/catalog.yaml` (or any overlay's
 * `catalog-overlay.yaml`); no schema migration required for older
 * catalogs that lack the field.
 *
 * Surfaced 2026-05-25 ecosystem audit (subagent report § 14): without
 * this marker users continue installing dead tools because agentbrew
 * has no way to say "stop using this one — here's the replacement".
 */
export interface CatalogDeprecation {
  /** ISO date when the entry was marked deprecated. `since: "2026-05-26"`. */
  since: string;
  /** One-sentence rationale. Shown in the user-facing CLI warning. */
  reason: string;
  /**
   * Optional replacement pointer. Use a catalog id (e.g. `"context7"`) for
   * an in-catalog migration, or a URL for an out-of-catalog replacement
   * (e.g. `"https://github.com/upstream/new-mcp"`). Omitted when the entry
   * is being removed without a successor — the warning then just says
   * "no replacement available".
   */
  replacement?: string;
}

export interface CatalogSkill {
  name: string;
  description: string;
  source: string;
  category: string;
  recommended: boolean;
  rationale?: string;
  deprecated?: CatalogDeprecation;
}

export interface CatalogEnvVarSetup {
  description: string;
  link?: string;
  steps?: string[];
}

export interface CatalogMcpSmokeCall {
  tool: string;
  arguments?: Record<string, unknown>;
  expect?: "no_error" | "result_truthy";
}

export type CatalogMcpProbeRetryPolicy = "probe-every-tick-no-heal-until-catalog-change";

export interface CatalogMcpProbeSuppression {
  statuses?: ProbeStatus[];
  reason: string;
  retryPolicy: CatalogMcpProbeRetryPolicy;
}

export interface CatalogMcpServer {
  name: string;
  description: string;
  /**
   * Stdio-transport entrypoint. Required for command/stdio MCPs; omitted
   * for HTTP-transport remote MCPs (where `url` carries the transport
   * instead — e.g. Acme Portal MCP Remote routed through the codegen-managed
   * organization-remote-mcp-proxy on localhost:8098).
   */
  command?: string;
  args?: string[];
  /**
   * HTTP-transport URL. Required for HTTP/SSE MCPs (e.g. remote-proxied
   * organization MCPs); omitted for stdio MCPs (which use `command`/`args`).
   */
  url?: string;
  /** Optional HTTP headers (e.g. `Authorization: Bearer …`) for `url` transport. */
  headers?: Record<string, string>;
  env?: Record<string, string>;
  category: string;
  recommended: boolean;
  smokeCall?: CatalogMcpSmokeCall;
  probe?: "fast";
  probeSuppression?: CatalogMcpProbeSuppression;
  rationale?: string;
  note?: string;
  /**
   * Optional clickable URL shown at the top of the setup wizard for this
   * server. Use this when the setup flow depends on an external document
   * (approval process, token generation guide, onboarding runbook) that
   * doesn't fit neatly inside a single env var's `link:`. Rendered as a
   * blue underlined URL by `setupServerEnvVars` and `setupSingleServer`
   * so modern terminals can cmd+click to open.
   */
  setupLink?: string;
  setup?: Record<string, CatalogEnvVarSetup>;
  deprecated?: CatalogDeprecation;
}

export interface CatalogRule {
  name: string;
  description: string;
  category: string;
  recommended: boolean;
  rationale?: string;
  content: string;
  deprecated?: CatalogDeprecation;
}

export interface CatalogCliTool {
  name: string;
  description: string;
  category: string;
  recommended: boolean;
  rationale?: string;
  note?: string;
  commands: string[];
  env?: Record<string, string>;
  setup?: Record<string, CatalogEnvVarSetup>;
  deprecated?: CatalogDeprecation;
}

/**
 * A whole-repo skill source that the catalog wants auto-registered on
 * machines where the catalog applies. Unlike `CatalogSkill` (one entry per
 * skill), `CatalogRepoSource` points at an entire GitHub repo — every skill
 * inside is discovered at install time via the deep-scan layer in
 * `src/catalog/index-source.ts`.
 *
 * Used today by the team overlay to declare that every team member
 * should have `your-org/team-skills` (and any future approved
 * registries) registered as a source without having to run `agentbrew
 * install` themselves. Auto-registration runs on `agentbrew team set <overlay-url>`
 * and is removed symmetrically on `agentbrew team unset` so user-added
 * sources survive.
 */
export interface CatalogRepoSource {
  /** GitHub owner/repo — must be on github.com for public catalog, or an approved team org for the overlay. */
  source: string;
  /** Human-readable description surfaced by `agentbrew catalog --sources`. */
  description: string;
  /**
   * Whether `agentbrew sync` should refresh this source when its cache is
   * older than the sync TTL. Defaults to `true`. Set `false` to pin the
   * currently-cached SHA until a user runs `agentbrew sync --pull` explicitly.
   */
  auto_update?: boolean;
}

export interface Catalog {
  skills: CatalogSkill[];
  mcp_servers: CatalogMcpServer[];
  rules: CatalogRule[];
  cli_tools?: CatalogCliTool[];
  /**
   * Optional list of whole-repo skill sources the catalog auto-registers
   * on applicable machines. Merged across base + overlay via `mergeCatalog`
   * (dedup by `source`, overlay wins on conflict).
   */
  repo_sources?: CatalogRepoSource[];
  /**
   * Optional mcpm registry server names that fail on the team's machines and
   * have no agentbrew-managed equivalent. Sync removes their `mcpm_<name>`
   * wrappers and uninstalls them from mcpm, unless state defines the name.
   * Adds to `BROKEN_MCPM_REGISTRY_SERVERS`; base + overlay merge as a union.
   */
  broken_mcpm_registry_servers?: string[];
}

interface LoadCatalogOptions {
  /**
   * @deprecated Whether to merge the team overlay on top of the generic catalog.
   * The team overlay is now handled via `agentbrew team set` and the team
   * overlay's `catalogOverlay:` field in Agentfile.yaml. This option is kept
   * for backward compatibility with tests and diagnostics.
   */
  includeTeamOverlay?: boolean;
}

export interface LoadBaseCatalogOptions {
  /**
   * Read a specific catalog file instead of the package's repo-owned
   * `src/catalog.yaml` candidates. Static analyzers use this to pin the
   * catalog to the checkout they are inspecting.
   */
  path?: string;
}

/** Try each candidate path in order and return the first YAML file that parses. */
function loadYamlFromCandidates<T>(candidates: string[]): T | undefined {
  for (const path of candidates) {
    try {
      const content = readFileSync(path, "utf-8");
      return yaml.load(content) as T;
    } catch (e) {
      logSkipped("catalog/types/load", e);
      // Path not found or YAML parse error — try next candidate
    }
  }
  return undefined;
}

function catalogCandidates(filename: string): string[] {
  return [
    join(import.meta.dirname, "..", filename),
    join(import.meta.dirname, filename),
    join(import.meta.dirname, "..", "..", "src", filename),
  ];
}

/**
 * Merge a team overlay catalog into a base catalog. Entries with the same `name`
 * are replaced by the overlay (letting the overlay promote recommended
 * flags, rewrite descriptions for team context, etc.). Entries that only
 * exist in the overlay are appended.
 *
 * ## Why same-name override is a feature, not a bug
 *
 * The primary use case for team overlays is "promote this generic
 * skill to recommended for team members." Same-name override makes that a
 * one-entry change in the overlay's `catalog-overlay.yaml`. If we made it an error or
 * required explicit opt-in, every promotion would require a coordinated
 * multi-file edit.
 *
 * The safety tradeoff is managed by three properties:
 * 1. Overlay edits go through PR review on the overlay repo.
 * 2. The generic entry in `catalog.yaml` is never touched on disk — if
 *    the overlay file is deleted, the generic entry reappears verbatim.
 * 3. When no team is set, the overlay is not loaded at all, so
 *    users always see the unmodified generic catalog.
 *
 * ## How to promote a generic skill in a team overlay
 *
 * Add an entry to the overlay's `catalog-overlay.yaml` with the same `name` as the generic
 * entry. Set `recommended: true` and supply a `rationale`. Optionally
 * override `description`, `category`, or `source` for the team-context
 * version.
 */
function mergeByKey<T>(base: T[], overlay: T[], key: (item: T) => string): T[] {
  const overlayByKey = new Map(overlay.map((item) => [key(item), item]));
  const merged = base.map((item) => overlayByKey.get(key(item)) ?? item);
  const baseKeys = new Set(base.map(key));
  for (const item of overlay) {
    if (!baseKeys.has(key(item))) merged.push(item);
  }
  return merged;
}

function mergeByName<T extends { name: string }>(base: T[], overlay: T[]): T[] {
  return mergeByKey(base, overlay, (item) => item.name);
}

/** Merge an optional list, preserving undefined if neither side had entries. */
function mergeOptionalByKey<T>(
  base: T[] | undefined,
  overlay: T[] | undefined,
  key: (item: T) => string,
): T[] | undefined {
  const hasAny = (base?.length ?? 0) > 0 || (overlay?.length ?? 0) > 0;
  return hasAny ? mergeByKey(base ?? [], overlay ?? [], key) : undefined;
}

function mergeCatalog(base: Catalog, overlay: Catalog): Catalog {
  return {
    skills: mergeByName(base.skills ?? [], overlay.skills ?? []),
    mcp_servers: mergeByName(base.mcp_servers ?? [], overlay.mcp_servers ?? []),
    rules: mergeByName(base.rules ?? [], overlay.rules ?? []),
    cli_tools: mergeOptionalByKey(base.cli_tools, overlay.cli_tools, (item) => item.name),
    // repo_sources dedup by `source` (owner/repo) — they don't have `name`. Overlay
    // wins on conflict so the team overlay can tighten descriptions or change
    // auto_update semantics for a shared registry without requiring a base edit.
    repo_sources: mergeOptionalByKey(base.repo_sources, overlay.repo_sources, (item) => item.source),
    broken_mcpm_registry_servers: mergeOptionalByKey(
      base.broken_mcpm_registry_servers,
      overlay.broken_mcpm_registry_servers,
      (name) => name,
    ),
  };
}

/**
 * Load only the repo-owned catalog.
 *
 * This loader is deliberately independent of agentbrew state. Use it for
 * static analysis and repository gates that must not include a machine-local
 * team overlay.
 */
export function loadBaseCatalog(options: LoadBaseCatalogOptions = {}): Catalog {
  const candidates = options.path ? [options.path] : catalogCandidates("catalog.yaml");
  const base = loadYamlFromCandidates<Catalog>(candidates);
  if (!base) {
    const location = options.path ? ` at ${options.path}` : "";
    throw new Error(`catalog.yaml not found${location}`);
  }
  return base;
}

/**
 * Load the catalog, optionally layering a team overlay on top.
 *
 * ## Loading semantics
 *
 * 1. Always loads `src/catalog.yaml` (or `dist/catalog.yaml` at runtime
 *    when agentbrew ships from a built package). If this file is missing
 *    or unparseable, throws — the generic catalog is mandatory.
 * 2. If a team overlay should be included, loads the overlay's `catalog-overlay.yaml`
 *    from the team's Agentfile.yaml `catalogOverlay:` field and merges it on top via
 *    `mergeCatalog()`. If the overlay file is missing, silently returns the base.
 *
 * ## When the overlay is loaded
 *
 * - By default: whenever `state.team` is set (via `agentbrew team set`).
 * - Explicit opt-in/out: `options.includeTeamOverlay` is reserved for tests
 *   and diagnostics that need to override the default state-based behavior.
 *
 * ## Behaviour when an overlay source repo is unreachable
 *
 * `loadCatalog()` only reads YAML files — it does not touch source repos.
 * If the overlay references `source: some-org/private-repo` and the user
 * can't clone it, `loadCatalog()` still returns the merged catalog. The
 * failure surfaces later at install time: `installSkill()` attempts to
 * fetch the source, logs a classified git error, and reports "can't reach
 * this source" to the user. The overlay entry remains in the catalog so
 * `agentbrew catalog` still shows it.
 */
export function loadCatalog(_options: LoadCatalogOptions = {}): Catalog {
  const base = loadBaseCatalog();

  const state = _options.includeTeamOverlay === false ? undefined : loadState();
  let result = base;

  // Team-overlay catalog (story #27). When `state.team` is set, the
  // overlay's catalog merges on top of the generic catalog.yaml. The path
  // is resolved on `team set` and stored in `state.team.catalogOverlayPath`;
  // cleared on `team unset`. Stale path (cache deleted, etc.) is skipped
  // silently to avoid crashing the catalog loader.
  if (state?.team?.catalogOverlayPath) {
    try {
      const overlay = loadYamlFromCandidates<Catalog>([state.team.catalogOverlayPath]);
      if (overlay) result = mergeCatalog(result, overlay);
    } catch {
      // Stale path; skip silently.
    }
  }

  return result;
}

export interface DisplaySkill {
  name: string;
  description: string;
  source: string;
  category: string;
  recommended: boolean;
  installed: boolean;
  /**
   * Mirror of CatalogSkill.deprecated so per-skill listings can filter or
   * badge deprecated entries through the same `DisplaySkill` shape used
   * for both built-in and source-discovered skills. Source skills (from
   * `state.sources`) won't carry this field today — the catalog YAML is
   * the only authoring surface — but the optional field keeps both
   * shapes structurally compatible.
   */
  deprecated?: CatalogDeprecation;
}

export function getSourceSkills(sources: Source[]): DisplaySkill[] {
  const skills: DisplaySkill[] = [];
  for (const source of sources) {
    const available = source.availableItems ?? [];
    for (const item of available) {
      skills.push({
        name: item.name,
        description: item.description,
        source: source.url,
        category: "community",
        recommended: false,
        installed: source.skillsInstalled.includes(item.name),
      });
    }
  }
  return skills;
}

export function matchesSearch(text: string, search: string): boolean {
  const lower = search.toLowerCase();
  return text.toLowerCase().includes(lower);
}

export type OutputFormat = "text" | "json" | "markdown";

export interface CatalogData {
  skills: DisplaySkill[];
  mcpServers: CatalogMcpServer[];
  rules: CatalogRule[];
  cliTools: CatalogCliTool[];
}
