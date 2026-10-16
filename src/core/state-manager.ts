import { resolve } from "node:path";
import chalk from "chalk";
import { getSourceCacheDir, sourceCacheRoot } from "../catalog/index-source.js";
import { detectSourceType } from "../git-source-url.js";
import { fixDeprecatedMemoryServerArgs, migrateDeprecatedGithubServer } from "../mcp/mcpm-hygiene.js";
import type { AgentBrewState, AgentConfig, McpServer, Source } from "../types.js";
import { expandHome } from "../utils.js";

/**
 * Tracks the state.yaml schema version so future breaking changes can trigger
 * an automatic migration rather than silently misreading old state files.
 * Increment this constant whenever a field is renamed, removed, or retyped.
 */
export const CURRENT_SCHEMA_VERSION = 1;

export interface StateManager {
  load(): AgentBrewState | undefined;
  require(options?: { quiet?: boolean }): AgentBrewState | undefined;
  save(state: AgentBrewState): void;
  update(fn: (state: AgentBrewState) => void): void;
  invalidate(): void;
  agents(): AgentConfig[];
  sources(): Source[];
  mcpServers(): McpServer[];
}

export interface StateIO {
  read(): AgentBrewState | undefined;
  write(state: AgentBrewState): void;
}

/** Validate loaded state for common misconfigurations.
 * Returns an array of human-readable warning strings. Empty array = clean. */
export function validateState(state: AgentBrewState): string[] {
  const warnings: string[] = [];
  validateMcpServers(state.mcpServers ?? [], warnings);
  validateSkillSourceDirs(state.skillSourceDirs ?? [], warnings);
  validateCachedSkillSourceDirs(state.skillSourceDirs ?? [], state.sources ?? [], warnings);
  return warnings;
}

function validateMcpServers(servers: McpServer[], warnings: string[]): void {
  const seen = new Set<string>();

  for (const server of servers) {
    const label = server.name || "(unnamed)";

    if (!server.name) {
      warnings.push(`mcpServers: server at index ${servers.indexOf(server)} has an empty name`);
    }

    if (!server.command && !server.url) {
      warnings.push(`mcpServers[${label}]: empty command with no url — server has no transport`);
    }

    if (server.name && seen.has(server.name)) {
      warnings.push(`mcpServers: duplicate server name '${server.name}'`);
    }
    if (server.name) seen.add(server.name);

    validateEnvValues(label, server.env ?? {}, warnings);
  }
}

function validateEnvValues(serverLabel: string, env: Record<string, string>, warnings: string[]): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      warnings.push(`mcpServers[${serverLabel}]: env var '${key}' is ${typeof value}, expected string`);
    }
  }
}

function validateSkillSourceDirs(dirs: Array<{ label: string; path: string }>, warnings: string[]): void {
  for (const dir of dirs) {
    if (!dir.path) {
      warnings.push(`skillSourceDirs: entry '${dir.label || "(unlabeled)"}' has an empty path`);
    }
    if (!dir.label) {
      warnings.push(`skillSourceDirs: entry with path '${dir.path || "(empty)"}' has an empty label`);
    }
  }
}

function isWithin(path: string, root: string): boolean {
  const normalized = resolve(expandHome(path));
  const normalizedRoot = resolve(expandHome(root));
  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
}

/** `skillSourceDirs` has two meanings. Inside a tracked source's cache, only
 *  that source's `skillsInstalled` deploy. Anywhere else, every skill in the
 *  dir deploys (an explicit opt-in). A cache path that no tracked source owns
 *  (for example after the source was removed or the entry was hand-edited)
 *  silently falls into the second meaning, so warn about it. */
function validateCachedSkillSourceDirs(
  dirs: Array<{ label: string; path: string }>,
  sources: Source[],
  warnings: string[],
): void {
  const cacheRoot = sourceCacheRoot();
  const sourceRoots = sources.map((source) => (source.type === "local" ? source.url : getSourceCacheDir(source)));
  for (const dir of dirs) {
    if (!dir.path || !isWithin(dir.path, cacheRoot)) continue;
    if (sourceRoots.some((root) => isWithin(dir.path, root))) continue;
    warnings.push(
      `skillSourceDirs: entry '${dir.label}' points into the source cache, but no tracked source owns it, so sync deploys every skill in it. Run \`agentbrew install <source>\` to track it, or remove the entry.`,
    );
  }
}

export function migrateState(state: AgentBrewState): AgentBrewState {
  const version = state.schemaVersion ?? 0;

  if (version >= CURRENT_SCHEMA_VERSION) {
    normalizeSources(state);
    normalizeMcpServers(state);
    return state;
  }

  const migrated = { ...state };
  // v0 → v1: add schemaVersion field (no data changes needed)
  migrated.schemaVersion = CURRENT_SCHEMA_VERSION;
  normalizeSources(migrated);
  normalizeMcpServers(migrated);

  return migrated;
}

