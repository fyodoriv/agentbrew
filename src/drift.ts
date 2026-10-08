import { checkAgentDefsDrift } from "./drift-checks/agents.js";
import { checkCommandsDrift, checkUserCreatedCommands } from "./drift-checks/commands.js";
import { checkEnvHygieneDrift } from "./drift-checks/env.js";
import { checkHooksDrift } from "./drift-checks/hooks.js";
import { checkInstructionsDrift } from "./drift-checks/instructions.js";
import { checkLaunchAgentPathDrift } from "./drift-checks/launchagent-path.js";
import {
  checkBarePlaceholdersDrift,
  checkCatalogPinDrift,
  checkMcpDrift,
  checkMcpEnvVarsDrift,
  checkMcpPermissionDrift,
  checkPlaywrightIsolatedDrift,
  checkUserAddedMcpServers,
} from "./drift-checks/mcp.js";
import { checkRulesDrift } from "./drift-checks/rules.js";
import {
  checkBrokenSymlinks,
  checkSkillsDrift,
  checkSkillsValidity,
  checkUserCreatedSkills,
} from "./drift-checks/skills.js";
import type { DriftItem } from "./drift-checks/types.js";

// Re-export types and all check functions so existing `from "./drift.js"` imports keep working.
export type { DriftItem };
export {
  checkAgentDefsDrift,
  checkBarePlaceholdersDrift,
  checkBrokenSymlinks,
  checkCatalogPinDrift,
  checkCommandsDrift,
  checkEnvHygieneDrift,
  checkHooksDrift,
  checkInstructionsDrift,
  checkLaunchAgentPathDrift,
  checkMcpDrift,
  checkMcpEnvVarsDrift,
  checkMcpPermissionDrift,
  checkPlaywrightIsolatedDrift,
  checkRulesDrift,
  checkSkillsDrift,
  checkSkillsValidity,
  checkUserAddedMcpServers,
  checkUserCreatedCommands,
  checkUserCreatedSkills,
};

/**
 * Map internal drift `type` identifiers to user-facing labels in the
 * `formatDriftSummary` parenthesized breakdown. Only types whose internal
 * name conflicts with another user-visible quantity get a friendlier label;
 * all other types pass through unchanged so existing tests / dashboards
 * stay stable.
 *
 * `rules` → `agent-rules-files`: the install-time message uses
 * `"already in shared-rules.md"` to refer to source-of-truth rule snippets
 * (5 rules in shared-rules.md), while drift items here are stale
 * managed-sections in agent-side rule files (CLAUDE.md, .cursor/rules/, …).
 * Showing both as "rules" caused the user-reported "5 already present vs
 * 6 out of date" contradiction in `status-numbers-self-consistent`.
 */
const DRIFT_SUMMARY_LABELS: Record<string, string> = {
  rules: "agent-rules-files",
  "rules-source": "shared-rules",
};

/** Group drift items by type and return a parenthesized breakdown string like "(N mcp, M skills, …)". */
export function formatDriftSummary(items: DriftItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([type, count]) => `${count} ${DRIFT_SUMMARY_LABELS[type] ?? type}`);
  return parts.length > 0 ? `(${parts.join(", ")})` : "";
}

/** Collect all drift items without side effects (for API consumption). */
export function collectDrift(): DriftItem[] {
  return [
    ...checkMcpDrift(),
    ...checkMcpEnvVarsDrift(),
    ...checkBarePlaceholdersDrift(),
    ...checkCatalogPinDrift(),
    ...checkPlaywrightIsolatedDrift(),
    ...checkEnvHygieneDrift(),
    ...checkMcpPermissionDrift(),
    ...checkRulesDrift(),
    ...checkSkillsDrift(),
    ...checkBrokenSymlinks(),
    ...checkSkillsValidity(),
    ...checkCommandsDrift(),
    ...checkHooksDrift(),
    ...checkLaunchAgentPathDrift(),
    ...checkInstructionsDrift(),
    ...checkUserAddedMcpServers(),
    ...checkUserCreatedSkills(),
    ...checkUserCreatedCommands(),
    ...checkAgentDefsDrift(),
  ];
}
