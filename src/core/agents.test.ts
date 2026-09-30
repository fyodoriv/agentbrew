import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillFeature } from "../types.js";
import {
  filterReadsFromAgents,
  loadAgentDefinitions,
  resetAgentDefinitionsCache,
  resolveAgentYamlPath,
} from "./agents.js";

vi.mock("../state.js", () => ({
  loadState: () => ({ agents: [], team: undefined }),
}));

/**
 * Raw YAML entry shape — identical to the private `AgentYamlEntry` in
 * `agents.ts` but defined here so the consistency validator can reason about
 * fields that are collapsed before they reach the resolved `AgentConfig`
 * (notably the three mutually-exclusive MCP access modes).
 */
interface RawAgentEntry {
  name?: unknown;
  skillsDir?: unknown;
  mcpConfig?: unknown;
  mcpKey?: unknown;
  mcpFormat?: unknown;
  mcpPermissionsConfig?: unknown;
  mcpConfigVscodeExt?: unknown;
  mcpConfigVscodeSettings?: unknown;
  rulesFile?: unknown;
  rulesDir?: unknown;
  commandsDir?: unknown;
  agentsDir?: unknown;
  agentsDirFormat?: unknown;
  commandTransform?: unknown;
  commandFileExt?: unknown;
  hooksFile?: unknown;
  hooksKey?: unknown;
  hooksFormat?: unknown;
  hooksScope?: unknown;
  modelConfig?: unknown;
  readsFrom?: unknown;
  experimental?: unknown;
  supportedSkillFeatures?: unknown;
}

const VALID_SKILL_FEATURES: readonly SkillFeature[] = ["allowed-tools", "context-fork", "hooks"];
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

const EXPERIMENTAL_FORBIDDEN_FIELDS = [
  "mcpConfig",
  "mcpPermissionsConfig",
  "mcpConfigVscodeExt",
  "mcpConfigVscodeSettings",
  "rulesFile",
  "rulesDir",
  "commandsDir",
  "agentsDir",
  "hooksFile",
  "modelConfig",
] as const satisfies readonly (keyof RawAgentEntry)[];

function pushNameViolations(entry: RawAgentEntry, seen: Set<string>, violations: string[]): void {
  if (typeof entry.name !== "string" || entry.name.length === 0) {
    violations.push("entry has no `name` (required, string)");
    return;
  }
  if (!KEBAB_CASE.test(entry.name)) {
    violations.push(`'${entry.name}' name must be kebab-case (lowercase letters/digits separated by '-')`);
  }
  if (seen.has(entry.name)) {
    violations.push(`'${entry.name}' name is duplicated`);
  }
  seen.add(entry.name);
}

function countMcpAccessModes(entry: RawAgentEntry): number {
  let modes = 0;
  if (entry.mcpConfig !== undefined) modes += 1;
  if (entry.mcpConfigVscodeExt !== undefined) modes += 1;
  if (entry.mcpConfigVscodeSettings !== undefined) modes += 1;
  return modes;
}

