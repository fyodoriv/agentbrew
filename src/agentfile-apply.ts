import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { detectSourceType } from "./add-source.js";
import type { Agentfile, AgentfileHookEntry } from "./agentfile.js";
import {
  getStateServers,
  getStateSources,
  loadAgentfile,
  loadAgentfileFromPath,
  resolveAgentfileMcp,
  validateAgentfileMcp,
} from "./agentfile.js";
import { loadCatalog } from "./catalog/types.js";
import { MEMORY_MANAGED_SERVER_NAME } from "./memory/constants.js";
import { ensureMemoryMcpServer, mergeMemoryPackPaths } from "./memory/enable.js";
import { resolveMemoryPackPaths } from "./memory/pack-paths.js";
import { SHARED_RULES_PATH } from "./paths.js";
import { stripRulesDuplicatingExisting } from "./rules-hygiene.js";
import { loadState, saveState } from "./state.js";
import { indexOfMarkerAtLineStart } from "./sync/marker-utils.js";
import type { AgentBrewState, ManagedHook, McpServer } from "./types.js";
import { ICON_SUCCESS } from "./ui/output.js";
import { expandHome } from "./utils.js";

/** Result of applying an Agentfile to state. */
export interface ApplyAgentfileResult {
  serversAdded: string[];
  serversUpdated: string[];
  serversRemoved: string[];
  sourcesAdded: string[];
  commandDirsAdded: string[];
  agentDirsAdded: string[];
  skillsToInstall: string[];
  rulesUpdated: boolean;
  hooksUpdated: boolean;
  recommendedRequested: boolean;
  /** Agent names whose `detected` flag was flipped to false in state by the
   *  Agentfile's `excludeAgents:` list. */
  excludedAgents: string[];
  /** True when the Agentfile's `defaultModel`/`defaultEffort`/`modelOverrides` changed state. */
  defaultModelUpdated: boolean;
}

interface ApplyAgentfileOptions {
  quiet?: boolean;
  authoritative?: boolean;
  includeSkillInstallReport?: boolean;
  dryRun?: boolean;
  stateOverride?: AgentBrewState;
}

function cloneStateForDryRun(state: AgentBrewState): AgentBrewState {
  return JSON.parse(JSON.stringify(state)) as AgentBrewState;
}

function reportAgentfileInstallRequests(
  skillsToInstall: string[],
  recommendedRequested: boolean,
  quiet: boolean,
  includeSkillInstallReport: boolean,
  dryRun: boolean,
): void {
  if (quiet || !includeSkillInstallReport) return;
  if (skillsToInstall.length > 0) {
    if (dryRun) {
      console.log(
        chalk.dim(
          `  ~ Agentfile preview — would install ${skillsToInstall.length} skill(s): ${skillsToInstall.join(", ")}`,
        ),
      );
    } else {
      // Name the skills explicitly so users can cross-reference the count against
      // the list. Previously we only printed the count, which was easy to confuse
      // with the separate "Installing recommended items: Skills: ..." list that
      // `installRecommended` prints immediately afterwards when
      // `recommendedRequested` is also true. See `status-numbers-self-consistent`.
      console.log(
        `  ${ICON_SUCCESS} ${skillsToInstall.length} skill(s) from Agentfile to install: ${skillsToInstall.join(", ")}`,
      );
    }
  }
  if (recommendedRequested) {
    const message = dryRun
      ? "Agentfile preview — would install recommended set"
      : "Recommended set requested by Agentfile";
    console.log(dryRun ? chalk.dim(`  ~ ${message}`) : `  ${ICON_SUCCESS} ${message}`);
  }
}

/** Check if two MCP server definitions differ in command, args, or env. */
function serverConfigChanged(existing: McpServer, incoming: McpServer): boolean {
  if (existing.command !== incoming.command) return true;
  if (existing.url !== incoming.url) return true;
  if (JSON.stringify(existing.args) !== JSON.stringify(incoming.args)) return true;
  if (JSON.stringify(existing.env) !== JSON.stringify(incoming.env)) return true;
  if (JSON.stringify(existing.headers ?? {}) !== JSON.stringify(incoming.headers ?? {})) return true;
  return false;
}

