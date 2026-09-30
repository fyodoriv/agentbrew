import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { loadCatalog } from "./catalog/types.js";
import { errorMessage } from "./core/errors.js";
import { fixDeprecatedMemoryServerArgs } from "./mcp/mcpm-hygiene.js";
import { MEMORY_MANAGED_SERVER_NAME, MEMORY_MANAGED_SOURCE } from "./memory/constants.js";
import { SHARED_RULES_PATH } from "./paths.js";
import { loadState, requireState } from "./state.js";
import type { AgentBrewState, McpServer, Source } from "./types.js";
import { expandHome } from "./utils.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** An MCP server entry in an Agentfile — either a catalog shorthand or full spec. */
type AgentfileMcpEntry =
  | string
  | {
      name: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
    };

/** A hook entry in an Agentfile. */
export interface AgentfileHookEntry {
  event: string;
  command?: string;
  matcher?: string;
  type?: "command" | "prompt";
  prompt?: string;
  timeout?: number;
}

/** Warning about an Agentfile entry that may indicate misconfiguration. */
interface AgentfileWarning {
  type: "unknown-server";
  message: string;
}

/** Raw parsed Agentfile structure. */
export interface Agentfile {
  mcp?: AgentfileMcpEntry[];
  skills?: string[];
  sources?: string[];
  commands?: string[];
  agents?: string[];
  rules?: string;
  hooks?: AgentfileHookEntry[];
  recommended?: boolean;
  /** Agent names to mark as `detected: false` even when their config dirs exist.
   *  Used to deliberately exclude agents the user / org no longer cares about,
   *  so every sync path that respects `detected` (rules, skills, commands, mcp,
   *  hooks, agents, instructions) skips them. Filesystem dirs are NOT deleted;
   *  the exclusion is purely a sync-time filter. */
  excludeAgents?: string[];
  /** Default model id to deploy to every detected agent that declares a
   *  `modelConfig` surface in agents.yaml (claude-code, devin, codex today).
   *  Absent means model sync is off. */
  defaultModel?: string;
  /** Per-agent exceptions to `defaultModel`, keyed by agent name. A string
   *  replaces the model id for that agent; `null` skips the agent (e.g. the
   *  model is not available on that agent's provider/gateway yet). */
  modelOverrides?: Record<string, string | null>;
  /** Task backend declaration — "tasks-md" (default) or "github-issues".
   *  When "github-issues", must also declare "repo" (owner/repo) and "project" (number).
   *  See docs/task-backend-contract.md for the full contract. */
  task_backend?: "tasks-md" | "github-issues";
  /** GitHub owner/repo for github-issues backend (required when task_backend is github-issues). */
  repo?: `${string}/${string}`;
  /** GitHub Project number for github-issues backend (required when task_backend is github-issues). */
  project?: number;
  /** Optional semantic memory runtime toggle from Agentfile. */
  memory?: { enabled?: boolean };
  /** Relative paths to memory pack directories (resolved at apply/team set). */
  memoryPacks?: string[];
}

// ── Agentfile names (checked in priority order) ───────────────────────────────

/** Agentfile names checked in priority order — .yaml first for tooling compatibility. */
export const AGENTFILE_NAMES = ["Agentfile.yaml", "Agentfile.yml", "Agentfile"];

// ── Parsing ───────────────────────────────────────────────────────────────────

/** Parse a single raw YAML entry into an AgentfileHookEntry, or undefined if invalid. */
function parseSingleHookEntry(entry: unknown): AgentfileHookEntry | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const obj = entry as Record<string, unknown>;
  if (typeof obj.event !== "string") return undefined;
  const hook: AgentfileHookEntry = { event: obj.event };
  if (typeof obj.command === "string") hook.command = obj.command;
  if (typeof obj.matcher === "string") hook.matcher = obj.matcher;
  if (obj.type === "command" || obj.type === "prompt") hook.type = obj.type;
  if (typeof obj.prompt === "string") hook.prompt = obj.prompt;
  if (typeof obj.timeout === "number") hook.timeout = obj.timeout;
  return hook;
}