/** Ensures every source has valid arrays for skillsInstalled and availableItems.
 * YAML parses bare `skillsInstalled:` (no value) as null, which crashes downstream `.includes()` calls. */
function normalizeSources(state: AgentBrewState): void {
  for (const source of state.sources ?? []) {
    if (!Array.isArray(source.skillsInstalled)) {
      source.skillsInstalled = [];
    }
    if (!Array.isArray(source.availableItems)) {
      source.availableItems = [];
    }
    // Repair misclassified team/GHE sources stored as type: github with git@ or https URLs.
    const correctedType = detectSourceType(source.url);
    if (source.type === "github" && correctedType !== "github") {
      source.type = correctedType;
    }
  }
}

/** Ensures every MCP server has valid args array and env object.
 * YAML parses bare `args:` (no value) as null, which crashes downstream `.map()` and `Object.entries()` calls. */
function normalizeMcpServers(state: AgentBrewState): void {
  for (const server of state.mcpServers ?? []) {
    if (!Array.isArray(server.args)) {
      server.args = [];
    }
    if (!server.env || typeof server.env !== "object") {
      server.env = {};
    }
    fixDeprecatedMemoryServerArgs(server.args);
    migrateDeprecatedGithubServer(server);
  }
}

export function createStateManager(io: StateIO): StateManager {
  let cached: AgentBrewState | undefined;
  let loaded = false;

  function ensureLoaded(): AgentBrewState | undefined {
    if (!loaded) {
      const raw = io.read();
      cached = raw ? migrateState(raw) : undefined;
      if (cached) {
        const warnings = validateState(cached);
        for (const w of warnings) {
          console.error(chalk.yellow(`  ⚠ state.yaml: ${w}`));
        }
      }
      loaded = true;
    }
    return cached;
  }

  return {
    load() {
      return ensureLoaded();
    },

    require(options) {
      const state = ensureLoaded();
      if (!state && !options?.quiet) {
        console.log(chalk.yellow("agentbrew not initialized. Run `agentbrew init` first."));
      }
      return state;
    },

    save(state: AgentBrewState) {
      state.schemaVersion = CURRENT_SCHEMA_VERSION;
      io.write(state);
      cached = state;
      loaded = true;
    },

    update(fn: (state: AgentBrewState) => void) {
      const state = ensureLoaded();
      if (!state) return;
      fn(state);
      state.schemaVersion = CURRENT_SCHEMA_VERSION;
      io.write(state);
      cached = state;
    },

    invalidate() {
      cached = undefined;
      loaded = false;
    },

    agents() {
      return ensureLoaded()?.agents ?? [];
    },

    sources() {
      return ensureLoaded()?.sources ?? [];
    },

    mcpServers() {
      return ensureLoaded()?.mcpServers ?? [];
    },
  };
}

export function createInMemoryStateManager(
  initial?: AgentBrewState,
): StateManager & { current: AgentBrewState | undefined } {
  const io: StateIO = {
    read() {
      return manager.current;
    },
    write(state: AgentBrewState) {
      manager.current = state;
    },
  };

  const inner = createStateManager(io);

  const manager = {
    current: initial,
    load() {
      // Reset cache so it re-reads from `current`
      inner.invalidate();
      return inner.load();
    },
    require(options?: { quiet?: boolean }) {
      inner.invalidate();
      return inner.require({ quiet: true, ...options });
    },
    save(state: AgentBrewState) {
      inner.save(state);
      manager.current = state;
    },
    update(fn: (state: AgentBrewState) => void) {
      inner.invalidate();
      inner.update(fn);
      manager.current = inner.load();
    },
    invalidate() {
      inner.invalidate();
    },
    agents() {
      inner.invalidate();
      return inner.agents();
    },
    sources() {
      inner.invalidate();
      return inner.sources();
    },
    mcpServers() {
      inner.invalidate();
      return inner.mcpServers();
    },
  };

  return manager;
}

let singleton: StateManager | undefined;

export function getStateManager(): StateManager {
  if (!singleton) {
    throw new Error("StateManager not initialized. Call initStateManager() first.");
  }
  return singleton;
}

export function initStateManager(io: StateIO): StateManager {
  singleton = createStateManager(io);
  return singleton;
}

export function replaceStateManager(manager: StateManager | undefined): StateManager | undefined {
  const previous = singleton;
  singleton = manager;
  return previous;
}

export function resetStateManager(): void {
  singleton = undefined;
}