/** Merge MCP servers from Agentfile into state. Returns names added/updated/removed. */
function mergeAgentfileMcp(
  agentfile: Agentfile,
  state: AgentBrewState,
  authoritative: boolean,
): { added: string[]; updated: string[]; removed: string[] } {
  const resolvedServers = resolveAgentfileMcp(agentfile);
  const stateServers = getStateServers(state);
  const existingByName = new Map(stateServers.map((s) => [s.name, s]));
  const added: string[] = [];
  const updated: string[] = [];

  for (const server of resolvedServers) {
    const existing = existingByName.get(server.name);
    if (!existing) {
      state.mcpServers?.push(server);
      added.push(server.name);
    } else if (serverConfigChanged(existing, server)) {
      existing.command = server.command;
      existing.args = server.args;
      existing.env = server.env;
      existing.url = server.url;
      existing.headers = server.headers;
      updated.push(server.name);
    }
  }

  let removed: string[] = [];
  if (authoritative) {
    const agentfileServerNames = new Set(resolvedServers.map((s) => s.name));
    const preservedNames = state.memory?.enabled === true ? new Set([MEMORY_MANAGED_SERVER_NAME]) : new Set<string>();
    const toRemove = stateServers.filter((s) => !agentfileServerNames.has(s.name) && !preservedNames.has(s.name));
    if (toRemove.length > 0) {
      state.mcpServers = stateServers.filter((s) => agentfileServerNames.has(s.name) || preservedNames.has(s.name));
      removed = toRemove.map((s) => s.name);
    }
  }

  return { added, updated, removed };
}

/** Merge sources from Agentfile into state. Returns URLs added. */
function mergeAgentfileSources(
  agentfile: { sources?: string[] },
  state: AgentBrewState,
  authoritative: boolean,
  baseDir: string,
): string[] {
  if (!agentfile.sources) return [];

  const sources = getStateSources(state);
  const existingUrls = new Set(sources.map((s) => s.url));
  const added: string[] = [];

  for (const sourceUrl of agentfile.sources) {
    const normalizedSourceUrl = normalizeAgentfileSourceUrl(sourceUrl, baseDir);
    if (!existingUrls.has(normalizedSourceUrl)) {
      state.sources?.push({
        url: normalizedSourceUrl,
        type: detectSourceType(normalizedSourceUrl),
        skillsInstalled: [],
        availableItems: [],
        addedAt: new Date().toISOString(),
        origin: "agentfile",
      });
      added.push(normalizedSourceUrl);
    }
  }

  if (authoritative) {
    const agentfileSourceUrls = new Set(
      agentfile.sources.map((sourceUrl) => normalizeAgentfileSourceUrl(sourceUrl, baseDir)),
    );
    // Preserve sources whose origin is "team:<label>" — they are owned by the
    // active team overlay (managed via `agentbrew team set|unset`), not by the
    // Agentfile being applied. Pruning them would silently drop the team's
    // team-skills, example-app, etc. on every `agentbrew sync` cycle. See
    // sync-wipes-team-origin-sources in TASKS.md for the failure mode.
    const isTeamOwned = (s: { origin?: string }): boolean =>
      typeof s.origin === "string" && s.origin.startsWith("team:");
    const toRemove = sources.filter((s) => !agentfileSourceUrls.has(s.url) && !isTeamOwned(s));
    if (toRemove.length > 0) {
      state.sources = sources.filter((s) => agentfileSourceUrls.has(s.url) || isTeamOwned(s));
    }
  }

  return added;
}

function normalizeAgentfileSourceUrl(sourceUrl: string, baseDir: string): string {
  if (sourceUrl.startsWith("./") || sourceUrl.startsWith("../")) {
    return join(baseDir, sourceUrl);
  }
  return sourceUrl;
}

/** Collect catalog skills from Agentfile that need installing. */
function collectAgentfileSkills(agentfile: { skills?: string[] }, quiet: boolean): string[] {
  if (!agentfile.skills) return [];

  const catalog = loadCatalog();
  const catalogSkillNames = new Set(catalog.skills.map((s) => s.name));
  const agentBrewDir = process.env.AGENTBREW_DIR ?? resolve(join(fileURLToPath(import.meta.url), "..", ".."));
  const builtinSkillRoot = join(agentBrewDir, "skill-plugins", "dev");
  const result: string[] = [];

  for (const skillName of agentfile.skills) {
    if (catalogSkillNames.has(skillName)) {
      result.push(skillName);
    } else if (existsSync(join(builtinSkillRoot, skillName, "SKILL.md"))) {
      result.push(skillName);
    } else if (!quiet) {
      console.warn(chalk.yellow(`  ⚠ Unknown skill in Agentfile: ${skillName}`));
    }
  }

  return result;
}

