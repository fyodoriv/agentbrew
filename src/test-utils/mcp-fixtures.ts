/**
 * Test-only fixture helpers for MCP-related tests.
 *
 * Surfaced during slices 4a/4b/4c of `delegate-mcp-to-mcpm` (TASKS.md):
 * re-targeting tests from cursor/claude-code (intersection-skip) to
 * kiro/amp/copilot (carve-outs) required hand-editing many inline agent
 * definitions of the shape `{ name: "kiro", detected: true,
 * skillsDir: "x", mcpConfig: "~/.kiro/settings/mcp.json" }`. This
 * helper consolidates that shape so future delegation slices that
 * re-target tests have a single canonical "give me a carve-out agent"
 * entry point.
 *
 * Lives next to other test helpers under `src/test-utils/`. Not exported
 * from production code paths — this file is referenced only by `*.test.ts`
 * suites.
 */

import { AGENT_DEFINITIONS, type AgentConfig } from "../types.js";

/** Optional overrides for {@link makeMcpAgentDef}. */
interface McpAgentFixtureOptions {
  detected?: boolean;
  skillsDir?: string;
  mcpConfig?: string;
  mcpKey?: string;
  mcpFormat?: AgentConfig["mcpFormat"];
  rulesFile?: string;
  rulesDir?: string;
  commandsDir?: string;
}

/**
 * Build a test-friendly {@link AgentConfig} for MCP-related tests.
 *
 * Defaults to a `kiro` carve-out (the canonical carve-out for MCP
 * intersection-skip tests) with `detected: true`. When the requested
 * agent name exists in {@link AGENT_DEFINITIONS}, `skillsDir` and
 * `mcpConfig` resolve from there; otherwise they fall back to a
 * placeholder string so older tests that only need a string-typed
 * value continue to compile.
 *
 * Returns the minimum viable shape — `mcpKey`/`mcpFormat`/`rulesFile`
 * etc. are NOT auto-included from `AGENT_DEFINITIONS` so the test
 * object stays small and the migrated tests don't grow side-effect
 * surface. Pass them explicitly when a test needs them.
 *
 * @example
 *   makeMcpAgentDef()
 *   // → { name: "kiro", detected: true,
 *   //     skillsDir: "~/.kiro/skills",
 *   //     mcpConfig: "~/.kiro/settings/mcp.json" }
 *
 * @example
 *   makeMcpAgentDef("amp", { detected: false })
 *   // → { name: "amp", detected: false,
 *   //     skillsDir: "~/.config/amp/skills",
 *   //     mcpConfig: "~/.config/amp/settings.json" }
 *
 * @example
 *   makeMcpAgentDef("kiro", { skillsDir: "x" })
 *   // → { name: "kiro", detected: true, skillsDir: "x",
 *   //     mcpConfig: "~/.kiro/settings/mcp.json" }
 */
export function makeMcpAgentDef(name = "kiro", options: McpAgentFixtureOptions = {}): AgentConfig {
  const defaults = AGENT_DEFINITIONS.find((a) => a.name === name);
  const skillsDir = options.skillsDir ?? defaults?.skillsDir ?? "x";

  const result: AgentConfig = {
    name,
    detected: options.detected ?? true,
    skillsDir,
  };
  const mcpConfig = options.mcpConfig ?? defaults?.mcpConfig;
  if (mcpConfig !== undefined) result.mcpConfig = mcpConfig;
  if (options.mcpKey !== undefined) result.mcpKey = options.mcpKey;
  if (options.mcpFormat !== undefined) result.mcpFormat = options.mcpFormat;
  if (options.rulesFile !== undefined) result.rulesFile = options.rulesFile;
  if (options.rulesDir !== undefined) result.rulesDir = options.rulesDir;
  if (options.commandsDir !== undefined) result.commandsDir = options.commandsDir;
  return result;
}
