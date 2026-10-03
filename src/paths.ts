/**
 * Central registry for well-known agentbrew config paths.
 * All paths use `~` as prefix — call `expandHome()` before file I/O.
 */

/** Canonical deployed instructions file (agents.md cross-tool standard). */
export const CANONICAL_INSTRUCTIONS_PATH = "~/.config/agentbrew/AGENTS.md";

/** Shared rules file deployed to all agents. */
export const SHARED_RULES_PATH = "~/.config/agentbrew/shared-rules.md";

/** Per-file rules directory (individual .md rule files). */
export const RULES_DIR = "~/.config/agentbrew/rules";

/** Shared commands directory. */
export const COMMANDS_DIR = "~/.config/agentbrew/commands";

/** Agent persona definitions directory. */
export const AGENTS_DIR = "~/.config/agentbrew/agents";

/** Skills installed from catalog sources. */
export const INSTALLED_SKILLS_DIR = "~/.config/agentbrew/installed-skills";

/** Config backup snapshots. */
export const BACKUPS_DIR = "~/.config/agentbrew/backups";

/** Sync error log for drift detection. */
export const SYNC_ERRORS_PATH = "~/.config/agentbrew/sync-errors.json";

/** Helper scripts the agent instructions call (deployed by src/sync/helper-scripts.ts). */
export const HELPER_SCRIPTS_DIR = "~/.config/agentbrew/scripts";

/** Shell hook script for cd-based project detection (bash/zsh). */
export const SHELL_HOOK_PATH = "~/.config/agentbrew/shell-hook.sh";

/** Shell hook script for fish shell. */
export const FISH_HOOK_PATH = "~/.config/agentbrew/shell-hook.fish";

/** Auto-repair log tracking what was fixed and when. */
export const REPAIR_LOG_PATH = "~/.config/agentbrew/repair-log.json";

/** MCP probe health snapshot written by the auto-repair cron path. */
export const MCP_HEALTH_PATH = "~/.cache/agentbrew/mcp-health.json";

/** Last-seen timestamps for freshness checks. */
export const LAST_SEEN_PATH = "~/.config/agentbrew/last-seen.json";

/** Context-budget measurement snapshots (agentbrew measure context). */
export const CONTEXT_BUDGET_METRICS_DIR = "~/.config/agentbrew/metrics";

/** Latest context-budget snapshot — read by agents at session start. */
export const CONTEXT_BUDGET_LATEST_PATH = "~/.config/agentbrew/metrics/latest.json";

/** Manual Cursor context-ring readings (no API — human/agent notes). */
export const CONTEXT_BUDGET_MANUAL_SNAPSHOTS_DIR = "~/.config/agentbrew/metrics/manual-snapshots";

/** State path for the installed-skills label used in skillSourceDirs. */
export const INSTALLED_SKILLS_LABEL = "installed-skills";
