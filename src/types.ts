export type CommandTransform = (content: string) => string;
export type HooksFormat = "claude-settings" | "claude-direct" | "cursor";
export type HooksScope = "user" | "project";

/**
 * Skill-manifest features that may not be supported by every agent. Derived
 * from the compatibility matrix in the vercel-labs/skills README — see
 * `supportedSkillFeatures` on AgentConfig and the values in agents.yaml.
 *
 * - `allowed-tools`: agent honors the `allowed-tools` array in skill frontmatter
 *   (tool-access restrictions). Supported by most agents today.
 * - `context-fork`: agent runs the skill in a forked/isolated context
 *   (`context: fork` in frontmatter). Claude Code only.
 * - `hooks`: agent executes skill lifecycle hooks declared in frontmatter.
 *   Claude Code, Cline, and Kiro CLI today.
 *
 * Skills that declare a feature their target agent doesn't support are
 * skipped during sync so the user sees the skip (and can pick another agent)
 * rather than a silent runtime failure.
 */
export type SkillFeature = "allowed-tools" | "context-fork" | "hooks";

/** Default when `supportedSkillFeatures` is unset. `allowed-tools` is the
 *  baseline the vercel-labs/skills matrix uses for most agents, and agentbrew
 *  treats an unconfigured agent as "supports the baseline." Agents that lack
 *  even that support (e.g. Zencoder) must set `supportedSkillFeatures: []`
 *  explicitly in agents.yaml. */
export const DEFAULT_SUPPORTED_SKILL_FEATURES: readonly SkillFeature[] = ["allowed-tools"];

/** Where an agent's default-model setting lives. Declared per agent in
 *  agents.yaml; written by `src/sync/model-sync.ts` when the Agentfile
 *  sets `defaultModel`. */
export interface ModelConfig {
  /** Path to the agent's config file holding the default model (~-prefixed). */
  file: string;
  /** Dot-separated key path inside the file (e.g. "model", "agent.model"). */
  path: string;
  /** Config file format. Defaults to "json". */
  format?: "json" | "toml";
  /** Dot-separated key path for the default reasoning effort, when the agent
   *  stores it apart from the model id (e.g. Claude Code `effortLevel`). */
  effortPath?: string;
}

export interface McpPermissionsConfig {
  file: string;
}

export interface AgentConfig {
  name: string;
  detected: boolean;
  skillsDir: string;
  mcpConfig?: string;
  mcpKey?: string; // JSON key for servers object, defaults to "mcpServers"
  // config file format, defaults to "json". Core formats are statically
  // dispatched in adapters.ts; any other string is resolved at runtime from a
  // team-overlay adapter dir (see TeamConfig.adapterDirs) — e.g. "overlay-desktop"
  // ships in the agentbrew-acme overlay. The `(string & {})` keeps the core
  // literals for autocomplete while allowing overlay-provided formats.
  mcpFormat?: "json" | "yaml" | "toml" | "opencode" | (string & {});
  mcpPermissionsConfig?: McpPermissionsConfig;
  rulesFile?: string;
  /** Directory for per-file rules (e.g., ~/.cursor/rules/, ~/.windsurf/rules/). */
  rulesDir?: string;
  commandsDir?: string;
  agentsDir?: string;
  /** How agents are stored in agentsDir — "flat" writes name.md, "subdir" writes name/AGENT.md (Devin format). */
  agentsDirFormat?: "flat" | "subdir";
  commandTransform?: CommandTransform;
  commandFileExt?: string;
  /** Agent names whose skills/commands/agents dirs this agent already reads. Skip deploying to this agent's dirs to avoid duplicates. */
  readsFrom?: string[];
  /** Path to the agent's hooks config file (e.g., ~/.claude/settings.json). */
  hooksFile?: string;
  /** JSON key containing hooks object in hooksFile. Defaults to "hooks". */
  hooksKey?: string;
  hooksFormat?: HooksFormat;
  hooksScope?: HooksScope;
  /** Where the agent's default-model setting lives (see {@link ModelConfig}).
   *  Unset means the agent has no file-managed model surface (e.g. Cursor and
   *  Windsurf store the model in app-managed/UI state). */
  modelConfig?: ModelConfig;
  /** Skills-only agents with minimal real-world validation. */
  experimental?: boolean;
  /** Which skill-manifest features the agent supports (see {@link SkillFeature}).
   *  When undefined, treated as {@link DEFAULT_SUPPORTED_SKILL_FEATURES}. Empty
   *  array means the agent supports only "basic" skills (no allowed-tools,
   *  hooks, or context-fork). */
  supportedSkillFeatures?: SkillFeature[];
}