function pushFieldImplicationViolations(entry: RawAgentEntry, violations: string[]): void {
  const name = typeof entry.name === "string" ? entry.name : "(unnamed)";
  if (typeof entry.skillsDir !== "string" || entry.skillsDir.length === 0) {
    violations.push(`'${name}' is missing \`skillsDir\` (required)`);
  }
  if (entry.agentsDirFormat !== undefined && entry.agentsDir === undefined) {
    violations.push(`'${name}' sets \`agentsDirFormat\` but has no \`agentsDir\``);
  }
  if (entry.commandTransform !== undefined && entry.commandsDir === undefined) {
    violations.push(`'${name}' sets \`commandTransform\` but has no \`commandsDir\``);
  }
  if (entry.commandFileExt !== undefined && entry.commandsDir === undefined) {
    violations.push(`'${name}' sets \`commandFileExt\` but has no \`commandsDir\``);
  }
  if (entry.hooksKey !== undefined && entry.hooksFile === undefined) {
    violations.push(`'${name}' sets \`hooksKey\` but has no \`hooksFile\``);
  }
  if (entry.hooksFormat !== undefined && entry.hooksFile === undefined) {
    violations.push(`'${name}' sets \`hooksFormat\` but has no \`hooksFile\``);
  }
  if (entry.hooksScope !== undefined && entry.hooksFile === undefined) {
    violations.push(`'${name}' sets \`hooksScope\` but has no \`hooksFile\``);
  }
  if (countMcpAccessModes(entry) > 1) {
    violations.push(
      `'${name}' sets more than one MCP access mode — pick exactly one of mcpConfig, mcpConfigVscodeExt, mcpConfigVscodeSettings`,
    );
  }
  if (entry.mcpPermissionsConfig !== undefined && countMcpAccessModes(entry) === 0) {
    violations.push(`'${name}' sets \`mcpPermissionsConfig\` but has no MCP access mode`);
  }
  pushMcpPermissionsConfigViolations(entry, violations);
  if (
    entry.hooksFormat !== undefined &&
    entry.hooksFormat !== "claude-settings" &&
    entry.hooksFormat !== "claude-direct" &&
    entry.hooksFormat !== "cursor"
  ) {
    violations.push(`'${name}' has invalid \`hooksFormat\` '${String(entry.hooksFormat)}'`);
  }
  if (entry.hooksScope !== undefined && entry.hooksScope !== "user" && entry.hooksScope !== "project") {
    violations.push(`'${name}' has invalid \`hooksScope\` '${String(entry.hooksScope)}'`);
  }
  pushModelConfigViolations(entry, violations);
}

function pushMcpPermissionsConfigViolations(entry: RawAgentEntry, violations: string[]): void {
  if (entry.mcpPermissionsConfig === undefined) return;
  const name = typeof entry.name === "string" ? entry.name : "(unnamed)";
  if (typeof entry.mcpPermissionsConfig !== "object" || entry.mcpPermissionsConfig === null) {
    violations.push(`'${name}' has non-object \`mcpPermissionsConfig\``);
    return;
  }
  const config = entry.mcpPermissionsConfig as Record<string, unknown>;
  if (typeof config.file !== "string" || !config.file.startsWith("~")) {
    violations.push(`'${name}' mcpPermissionsConfig.file must be a ~-prefixed string`);
  }
}

function pushModelConfigViolations(entry: RawAgentEntry, violations: string[]): void {
  if (entry.modelConfig === undefined) return;
  const name = typeof entry.name === "string" ? entry.name : "(unnamed)";
  if (typeof entry.modelConfig !== "object" || entry.modelConfig === null || Array.isArray(entry.modelConfig)) {
    violations.push(`'${name}' has non-object \`modelConfig\``);
    return;
  }
  const config = entry.modelConfig as Record<string, unknown>;
  if (typeof config.file !== "string" || !config.file.startsWith("~")) {
    violations.push(`'${name}' modelConfig.file must be a ~-prefixed string`);
  }
  if (typeof config.path !== "string" || config.path.length === 0) {
    violations.push(`'${name}' modelConfig.path must be a non-empty string`);
  }
  if (config.format !== undefined && config.format !== "json" && config.format !== "toml") {
    violations.push(`'${name}' has invalid modelConfig.format '${String(config.format)}' (allowed: json, toml)`);
  }
}

function pushExperimentalViolations(entry: RawAgentEntry, violations: string[]): void {
  if (entry.experimental !== true) return;
  const name = typeof entry.name === "string" ? entry.name : "(unnamed)";
  for (const field of EXPERIMENTAL_FORBIDDEN_FIELDS) {
    if (entry[field] !== undefined) {
      violations.push(`'${name}' is \`experimental: true\` but sets \`${field}\` (skills-only invariant)`);
    }
  }
}

