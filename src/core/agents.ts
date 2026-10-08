import { createRequire } from "node:module";
import { join } from "node:path";
import yaml from "js-yaml";
import { loadState } from "../state.js";
import type {
  AgentConfig,
  HooksFormat,
  HooksScope,
  McpPermissionsConfig,
  ModelConfig,
  SkillFeature,
} from "../types.js";
import { vscodeExtConfigPath, vscodeSettingsPath } from "../utils.js";
import { errorMessage } from "./errors.js";
import { resolveTransform } from "./transforms.js";

// Use createRequire to get fs that isn't affected by vi.mock("node:fs")
const nativeRequire = createRequire(import.meta.url);
const { readFileSync } = nativeRequire("fs") as typeof import("fs");

interface AgentYamlEntry {
  name: string;
  skillsDir: string;
  mcpConfig?: string;
  mcpKey?: string;
  mcpFormat?: "json" | "yaml" | "toml" | "opencode" | (string & {});
  mcpPermissionsConfig?: McpPermissionsConfig;
  mcpConfigVscodeExt?: { extensionId: string; filename: string };
  mcpConfigVscodeSettings?: boolean;
  rulesFile?: string;
  rulesDir?: string;
  commandsDir?: string;
  agentsDir?: string;
  agentsDirFormat?: "flat" | "subdir";
  commandTransform?: string;
  commandFileExt?: string;
  hooksFile?: string;
  hooksKey?: string;
  hooksFormat?: HooksFormat;
  hooksScope?: HooksScope;
  modelConfig?: ModelConfig;
  readsFrom?: string[];
  experimental?: boolean;
  supportedSkillFeatures?: SkillFeature[];
}

let cached: Omit<AgentConfig, "detected">[] | undefined;

/**
 * Path-prefix substitutions driven by environment variables. Each entry
 * matches a `~/<prefix>/...` path in agents.yaml and replaces the prefix
 * with the env var's absolute value when set.
 *
 * Sourced from the 2026-04-26 [`docs/audits/harness-locate-cross-check.md`
 * § "Env-var overrides agentbrew doesn't honor"](../../docs/audits/harness-locate-cross-check.md)
 * audit. Both env vars are documented standards from upstream tools:
 *   - `CLAUDE_CONFIG_DIR` — Claude Code's documented config-directory
 *     override (used by CI environments and users with non-standard
 *     home layouts).
 *   - `XDG_CONFIG_HOME` — XDG Base Directory standard. Copilot CLI honors
 *     `$XDG_CONFIG_HOME/copilot/...` before falling back to `~/.copilot/`.
 *
 * Relative env-var values are ignored (fall back to the original `~/...`)
 * because path-resolution downstream (e.g. `expandHome`) assumes absolute
 * results — silently producing a CWD-relative path would be a worse bug
 * than ignoring the override.
 */
const ENV_VAR_PATH_OVERRIDES: ReadonlyArray<{
  /** Path prefix to match (without trailing slash). */
  match: string;
  /** Env var holding the override base. */
  envVar: string;
  /** Suffix to append to the env var's value (e.g. `/copilot` for `XDG_CONFIG_HOME`). */
  suffix?: string;
}> = [
  { match: "~/.claude", envVar: "CLAUDE_CONFIG_DIR" },
  { match: "~/.copilot", envVar: "XDG_CONFIG_HOME", suffix: "/copilot" },
];

/**
 * Resolve a single agent-path string from agents.yaml against the env-var
 * override table. Returns the path unchanged when no override applies, the
 * env var is unset, or the env var value is not absolute.
 *
 * The function is pure-string (no fs / os calls) so it composes safely
 * with the downstream `expandHome` step — this layer chooses WHICH `~`
 * to expand; `expandHome` does the actual expansion.
 *
 * @example
 *   // CLAUDE_CONFIG_DIR=/tmp/myclaude
 *   resolveAgentYamlPath("~/.claude/skills") === "/tmp/myclaude/skills"
 *   // XDG_CONFIG_HOME=/tmp/xdg
 *   resolveAgentYamlPath("~/.copilot/skills") === "/tmp/xdg/copilot/skills"
 *   // CLAUDE_CONFIG_DIR unset
 *   resolveAgentYamlPath("~/.claude/skills") === "~/.claude/skills"
 *   // CLAUDE_CONFIG_DIR=relative/path (not absolute)
 *   resolveAgentYamlPath("~/.claude/skills") === "~/.claude/skills"
 */
export function resolveAgentYamlPath(path: string): string {
  for (const override of ENV_VAR_PATH_OVERRIDES) {
    if (path !== override.match && !path.startsWith(`${override.match}/`)) continue;
    const value = process.env[override.envVar];
    if (!value?.startsWith("/")) return path;
    const base = override.suffix ? `${value}${override.suffix}` : value;
    return path === override.match ? base : `${base}${path.slice(override.match.length)}`;
  }
  return path;
}

/** Apply the env-var override table to an optional path field. */
function maybeResolve(path: string | undefined): string | undefined {
  return path === undefined ? undefined : resolveAgentYamlPath(path);
}

/** Resolve the MCP config file path for a given agent YAML entry. */
function resolveMcpConfigPath(entry: AgentYamlEntry): string | undefined {
  if (entry.mcpConfigVscodeExt) {
    return vscodeExtConfigPath(entry.mcpConfigVscodeExt.extensionId, entry.mcpConfigVscodeExt.filename);
  }
  if (entry.mcpConfigVscodeSettings) {
    return vscodeSettingsPath();
  }
  return maybeResolve(entry.mcpConfig);
}