export interface SkillInfo {
  name: string;
  source: string;
  path: string;
}

export interface McpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Source of this MCP server. Can be a specific source type or "team:<label>" for team overlay sources. */
  source: string;
  url?: string;
  headers?: Record<string, string>;
  /** Git URL this server was installed from (for git-installed servers). */
  gitUrl?: string;
  /** Git ref (branch, tag, or commit) pinned at install time. */
  gitRef?: string;
  /** ISO timestamp when this server was first registered. */
  addedAt?: string;
  /** Set when the endpoint is durably unusable for reasons agentbrew cannot fix. */
  quarantine?: McpQuarantine;
}

/**
 * Marks an MCP server that must not be deployed to any agent.
 *
 * Some endpoints fail for reasons no local repair can address — a service that
 * authenticates the user but denies authorization, a decommissioned host, a
 * revoked entitlement. Left in place, one such endpoint reports a failed
 * connection in every agent on every launch, which buries the failures that
 * are actionable. Quarantine keeps the definition and its evidence in state
 * while removing it from the agent configs.
 */
export interface McpQuarantine {
  /** Why the endpoint is unusable, in one line. Shown by `agentbrew status`. */
  reason: string;
  /** ISO timestamp when the quarantine was recorded. */
  since: string;
  /** Team or contact who can lift the block. */
  owner?: string;
  /** Command or trace ID that reproduces the failure, for the owner to act on. */
  evidence?: string;
}

export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  url?: string;
  headers?: Record<string, string>;
}

/** Pluggable adapter for reading/writing MCP server configs in different file formats.
 *  Each format (JSON map, YAML extensions, TOML, desktop array) gets its own adapter. */
export interface McpFormatAdapter {
  /** Read deployed server entries keyed by name. */
  readEntries(configPath: string, mcpKey: string): Record<string, Record<string, unknown>>;

  /** Write the full entries record back to the config file. */
  writeEntries(configPath: string, entries: Record<string, Record<string, unknown>>, mcpKey: string): void;

  /** Convert an McpServer to the format-specific entry object. */
  toEntry(server: McpServer, agentName: string): Record<string, unknown>;

  /** Compare existing and desired entries — true if they match (no update needed). */
  entriesMatch(existing: Record<string, unknown>, desired: Record<string, unknown>): boolean;

  /** Apply a single update to entries: add replaces, update may merge. */
  applyUpdate(
    entries: Record<string, Record<string, unknown>>,
    serverName: string,
    entry: Record<string, unknown>,
  ): void;

  /** Whether an existing entry is eligible for pruning. */
  isPrunable(name: string, entry: Record<string, unknown>): boolean;

  /** Extract deployed servers as McpServer[] for discovery. */
  discoverServers(configPath: string, mcpKey: string): McpServer[];

  /** Remove a single server from the config file. Returns true if found. */
  removeServer(configPath: string, serverName: string, mcpKey: string): boolean;
}