function pushSupportedSkillFeatureViolations(entry: RawAgentEntry, violations: string[]): void {
  if (entry.supportedSkillFeatures === undefined) return;
  const name = typeof entry.name === "string" ? entry.name : "(unnamed)";
  if (!Array.isArray(entry.supportedSkillFeatures)) {
    violations.push(`'${name}' has non-array \`supportedSkillFeatures\``);
    return;
  }
  for (const feature of entry.supportedSkillFeatures) {
    if (typeof feature !== "string" || !VALID_SKILL_FEATURES.includes(feature as SkillFeature)) {
      violations.push(
        `'${name}' has invalid supportedSkillFeatures member '${String(feature)}' (allowed: ${VALID_SKILL_FEATURES.join(", ")})`,
      );
    }
  }
}

function pushReadsFromViolations(entry: RawAgentEntry, allNames: Set<string>, violations: string[]): void {
  if (entry.readsFrom === undefined) return;
  const name = typeof entry.name === "string" ? entry.name : "(unnamed)";
  if (!Array.isArray(entry.readsFrom)) {
    violations.push(`'${name}' has non-array \`readsFrom\``);
    return;
  }
  for (const reference of entry.readsFrom) {
    if (typeof reference !== "string") {
      violations.push(`'${name}' has non-string readsFrom entry '${String(reference)}'`);
      continue;
    }
    if (!allNames.has(reference)) {
      violations.push(`'${name}' readsFrom '${reference}' which is not defined in agents.yaml`);
    }
  }
}

/**
 * Validates the raw YAML entries against the invariants documented in the
 * `agents.yaml` header. Returns one human-readable message per violation so
 * CI output points reviewers at the exact rule they broke.
 */
function findAgentYamlViolations(entries: RawAgentEntry[]): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    pushNameViolations(entry, seen, violations);
    pushFieldImplicationViolations(entry, violations);
    pushExperimentalViolations(entry, violations);
    pushSupportedSkillFeatureViolations(entry, violations);
  }
  // readsFrom validation needs the full name set — compute after first pass
  const allNames = new Set(
    entries.map((entry) => (typeof entry.name === "string" ? entry.name : "")).filter((name) => name !== ""),
  );
  for (const entry of entries) {
    pushReadsFromViolations(entry, allNames, violations);
  }
  return violations;
}

beforeEach(() => {
  resetAgentDefinitionsCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetAgentDefinitionsCache();
});