/** Validate and parse raw YAML hook entries into typed AgentfileHookEntry[]. */
function parseAgentfileHooks(raw: unknown[]): AgentfileHookEntry[] {
  const hooks: AgentfileHookEntry[] = [];
  for (const entry of raw) {
    const parsed = parseSingleHookEntry(entry);
    if (parsed) hooks.push(parsed);
  }
  return hooks;
}

/** Find and load an Agentfile from a directory. Returns undefined if none found or malformed. */
export function loadAgentfile(directory: string): Agentfile | undefined {
  for (const name of AGENTFILE_NAMES) {
    const path = join(directory, name);
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        return parseAgentfile(content);
      } catch (error) {
        const reason = errorMessage(error);
        console.error(chalk.red(`\n✗ Failed to parse Agentfile: ${reason}`));
        console.error(chalk.dim(`  File: ${path}`));
        console.error(chalk.dim(`  Fix the YAML syntax and try again.\n`));
        return undefined;
      }
    }
  }
  return undefined;
}

function parseAgentfileMemoryFields(raw: Record<string, unknown>): Pick<Agentfile, "memory" | "memoryPacks"> {
  const memory =
    raw.memory && typeof raw.memory === "object" && raw.memory !== null
      ? { enabled: (raw.memory as Record<string, unknown>).enabled === true ? true : undefined }
      : undefined;
  const memoryPacks = Array.isArray(raw.memoryPacks)
    ? raw.memoryPacks.filter((x): x is string => typeof x === "string")
    : undefined;
  return { memory, memoryPacks };
}

/** Parse an Agentfile YAML string into a typed structure. */
export function parseAgentfile(content: string): Agentfile {
  const raw = yaml.load(content) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return {};

  return {
    mcp: Array.isArray(raw.mcp)
      ? (raw.mcp.filter(
          (entry: unknown) => typeof entry === "string" || (typeof entry === "object" && entry !== null),
        ) as AgentfileMcpEntry[])
      : undefined,
    skills: Array.isArray(raw.skills) ? raw.skills.map(String) : undefined,
    sources: Array.isArray(raw.sources) ? raw.sources.map(String) : undefined,
    commands: Array.isArray(raw.commands) ? raw.commands.map(String) : undefined,
    agents: Array.isArray(raw.agents) ? raw.agents.map(String) : undefined,
    rules: typeof raw.rules === "string" ? raw.rules : undefined,
    hooks: Array.isArray(raw.hooks) ? parseAgentfileHooks(raw.hooks) : undefined,
    recommended: raw.recommended === true ? true : undefined,
    excludeAgents: Array.isArray(raw.excludeAgents)
      ? raw.excludeAgents.filter((x): x is string => typeof x === "string")
      : undefined,
    defaultModel: typeof raw.defaultModel === "string" && raw.defaultModel.trim() ? raw.defaultModel.trim() : undefined,
    modelOverrides: parseModelOverrides(raw.modelOverrides),
    task_backend: parseTaskBackend(raw.task_backend),
    repo: parseRepo(raw.repo),
    project: parseProject(raw.project),
    ...parseAgentfileMemoryFields(raw),
  };
}

