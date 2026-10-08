import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it, vi } from "vitest";
import { AGENT_DEFINITIONS } from "./types.js";

vi.mock("./state.js", () => ({
  loadState: () => ({ agents: [], team: undefined }),
}));

describe("AGENT_DEFINITIONS", () => {
  it("defines one entry per agents.yaml row", () => {
    const yamlPath = join(import.meta.dirname, "core", "agents.yaml");
    const yamlEntries = yaml.load(readFileSync(yamlPath, "utf-8"));
    expect(Array.isArray(yamlEntries)).toBe(true);
    expect(AGENT_DEFINITIONS).toHaveLength((yamlEntries as unknown[]).length);
  });

  it("includes all expected agent names", () => {
    const names = AGENT_DEFINITIONS.map((a) => a.name);
    expect(names).toContain("claude-code");
    expect(names).toContain("cursor");
    expect(names).toContain("augment");
    expect(names).toContain("codex");
    expect(names).toContain("gemini-cli");
    expect(names).toContain("copilot");
    expect(names).toContain("opencode");
    expect(names).toContain("kiro");
    expect(names).toContain("amp");
    expect(names).toContain("goose");
    expect(names).toContain("cline");
    expect(names).toContain("roo-code");
    expect(names).toContain("trae");
    expect(names).toContain("junie");
    expect(names).toContain("continue");
    expect(names).toContain("warp");
    expect(names).toContain("antigravity");
    expect(names).toContain("qwen-code");
    expect(names).toContain("openhands");
    expect(names).toContain("kilo");
    expect(names).toContain("droid");
    expect(names).toContain("openclaw");
    expect(names).toContain("pi");
    expect(names).toContain("crush");
    expect(names).toContain("kode");
    expect(names).toContain("qoder");
    expect(names).toContain("zencoder");
    expect(names).toContain("cortex");
    expect(names).toContain("mistral-vibe");
    expect(names).toContain("mux");
    expect(names).toContain("codebuddy");
    expect(names).toContain("kimi-cli");
    expect(names).toContain("replit");
    expect(names).toContain("universal");
    expect(names).toContain("command-code");
    expect(names).toContain("iflow-cli");
    expect(names).toContain("mcpjam");
    expect(names).toContain("trae-cn");
    expect(names).toContain("neovate");
    expect(names).toContain("pochi");
    expect(names).toContain("adal");
    expect(names).toContain("aider-desk");
    expect(names).toContain("bob");
    expect(names).toContain("codearts-agent");
    expect(names).toContain("codemaker");
    expect(names).toContain("codestudio");
    expect(names).toContain("deepagents");
    expect(names).toContain("dexto");
    expect(names).toContain("firebender");
    expect(names).toContain("forgecode");
    expect(names).toContain("rovodev");
    expect(names).toContain("tabnine-cli");
    expect(names).toContain("qodo");
  });

  it("claude-code has MCP config and rules file", () => {
    const claude = AGENT_DEFINITIONS.find((a) => a.name === "claude-code");
    expect(claude?.mcpConfig).toBe("~/.claude.json");
    expect(claude?.mcpPermissionsConfig?.file).toBe("~/.claude/settings.json");
    expect(claude?.rulesFile).toBe("~/.claude/CLAUDE.md");
    expect(claude?.skillsDir).toBe("~/.claude/skills");
  });

  it("kiro has MCP config", () => {
    const kiro = AGENT_DEFINITIONS.find((a) => a.name === "kiro");
    expect(kiro?.mcpConfig).toBe("~/.kiro/settings/mcp.json");
    expect(kiro?.skillsDir).toBe("~/.kiro/skills");
  });

  it("opencode has MCP config with custom key", () => {
    const opencode = AGENT_DEFINITIONS.find((a) => a.name === "opencode");
    expect(opencode?.mcpConfig).toBe("~/.config/opencode/opencode.json");
    expect(opencode?.mcpKey).toBe("mcp");
  });

  it("amp has MCP config with custom key", () => {
    const amp = AGENT_DEFINITIONS.find((a) => a.name === "amp");
    expect(amp?.mcpConfig).toBe("~/.config/amp/settings.json");
    expect(amp?.mcpKey).toBe("amp.mcpServers");
  });

  it("agents without MCP have undefined mcpConfig", () => {
    const augment = AGENT_DEFINITIONS.find((a) => a.name === "augment");
    expect(augment?.mcpConfig).toBeUndefined();
  });

  it("copilot has MCP config pointing to VS Code settings.json", () => {
    const copilot = AGENT_DEFINITIONS.find((a) => a.name === "copilot");
    expect(copilot?.mcpConfig).toContain("settings.json");
  });

  it("codex has TOML MCP config", () => {
    const codex = AGENT_DEFINITIONS.find((a) => a.name === "codex");
    expect(codex?.mcpConfig).toBe("~/.codex/config.toml");
    expect(codex?.mcpFormat).toBe("toml");
    expect(codex?.mcpKey).toBe("mcp_servers");
  });

  it("opencode has commands", () => {
    const opencode = AGENT_DEFINITIONS.find((a) => a.name === "opencode");
    expect(opencode?.commandsDir).toBe("~/.config/opencode/commands");
  });

  it("goose has YAML MCP config", () => {
    const goose = AGENT_DEFINITIONS.find((a) => a.name === "goose");
    expect(goose?.mcpConfig).toBe("~/.config/goose/config.yaml");
    expect(goose?.mcpKey).toBe("extensions");
    expect(goose?.mcpFormat).toBe("yaml");
  });

  it("cline has VS Code extension MCP config", () => {
    const cline = AGENT_DEFINITIONS.find((a) => a.name === "cline");
    expect(cline?.mcpConfig).toContain("saoudrizwan.claude-dev");
    expect(cline?.mcpConfig).toContain("cline_mcp_settings.json");
  });

  it("roo-code has VS Code extension MCP config", () => {
    const roo = AGENT_DEFINITIONS.find((a) => a.name === "roo-code");
    expect(roo?.mcpConfig).toContain("rooveterinaryinc.roo-cline");
    expect(roo?.mcpConfig).toContain("cline_mcp_settings.json");
  });

  it("agents without rules have undefined rulesFile", () => {
    const cursor = AGENT_DEFINITIONS.find((a) => a.name === "cursor");
    expect(cursor?.rulesFile).toBeUndefined();

    const kiro = AGENT_DEFINITIONS.find((a) => a.name === "kiro");
    expect(kiro?.rulesFile).toBeUndefined();
  });

  it("gemini-cli has rulesFile", () => {
    const gemini = AGENT_DEFINITIONS.find((a) => a.name === "gemini-cli");
    expect(gemini?.rulesFile).toBe("~/.gemini/GEMINI.md");
  });

  it("all agents have skillsDir", () => {
    for (const agent of AGENT_DEFINITIONS) {
      expect(agent.skillsDir).toBeDefined();
      expect(agent.skillsDir).toContain("skills");
    }
  });

  it("cursor keeps commandTransform after delegation strips frontmatter", () => {
    const cursor = AGENT_DEFINITIONS.find((a) => a.name === "cursor");
    expect(cursor?.commandTransform?.("---\ndescription: Run\n---\n\n# Run")).toBe("\n# Run");
  });

  it("cursor declares Cursor CLI MCP permissions config", () => {
    const cursor = AGENT_DEFINITIONS.find((a) => a.name === "cursor");
    expect(cursor?.mcpPermissionsConfig?.file).toBe("~/.cursor/cli-config.json");
  });

  it("claude-code has no commandTransform (identity)", () => {
    const claude = AGENT_DEFINITIONS.find((a) => a.name === "claude-code");
    expect(claude?.commandTransform).toBeUndefined();
  });

  it("commandTransform is the ONLY function-typed field on any agent definition", () => {
    for (const agent of AGENT_DEFINITIONS) {
      for (const [key, value] of Object.entries(agent)) {
        if (typeof value === "function") {
          expect(key).toBe("commandTransform");
        }
      }
    }
  });

  it("AGENT_DEFINITIONS without commandTransform are safe for yaml.dump", () => {
    const safe = AGENT_DEFINITIONS.filter((a) => !a.commandTransform);
    expect(safe.length).toBeGreaterThan(0);
    expect(() => yaml.dump(safe)).not.toThrow();
  });

  it("AGENT_DEFINITIONS with commandTransform crash yaml.dump (proves the risk)", () => {
    const unsafe = AGENT_DEFINITIONS.filter((a) => a.commandTransform);
    expect(unsafe.length).toBeGreaterThan(0);
    expect(() => yaml.dump(unsafe)).toThrow(/unacceptable kind of an object to dump/);
  });

  it("JSON.parse(JSON.stringify()) strips all functions from AGENT_DEFINITIONS", () => {
    const sanitized = JSON.parse(JSON.stringify(AGENT_DEFINITIONS));
    for (const agent of sanitized) {
      for (const value of Object.values(agent)) {
        expect(typeof value).not.toBe("function");
      }
    }
    // Verify data survived
    expect(sanitized.length).toBe(AGENT_DEFINITIONS.length);
    const names = sanitized.map((a: Record<string, unknown>) => a.name);
    expect(names).toContain("cursor");
    expect(names).toContain("claude-code");
  });

  it("only cursor and gemini-cli have commandTransform after command delegation", () => {
    const withTransform = AGENT_DEFINITIONS.filter((a) => a.commandTransform).map((a) => a.name);
    expect(withTransform).toEqual(expect.arrayContaining(["cursor", "gemini-cli"]));
    expect(withTransform).toHaveLength(2);
  });
});