describe("loadAgentDefinitions", () => {
  it("loads one definition per agents.yaml entry", () => {
    const yamlPath = join(import.meta.dirname, "agents.yaml");
    const yamlEntries = yaml.load(readFileSync(yamlPath, "utf-8"));
    expect(Array.isArray(yamlEntries)).toBe(true);
    const defs = loadAgentDefinitions();
    expect(defs.length).toBe((yamlEntries as unknown[]).length);
    expect(new Set(defs.map((d) => d.name)).size).toBe(defs.length);
  });

  it("marks skills-only agents as experimental with no extra sync surfaces", () => {
    const defs = loadAgentDefinitions();
    const experimental = defs.filter((d) => d.experimental);
    const stable = defs.filter((d) => !d.experimental);
    expect(experimental.length + stable.length).toBe(defs.length);
    for (const agent of experimental) {
      for (const field of EXPERIMENTAL_FORBIDDEN_FIELDS) {
        expect((agent as Record<string, unknown>)[field]).toBeUndefined();
      }
    }
  });

  it("does not mark agents with mcpConfig as experimental", () => {
    const defs = loadAgentDefinitions();
    const withMcp = defs.filter((d) => d.mcpConfig);
    for (const agent of withMcp) {
      expect(agent.experimental).toBeFalsy();
    }
  });

  it("returns cached result on second call", () => {
    const first = loadAgentDefinitions();
    const second = loadAgentDefinitions();
    expect(first).toBe(second);
  });

  it("claude-code has all config fields", () => {
    const claude = loadAgentDefinitions().find((d) => d.name === "claude-code");
    expect(claude).toBeDefined();
    expect(claude?.skillsDir).toBe("~/.claude/skills");
    expect(claude?.mcpConfig).toBe("~/.claude.json");
    expect(claude?.rulesFile).toBe("~/.claude/CLAUDE.md");
    expect(claude?.commandsDir).toBe("~/.claude/commands");
    expect(claude?.agentsDir).toBe("~/.claude/agents");
    expect(claude?.hooksFile).toBe("~/.claude/settings.json");
    expect(claude?.hooksFormat).toBe("claude-settings");
  });

  it("claude-desktop shares ~/.claude/ paths for rules, commands, and agents", () => {
    const desktop = loadAgentDefinitions().find((d) => d.name === "claude-desktop");
    expect(desktop).toBeDefined();
    expect(desktop?.skillsDir).toBe("~/Library/Application Support/Claude/skills");
    expect(desktop?.mcpConfig).toBe("~/Library/Application Support/Claude/claude_desktop_config.json");
    expect(desktop?.rulesFile).toBe("~/.claude/CLAUDE.md");
    expect(desktop?.commandsDir).toBe("~/.claude/commands");
    expect(desktop?.agentsDir).toBe("~/.claude/agents");
    expect(desktop?.readsFrom).toEqual(["claude-code"]);
  });

  it("cursor has commandTransform for delegated ai-rules output", () => {
    const cursor = loadAgentDefinitions().find((d) => d.name === "cursor");
    expect(cursor?.commandTransform).toBeTypeOf("function");
    expect(cursor?.commandTransform?.("---\ndescription: Run\n---\n\n# Run")).toBe("\n# Run");
  });

  it("cursor writes hooks to Cursor's native hooks file", () => {
    const cursor = loadAgentDefinitions().find((d) => d.name === "cursor");
    expect(cursor?.hooksFile).toBe("~/.cursor/hooks.json");
    expect(cursor?.hooksFormat).toBe("cursor");
  });

  it("cursor writes MCP permissions to Cursor CLI config", () => {
    const cursor = loadAgentDefinitions().find((d) => d.name === "cursor");
    expect(cursor?.mcpPermissionsConfig?.file).toBe("~/.cursor/cli-config.json");
  });

  it("devin writes hooks to the project-local hooks file", () => {
    const devin = loadAgentDefinitions().find((d) => d.name === "devin");
    expect(devin?.hooksFile).toBe(".devin/hooks.v1.json");
    expect(devin?.hooksFormat).toBe("claude-direct");
    expect(devin?.hooksScope).toBe("project");
  });

  it("windsurf has commandTransform resolved", () => {
    const windsurf = loadAgentDefinitions().find((d) => d.name === "windsurf");
    expect(windsurf?.commandTransform).toBeTypeOf("function");
    expect(windsurf?.commandTransform?.("<!-- turbo -->")).toBe("// turbo");
  });

  it("gemini-cli has mcpConfig, rulesFile, commandTransform, and commandFileExt", () => {
    const gemini = loadAgentDefinitions().find((d) => d.name === "gemini-cli");
    expect(gemini?.skillsDir).toBe("~/.gemini/skills");
    expect(gemini?.mcpConfig).toBe("~/.gemini/settings.json");
    expect(gemini?.rulesFile).toBe("~/.gemini/GEMINI.md");
    expect(gemini?.commandsDir).toBe("~/.gemini/commands");
    expect(gemini?.commandTransform).toBeTypeOf("function");
    expect(gemini?.commandFileExt).toBe(".toml");
    const result = gemini?.commandTransform?.("---\ndescription: Test\n---\n\n# Title\n");
    expect(result).toContain('description = "Test"');
    expect(result).toContain('prompt = """');
  });

  it("devin has mcpConfig and rulesFile", () => {
    const devin = loadAgentDefinitions().find((d) => d.name === "devin");
    expect(devin).toBeDefined();
    expect(devin?.skillsDir).toBe("~/.config/devin/skills");
    expect(devin?.mcpConfig).toBe("~/.config/devin/config.json");
    expect(devin?.mcpKey).toBe("mcpServers");
    expect(devin?.mcpPermissionsConfig?.file).toBe("~/.config/devin/config.json");
    expect(devin?.rulesFile).toBe("~/.config/devin/AGENTS.md");
  });

  it("devin has agentsDir and subdir format for first-class support", () => {
    const devin = loadAgentDefinitions().find((d) => d.name === "devin");
    expect(devin?.agentsDir).toBe("~/.config/devin/agents");
    expect(devin?.agentsDirFormat).toBe("subdir");
  });

  it("codex has toml format and agentsDir", () => {
    const codex = loadAgentDefinitions().find((d) => d.name === "codex");
    expect(codex?.mcpFormat).toBe("toml");
    expect(codex?.agentsDir).toBe("~/.codex/agents");
  });

  it("goose has yaml format and extensions key", () => {
    const goose = loadAgentDefinitions().find((d) => d.name === "goose");
    expect(goose?.mcpFormat).toBe("yaml");
    expect(goose?.mcpKey).toBe("extensions");
  });

  it("cline has vscodeExt-computed mcpConfig", () => {
    const cline = loadAgentDefinitions().find((d) => d.name === "cline");
    expect(cline?.mcpConfig).toContain("saoudrizwan.claude-dev");
    expect(cline?.mcpConfig).toContain("cline_mcp_settings.json");
  });

  it("copilot has mcpConfig pointing to VS Code settings.json", () => {
    const copilot = loadAgentDefinitions().find((d) => d.name === "copilot");
    expect(copilot?.skillsDir).toBe("~/.copilot/skills");
    expect(copilot?.mcpConfig).toContain("settings.json");
    // Slice 3c of `delegate-rules-to-ai-rules` adds a user-global
    // rulesFile at ~/.copilot/AGENTS.md. Copilot reads project-local
    // `.github/copilot-instructions.md` today; the user-global path
    // exists for consistency with agentbrew's convention and as an
    // upstream-contribution target.
    expect(copilot?.rulesFile).toBe("~/.copilot/AGENTS.md");
  });

  it("slice 3c — free-capability gain agents in agents.yaml have rulesFile set", () => {
    // Added by slice 3c of `delegate-rules-to-ai-rules`. ai-rules writes
    // project-local AGENTS.md for each; agentbrew deploys the wrapped
    // output to the user-global paths listed here. firebender + kilo
    // graduated from experimental to host rulesFile (the
    // "experimental ⇒ skills-only" invariant forbids any other sync
    // surface on experimental agents).
    const defs = loadAgentDefinitions();
    const expected: Array<[string, string]> = [
      ["amp", "~/.config/amp/AGENTS.md"],
      ["cline", "~/.cline/AGENTS.md"],
      ["copilot", "~/.copilot/AGENTS.md"],
      ["firebender", "~/.firebender/AGENTS.md"],
      ["goose", "~/.config/goose/AGENTS.md"],
      ["kilo", "~/.kilocode/AGENTS.md"],
      ["roo-code", "~/.roo/AGENTS.md"],
    ];
    for (const [name, rulesFile] of expected) {
      const agent = defs.find((d) => d.name === name);
      expect(agent, `expected agent ${name} to exist`).toBeDefined();
      expect(agent?.rulesFile, `expected ${name}.rulesFile`).toBe(rulesFile);
      expect(agent?.experimental, `expected ${name} non-experimental`).toBeFalsy();
    }
  });
});