export function agentfileRulesSourceId(baseDir: string): string {
  const slug = basename(baseDir)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "agentfile";
}

const AGENTFILE_RULES_BLOCK_RE = /<!--\s*agentfile-rules:\s*\S+\s*-->[\s\S]*?<!--\s*\/agentfile-rules:\s*\S+\s*-->/g;

function findUnmanagedOccurrence(existing: string, needle: string): number {
  const managedRanges: Array<[number, number]> = [];
  for (const match of existing.matchAll(AGENTFILE_RULES_BLOCK_RE)) {
    managedRanges.push([match.index, match.index + match[0].length]);
  }
  let from = 0;
  while (from <= existing.length) {
    const idx = existing.indexOf(needle, from);
    if (idx === -1) return -1;
    const end = idx + needle.length;
    if (!managedRanges.some(([start, stop]) => idx < stop && end > start)) return idx;
    from = idx + 1;
  }
  return -1;
}

function insertAgentfileRulesBlock(existing: string, open: string, body: string, close: string): string {
  const block = `${open}\n${body}\n${close}\n`;
  const pullIdx = existing.indexOf("\n## Pull/fetch latest workflow");
  const catalogIdx = existing.indexOf("\n## Catalog rule markers");
  const insertAt = pullIdx !== -1 ? pullIdx : catalogIdx !== -1 ? catalogIdx : existing.trim() ? existing.length : 0;
  const before = existing.slice(0, insertAt).trimEnd();
  const after = existing.slice(insertAt);
  const spacer = before ? "\n\n" : "";
  return `${before}${spacer}${block}${after.startsWith("\n") ? after : `\n${after}`}`;
}

export function mergeRulesIntoSharedContent(
  existing: string,
  rulesContent: string,
  sourceId: string,
): { content: string; changed: boolean } {
  const open = `<!-- agentfile-rules: ${sourceId} -->`;
  const close = `<!-- /agentfile-rules: ${sourceId} -->`;
  const body = stripRulesDuplicatingExisting(existing, rulesContent, { excludeSourceId: sourceId });

  const openIdx = indexOfMarkerAtLineStart(existing, open);
  const closeIdx = indexOfMarkerAtLineStart(existing, close);
  if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
    const current = existing.slice(openIdx + open.length, closeIdx).trim();
    if (current === body) return { content: existing, changed: false };
    const before = existing.slice(0, openIdx);
    const after = existing.slice(closeIdx + close.length);
    return { content: `${before}${open}\n${body}\n${close}${after}`, changed: true };
  }

  const occurrence = findUnmanagedOccurrence(existing, body);
  if (occurrence !== -1) {
    const before = existing.slice(0, occurrence);
    const after = existing.slice(occurrence + body.length);
    return { content: `${before}${open}\n${body}\n${close}${after}`, changed: true };
  }

  return { content: insertAgentfileRulesBlock(existing, open, body, close), changed: true };
}

/** Merge rules from Agentfile into shared-rules.md. Returns true if updated. */
function mergeAgentfileRules(agentfile: { rules?: string }, baseDir: string, dryRun: boolean): boolean {
  if (!agentfile.rules) return false;

  let rulesContent = agentfile.rules.trim();

  const looksLikePath =
    rulesContent.startsWith("./") ||
    rulesContent.startsWith("../") ||
    rulesContent.startsWith("~/") ||
    (isAbsolute(rulesContent) && !rulesContent.includes("\n"));

  if (looksLikePath) {
    const expanded = expandHome(rulesContent);
    const rulesFilePath = isAbsolute(expanded) ? expanded : join(baseDir, rulesContent);
    if (existsSync(rulesFilePath)) {
      rulesContent = readFileSync(rulesFilePath, "utf-8").trim();
    } else {
      console.warn(chalk.yellow(`  ⚠ Rules file not found: ${rulesFilePath}`));
    }
  }

  const rulesPath = expandHome(SHARED_RULES_PATH);
  const existing = existsSync(rulesPath) ? readFileSync(rulesPath, "utf-8") : "";
  const { content, changed } = mergeRulesIntoSharedContent(existing, rulesContent, agentfileRulesSourceId(baseDir));
  if (!changed) return false;
  if (dryRun) return true;

  writeFileAtomicSync(rulesPath, content, "utf-8");
  return true;
}

