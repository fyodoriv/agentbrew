import { loadAgentDefinitions } from "../core/agents.js";
import { DEFAULT_SUPPORTED_SKILL_FEATURES, type SkillFeature } from "../types.js";

/** Human-facing row shape — one entry per agent in the feature matrix. */
interface AgentMatrixRow {
  name: string;
  skills: boolean;
  mcp: boolean;
  rules: boolean;
  commands: boolean;
  agents: boolean;
  hooks: boolean;
  experimental: boolean;
  skillFeatures: readonly SkillFeature[];
}

/**
 * Build a structured matrix row per agent. Exported so tests can assert
 * specific agents have the capabilities users expect.
 */
export function buildAgentMatrix(): AgentMatrixRow[] {
  return loadAgentDefinitions().map((definition) => ({
    name: definition.name,
    skills: Boolean(definition.skillsDir),
    mcp: Boolean(definition.mcpConfig),
    rules: Boolean(definition.rulesFile) || Boolean(definition.rulesDir),
    commands: Boolean(definition.commandsDir),
    agents: Boolean(definition.agentsDir),
    hooks: Boolean(definition.hooksFile),
    experimental: definition.experimental === true,
    skillFeatures: definition.supportedSkillFeatures ?? DEFAULT_SUPPORTED_SKILL_FEATURES,
  }));
}

function check(value: boolean): string {
  return value ? "✓" : "—";
}

function renderSyncSurfacesTable(rows: AgentMatrixRow[]): string {
  const stable = rows.filter((row) => !row.experimental).sort((a, b) => a.name.localeCompare(b.name));
  const header = "| Agent | Skills | MCP | Rules | Commands | Agents | Hooks |";
  const separator = "|---|---|---|---|---|---|---|";
  const body = stable.map(
    (row) =>
      `| ${row.name} | ${check(row.skills)} | ${check(row.mcp)} | ${check(row.rules)} | ${check(row.commands)} | ${check(row.agents)} | ${check(row.hooks)} |`,
  );
  return [header, separator, ...body].join("\n");
}

function renderSkillFeaturesTable(rows: AgentMatrixRow[]): string {
  const stable = rows.filter((row) => !row.experimental).sort((a, b) => a.name.localeCompare(b.name));
  const header = "| Agent | allowed-tools | context-fork | hooks |";
  const separator = "|---|---|---|---|";
  const body = stable.map((row) => {
    const features = new Set(row.skillFeatures);
    return `| ${row.name} | ${check(features.has("allowed-tools"))} | ${check(features.has("context-fork"))} | ${check(features.has("hooks"))} |`;
  });
  return [header, separator, ...body].join("\n");
}

function renderExperimentalList(rows: AgentMatrixRow[]): string {
  const experimental = rows
    .filter((row) => row.experimental)
    .map((row) => row.name)
    .sort();
  return `Skills-only (experimental; sync only writes to \`skillsDir\`; not tested on real user machines beyond the author's): ${experimental.join(", ")}.`;
}

/**
 * Rebuilds the README agent feature matrix from `agents.yaml`. Outputs two
 * tables and one paragraph. Keep the output small enough to paste into the
 * README without overwhelming readers — stable agents in tables, experimental
 * names in a prose list.
 */
export function renderAgentFeatureMatrix(): string {
  const rows = buildAgentMatrix();
  return [
    "### Sync surfaces per agent",
    "",
    "Each column is a sync module. ✓ means `agentbrew sync` writes to that surface for that agent; — means the module is skipped because the agent has no matching config path.",
    "",
    renderSyncSurfacesTable(rows),
    "",
    "### SKILL.md feature support",
    "",
    "Sourced from [vercel-labs/skills README](https://github.com/vercel-labs/skills#compatibility). A skill that declares a feature its target agent does not support is skipped during sync.",
    "",
    renderSkillFeaturesTable(rows),
    "",
    renderExperimentalList(rows),
  ].join("\n");
}