/** Keep string values (trimmed) and explicit nulls; drop everything else. */
function parseModelOverrides(value: unknown): Record<string, string | null> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const overrides: Record<string, string | null> = {};
  for (const [agent, model] of Object.entries(value)) {
    if (model === null) overrides[agent] = null;
    else if (typeof model === "string" && model.trim()) overrides[agent] = model.trim();
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function parseTaskBackend(value: unknown): "tasks-md" | "github-issues" | undefined {
  if (value === "tasks-md" || value === "github-issues") {
    return value;
  }
  return undefined;
}

function parseRepo(value: unknown): `${string}/${string}` | undefined {
  if (typeof value === "string" && /^[^/]+\/[^/]+$/.test(value)) {
    return value as `${string}/${string}`;
  }
  return undefined;
}

function parseProject(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return undefined;
}

/** Load an Agentfile from an explicit file path. Returns undefined if missing or malformed. */
export function loadAgentfileFromPath(filePath: string): Agentfile | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const content = readFileSync(filePath, "utf-8");
    return parseAgentfile(content);
  } catch (error) {
    const reason = errorMessage(error);
    console.error(chalk.red(`\n✗ Failed to parse Agentfile: ${reason}`));
    console.error(chalk.dim(`  File: ${filePath}`));
    console.error(chalk.dim(`  Fix the YAML syntax and try again.\n`));
    return undefined;
  }
}

function mcpEntryName(entry: AgentfileMcpEntry): string {
  return typeof entry === "string" ? entry : entry.name;
}

function mergeMcpEntries(current: AgentfileMcpEntry[] | undefined, incoming: AgentfileMcpEntry[] | undefined) {
  if (!incoming?.length) return current;
  const result = current ? [...current] : [];
  const indexByName = new Map(result.map((entry, index) => [mcpEntryName(entry), index]));

  for (const entry of incoming) {
    const name = mcpEntryName(entry);
    const existingIndex = indexByName.get(name);
    if (existingIndex === undefined) {
      indexByName.set(name, result.length);
      result.push(entry);
    } else {
      result[existingIndex] = entry;
    }
  }

  return result;
}

function mergeStringEntries(
  current: string[] | undefined,
  incoming: string[] | undefined,
  normalize: (value: string) => string = (value) => value,
) {
  if (!incoming?.length) return current;
  const result = current ? [...current] : [];
  const seen = new Set(result);

  for (const item of incoming) {
    const normalized = normalize(item);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function normalizeSourceEntry(value: string, baseDir: string): string {
  if (value.startsWith("./") || value.startsWith("../")) return join(baseDir, value);
  return value;
}

function normalizeSourceDirEntry(value: string, baseDir: string): string {
  const expanded = expandHome(value);
  if (isAbsolute(expanded)) return expanded;
  return join(baseDir, value);
}

function hookEntryKey(entry: AgentfileHookEntry): string {
  return `${entry.event}:${entry.matcher ?? "*"}`;
}

function mergeHookEntries(
  current: AgentfileHookEntry[] | undefined,
  incoming: AgentfileHookEntry[] | undefined,
): AgentfileHookEntry[] | undefined {
  if (!incoming?.length) return current;
  const result = current ? [...current] : [];
  const indexByKey = new Map(result.map((entry, index) => [hookEntryKey(entry), index]));

  for (const entry of incoming) {
    const key = hookEntryKey(entry);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, result.length);
      result.push(entry);
    } else {
      result[existingIndex] = entry;
    }
  }

  return result;
}

function resolveRulesForMerge(rules: string, baseDir: string): string {
  const rulesContent = rules.trim();
  const expanded = expandHome(rulesContent);
  const looksLikePath =
    rulesContent.startsWith("./") ||
    rulesContent.startsWith("../") ||
    rulesContent.startsWith("~/") ||
    (isAbsolute(expanded) && !rulesContent.includes("\n"));

  if (!looksLikePath) return rulesContent;

  const rulesFilePath = isAbsolute(expanded) ? expanded : join(baseDir, rulesContent);
  if (!existsSync(rulesFilePath)) return rulesContent;
  return readFileSync(rulesFilePath, "utf-8").trim();
}

function mergeRules(current: string | undefined, incoming: string | undefined, baseDir: string): string | undefined {
  if (!incoming) return current;
  const rulesContent = resolveRulesForMerge(incoming, baseDir);
  if (!rulesContent) return current;
  const existing = current?.trim();
  if (!existing) return rulesContent;
  if (existing.includes(rulesContent)) return existing;
  return `${existing}\n\n${rulesContent}`;
}