/** Merge command source dirs from Agentfile into state. Returns paths added. */
function mergeAgentfileCommandDirs(
  agentfile: { commands?: string[] },
  state: AgentBrewState,
  baseDir: string,
): string[] {
  if (!agentfile.commands?.length) return [];

  const dirs = state.commandSourceDirs ?? [];
  const existingPaths = new Set(dirs.map((d) => d.path));
  const added: string[] = [];

  for (const relPath of agentfile.commands) {
    const absPath = isAbsolute(relPath) ? relPath : join(baseDir, relPath);
    if (!existingPaths.has(absPath)) {
      dirs.push({ label: basename(baseDir), path: absPath, origin: "agentfile" as const });
      added.push(absPath);
    }
  }

  if (added.length > 0) state.commandSourceDirs = dirs;
  return added;
}

/** Merge agent definition source dirs from Agentfile into state. Returns paths added. */
function mergeAgentfileAgentDirs(agentfile: { agents?: string[] }, state: AgentBrewState, baseDir: string): string[] {
  if (!agentfile.agents?.length) return [];

  const dirs = state.agentSourceDirs ?? [];
  const existingPaths = new Set(dirs.map((d) => d.path));
  const added: string[] = [];

  for (const relPath of agentfile.agents) {
    const absPath = isAbsolute(relPath) ? relPath : join(baseDir, relPath);
    if (!existingPaths.has(absPath)) {
      dirs.push({ label: basename(baseDir), path: absPath, origin: "agentfile" as const });
      added.push(absPath);
    }
  }

  if (added.length > 0) state.agentSourceDirs = dirs;
  return added;
}

/** Convert an AgentfileHookEntry into a ManagedHook for state storage. */
function toManagedHook(entry: AgentfileHookEntry): ManagedHook {
  return {
    event: entry.event,
    matcher: entry.matcher,
    type: entry.type ?? (entry.prompt ? "prompt" : "command"),
    command: entry.command,
    prompt: entry.prompt,
    timeout: entry.timeout,
    source: "agentfile",
  };
}

/** Merge hooks from Agentfile into state. Returns true if state changed. */
/** Flip `detected: false` on any state.agents entry whose name is in
 *  `agentfile.excludeAgents`. Returns the list of names actually flipped
 *  (i.e., previously detected and now excluded) so the caller can report it. */
function mergeAgentfileExcludeAgents(agentfile: { excludeAgents?: string[] }, state: AgentBrewState): string[] {
  if (!agentfile.excludeAgents?.length) return [];
  const excluded = new Set(agentfile.excludeAgents);
  const flipped: string[] = [];
  for (const agent of state.agents) {
    if (excluded.has(agent.name) && agent.detected) {
      agent.detected = false;
      flipped.push(agent.name);
    }
  }
  return flipped;
}

/** Merge `defaultModel`/`defaultEffort`/`modelOverrides` into state. Set-when-present only —
 *  an Agentfile without the keys never clears an existing default, so project
 *  Agentfiles can't accidentally drop the machine-wide model choice. */
function mergeAgentfileDefaultModel(
  agentfile: { defaultModel?: string; defaultEffort?: string; modelOverrides?: Record<string, string | null> },
  state: AgentBrewState,
): boolean {
  let changed = false;
  if (agentfile.defaultModel !== undefined && state.defaultModel !== agentfile.defaultModel) {
    state.defaultModel = agentfile.defaultModel;
    changed = true;
  }
  if (agentfile.defaultEffort !== undefined && state.defaultEffort !== agentfile.defaultEffort) {
    state.defaultEffort = agentfile.defaultEffort;
    changed = true;
  }
  if (
    agentfile.modelOverrides !== undefined &&
    JSON.stringify(state.modelOverrides ?? {}) !== JSON.stringify(agentfile.modelOverrides)
  ) {
    state.modelOverrides = agentfile.modelOverrides;
    changed = true;
  }
  return changed;
}

