import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { parseAgentfile } from "../agentfile.js";
import { loadBaseCatalog } from "../catalog/types.js";
import { loadAgentDefinitions } from "../core/agents.js";
import { validateFrontmatter } from "../skills/validate.js";
import type { AgentConfig } from "../types.js";

export type AgentArtifactKind =
  | "agent-definition-catalog"
  | "agent-source"
  | "builtin-skill"
  | "catalog-command"
  | "catalog-mcp"
  | "catalog-rule"
  | "catalog-skill"
  | "command"
  | "command-source"
  | "hook"
  | "instruction-template"
  | "mcp-reference"
  | "rule-reference"
  | "skill-reference"
  | "source-reference";

export type AgentArtifactRisk = "high" | "medium" | "low";

export type AgentArtifactDiagnosticCode =
  | "duplicate-name"
  | "generated-output-source"
  | "high-risk-without-coverage"
  | "missing-metadata"
  | "missing-name"
  | "policy-contradiction"
  | "unreadable-source"
  | "unparseable-source";

export interface AgentArtifactCoverage {
  deterministicTests: string[];
  behavioralEvals: string[];
  exemption?: string;
}

export interface AgentArtifact {
  kind: AgentArtifactKind;
  name: string;
  sourcePath: string;
  targetAgents: string[];
  risk: AgentArtifactRisk;
  coverage: AgentArtifactCoverage;
  description?: string;
  sourceGroup?: string;
  content?: string;
}

export interface AgentArtifactDiagnostic {
  code: AgentArtifactDiagnosticCode;
  message: string;
  severity: "error" | "warning";
  sourcePath?: string;
  artifactName?: string;
  kind?: AgentArtifactKind;
}

export interface AgentArtifactInventory {
  artifacts: AgentArtifact[];
  diagnostics: AgentArtifactDiagnostic[];
}

export interface CollectAgentArtifactsOptions {
  repoRoot?: string;
  agentDefinitions?: Array<Omit<AgentConfig, "detected">>;
}

interface ArtifactDraft {
  kind: AgentArtifactKind;
  name: string;
  sourcePath: string;
  targetAgents: string[];
  risk: AgentArtifactRisk;
  description?: string;
  sourceGroup?: string;
  content?: string;
}