function applyMcpPermissionsConfig(config: Omit<AgentConfig, "detected">, entry: AgentYamlEntry): void {
  if (!entry.mcpPermissionsConfig) return;
  config.mcpPermissionsConfig = {
    ...entry.mcpPermissionsConfig,
    file: resolveAgentYamlPath(entry.mcpPermissionsConfig.file),
  };
}

/** Copy optional fields from a YAML entry onto the agent config object. */
function applyOptionalFields(config: Omit<AgentConfig, "detected">, entry: AgentYamlEntry): void {
  if (entry.mcpKey) config.mcpKey = entry.mcpKey;
  if (entry.mcpFormat) config.mcpFormat = entry.mcpFormat;
  applyMcpPermissionsConfig(config, entry);
  if (entry.rulesFile) config.rulesFile = resolveAgentYamlPath(entry.rulesFile);
  if (entry.rulesDir) config.rulesDir = resolveAgentYamlPath(entry.rulesDir);
  if (entry.commandsDir) config.commandsDir = resolveAgentYamlPath(entry.commandsDir);
  if (entry.agentsDir) config.agentsDir = resolveAgentYamlPath(entry.agentsDir);
  if (entry.agentsDirFormat) config.agentsDirFormat = entry.agentsDirFormat;
  if (entry.commandTransform) {
    config.commandTransform = resolveTransform(entry.commandTransform);
  }
  if (entry.commandFileExt) config.commandFileExt = entry.commandFileExt;
  if (entry.hooksFile) config.hooksFile = resolveAgentYamlPath(entry.hooksFile);
  if (entry.hooksKey) config.hooksKey = entry.hooksKey;
  applyHookOptionalFields(config, entry);
  if (entry.modelConfig) {
    config.modelConfig = { ...entry.modelConfig, file: resolveAgentYamlPath(entry.modelConfig.file) };
  }
  if (entry.readsFrom) config.readsFrom = entry.readsFrom;
  if (entry.experimental) config.experimental = true;
  // Preserve explicit empty arrays (e.g. Kiro / Zencoder opt out of
  // `allowed-tools`) — only skip when the field was omitted entirely.
  if (entry.supportedSkillFeatures !== undefined) {
    config.supportedSkillFeatures = entry.supportedSkillFeatures;
  }
}

function applyHookOptionalFields(config: Omit<AgentConfig, "detected">, entry: AgentYamlEntry): void {
  if (entry.hooksFormat) config.hooksFormat = entry.hooksFormat;
  if (entry.hooksScope) config.hooksScope = entry.hooksScope;
}

/** Convert a single YAML entry into an AgentConfig (without the `detected` field). */
function mapYamlEntryToConfig(entry: AgentYamlEntry): Omit<AgentConfig, "detected"> {
  const config: Omit<AgentConfig, "detected"> = {
    name: entry.name,
    skillsDir: resolveAgentYamlPath(entry.skillsDir),
  };

  const mcpConfig = resolveMcpConfigPath(entry);
  if (mcpConfig) config.mcpConfig = mcpConfig;

  applyOptionalFields(config, entry);

  return config;
}

export function loadAgentDefinitions(): Omit<AgentConfig, "detected">[] {
  if (cached) return cached;

  const thisDir = import.meta.dirname;
  const yamlPath = join(thisDir, "agents.yaml");
  const content = readFileSync(yamlPath, "utf-8");
  let entries: AgentYamlEntry[];
  try {
    entries = yaml.load(content) as AgentYamlEntry[];
  } catch (error) {
    throw new Error(`Failed to parse agents.yaml: ${errorMessage(error)}`);
  }

  // Merge agents the active team overlay registers (deduped — core wins on a
  // name collision), so an overlay can ship custom agents (e.g. overlay-desktop)
  // without baking them into core agents.yaml.
  const coreNames = new Set(entries.map((e) => e.name));
  const overlayEntries = loadOverlayAgentEntries().filter((e) => !coreNames.has(e.name));

  cached = [...entries, ...overlayEntries].map(mapYamlEntryToConfig);

  return cached;
}

/**
 * Load agent entries from the active team overlay's agents YAML
 * (`state.team.agentsOverlayPath`), if set. Loud-but-non-fatal on errors — a
 * broken overlay must not crash core agent loading.
 */
function loadOverlayAgentEntries(): AgentYamlEntry[] {
  try {
    const overlayPath = loadState()?.team?.agentsOverlayPath;
    if (!overlayPath) return [];
    const parsed = yaml.load(readFileSync(overlayPath, "utf-8")) as AgentYamlEntry[] | null;
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Failed to load overlay agents: ${errorMessage(error)}`);
    return [];
  }
}

/** Reset cache — for testing only */
export function resetAgentDefinitionsCache(): void {
  cached = undefined;
}

/**
 * Filter out agents whose dirs are already readable by another detected agent
 * via `readsFrom`. This prevents deploying duplicate symlinks when (e.g.) one agent
 * reads from several other agents' dirs.
 */
export function filterReadsFromAgents<T extends { name: string; readsFrom?: string[] }>(
  agents: T[],
  detectedNames: Set<string>,
): T[] {
  return agents.filter((agent) => {
    if (!agent.readsFrom?.length) return true;
    // Skip only if ALL readsFrom agents are detected (their dirs will have content)
    return !agent.readsFrom.every((name) => detectedNames.has(name));
  });
}