function readAgentfileForMerge(filePath: string): { agentfile: Agentfile; baseDir: string } {
  const absolutePath = resolve(expandHome(filePath));
  if (!existsSync(absolutePath)) throw new Error(`Agentfile not found: ${filePath}`);
  return {
    agentfile: parseAgentfile(readFileSync(absolutePath, "utf-8")),
    baseDir: dirname(absolutePath),
  };
}

function serializeAgentfileMemoryFields(agentfile: Agentfile, output: Record<string, unknown>): void {
  if (agentfile.memory?.enabled) output.memory = { enabled: true };
  if (agentfile.memoryPacks?.length) output.memoryPacks = agentfile.memoryPacks;
}

function serializableAgentfile(agentfile: Agentfile): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (agentfile.excludeAgents?.length) output.excludeAgents = agentfile.excludeAgents;
  if (agentfile.mcp?.length) output.mcp = agentfile.mcp;
  if (agentfile.skills?.length) output.skills = agentfile.skills;
  if (agentfile.sources?.length) output.sources = agentfile.sources;
  if (agentfile.commands?.length) output.commands = agentfile.commands;
  if (agentfile.agents?.length) output.agents = agentfile.agents;
  if (agentfile.hooks?.length) output.hooks = agentfile.hooks;
  if (agentfile.rules) output.rules = agentfile.rules;
  if (agentfile.recommended) output.recommended = true;
  if (agentfile.defaultModel) output.defaultModel = agentfile.defaultModel;
  if (agentfile.modelOverrides) output.modelOverrides = agentfile.modelOverrides;
  if (agentfile.task_backend) output.task_backend = agentfile.task_backend;
  if (agentfile.repo) output.repo = agentfile.repo;
  if (agentfile.project) output.project = agentfile.project;
  serializeAgentfileMemoryFields(agentfile, output);
  return output;
}

export function mergeAgentfiles(filePaths: string[]): string {
  const merged: Agentfile = {};

  for (const filePath of filePaths) {
    const { agentfile, baseDir } = readAgentfileForMerge(filePath);
    merged.mcp = mergeMcpEntries(merged.mcp, agentfile.mcp);
    merged.skills = mergeStringEntries(merged.skills, agentfile.skills);
    merged.sources = mergeStringEntries(merged.sources, agentfile.sources, (value) =>
      normalizeSourceEntry(value, baseDir),
    );
    merged.commands = mergeStringEntries(merged.commands, agentfile.commands, (value) =>
      normalizeSourceDirEntry(value, baseDir),
    );
    merged.agents = mergeStringEntries(merged.agents, agentfile.agents, (value) =>
      normalizeSourceDirEntry(value, baseDir),
    );
    merged.excludeAgents = mergeStringEntries(merged.excludeAgents, agentfile.excludeAgents);
    merged.hooks = mergeHookEntries(merged.hooks, agentfile.hooks);
    merged.rules = mergeRules(merged.rules, agentfile.rules, baseDir);
    if (agentfile.recommended) merged.recommended = true;
    if (agentfile.defaultModel) merged.defaultModel = agentfile.defaultModel;
    if (agentfile.modelOverrides) {
      merged.modelOverrides = { ...merged.modelOverrides, ...agentfile.modelOverrides };
    }
    if (agentfile.task_backend) merged.task_backend = agentfile.task_backend;
    if (agentfile.repo) merged.repo = agentfile.repo;
    if (agentfile.project) merged.project = agentfile.project;
    if (agentfile.memory?.enabled) merged.memory = { enabled: true };
    merged.memoryPacks = mergeStringEntries(merged.memoryPacks, agentfile.memoryPacks, (value) =>
      normalizeSourceDirEntry(value, baseDir),
    );
  }

  return yaml.dump(serializableAgentfile(merged), {
    lineWidth: 120,
    quotingType: '"',
    forceQuotes: false,
    noRefs: true,
    sortKeys: false,
  });
}