describe("filterReadsFromAgents", () => {
  it("keeps agents without readsFrom", () => {
    const agents = [{ name: "claude-code" }, { name: "cursor" }];
    const detected = new Set(["claude-code", "cursor"]);
    const result = filterReadsFromAgents(agents, detected);
    expect(result).toHaveLength(2);
  });

  it("skips claude-desktop when claude-code is detected (shared paths)", () => {
    const agents = [{ name: "claude-code" }, { name: "claude-desktop", readsFrom: ["claude-code"] }];
    const detected = new Set(["claude-code", "claude-desktop"]);
    const result = filterReadsFromAgents(agents, detected);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("claude-code");
  });

  it("keeps claude-desktop when claude-code is NOT detected", () => {
    const agents = [{ name: "claude-desktop", readsFrom: ["claude-code"] }];
    const detected = new Set(["claude-desktop"]);
    const result = filterReadsFromAgents(agents, detected);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("claude-desktop");
  });

  it("skips agent only when ALL readsFrom are detected", () => {
    const agents = [{ name: "multi-reader", readsFrom: ["agent-a", "agent-b"] }];
    // Only one of the two readsFrom agents is detected
    const detected = new Set(["multi-reader", "agent-a"]);
    const result = filterReadsFromAgents(agents, detected);
    expect(result).toHaveLength(1);

    // Both readsFrom agents detected → skip
    const detected2 = new Set(["multi-reader", "agent-a", "agent-b"]);
    const result2 = filterReadsFromAgents(agents, detected2);
    expect(result2).toHaveLength(0);
  });

  it("handles empty readsFrom array as no dependency", () => {
    const agents = [{ name: "standalone", readsFrom: [] as string[] }];
    const detected = new Set(["standalone"]);
    const result = filterReadsFromAgents(agents, detected);
    expect(result).toHaveLength(1);
  });

  it("validates real agent definitions — claude-desktop filtered when claude-code present", () => {
    const defs = loadAgentDefinitions();
    const withAgentsDir = defs.filter((a) => a.agentsDir !== undefined);
    const detectedNames = new Set(withAgentsDir.map((a) => a.name));
    const filtered = filterReadsFromAgents(withAgentsDir, detectedNames);
    const desktopInFiltered = filtered.find((a) => a.name === "claude-desktop");
    expect(desktopInFiltered).toBeUndefined();
    const codeInFiltered = filtered.find((a) => a.name === "claude-code");
    expect(codeInFiltered).toBeDefined();
  });
});