/** Merge optional memory runtime toggle and discovered pack paths into state. */
function mergeAgentfileMemory(
  agentfile: { memory?: { enabled?: boolean }; memoryPacks?: string[] },
  state: AgentBrewState,
  baseDir: string,
): boolean {
  let changed = false;
  if (agentfile.memory?.enabled === true) {
    const wasEnabled = state.memory?.enabled === true;
    state.memory = { ...state.memory, enabled: true };
    const registrationChanged = ensureMemoryMcpServer(state);
    if (!wasEnabled || registrationChanged) changed = true;
  }
  if (agentfile.memoryPacks?.length) {
    const paths = resolveMemoryPackPaths(baseDir, agentfile.memoryPacks);
    if (paths.length) {
      const before = new Set(state.memory?.packPaths ?? []);
      mergeMemoryPackPaths(state, paths);
      const after = new Set(state.memory?.packPaths ?? []);
      if (before.size !== after.size || paths.some((path) => !before.has(path))) {
        changed = true;
      }
    }
  }
  return changed;
}

function mergeAgentfileHooks(agentfile: { hooks?: AgentfileHookEntry[] }, state: AgentBrewState): boolean {
  if (!agentfile.hooks?.length) return false;

  const desired = agentfile.hooks.map(toManagedHook);
  const existing = state.hooks ?? [];

  // Build lookup keys for comparison (event + matcher)
  const hookKey = (h: ManagedHook): string => `${h.event}:${h.matcher ?? "*"}`;
  const existingKeys = new Set(existing.map(hookKey));
  const desiredKeys = new Set(desired.map(hookKey));

  // Check if anything changed
  const same =
    existing.length === desired.length &&
    desired.every((d) => existingKeys.has(hookKey(d))) &&
    existing.every((e) => desiredKeys.has(hookKey(e)));

  if (same) return false;

  state.hooks = desired;
  return true;
}

/** Log the summary of Agentfile application to console. */
function reportAgentfileResult(result: ApplyAgentfileResult, dryRun: boolean): void {
  const parts: string[] = [];
  if (result.serversAdded.length > 0) {
    parts.push(`${result.serversAdded.length} MCP server(s) added: ${result.serversAdded.join(", ")}`);
  }
  if (result.serversUpdated.length > 0) {
    parts.push(`${result.serversUpdated.length} MCP server(s) updated: ${result.serversUpdated.join(", ")}`);
  }
  if (result.serversRemoved.length > 0) {
    parts.push(`${result.serversRemoved.length} server(s) removed: ${result.serversRemoved.join(", ")}`);
  }
  if (result.sourcesAdded.length > 0) {
    parts.push(`${result.sourcesAdded.length} source(s): ${result.sourcesAdded.join(", ")}`);
  }
  if (result.commandDirsAdded.length > 0) {
    parts.push(`${result.commandDirsAdded.length} command dir(s)`);
  }
  if (result.agentDirsAdded.length > 0) {
    parts.push(`${result.agentDirsAdded.length} agent dir(s)`);
  }
  if (result.rulesUpdated) {
    parts.push("rules updated");
  }
  if (result.hooksUpdated) {
    parts.push("hooks updated");
  }
  if (result.excludedAgents.length > 0) {
    parts.push(`${result.excludedAgents.length} agent(s) excluded: ${result.excludedAgents.join(", ")}`);
  }
  if (result.defaultModelUpdated) {
    parts.push("default model updated");
  }
  if (parts.length === 0) return;
  if (dryRun) {
    console.log(chalk.dim(`  ~ Agentfile preview — ${parts.join(", ")}`));
  } else {
    console.log(`  ${ICON_SUCCESS} Agentfile applied — ${parts.join(", ")}`);
  }
}

function saveAndReportAgentfileResult(
  result: ApplyAgentfileResult,
  state: AgentBrewState,
  stateChanged: boolean,
  quiet: boolean,
  dryRun: boolean,
): void {
  if (!stateChanged) return;
  if (dryRun) {
    if (!quiet) reportAgentfileResult(result, true);
    return;
  }

  saveState(state);
  if (!quiet) reportAgentfileResult(result, false);
}

/** Load and validate Agentfile + state. Returns undefined if not ready. */
function loadAgentfileAndState(
  directoryOrPath: string,
  quiet: boolean,
  stateOverride?: AgentBrewState,
): { agentfile: Agentfile; state: AgentBrewState; baseDir: string } | undefined {
  const isFile = directoryOrPath.endsWith(".yaml") || directoryOrPath.endsWith(".yml");
  const agentfile = isFile ? loadAgentfileFromPath(directoryOrPath) : loadAgentfile(directoryOrPath);
  if (!agentfile) return undefined;

  const baseDir = isFile ? dirname(directoryOrPath) : directoryOrPath;
  const state = stateOverride ?? loadState();
  if (!state) {
    if (!quiet) {
      console.error(chalk.yellow("  ⚠ Agentfile found but agentbrew is not initialized."));
      console.log(chalk.dim("    Run `agentbrew init` first, then `agentbrew sync`.\n"));
    }
    return undefined;
  }

  return { agentfile, state, baseDir };
}

