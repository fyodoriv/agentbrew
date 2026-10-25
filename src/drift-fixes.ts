import type { DriftItem } from "./drift-checks/types.js";

/**
 * The fix for every drift type, printed after each drift item by `agentbrew
 * status` (docs/observability.md "Health check"). The Record type makes the
 * fix required: a new DriftItem type without a fix here fails `tsc`.
 */
export const DRIFT_FIXES: Readonly<Record<DriftItem["type"], string>> = {
  agents: "agentbrew sync --only agents",
  "claude-desktop-mcp": "follow the fix named in the item, then restart Claude Desktop",
  "claude-plugin": "run `agentbrew install <name>` to restore the pinned checkout and enable the plugin",
  "cli-build": "npm run build in the agentbrew checkout",
  "env-hygiene": "eval $(agentbrew env sanitize)",
  "organization-overlay": "agentbrew team set <overlay-url>, or agentbrew team unset",
  mcp: "agentbrew sync --only mcp",
  "mcp-bare-placeholder": "agentbrew sync --only mcp",
  "mcp-catalog-pin": "agentbrew sync --only mcp",
  "mcp-env-vars": "agentbrew setup",
  "mcp-playwright-isolated": "agentbrew sync --only mcp",
  "mcp-stale": "agentbrew mcp probe --deep",
  "mcp-permissions": "agentbrew sync --only mcp",
  "mcp-user-added": "optional: agentbrew import",
  models: "agentbrew sync --only models",
  rules: "agentbrew sync --only rules",
  "rules-source": "agentbrew rules dedupe && agentbrew sync",
  skills: "agentbrew sync --only skills",
  "skills-user-added": "optional: agentbrew import",
  "statusline-user-added": "optional: agentbrew import",
  "skill-validity": "fix the SKILL.md frontmatter, then agentbrew skills validate",
  commands: "agentbrew sync --only commands",
  "commands-user-added": "optional: agentbrew import",
  hooks: "agentbrew sync --only hooks",
  instructions: "agentbrew sync --only instructions",
  launchagent: "agentbrew status --fix",
  // Not auto-fixable: the repair job rewrites only the check plist's Node.
  "memory-launchagent": "agentbrew memory fix",
};

/**
 * Drift types that `fix()` (`agentbrew status --fix`, the repair job)
 * actually addresses by running sync pipelines. Used to filter out everything
 * else (skill-validity, env hygiene, user-added items, organization-overlay
 * mismatches) before computing what was "repaired" — otherwise we'd falsely
 * claim credit for user-created skills that fix() never touched. See
 * `user-additions-not-drift` in git log.
 */
export const AUTO_FIXABLE_TYPES: ReadonlySet<DriftItem["type"]> = new Set([
  "mcp",
  "mcp-bare-placeholder",
  "mcp-catalog-pin",
  "mcp-playwright-isolated",
  "mcp-permissions",
  "rules-source",
  "rules",
  "skills",
  "commands",
  "hooks",
  "instructions",
  "agents",
  "launchagent",
  "models",
]);

/** True when a plain `agentbrew sync` repairs this drift type (the LaunchAgent needs `agentbrew status --fix`). */
export function syncRepairs(type: DriftItem["type"]): boolean {
  return AUTO_FIXABLE_TYPES.has(type) && DRIFT_FIXES[type].includes("agentbrew sync");
}

/** The fix command or step for one drift item. */
export function driftFix(item: Pick<DriftItem, "type">): string {
  return DRIFT_FIXES[item.type];
}