// Contributor-facing lint: the invariants documented at the top of
// src/core/agents.yaml MUST hold. A violation means the yaml file was edited
// in a way that the sync engines cannot reliably consume (e.g. agentsDirFormat
// without agentsDir would silently pass typecheck but break at runtime). The
// failure message names the exact rule so the contributor can fix it.
describe("agents.yaml consistency", () => {
  it("all shipped entries satisfy the invariants", () => {
    const yamlPath = join(import.meta.dirname, "agents.yaml");
    const entries = yaml.load(readFileSync(yamlPath, "utf-8")) as RawAgentEntry[];
    expect(findAgentYamlViolations(entries)).toEqual([]);
  });

  it("flags duplicate agent names", () => {
    const violations = findAgentYamlViolations([
      { name: "claude-code", skillsDir: "~/.claude/skills" },
      { name: "claude-code", skillsDir: "~/.claude/skills" },
    ]);
    expect(violations.some((v) => v.includes("duplicated"))).toBe(true);
  });

  it("flags agentsDirFormat without agentsDir", () => {
    const violations = findAgentYamlViolations([
      { name: "broken", skillsDir: "~/x/skills", agentsDirFormat: "subdir" },
    ]);
    expect(violations.some((v) => v.includes("agentsDirFormat"))).toBe(true);
  });

  it("flags commandTransform without commandsDir", () => {
    const violations = findAgentYamlViolations([
      { name: "broken", skillsDir: "~/x/skills", commandTransform: "cursor" },
    ]);
    expect(violations.some((v) => v.includes("commandTransform"))).toBe(true);
  });

  it("flags hooksKey without hooksFile", () => {
    const violations = findAgentYamlViolations([{ name: "broken", skillsDir: "~/x/skills", hooksKey: "hooks" }]);
    expect(violations.some((v) => v.includes("hooksKey"))).toBe(true);
  });

  it("flags more than one MCP access mode", () => {
    const violations = findAgentYamlViolations([
      {
        name: "broken",
        skillsDir: "~/x/skills",
        mcpConfig: "~/x/mcp.json",
        mcpConfigVscodeSettings: true,
      },
    ]);
    expect(violations.some((v) => v.includes("MCP access"))).toBe(true);
  });

  it("flags experimental agent with non-skills sync surface", () => {
    const violations = findAgentYamlViolations([
      {
        name: "broken",
        skillsDir: "~/x/skills",
        experimental: true,
        rulesFile: "~/x/rules.md",
      },
    ]);
    expect(violations.some((v) => v.includes("experimental"))).toBe(true);
  });

  it("flags readsFrom pointing at a name not defined in the file", () => {
    const violations = findAgentYamlViolations([
      { name: "ghost-reader", skillsDir: "~/x/skills", readsFrom: ["does-not-exist"] },
    ]);
    expect(violations.some((v) => v.includes("readsFrom"))).toBe(true);
  });

  it("flags invalid supportedSkillFeatures values", () => {
    const violations = findAgentYamlViolations([
      {
        name: "broken",
        skillsDir: "~/x/skills",
        supportedSkillFeatures: ["invented-feature"],
      },
    ]);
    expect(violations.some((v) => v.includes("supportedSkillFeatures"))).toBe(true);
  });

  it("flags non-kebab-case names", () => {
    const violations = findAgentYamlViolations([{ name: "CamelCase", skillsDir: "~/x/skills" }]);
    expect(violations.some((v) => v.includes("kebab-case"))).toBe(true);
  });
});