export function writeMergedAgentfile(filePaths: string[], outputPath: string): string {
  const expandedOutputPath = expandHome(outputPath);
  mkdirSync(dirname(expandedOutputPath), { recursive: true });
  writeFileAtomicSync(expandedOutputPath, mergeAgentfiles(filePaths), "utf-8");
  return expandedOutputPath;
}

// ── Resolve catalog shorthands ────────────────────────────────────────────────

/** Resolve an MCP entry to a full McpServer definition. Catalog names are looked up. */
export function resolveMcpEntry(entry: AgentfileMcpEntry): McpServer | undefined {
  if (typeof entry === "string") {
    // Catalog shorthand — look up in catalog
    const catalog = loadCatalog();
    const match = catalog.mcp_servers.find((s) => s.name === entry);
    if (!match) return undefined;
    return {
      name: match.name,
      // Catalog entries are either stdio (command/args) OR http (url) —
      // never both. Default to empty strings/arrays when the catalog
      // entry only declares the http url, so the McpServer type stays
      // structurally sound; the `url` field below carries the transport.
      command: match.command ?? "",
      args: match.args ?? [],
      env: match.env ?? {},
      source: "agentfile",
      // Carry through `url` for HTTP-transport catalog entries (e.g. remote
      // proxied MCPs accessed over HTTP). Without this, the shorthand-style
      // Agentfile entry (`mcp: [<some HTTP MCP>]`) would lose the transport,
      // and state.yaml would record a server with empty command + no url —
      // unable to deploy to any agent.
      ...(match.url ? { url: match.url } : {}),
      ...(match.headers ? { headers: match.headers } : {}),
    };
  }

  // Full spec
  const args = entry.args ?? [];
  fixDeprecatedMemoryServerArgs(args);
  const server: McpServer = {
    name: entry.name,
    command: entry.command ?? "",
    args,
    env: entry.env ?? {},
    source: "agentfile",
    url: entry.url,
    headers: entry.headers,
  };
  return server;
}

/** Resolve all MCP entries from an Agentfile into server definitions. */
export function resolveAgentfileMcp(agentfile: Agentfile): McpServer[] {
  if (!agentfile.mcp) return [];
  const servers: McpServer[] = [];
  for (const entry of agentfile.mcp) {
    const resolved = resolveMcpEntry(entry);
    if (resolved) servers.push(resolved);
  }
  return servers;
}

/** Validate an Agentfile's MCP entries against the catalog. Returns warnings for misconfigurations. */
export function validateAgentfileMcp(agentfile: Agentfile): AgentfileWarning[] {
  if (!agentfile.mcp) return [];

  const catalog = loadCatalog();
  const catalogNames = new Set(catalog.mcp_servers.map((s) => s.name));
  const warnings: AgentfileWarning[] = [];

  for (const entry of agentfile.mcp) {
    if (typeof entry === "string" && !catalogNames.has(entry)) {
      warnings.push({
        type: "unknown-server",
        message: `unknown server '${entry}' — not in catalog`,
      });
    }
  }

  return warnings;
}

// ── Config getters (abstraction over state for eventual Agentfile migration) ──

/**
 * Get the current list of configured MCP servers.
 * Today reads from state.mcpServers. Will migrate to Agentfile as source of truth.
 */
export function getConfigServers(): McpServer[] {
  const state = loadState();
  return state?.mcpServers ?? [];
}

/**
 * Get the servers array from a loaded state object, initializing it if absent.
 * Returns a shallow copy — callers must mutate state.mcpServers directly and call saveState().
 */
export function getStateServers(state: AgentBrewState): McpServer[] {
  if (!state.mcpServers) state.mcpServers = [];
  return [...state.mcpServers];
}

/**
 * Get the sources array from a loaded state object, initializing it if absent.
 * Returns a shallow copy — callers must mutate state.sources directly and call saveState().
 */
export function getStateSources(state: AgentBrewState): Source[] {
  if (!state.sources) state.sources = [];
  return [...state.sources];
}

