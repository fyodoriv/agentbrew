import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { logSkipped } from "../core/logger.js";
import type { ProbeStatus } from "../mcp/probe.js";
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
 * add this object inline in `src/catalog.yaml`; no schema migration required for older
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
 */
export interface CatalogRepoSource {
  /** GitHub owner/repo on github.com. */
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

/**
 * A named group of existing catalog items (skills, MCP servers, rules, CLI
 * tools) that `agentbrew install <bundle>` installs together. A bundle holds
 * names only; each member keeps its own catalog entry and source.
 */
export interface CatalogBundle {
  name: string;
  description: string;
  members: string[];
}

export interface Catalog {
  skills: CatalogSkill[];
  mcp_servers: CatalogMcpServer[];
  rules: CatalogRule[];
  cli_tools?: CatalogCliTool[];
  bundles?: CatalogBundle[];
  /**
   * Optional list of whole-repo skill sources the catalog auto-registers
   * on applicable machines.
   */
  repo_sources?: CatalogRepoSource[];
  /**
   * Optional mcpm registry server names that fail on known machines and
   * have no agentbrew-managed equivalent. Sync removes their `mcpm_<name>`
   * wrappers and uninstalls them from mcpm, unless state defines the name.
   * Adds to `BROKEN_MCPM_REGISTRY_SERVERS`.
   */
  broken_mcpm_registry_servers?: string[];
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
 * Load the catalog: the repo-owned `src/catalog.yaml` (or `dist/catalog.yaml`
 * when agentbrew runs from a built package). Throws when it is missing or
 * unparseable. Team overlay catalogs were removed in agentbrew 1.0 (#208).
 */
export function loadCatalog(): Catalog {
  return loadBaseCatalog();
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