// Sourced from `agents-yaml-honor-env-overrides` (TASKS.md P2). The path
// resolver is the single source of truth for env-var-driven overrides; the
// audit at `docs/audits/harness-locate-cross-check.md` § "Env-var overrides
// agentbrew doesn't honor" enumerated the gap.
describe("resolveAgentYamlPath", () => {
  describe("CLAUDE_CONFIG_DIR override", () => {
    it("substitutes ~/.claude with an absolute env var value", () => {
      vi.stubEnv("CLAUDE_CONFIG_DIR", "/tmp/myclaude");
      expect(resolveAgentYamlPath("~/.claude/skills")).toBe("/tmp/myclaude/skills");
      expect(resolveAgentYamlPath("~/.claude/CLAUDE.md")).toBe("/tmp/myclaude/CLAUDE.md");
      expect(resolveAgentYamlPath("~/.claude/commands")).toBe("/tmp/myclaude/commands");
    });

    it("preserves the original path when the env var is unset", () => {
      vi.stubEnv("CLAUDE_CONFIG_DIR", "");
      expect(resolveAgentYamlPath("~/.claude/skills")).toBe("~/.claude/skills");
    });

    it("preserves the original path when the env var is a relative path (would silently produce a CWD-relative result downstream)", () => {
      vi.stubEnv("CLAUDE_CONFIG_DIR", "relative/path");
      expect(resolveAgentYamlPath("~/.claude/skills")).toBe("~/.claude/skills");
    });

    it("substitutes the bare `~/.claude` prefix as well as nested paths", () => {
      vi.stubEnv("CLAUDE_CONFIG_DIR", "/tmp/myclaude");
      expect(resolveAgentYamlPath("~/.claude")).toBe("/tmp/myclaude");
    });

    it("does not match unrelated `~/...` paths", () => {
      vi.stubEnv("CLAUDE_CONFIG_DIR", "/tmp/myclaude");
      expect(resolveAgentYamlPath("~/.cursor/rules")).toBe("~/.cursor/rules");
      expect(resolveAgentYamlPath("~/Library/Application Support/Claude/skills")).toBe(
        "~/Library/Application Support/Claude/skills",
      );
    });
  });

  describe("XDG_CONFIG_HOME override", () => {
    it("substitutes ~/.copilot with $XDG_CONFIG_HOME/copilot", () => {
      vi.stubEnv("XDG_CONFIG_HOME", "/tmp/xdg");
      expect(resolveAgentYamlPath("~/.copilot/skills")).toBe("/tmp/xdg/copilot/skills");
    });

    it("preserves the original path when the env var is unset", () => {
      vi.stubEnv("XDG_CONFIG_HOME", "");
      expect(resolveAgentYamlPath("~/.copilot/skills")).toBe("~/.copilot/skills");
    });

    it("preserves the original path when the env var is a relative path", () => {
      vi.stubEnv("XDG_CONFIG_HOME", "relative/xdg");
      expect(resolveAgentYamlPath("~/.copilot/skills")).toBe("~/.copilot/skills");
    });
  });

  it("preserves arbitrary `~/...` paths that don't match any override", () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/tmp/myclaude");
    vi.stubEnv("XDG_CONFIG_HOME", "/tmp/xdg");
    expect(resolveAgentYamlPath("~/.config/devin/skills")).toBe("~/.config/devin/skills");
    expect(resolveAgentYamlPath("~/.cursor/rules")).toBe("~/.cursor/rules");
  });

  it("preserves absolute paths unchanged", () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/tmp/myclaude");
    expect(resolveAgentYamlPath("/usr/local/share/claude/skills")).toBe("/usr/local/share/claude/skills");
  });
});