function serializeAgentfileMcpEntry(server: McpServer, catalogNames: ReadonlySet<string>): AgentfileMcpEntry {
  if (catalogNames.has(server.name)) return server.name;

  const entry: Exclude<AgentfileMcpEntry, string> = { name: server.name };
  if (server.command) entry.command = server.command;
  if (server.args.length > 0) entry.args = server.args;
  if (Object.keys(server.env).length > 0) entry.env = server.env;
  if (server.url) entry.url = server.url;
  if (server.headers && Object.keys(server.headers).length > 0) entry.headers = server.headers;
  return entry;
}

// ── Generate Agentfile from state ─────────────────────────────────────────────

/** Generate an Agentfile YAML string from the current agentbrew state. */
export function generateAgentfile(): string | undefined {
  const state = requireState();
  if (!state) return undefined;

  const catalog = loadCatalog();
  const agentfile: Record<string, unknown> = {};

  // Check if all recommended items are installed — emit shorthand if so
  const recommendedSkills = catalog.skills.filter((s) => s.recommended).map((s) => s.name);
  const recommendedMcp = catalog.mcp_servers.filter((s) => s.recommended).map((s) => s.name);
  const installedSkillNames = new Set(getStateSources(state).flatMap((s) => s.skillsInstalled));
  const servers = getStateServers(state);
  const installedMcpNames = new Set(servers.map((s) => s.name));
  const allRecommendedInstalled =
    recommendedSkills.every((s) => installedSkillNames.has(s)) && recommendedMcp.every((s) => installedMcpNames.has(s));

  if (allRecommendedInstalled) {
    agentfile.recommended = true;
  }

  // MCP servers
  if (servers.length > 0) {
    const catalogNames = new Set(catalog.mcp_servers.map((s) => s.name));
    const mcpEntries = servers
      .filter((server) => !(server.name === MEMORY_MANAGED_SERVER_NAME && server.source === MEMORY_MANAGED_SOURCE))
      .map((server) => serializeAgentfileMcpEntry(server, catalogNames));
    if (mcpEntries.length > 0) agentfile.mcp = mcpEntries;
  }

  if (state.memory?.enabled) {
    agentfile.memory = { enabled: true };
  }
  if (state.memory?.packPaths?.length) {
    agentfile.memoryPacks = [...state.memory.packPaths];
  }

  // Skills — include catalog skills that are installed
  const catalogSkillNames = new Set(catalog.skills.map((s) => s.name));
  const installedCatalogSkills = [...installedSkillNames].filter((s) => catalogSkillNames.has(s)).sort();
  if (installedCatalogSkills.length > 0) {
    agentfile.skills = installedCatalogSkills;
  }

  // Sources
  const stateSources = getStateSources(state);
  if (stateSources.length > 0) {
    agentfile.sources = stateSources.map((s) => s.url);
  }

  // Rules (only if shared rules file exists)
  const rulesPath = expandHome(SHARED_RULES_PATH);
  if (existsSync(rulesPath)) {
    const rulesContent = readFileSync(rulesPath, "utf-8").trim();
    if (rulesContent) agentfile.rules = rulesContent;
  }

  if (Object.keys(agentfile).length === 0) return undefined;

  const header =
    "# Agentfile — declarative agent configuration manifest\n# Commit this to git. Run `agentbrew sync` to deploy.\n\n";
  return header + yaml.dump(agentfile, { lineWidth: 120, quotingType: '"', forceQuotes: false });
}

// ── Re-exports from sub-modules (barrel) ──────────────────────────────────────

export type { ApplyAgentfileResult } from "./agentfile-apply.js";
export { applyAgentfile } from "./agentfile-apply.js";
export {
  addSkillToAgentfile,
  addSourceToAgentfile,
  addToAgentfile,
  ensureAgentfile,
  globalAgentfileDir,
  installSkillToProject,
  installToProject,
  removeFromAgentfile,
  removeFromProject,
  writeAgentfile,
} from "./agentfile-mutate.js";