const DEFAULT_REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GENERATED_OUTPUT_PREFIXES = [
  ".claude/",
  ".config/devin/",
  ".codex/",
  ".codeium/",
  ".cursor/",
  ".windsurf/",
  "~/",
];
const PROMPT_LIKE_KINDS: ReadonlySet<AgentArtifactKind> = new Set([
  "builtin-skill",
  "catalog-command",
  "command",
  "hook",
  "instruction-template",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function getStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getRecordArray(record: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = record[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
}

function repoRelative(repoRoot: string, path: string): string {
  return relative(repoRoot, path).replaceAll("\\", "/");
}

function readYamlRecord(repoRoot: string, relativePath: string, diagnostics: AgentArtifactDiagnostic[]) {
  const sourcePath = join(repoRoot, relativePath);
  const content = readText(sourcePath);
  if (content === undefined) {
    diagnostics.push({
      code: "unreadable-source",
      message: `Unable to read ${relativePath}`,
      severity: "error",
      sourcePath: relativePath,
    });
    return undefined;
  }
  try {
    const parsed = yaml.load(content);
    if (isRecord(parsed)) return parsed;
    diagnostics.push({
      code: "unparseable-source",
      message: `${relativePath} must parse to a YAML object`,
      severity: "error",
      sourcePath: relativePath,
    });
  } catch (error) {
    diagnostics.push({
      code: "unparseable-source",
      message: `${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
      severity: "error",
      sourcePath: relativePath,
    });
  }
  return undefined;
}

function sortedAgents(agents: string[]): string[] {
  return [...new Set(agents)].sort((left, right) => left.localeCompare(right));
}

function agentsWith(
  definitions: Array<Omit<AgentConfig, "detected">>,
  key: keyof Omit<AgentConfig, "detected">,
): string[] {
  return sortedAgents(definitions.filter((agent) => agent[key] !== undefined).map((agent) => agent.name));
}

function allSkillAgents(definitions: Array<Omit<AgentConfig, "detected">>): string[] {
  return sortedAgents(definitions.map((agent) => agent.name));
}

function makeCoverage(repoRoot: string, draft: ArtifactDraft): AgentArtifactCoverage {
  const deterministicTests = deterministicCoverage(repoRoot, draft);
  const behavioralEvals = behavioralCoverage(repoRoot, draft);
  const exemption = findExemption(draft.description ?? draft.content ?? "");
  return exemption ? { deterministicTests, behavioralEvals, exemption } : { deterministicTests, behavioralEvals };
}

function deterministicCoverage(repoRoot: string, draft: ArtifactDraft): string[] {
  const candidates = deterministicCandidates(draft);
  return candidates.filter((candidate) => existsSync(join(repoRoot, candidate)));
}

function deterministicCandidates(draft: ArtifactDraft): string[] {
  if (draft.kind === "hook") {
    return [`hooks/checks/${draft.name}.test.sh`, "src/hooks/manifest.test.ts", "src/sync/hooks-sync.test.ts"];
  }
  if (draft.kind === "command" || draft.kind === "catalog-command") {
    return ["src/sync/command-sync.test.ts", "src/catalog/install.test.ts"];
  }
  if (draft.kind === "catalog-mcp" || draft.kind === "mcp-reference") {
    return ["src/catalog/types.test.ts", "src/mcp/catalog-smoke.test.ts", "src/sync/mcp-sync.test.ts"];
  }
  if (draft.kind === "builtin-skill" || draft.kind === "catalog-skill" || draft.kind === "skill-reference") {
    return ["src/skills/skill-coverage.test.ts", "src/skills/validate.test.ts", "src/sync/skills-sync.test.ts"];
  }
  if (draft.kind === "instruction-template") {
    return ["src/sync/instructions-content.test.ts", "src/sync/instructions-sync.test.ts"];
  }
  if (draft.kind === "catalog-rule" || draft.kind === "rule-reference") {
    return ["src/catalog/rule-template.test.ts", "src/sync/rules-sync.test.ts"];
  }
  if (draft.kind === "agent-definition-catalog" || draft.kind === "agent-source") {
    return ["src/core/agents.test.ts", "src/sync/agents-sync.test.ts"];
  }
  return ["src/agentfile.test.ts", "src/agentfile-apply.test.ts"];
}

function behavioralCoverage(repoRoot: string, draft: ArtifactDraft): string[] {
  const coverage: string[] = [];
  const skillEvalPath = join("skill-plugins", "dev", draft.name, "evals", "evals.json");
  const promptfooPath = "agent-artifact-evals/promptfoo.yaml";
  if (draft.kind === "builtin-skill" && existsSync(join(repoRoot, skillEvalPath))) {
    coverage.push(skillEvalPath);
  }
  const workflowEvalPath = join("skill-plugins", "workflow", draft.name, "evals", "evals.json");
  if (draft.kind === "catalog-skill" && existsSync(join(repoRoot, workflowEvalPath))) {
    coverage.push(workflowEvalPath);
  }
  if (isPromptfooCoveredArtifact(draft) && existsSync(join(repoRoot, promptfooPath))) {
    coverage.push(promptfooPath);
  }
  return coverage;
}

function isPromptfooCoveredArtifact(draft: ArtifactDraft): boolean {
  return (
    (draft.kind === "instruction-template" && draft.sourcePath === "templates/AGENTS.md") ||
    (draft.kind === "command" &&
      [
        "src/cli-commands/storybook-screenshot/storybook-screenshot.md",
        "src/cli-commands/jenkins-cli/jenkins-status.md",
      ].includes(draft.sourcePath))
  );
}

function findExemption(content: string): string | undefined {
  const match = content.match(/agentbrew-artifact-exemption:\s*(.+)/i);
  return match?.[1]?.trim();
}

function finalizeArtifacts(repoRoot: string, drafts: ArtifactDraft[]): AgentArtifact[] {
  return drafts
    .map((draft) => ({ ...draft, coverage: makeCoverage(repoRoot, draft) }))
    .sort((left, right) => {
      const kindOrder = left.kind.localeCompare(right.kind);
      return kindOrder === 0 ? left.name.localeCompare(right.name) : kindOrder;
    });
}

function collectCatalogArtifacts(
  repoRoot: string,
  definitions: Array<Omit<AgentConfig, "detected">>,
  diagnostics: AgentArtifactDiagnostic[],
): ArtifactDraft[] {
  const catalogPath = join(repoRoot, "src/catalog.yaml");
  if (!existsSync(catalogPath)) {
    diagnostics.push({
      code: "unreadable-source",
      message: "Unable to read src/catalog.yaml",
      severity: "error",
      sourcePath: "src/catalog.yaml",
    });
    return [];
  }

  let catalog: Record<string, unknown>;
  try {
    catalog = loadBaseCatalog({ path: catalogPath }) as unknown as Record<string, unknown>;
  } catch (error) {
    diagnostics.push({
      code: "unparseable-source",
      message: `src/catalog.yaml: ${error instanceof Error ? error.message : String(error)}`,
      severity: "error",
      sourcePath: "src/catalog.yaml",
    });
    return [];
  }

  return [
    ...collectNamedCatalogSection(catalog, "skills", "catalog-skill", "medium", allSkillAgents(definitions)),
    ...collectNamedCatalogSection(catalog, "mcp_servers", "catalog-mcp", "high", agentsWith(definitions, "mcpConfig")),
    ...collectNamedCatalogSection(catalog, "rules", "catalog-rule", "medium", agentsWith(definitions, "rulesFile")),
    ...collectCatalogCommands(repoRoot, catalog, definitions),
  ];
}

function collectNamedCatalogSection(
  catalog: Record<string, unknown>,
  section: string,
  kind: AgentArtifactKind,
  risk: AgentArtifactRisk,
  targetAgents: string[],
): ArtifactDraft[] {
  return getRecordArray(catalog, section)
    .map((entry) => catalogEntryDraft(entry, kind, risk, targetAgents))
    .filter((draft): draft is ArtifactDraft => draft !== undefined);
}

function catalogEntryDraft(
  entry: Record<string, unknown>,
  kind: AgentArtifactKind,
  risk: AgentArtifactRisk,
  targetAgents: string[],
): ArtifactDraft | undefined {
  const name = getString(entry, "name");
  if (!name) return undefined;
  return {
    kind,
    name,
    sourcePath: "src/catalog.yaml",
    targetAgents,
    risk,
    description: getString(entry, "description"),
    sourceGroup: "catalog",
  };
}

function collectCatalogCommands(
  repoRoot: string,
  catalog: Record<string, unknown>,
  definitions: Array<Omit<AgentConfig, "detected">>,
): ArtifactDraft[] {
  const commandAgents = agentsWith(definitions, "commandsDir");
  const drafts: ArtifactDraft[] = [];
  for (const tool of getRecordArray(catalog, "cli_tools")) {
    const toolName = getString(tool, "name");
    if (!toolName) continue;
    drafts.push({
      kind: "command-source",
      name: toolName,
      sourcePath: "src/catalog.yaml",
      targetAgents: commandAgents,
      risk: "medium",
      description: getString(tool, "description"),
      sourceGroup: "catalog-cli-tools",
    });
    for (const commandName of getStringArray(tool, "commands")) {
      drafts.push({
        kind: "catalog-command",
        name: commandName,
        sourcePath: "src/catalog.yaml",
        targetAgents: commandAgents,
        risk: "high",
        description: getString(tool, "description"),
        sourceGroup: toolName,
      });
      const commandPath = join("src", "cli-commands", toolName, `${commandName}.md`);
      const content = readText(join(repoRoot, commandPath));
      drafts.push({
        kind: "command",
        name: commandName,
        sourcePath: commandPath,
        targetAgents: commandAgents,
        risk: "high",
        description: content ? extractDescription(content) : getString(tool, "description"),
        sourceGroup: toolName,
        content,
      });
    }
  }
  return drafts;
}

function extractDescription(content: string): string | undefined {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return undefined;
  try {
    const frontmatter = yaml.load(match[1]);
    return isRecord(frontmatter) ? getString(frontmatter, "description") : undefined;
  } catch {
    return undefined;
  }
}

function collectAgentfileArtifacts(
  repoRoot: string,
  definitions: Array<Omit<AgentConfig, "detected">>,
  diagnostics: AgentArtifactDiagnostic[],
): ArtifactDraft[] {
  const sourcePath = "Agentfile.yaml";
  const content = readText(join(repoRoot, sourcePath));
  if (content === undefined) return [];
  try {
    const agentfile = parseAgentfile(content);
    return [
      ...collectAgentfileMcp(agentfile.mcp ?? [], definitions),
      ...stringReferences("skill-reference", agentfile.skills ?? [], allSkillAgents(definitions)),
      ...stringReferences("source-reference", agentfile.sources ?? [], allSkillAgents(definitions)),
      ...stringReferences("command-source", agentfile.commands ?? [], agentsWith(definitions, "commandsDir")),
      ...stringReferences("agent-source", agentfile.agents ?? [], agentsWith(definitions, "agentsDir")),
      ...agentfileRule(agentfile.rules, definitions),
      ...agentfileHooks(agentfile.hooks ?? [], definitions),
    ];
  } catch (error) {
    diagnostics.push({
      code: "unparseable-source",
      message: `${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
      severity: "error",
      sourcePath,
    });
    return [];
  }
}

function collectAgentfileMcp(
  entries: NonNullable<ReturnType<typeof parseAgentfile>["mcp"]>,
  definitions: Array<Omit<AgentConfig, "detected">>,
): ArtifactDraft[] {
  const drafts: ArtifactDraft[] = [];
  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry.name;
    if (!name) continue;
    drafts.push({
      kind: "mcp-reference",
      name,
      sourcePath: "Agentfile.yaml",
      targetAgents: agentsWith(definitions, "mcpConfig"),
      risk: "high",
      sourceGroup: "agentfile",
    });
  }
  return drafts;
}

function stringReferences(kind: AgentArtifactKind, names: string[], targetAgents: string[]): ArtifactDraft[] {
  return names.map((name) => ({
    kind,
    name,
    sourcePath: "Agentfile.yaml",
    targetAgents,
    risk: kind === "skill-reference" ? "high" : "medium",
    sourceGroup: "agentfile",
  }));
}

function agentfileRule(rules: string | undefined, definitions: Array<Omit<AgentConfig, "detected">>): ArtifactDraft[] {
  if (!rules) return [];
  return [
    {
      kind: "rule-reference",
      name: rules,
      sourcePath: "Agentfile.yaml",
      targetAgents: agentsWith(definitions, "rulesFile"),
      risk: "medium",
      sourceGroup: "agentfile",
    },
  ];
}

function agentfileHooks(
  hooks: NonNullable<ReturnType<typeof parseAgentfile>["hooks"]>,
  definitions: Array<Omit<AgentConfig, "detected">>,
): ArtifactDraft[] {
  return hooks.map((hook, index) => ({
    kind: "hook",
    name: `${hook.event}:${hook.matcher ?? "*"}` || `agentfile-hook-${index + 1}`,
    sourcePath: "Agentfile.yaml",
    targetAgents: agentsWith(definitions, "hooksFile"),
    risk: "high",
    description: hook.command ?? hook.prompt,
    sourceGroup: "agentfile",
  }));
}

function collectTemplateArtifacts(
  repoRoot: string,
  definitions: Array<Omit<AgentConfig, "detected">>,
): ArtifactDraft[] {
  const sourcePath = "templates/AGENTS.md";
  const content = readText(join(repoRoot, sourcePath));
  if (content === undefined) return [];
  return [
    {
      kind: "instruction-template",
      name: "AGENTS.md",
      sourcePath,
      targetAgents: agentsWith(definitions, "rulesFile"),
      risk: "high",
      description: "Global agent instructions template",
      sourceGroup: "templates",
      content,
    },
  ];
}

function collectAgentDefinitionArtifacts(
  repoRoot: string,
  definitions: Array<Omit<AgentConfig, "detected">>,
): ArtifactDraft[] {
  const sourcePath = "src/core/agents.yaml";
  if (!existsSync(join(repoRoot, sourcePath))) return [];
  return [
    {
      kind: "agent-definition-catalog",
      name: "agents.yaml",
      sourcePath,
      targetAgents: sortedAgents(definitions.map((agent) => agent.name)),
      risk: "medium",
      description: "Agent target matrix",
      sourceGroup: "core-agents",
    },
    ...definitions
      .filter((agent) => agent.agentsDir !== undefined)
      .map((agent) => ({
        kind: "agent-source" as const,
        name: agent.name,
        sourcePath,
        targetAgents: [agent.name],
        risk: "medium" as const,
        description: agent.agentsDir,
        sourceGroup: "core-agents",
      })),
  ];
}

function collectHookArtifacts(
  repoRoot: string,
  definitions: Array<Omit<AgentConfig, "detected">>,
  diagnostics: AgentArtifactDiagnostic[],
): ArtifactDraft[] {
  const sourcePath = "hooks/manifest.yaml";
  const manifest = readYamlRecord(repoRoot, sourcePath, diagnostics);
  if (manifest === undefined) return [];
  return getRecordArray(manifest, "hooks")
    .map((hook) => hookDraft(hook, definitions))
    .filter((draft): draft is ArtifactDraft => draft !== undefined);
}

function hookDraft(
  hook: Record<string, unknown>,
  definitions: Array<Omit<AgentConfig, "detected">>,
): ArtifactDraft | undefined {
  const name = getString(hook, "id");
  if (!name) return undefined;
  const manifestAgents = getStringArray(hook, "agents");
  return {
    kind: "hook",
    name,
    sourcePath: "hooks/manifest.yaml",
    targetAgents: sortedAgents(manifestAgents.length > 0 ? manifestAgents : agentsWith(definitions, "hooksFile")),
    risk: "high",
    description: getString(hook, "description"),
    sourceGroup: "hooks-manifest",
  };
}

function collectBuiltInSkillArtifacts(
  repoRoot: string,
  definitions: Array<Omit<AgentConfig, "detected">>,
): ArtifactDraft[] {
  const skillRoot = join(repoRoot, "skill-plugins", "dev");
  if (!existsSync(skillRoot)) return [];
  return readdirSync(skillRoot)
    .map((entry) => join(skillRoot, entry))
    .filter(isSkillDirectory)
    .map((directory) => builtInSkillDraft(repoRoot, directory, definitions))
    .filter((draft): draft is ArtifactDraft => draft !== undefined);
}

function isSkillDirectory(directory: string): boolean {
  try {
    return statSync(directory).isDirectory() && existsSync(join(directory, "SKILL.md"));
  } catch {
    return false;
  }
}

function builtInSkillDraft(
  repoRoot: string,
  directory: string,
  definitions: Array<Omit<AgentConfig, "detected">>,
): ArtifactDraft | undefined {
  const sourcePath = repoRelative(repoRoot, join(directory, "SKILL.md"));
  const content = readText(join(directory, "SKILL.md"));
  if (content === undefined) return undefined;
  const name = basename(directory);
  const frontmatterIssues = validateFrontmatter(content, name).filter((issue) => issue.severity === "error");
  return {
    kind: "builtin-skill",
    name,
    sourcePath,
    targetAgents: allSkillAgents(definitions),
    risk: "high",
    description: frontmatterIssues.length === 0 ? extractDescription(content) : undefined,
    sourceGroup: "skill-plugins/dev",
    content,
  };
}

export function collectAgentArtifacts(options: CollectAgentArtifactsOptions = {}): AgentArtifactInventory {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const definitions = options.agentDefinitions ?? loadAgentDefinitions();
  const diagnostics: AgentArtifactDiagnostic[] = [];
  const drafts = [
    ...collectCatalogArtifacts(repoRoot, definitions, diagnostics),
    ...collectAgentfileArtifacts(repoRoot, definitions, diagnostics),
    ...collectTemplateArtifacts(repoRoot, definitions),
    ...collectAgentDefinitionArtifacts(repoRoot, definitions),
    ...collectHookArtifacts(repoRoot, definitions, diagnostics),
    ...collectBuiltInSkillArtifacts(repoRoot, definitions),
  ];
  return { artifacts: finalizeArtifacts(repoRoot, drafts), diagnostics };
}

export function lintAgentArtifacts(artifacts: AgentArtifact[]): AgentArtifactDiagnostic[] {
  return [
    ...missingNameDiagnostics(artifacts),
    ...duplicateDiagnostics(artifacts),
    ...generatedOutputDiagnostics(artifacts),
    ...metadataDiagnostics(artifacts),
    ...coverageDiagnostics(artifacts),
    ...instructionPolicyDiagnostics(artifacts),
  ];
}

function missingNameDiagnostics(artifacts: AgentArtifact[]): AgentArtifactDiagnostic[] {
  return artifacts
    .filter((artifact) => artifact.name.trim().length === 0)
    .map((artifact) => ({
      code: "missing-name" as const,
      message: `${artifact.kind} artifact is missing a required name`,
      severity: "error" as const,
      sourcePath: artifact.sourcePath,
      artifactName: artifact.name,
      kind: artifact.kind,
    }));
}

function duplicateDiagnostics(artifacts: AgentArtifact[]): AgentArtifactDiagnostic[] {
  const byKindAndName = new Map<string, AgentArtifact[]>();
  for (const artifact of artifacts) {
    const key = `${artifact.kind}:${artifact.name}`;
    byKindAndName.set(key, [...(byKindAndName.get(key) ?? []), artifact]);
  }
  return [...byKindAndName.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      code: "duplicate-name" as const,
      message: `Duplicate ${group[0].kind} artifact named ${group[0].name}`,
      severity: "error" as const,
      sourcePath: group.map((artifact) => artifact.sourcePath).join(", "),
      artifactName: group[0].name,
      kind: group[0].kind,
    }));
}

function generatedOutputDiagnostics(artifacts: AgentArtifact[]): AgentArtifactDiagnostic[] {
  return artifacts
    .filter((artifact) => GENERATED_OUTPUT_PREFIXES.some((prefix) => artifact.sourcePath.startsWith(prefix)))
    .map((artifact) => ({
      code: "generated-output-source" as const,
      message: `${artifact.sourcePath} is a generated agent output path, not a source artifact`,
      severity: "error" as const,
      sourcePath: artifact.sourcePath,
      artifactName: artifact.name,
      kind: artifact.kind,
    }));
}

function metadataDiagnostics(artifacts: AgentArtifact[]): AgentArtifactDiagnostic[] {
  return artifacts
    .filter((artifact) => PROMPT_LIKE_KINDS.has(artifact.kind))
    .filter((artifact) => !artifact.description || artifact.targetAgents.length === 0)
    .map((artifact) => ({
      code: "missing-metadata" as const,
      message: `${artifact.kind} ${artifact.name} is missing description or target-agent metadata`,
      severity: "error" as const,
      sourcePath: artifact.sourcePath,
      artifactName: artifact.name,
      kind: artifact.kind,
    }));
}

function coverageDiagnostics(artifacts: AgentArtifact[]): AgentArtifactDiagnostic[] {
  return artifacts
    .filter((artifact) => artifact.risk === "high")
    .filter(
      (artifact) =>
        artifact.coverage.deterministicTests.length === 0 &&
        artifact.coverage.behavioralEvals.length === 0 &&
        artifact.coverage.exemption === undefined,
    )
    .map((artifact) => ({
      code: "high-risk-without-coverage" as const,
      message: `High-risk ${artifact.kind} ${artifact.name} has no deterministic test, behavioral eval, or exemption`,
      severity: "error" as const,
      sourcePath: artifact.sourcePath,
      artifactName: artifact.name,
      kind: artifact.kind,
    }));
}

function instructionPolicyDiagnostics(artifacts: AgentArtifact[]): AgentArtifactDiagnostic[] {
  return artifacts
    .filter((artifact) => artifact.kind === "instruction-template")
    .flatMap((artifact) => policyDiagnosticsForInstruction(artifact));
}

function policyDiagnosticsForInstruction(artifact: AgentArtifact): AgentArtifactDiagnostic[] {
  const content = artifact.content ?? "";
  const diagnostics: AgentArtifactDiagnostic[] = [];
  if (!/explicit(?: per-action)? approval/i.test(content)) {
    diagnostics.push({
      code: "policy-contradiction",
      message: `${artifact.name} is missing explicit approval language for publishing actions`,
      severity: "error",
      sourcePath: artifact.sourcePath,
      artifactName: artifact.name,
      kind: artifact.kind,
    });
  }
  if (/edit generated agent files directly/i.test(content)) {
    diagnostics.push({
      code: "policy-contradiction",
      message: `${artifact.name} tells agents to edit generated output files directly`,
      severity: "error",
      sourcePath: artifact.sourcePath,
      artifactName: artifact.name,
      kind: artifact.kind,
    });
  }
  return diagnostics;
}
