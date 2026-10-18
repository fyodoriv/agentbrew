import type { DriftItem } from "./drift-checks/types.js";

/**
 * The fix for every drift type, printed after each drift item by `agentbrew
 * status` (docs/observability.md "Health check"). The Record type makes the
 * fix required: a new DriftItem type without a fix here fails `tsc`.
 */
export const DRIFT_FIXES: Readonly<Record<DriftItem["type"], string>> = {
  agents: "agentbrew sync --only agents",
  "claude-desktop-mcp": "follow the fix named in the item, then restart Claude Desktop",
  "cli-build": "npm run build in the agentbrew checkout",
  "env-hygiene": "eval $(agentbrew env sanitize)",
  "organization-overlay": "agentbrew team set <overlay-url>, or agentbrew team unset",
  mcp: "agentbrew sync --only mcp",
  "mcp-bare-placeholder": "agentbrew sync --only mcp",
  "mcp-catalog-pin": "agentbrew sync --only mcp",
  "mcp-env-vars": "agentbrew setup",
  "mcp-playwright-isolated": "agentbrew sync --only mcp",
  "mcp-stale": "agentbrew sync",
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
  launchagent: "agentbrew fix",
};

/** The fix command or step for one drift item. */
export function driftFix(item: Pick<DriftItem, "type">): string {
  return DRIFT_FIXES[item.type];
}