/** Print a one-time hint when a legacy `.agentbrew.yaml` is detected next to
 *  the Agentfile-bearing directory. The legacy format was removed when
 *  `delete-legacy-project-format` shipped — agentbrew no longer parses it,
 *  but users with old files in their repos deserve a pointer to the rename. */
function warnIfLegacyAgentbrewYamlPresent(directoryOrPath: string, quiet: boolean): void {
  if (quiet) return;
  const isFile = directoryOrPath.endsWith(".yaml") || directoryOrPath.endsWith(".yml");
  const dir = isFile ? dirname(directoryOrPath) : directoryOrPath;
  const legacyPath = join(dir, ".agentbrew.yaml");
  if (existsSync(legacyPath)) {
    console.warn(
      chalk.yellow(
        `  ⚠ Found legacy ${chalk.bold(".agentbrew.yaml")} — rename to Agentfile.yaml or merge it into your existing Agentfile.`,
      ),
    );
    console.warn(chalk.dim("    Legacy format is no longer parsed (see CHANGELOG.md)."));
  }
}

export function applyAgentfile(
  directoryOrPath: string,
  options?: ApplyAgentfileOptions,
): ApplyAgentfileResult | undefined {
  const quiet = options?.quiet ?? false;
  const authoritative = options?.authoritative ?? false;
  const includeSkillInstallReport = options?.includeSkillInstallReport ?? true;
  const dryRun = options?.dryRun ?? false;

  warnIfLegacyAgentbrewYamlPresent(directoryOrPath, quiet);

  const loaded = loadAgentfileAndState(directoryOrPath, quiet, options?.stateOverride);
  if (!loaded) return undefined;

  const { agentfile, baseDir } = loaded;
  const state = options?.stateOverride ?? (dryRun ? cloneStateForDryRun(loaded.state) : loaded.state);

  // Validate before applying — warn about misconfigurations early
  if (!quiet) {
    const validationWarnings = validateAgentfileMcp(agentfile);
    for (const w of validationWarnings) {
      console.warn(chalk.yellow(`  ⚠ ${w.message}`));
    }
  }

  const mcp = mergeAgentfileMcp(agentfile, state, authoritative);
  const sourcesAdded = mergeAgentfileSources(agentfile, state, authoritative, baseDir);
  const commandDirsAdded = mergeAgentfileCommandDirs(agentfile, state, baseDir);
  const agentDirsAdded = mergeAgentfileAgentDirs(agentfile, state, baseDir);
  const skillsToInstall = collectAgentfileSkills(agentfile, quiet);
  const rulesUpdated = mergeAgentfileRules(agentfile, baseDir, dryRun);
  const hooksUpdated = mergeAgentfileHooks(agentfile, state);
  const excludedAgents = mergeAgentfileExcludeAgents(agentfile, state);
  const defaultModelUpdated = mergeAgentfileDefaultModel(agentfile, state);
  const memoryUpdated = mergeAgentfileMemory(agentfile, state, baseDir);

  const result: ApplyAgentfileResult = {
    serversAdded: mcp.added,
    serversUpdated: mcp.updated,
    serversRemoved: mcp.removed,
    sourcesAdded,
    commandDirsAdded,
    agentDirsAdded,
    skillsToInstall,
    rulesUpdated,
    hooksUpdated,
    recommendedRequested: agentfile.recommended ?? false,
    excludedAgents,
    defaultModelUpdated,
  };

  const stateChanged =
    mcp.added.length > 0 ||
    mcp.updated.length > 0 ||
    mcp.removed.length > 0 ||
    sourcesAdded.length > 0 ||
    commandDirsAdded.length > 0 ||
    agentDirsAdded.length > 0 ||
    rulesUpdated ||
    hooksUpdated ||
    excludedAgents.length > 0 ||
    defaultModelUpdated ||
    memoryUpdated;

  saveAndReportAgentfileResult(result, state, stateChanged, quiet, dryRun);

  reportAgentfileInstallRequests(
    skillsToInstall,
    result.recommendedRequested,
    quiet,
    includeSkillInstallReport,
    dryRun,
  );

  return result;
}