export interface McpJsonConfig {
  mcpServers?: Record<string, McpServerEntry>;
  permissions?: { allow?: string[]; deny?: string[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface SyncOptions {
  quiet?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  prune?: boolean;
  discover?: boolean;
  /**
   * Compact mode silences per-module headers, per-target detail, and per-module
   * summaries — info/log/success calls become noops while warn/error continue
   * to surface. The sync runner emits a single consolidated summary line
   * instead. Used by `agentbrew sync` (default) to keep no-op output ≤5 lines
   * (compact-mode acceptance). `--verbose` disables compact
   * so users see today's full per-agent / per-skill detail. `quiet` takes
   * precedence when both are set.
   */
  compact?: boolean;
}

type SourceItemType = "skill" | "mcp" | "rule" | "command";

export interface SourceItem {
  name: string;
  description: string;
  type: SourceItemType;
}

export interface Source {
  url: string;
  type: "github" | "local" | "url";
  skillsInstalled: string[];
  availableItems: SourceItem[];
  addedAt: string;
  indexedAt?: string;
  commitSha?: string;
  bootstrapScript?: string;
  /**
   * Where this source was added from. `undefined` is treated as `"user"` by
   * all consumers for backwards compatibility — state.yaml files created
   * before this field existed have no `origin` and must continue to work.
   *
   * - `"user"` — added manually via `agentbrew install <source>`
   * - `"agentfile"` — declared in an Agentfile.yaml and applied via `agentbrew apply`
   * - `"catalog"` — auto-registered by the catalog (e.g. team overlay
   *   `repo_sources` on `agentbrew team set <overlay-url>`). Removed symmetrically on
   *   `agentbrew team unset` — user-added sources (`origin !== "catalog"`)
   *   survive the toggle.
   * - `"global"` — declared in the global Agentfile.yaml
   * - `"team:<label>"` — declared in a team overlay's Agentfile.yaml
   * - `"project"` — declared in a project's Agentfile.yaml
   */
  origin?: string;
}

export interface SkillSourceDir {
  label: string;
  path: string;
  format?: "standard" | "tasks-md";
  /** Where this source dir was added from — e.g. "agentfile", "user", or "team:<label>". */
  origin?: string;
}

/** A managed hook entry stored in state and synced to agent config files. */
export interface ManagedHook {
  event: string;
  matcher?: string;
  type: "command" | "prompt";
  command?: string;
  prompt?: string;
  timeout?: number;
  agents?: string[];
  /** Source of this hook. Can be "agentfile", "user", "catalog", or "team:<label>". */
  source: string;
}

/** Local semantic memory runtime configuration (never includes DB contents). */
export interface MemoryConfig {
  enabled?: boolean;
  /** Resolved absolute paths to discovered pack directories. */
  packPaths?: string[];
}

export interface TeamConfig {
  label: string;
  url: string;
  cachedAt: string;
  lastSyncedAt: string;
  detectedSignals?: string[];
  /**
   * Absolute path to the team's catalog overlay file (resolved from the
   * overlay Agentfile.yaml's `catalogOverlay:` field, relative to the
   * cached team-clone root). When set, `loadCatalog()` merges this YAML on
   * top of the generic `catalog.yaml`. Cleared on `team unset`.
   */
  catalogOverlayPath?: string;
  /**
   * Absolute paths to MCP-format adapter directories the overlay provides
   * (resolved from the overlay Agentfile.yaml's `adapters:` list). Each dir's
   * basename is the `mcpFormat` it serves and contains a CommonJS `adapter.js`
   * exporting an {@link McpFormatAdapter} class. `getAdapter()` loads these
   * lazily for any non-core format. Lets the overlay ship formats (e.g.
   * overlay-desktop) without baking them into core. Cleared on `team unset`.
   */
  adapterDirs?: string[];
  /**
   * Absolute path to the overlay's agents YAML (resolved from the overlay
   * Agentfile.yaml's `agents:` field). `loadAgentDefinitions()` merges these
   * entries on top of core `agents.yaml`, so the overlay can register custom
   * agents (e.g. overlay-desktop) without baking them into core. Cleared on
   * `team unset`.
   */
  agentsOverlayPath?: string;
  /** Absolute memory pack dirs from overlay memoryPacks: — cleared on team unset. */
  memoryPackPaths?: string[];
}

export interface AgentBrewState {
  schemaVersion?: number;
  agents: AgentConfig[];
  sources?: Source[];
  mcpServers?: McpServer[];
  /** MCP servers the user removed; the recommended installer must not add them back. */
  declinedMcpServers?: string[];
  skillSourceDirs?: SkillSourceDir[];
  agentSourceDirs?: Array<{ label: string; path: string; origin?: string }>;
  commandSourceDirs?: Array<{ label: string; path: string; origin?: string }>;
  hooks?: ManagedHook[];
  externalMcpServers?: string[];
  catalogVersion: string;
  /**
   * Team overlay configuration — when set, the overlay's Agentfile.yaml is
   * merged into the catalog and state with origin: "team:<label>". Only one
   * team can be active at a time. Managed via `agentbrew team set|unset`.
   */
  team?: TeamConfig;
  /** Shared memory runtime — local DB paths and pack discovery only. */
  memory?: MemoryConfig;
  /**
   * @deprecated team overlay flag — superseded by `state.team`.
   * When true, the team overlay catalog was merged and organization-recommended
   * skills/MCP servers were promoted. This field is preserved for state
   * migration and future reversal, but new code should use `state.team` instead.
   * The team command (`agentbrew team set`) is now the explicit entry point
   * for team-level configuration including team overlays.
   */
  organization?: boolean;
  /**
   * Slice 5 of `delegate-skill-install-to-skills-cli` (TASKS.md):
   * controls whether `agentbrew install <remote-source>` delegates to skills
   * CLI (`npx skills add`) for all detected intersection agents when the
   * source contains skills-CLI-shaped content (SKILL.md files or
   * `.claude-plugin/marketplace.json`). Three modes:
   *   - `"auto"` (default when undefined) — delegate-first for skill-shaped
   *     sources, native-only for non-skill sources.
   *   - `"delegate"` — same as `"auto"` for slices 4–6; slice 7 may broaden
   *     to non-skill sources too once `cloneAndIndexRemoteSource` (renamed
   *     from `tryGitCloneFirst` in `audit-trygitclonefirst-post-slice-5`) is
   *     restructured or deleted.
   *   - `"native"` — keep the historical native-only path; no skills CLI
   *     delegation. Useful for offline / proxy-blocked environments where
   *     `npx skills add` is unreliable.
   * Carve-out agents (`claude-desktop`, `overlay-desktop`) STAY on the native
   * installer regardless of this setting — skills CLI does not target them.
   * Slice 4 (PR #804) shipped this gate as a `claude-code` canary; slice 5
   * broadened to the full supported intersection.
   */
  skillInstallMode?: "auto" | "delegate" | "native";
  /**
   * Default model id deployed to every detected agent that declares a
   * `modelConfig` surface in agents.yaml (see `src/sync/model-sync.ts`).
   * Set from the Agentfile's `defaultModel:` key; absent means model sync
   * is off and agents keep whatever model they have.
   */
  defaultModel?: string;
  /**
   * Default reasoning effort written next to `defaultModel` for agents whose
   * `modelConfig` declares an `effortPath`. Set from the Agentfile's
   * `defaultEffort:` key.
   */
  defaultEffort?: string;
  /**
   * Per-agent exceptions to `defaultModel`, keyed by agent name. A string
   * replaces the model id for that agent (providers name the same model
   * differently); `null` skips the agent entirely (e.g. the model is not
   * available on that agent's provider/gateway yet).
   */
  modelOverrides?: Record<string, string | null>;
}

// AGENT_DEFINITIONS is now loaded from agents.yaml at runtime.
// Re-exported here for backward compatibility — all existing imports continue to work.
import { loadAgentDefinitions } from "./core/agents.js";
export const AGENT_DEFINITIONS: Omit<AgentConfig, "detected">[] = loadAgentDefinitions();

/** Vendor-neutral skills directory — shared by Warp and the vendor-neutral deploy target. */
export const VENDOR_NEUTRAL_SKILLS_DIR = "~/.agents/skills";