// Confirms the override is wired through `loadAgentDefinitions` for every
// path field in agents.yaml that uses the matching prefix — a regression
// test against new fields being added later but not plumbed through.
describe("loadAgentDefinitions with env-var overrides", () => {
  it("rewrites all ~/.claude/ paths for claude-code when CLAUDE_CONFIG_DIR is set", () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/tmp/myclaude");
    resetAgentDefinitionsCache();
    const claude = loadAgentDefinitions().find((d) => d.name === "claude-code");
    expect(claude).toBeDefined();
    expect(claude?.skillsDir).toBe("/tmp/myclaude/skills");
    expect(claude?.rulesFile).toBe("/tmp/myclaude/CLAUDE.md");
    expect(claude?.commandsDir).toBe("/tmp/myclaude/commands");
    expect(claude?.agentsDir).toBe("/tmp/myclaude/agents");
    expect(claude?.hooksFile).toBe("/tmp/myclaude/settings.json");
    // mcpConfig (~/.claude.json) is at the home dir, NOT under ~/.claude/ —
    // it stays unchanged. Documenting this here so a future "broaden the
    // match" diff has to update this test, which forces a re-think.
    expect(claude?.mcpConfig).toBe("~/.claude.json");
  });

  it("rewrites ~/.claude/ paths for claude-desktop's shared rules/commands/agents fields", () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/tmp/myclaude");
    resetAgentDefinitionsCache();
    const desktop = loadAgentDefinitions().find((d) => d.name === "claude-desktop");
    expect(desktop).toBeDefined();
    // claude-desktop's skillsDir is under ~/Library/, NOT ~/.claude/, so it
    // is NOT affected by the override. The audit's intent is to honor
    // Claude Code's documented config-directory; claude-desktop's macOS
    // app-data path is a different concern.
    expect(desktop?.skillsDir).toBe("~/Library/Application Support/Claude/skills");
    expect(desktop?.rulesFile).toBe("/tmp/myclaude/CLAUDE.md");
    expect(desktop?.commandsDir).toBe("/tmp/myclaude/commands");
    expect(desktop?.agentsDir).toBe("/tmp/myclaude/agents");
  });

  it("rewrites ~/.copilot/ paths when XDG_CONFIG_HOME is set", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "/tmp/xdg");
    resetAgentDefinitionsCache();
    const copilot = loadAgentDefinitions().find((d) => d.name === "copilot");
    expect(copilot).toBeDefined();
    expect(copilot?.skillsDir).toBe("/tmp/xdg/copilot/skills");
  });

  it("leaves all paths unchanged when no override env vars are set", () => {
    resetAgentDefinitionsCache();
    const claude = loadAgentDefinitions().find((d) => d.name === "claude-code");
    expect(claude?.skillsDir).toBe("~/.claude/skills");
    expect(claude?.rulesFile).toBe("~/.claude/CLAUDE.md");
    const copilot = loadAgentDefinitions().find((d) => d.name === "copilot");
    expect(copilot?.skillsDir).toBe("~/.copilot/skills");
  });
});
