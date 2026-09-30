import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sync/instructions-sync.js", () => ({
  getInstructionsSourcePath: vi.fn(),
}));

vi.mock("./sync/skills-sync.js", () => ({
  getSkillSources: vi.fn(),
}));

vi.mock("./state.js", () => ({
  loadState: vi.fn(() => undefined),
  getStatePath: vi.fn(() => "/nonexistent/state.yaml"),
}));

vi.mock("./utils.js", () => ({
  expandHome: vi.fn((p: string) => p),
}));

vi.mock("./types.js", () => ({
  AGENT_DEFINITIONS: [],
}));

vi.mock("./mcp/adapters.js", () => ({
  getAdapter: vi.fn(() => ({
    readEntries: vi.fn(() => ({})),
  })),
}));

import { lint, validateConfig } from "./lint.js";
import { getAdapter } from "./mcp/adapters.js";
import { getStatePath, loadState } from "./state.js";
import { getInstructionsSourcePath } from "./sync/instructions-sync.js";
import { getSkillSources } from "./sync/skills-sync.js";
import type { AgentConfig, McpFormatAdapter } from "./types.js";
import { AGENT_DEFINITIONS } from "./types.js";
import { expandHome } from "./utils.js";

let testDir: string;
let mockHome: string;

function bigSharedRules(sections: number): string {
  return Array.from({ length: sections }, (_, s) => {
    const body = Array.from({ length: 80 }, (_, i) => `s${s}-${i} ${"x".repeat(42)}`).join("\n");
    return `## Section ${s}\n${body}`;
  }).join("\n\n");
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  testDir = join(tmpdir(), `lint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mockHome = join(testDir, "mock-home");
  mkdirSync(testDir, { recursive: true });
  mkdirSync(mockHome, { recursive: true });

  process.env.AGENTBREW_DIR = join(testDir, "agentbrew-repo");

  // expandHome: replace ~ prefix with unique per-test mockHome
  vi.mocked(expandHome).mockImplementation((p: string) => p.replace(/^~/, mockHome));

  vi.mocked(getSkillSources).mockReturnValue([]);
  vi.mocked(loadState).mockReturnValue(undefined);
  vi.mocked(getStatePath).mockReturnValue("/nonexistent/state.yaml");
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("lint", () => {
  it("returns true when all config is valid", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const result = lint();

    expect(result).toBe(true);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("All config valid");
  });

  it("returns false when AGENTS.md is missing", () => {
    vi.mocked(getInstructionsSourcePath).mockReturnValue(join(testDir, "nonexistent.md"));

    const result = lint();

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("not found");
  });

  it("shows skill source status", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const sourcePath = join(testDir, "skills");
    mkdirSync(sourcePath, { recursive: true });

    vi.mocked(getSkillSources).mockReturnValue([
      { label: "test-source", path: sourcePath, scanner: () => ["/a", "/b"] },
    ]);

    const result = lint();

    expect(result).toBe(true);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("test-source");
    expect(calls).toContain("2 skills");
  });

  it("validates catalog.yaml if present", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const srcDir = join(testDir, "agentbrew-repo", "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "catalog.yaml"), "skills:\n  - name: test\n");

    const result = lint();

    expect(result).toBe(true);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("catalog.yaml");
  });

  it("validates state.yaml structure", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const stateFile = join(testDir, "state.yaml");
    writeFileSync(stateFile, "dummy");
    vi.mocked(getStatePath).mockReturnValue(stateFile);
    vi.mocked(loadState).mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [{ name: "test", command: "echo", args: [], env: {}, source: "user" }],
      catalogVersion: "0.1.0",
    });

    const result = lint();

    expect(result).toBe(true);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("state.yaml");
    expect(calls).toContain("1 MCP servers");
  });

  it("does not warn for parser-supported Agentfile keys", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);
    writeFileSync(
      join(testDir, "Agentfile.yaml"),
      [
        "mcp:",
        "  - context7",
        "skills:",
        "  - debug",
        "sources:",
        "  - ./skills",
        "commands:",
        "  - ./commands",
        "agents:",
        "  - ./agents",
        "rules: ./rules.md",
        "hooks:",
        "  - event: PreToolUse",
        "    command: echo ok",
        "recommended: true",
      ].join("\n"),
    );

    const origCwd = process.cwd();
    process.chdir(testDir);
    try {
      const result = lint();
      const output = [
        ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
        ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
      ]
        .flat()
        .join(" ");

      expect(result).toBe(true);
      expect(output).toContain("Agentfile.yaml");
      expect(output).not.toContain("unknown keys");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("reports error for invalid state.yaml", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const stateFile = join(testDir, "state.yaml");
    writeFileSync(stateFile, "dummy");
    vi.mocked(getStatePath).mockReturnValue(stateFile);
    vi.mocked(loadState).mockReturnValue(null as unknown as ReturnType<typeof loadState>);

    const result = lint();

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("failed to parse");
  });

  it("reports warnings and errors summary", () => {
    vi.mocked(getInstructionsSourcePath).mockReturnValue(join(testDir, "nonexistent.md"));

    const result = lint();

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("error(s)");
  });

  it("reports warnings-only summary when shared-rules.md is empty", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const sharedRulesDir = join(mockHome, ".config", "agentbrew");
    mkdirSync(sharedRulesDir, { recursive: true });
    writeFileSync(join(sharedRulesDir, "shared-rules.md"), "   ");

    const result = lint();

    expect(result).toBe(true);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("warning(s), no errors");
  });

  it("shows shared-rules.md line count when non-empty", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const sharedRulesDir = join(mockHome, ".config", "agentbrew");
    mkdirSync(sharedRulesDir, { recursive: true });
    writeFileSync(join(sharedRulesDir, "shared-rules.md"), "line one\nline two\nline three");

    const result = lint();

    expect(result).toBe(true);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("shared-rules.md");
    expect(calls).toContain("lines");
  });

  it("reports duplicate shared-rules ## headings with both line numbers", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const sharedRulesDir = join(mockHome, ".config", "agentbrew");
    mkdirSync(sharedRulesDir, { recursive: true });
    writeFileSync(
      join(sharedRulesDir, "shared-rules.md"),
      ["# Shared rules", "", "## Jira Foo", "First", "", "## Other", "ok", "", "## Jira Foo", "Second"].join("\n"),
    );

    const result = lint();

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("duplicate ## heading");
    expect(calls).toContain("Jira Foo");
    expect(calls).toContain("lines 3, 9");
    expect(calls).toContain("merge into line 3");
  });

  it("reports repeated shared-rules subsection markers within one parent section", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const sharedRulesDir = join(mockHome, ".config", "agentbrew");
    mkdirSync(sharedRulesDir, { recursive: true });
    writeFileSync(
      join(sharedRulesDir, "shared-rules.md"),
      [
        "## Jira Audit Hygiene",
        "── Scope discipline ──",
        "Body",
        "── Inline planning ──",
        "Body",
        "── Scope discipline ──",
      ].join("\n"),
    );

    const result = lint();

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("repeated subsection marker");
    expect(calls).toContain("Scope discipline");
    expect(calls).toContain("Jira Audit Hygiene");
    expect(calls).toContain("lines 2, 6");
  });

  it("reports shared-rules sections over the token budget", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const sharedRulesDir = join(mockHome, ".config", "agentbrew");
    mkdirSync(sharedRulesDir, { recursive: true });
    writeFileSync(join(sharedRulesDir, "shared-rules.md"), `## Huge Section\n${"token ".repeat(5001)}`);

    const result = lint();

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("section over token budget");
    expect(calls).toContain("Huge Section");
    expect(calls).toContain("5001 tokens");
  });

  it("reports an error when the projected deployed rules file exceeds the 40k char budget", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions\nshort");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const sharedRulesDir = join(mockHome, ".config", "agentbrew");
    mkdirSync(sharedRulesDir, { recursive: true });
    const content = bigSharedRules(11);
    expect(content.length).toBeGreaterThan(40_000);
    writeFileSync(join(sharedRulesDir, "shared-rules.md"), content);

    const result = lint();

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("deployed rules file projected at");
    expect(calls).toContain("char budget");
  });

  it("warns (no error) when the projected deployed rules file is between 32k and 40k chars", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions\nshort");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const sharedRulesDir = join(mockHome, ".config", "agentbrew");
    mkdirSync(sharedRulesDir, { recursive: true });
    const content = bigSharedRules(9);
    expect(content.length).toBeGreaterThan(32_000);
    expect(content.length).toBeLessThan(39_000);
    writeFileSync(join(sharedRulesDir, "shared-rules.md"), content);

    const result = lint();

    expect(result).toBe(true);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("soft target");
  });

  it("reports error when shared-rules.md exists but is unreadable", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const sharedRulesDir = join(mockHome, ".config", "agentbrew");
    mkdirSync(sharedRulesDir, { recursive: true });
    const sharedRulesPath = join(sharedRulesDir, "shared-rules.md");
    writeFileSync(sharedRulesPath, "content");
    chmodSync(sharedRulesPath, 0o000);

    const result = lint();

    // Restore permissions so afterEach cleanup can remove it
    chmodSync(sharedRulesPath, 0o644);

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("unreadable");
  });

  it("shows commands section when commands dir exists with valid files", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const commandsDir = join(mockHome, ".config", "agentbrew", "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, "deploy.md"), "# Deploy");
    writeFileSync(join(commandsDir, "test.md"), "# Test");

    const result = lint();

    expect(result).toBe(true);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("2 command(s)");
  });

  it("reports warning when a command file is empty", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const commandsDir = join(mockHome, ".config", "agentbrew", "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, "empty.md"), "   ");

    const result = lint();

    expect(result).toBe(true);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("empty");
  });

  it("reports error when commands dir is unreadable", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const commandsDir = join(mockHome, ".config", "agentbrew", "commands");
    mkdirSync(commandsDir, { recursive: true });
    chmodSync(commandsDir, 0o000);

    const result = lint();

    // Restore permissions so afterEach cleanup can remove it
    chmodSync(commandsDir, 0o755);

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("commands dir");
  });

  it("reports error when MCP adapter fails to read a config file", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const mcpConfigPath = join(mockHome, ".config", "test-agent", "mcp.json");
    mkdirSync(join(mockHome, ".config", "test-agent"), { recursive: true });
    writeFileSync(mcpConfigPath, "{}");

    const fakeAgent = {
      name: "test-agent",
      detected: false,
      skillsDir: "",
      mcpConfig: mcpConfigPath,
      mcpKey: "mcpServers",
    } satisfies AgentConfig;

    (AGENT_DEFINITIONS as AgentConfig[]).push(fakeAgent);

    vi.mocked(getAdapter).mockReturnValue({
      readEntries: vi.fn(() => {
        throw new Error("parse failure");
      }),
    } as unknown as McpFormatAdapter);

    const result = lint();

    // Clean up the pushed agent
    (AGENT_DEFINITIONS as AgentConfig[]).pop();

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("parse failure");
  });

  it("shows 'not found' for skill source whose path does not exist", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    vi.mocked(getSkillSources).mockReturnValue([
      { label: "missing-source", path: join(testDir, "nonexistent-skills"), scanner: () => [] },
    ]);

    const result = lint();

    expect(result).toBe(true);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("missing-source");
    expect(calls).toContain("not found");
  });

  it("reports error when catalog.yaml contains invalid YAML (lines 37-40)", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const srcDir = join(testDir, "agentbrew-repo", "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "catalog.yaml"), "skills: [\nnot valid yaml {{{{");

    const result = lint();

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("invalid YAML");
  });

  it("reports error when a recommended catalog MCP lacks smokeCall", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const srcDir = join(testDir, "agentbrew-repo", "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "catalog.yaml"),
      [
        "skills: []",
        "rules: []",
        "mcp_servers:",
        "  - name: missing-smoke",
        "    description: Missing smoke",
        "    command: npx",
        "    category: docs",
        "    recommended: true",
      ].join("\n"),
    );

    const result = lint();

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("missing-smoke");
    expect(calls).toContain("smokeCall");
  });

  it("passes when a recommended catalog MCP keeps smokeCall with fast scheduler probe", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const srcDir = join(testDir, "agentbrew-repo", "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "catalog.yaml"),
      [
        "skills: []",
        "rules: []",
        "mcp_servers:",
        "  - name: browser-smoke",
        "    description: Browser smoke",
        "    command: npx",
        "    category: browser",
        "    recommended: true",
        "    smokeCall:",
        "      tool: list_pages",
        "    probe: fast",
      ].join("\n"),
    );

    const result = lint();

    expect(result).toBe(true);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("catalog MCP smokeCall metadata");
  });

  it("reports error when state.yaml has structural issues (lines 63-64)", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const stateFile = join(testDir, "state.yaml");
    writeFileSync(stateFile, "dummy");
    vi.mocked(getStatePath).mockReturnValue(stateFile);
    // Return a state where agents is not an array — triggers stateErrors branch
    vi.mocked(loadState).mockReturnValue({
      agents: "not-an-array" as unknown as AgentConfig[],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    const result = lint();

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("agents must be an array");
  });

  it("reports error when a command file is unreadable (lines 126-127)", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const commandsDir = join(mockHome, ".config", "agentbrew", "commands");
    mkdirSync(commandsDir, { recursive: true });
    const commandFile = join(commandsDir, "locked.md");
    writeFileSync(commandFile, "# Locked");
    chmodSync(commandFile, 0o000);

    const result = lint();

    // Restore permissions so afterEach cleanup can remove the file
    chmodSync(commandFile, 0o644);

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("unreadable");
  });

  it("reports error when state.yaml has hardcoded secrets", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const stateFile = join(testDir, "state.yaml");
    writeFileSync(stateFile, "dummy");
    vi.mocked(getStatePath).mockReturnValue(stateFile);
    vi.mocked(loadState).mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [
        {
          name: "my-server",
          command: "echo",
          args: [],
          env: { GITHUB_TOKEN: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij" },
          source: "user",
        },
      ],
      catalogVersion: "0.1.0",
    });

    const result = lint();

    expect(result).toBe(false);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("GitHub PAT");
    expect(calls).toContain("my-server");
    expect(calls).toContain("placeholder");
  });

  it("reports no secret errors when env values use placeholders", () => {
    const agentsMdPath = join(testDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "# Instructions");
    vi.mocked(getInstructionsSourcePath).mockReturnValue(agentsMdPath);

    const stateFile = join(testDir, "state.yaml");
    writeFileSync(stateFile, "dummy");
    vi.mocked(getStatePath).mockReturnValue(stateFile);
    vi.mocked(loadState).mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [
        {
          name: "clean-server",
          command: "echo",
          args: [],
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
          source: "user",
        },
      ],
      catalogVersion: "0.1.0",
    });

    const result = lint();

    expect(result).toBe(true);
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("no hardcoded secrets detected");
  });
});

describe("validateConfig", () => {
  it("returns zero errors and warnings when no config files exist", () => {
    const result = validateConfig();
    expect(result.errors).toBe(0);
    expect(result.warnings).toBe(0);
    expect(result.details).toEqual([]);
  });

  it("returns error when state.yaml fails to parse", () => {
    const stateFile = join(testDir, "state.yaml");
    writeFileSync(stateFile, "dummy");
    vi.mocked(getStatePath).mockReturnValue(stateFile);
    vi.mocked(loadState).mockReturnValue(null as unknown as ReturnType<typeof loadState>);

    const result = validateConfig();

    expect(result.errors).toBe(1);
    expect(result.details).toContain("state.yaml failed to parse");
  });

  it("returns error when a recommended catalog MCP lacks smokeCall", () => {
    const srcDir = join(testDir, "agentbrew-repo", "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "catalog.yaml"),
      [
        "skills: []",
        "rules: []",
        "mcp_servers:",
        "  - name: missing-smoke",
        "    description: Missing smoke",
        "    command: npx",
        "    category: docs",
        "    recommended: true",
      ].join("\n"),
    );

    const result = validateConfig();

    expect(result.errors).toBe(1);
    expect(result.details[0]).toContain("missing-smoke");
    expect(result.details[0]).toContain("smokeCall");
  });

  // A suppression already records that this server's probe cannot pass, so the
  // deep smoke tool it would call is unreachable by construction.
  it("accepts a recommended catalog MCP that documents why probing cannot pass", () => {
    const srcDir = join(testDir, "agentbrew-repo", "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "catalog.yaml"),
      [
        "skills: []",
        "rules: []",
        "mcp_servers:",
        "  - name: oauth-remote",
        "    description: Remote MCP with per-client OAuth",
        "    url: https://example.test/mcp",
        "    category: design",
        "    recommended: true",
        "    probeSuppression:",
        "      statuses: [init_error]",
        "      reason: per-client OAuth; the probe is unauthenticated by design",
        "      retryPolicy: probe-every-tick-no-heal-until-catalog-change",
      ].join("\n"),
    );

    const result = validateConfig();

    expect(result.details.filter((d) => d.includes("smokeCall"))).toEqual([]);
  });

  it("still demands smokeCall when the suppression has no reason", () => {
    const srcDir = join(testDir, "agentbrew-repo", "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "catalog.yaml"),
      [
        "skills: []",
        "rules: []",
        "mcp_servers:",
        "  - name: bare-suppression",
        "    description: Suppression with no rationale",
        "    url: https://example.test/mcp",
        "    category: design",
        "    recommended: true",
        "    probeSuppression:",
        "      statuses: [init_error]",
      ].join("\n"),
    );

    const result = validateConfig();

    expect(result.details.some((d) => d.includes("bare-suppression") && d.includes("smokeCall"))).toBe(true);
  });

  it("returns warning when Agentfile has unknown keys", () => {
    const agentfilePath = join(testDir, "Agentfile.yaml");
    writeFileSync(agentfilePath, "mcp:\n  - context7\ncustomField: true\n");

    const origCwd = process.cwd();
    process.chdir(testDir);
    try {
      const result = validateConfig();
      expect(result.warnings).toBe(1);
      expect(result.details.some((d) => d.includes("unknown keys"))).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("returns no warning when Agentfile has only known keys", () => {
    const agentfilePath = join(testDir, "Agentfile.yaml");
    writeFileSync(
      agentfilePath,
      [
        "mcp:",
        "  - context7",
        "skills:",
        "  - debug",
        "sources:",
        "  - ./skills",
        "commands:",
        "  - ./commands",
        "agents:",
        "  - ./agents",
        "rules: ./rules.md",
        "hooks:",
        "  - event: PreToolUse",
        "    command: echo ok",
        "recommended: true",
      ].join("\n"),
    );

    const origCwd = process.cwd();
    process.chdir(testDir);
    try {
      const result = validateConfig();
      expect(result.warnings).toBe(0);
      expect(result.errors).toBe(0);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("returns error when state.yaml has hardcoded secrets", () => {
    const stateFile = join(testDir, "state.yaml");
    writeFileSync(stateFile, "dummy");
    vi.mocked(getStatePath).mockReturnValue(stateFile);
    vi.mocked(loadState).mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [
        {
          name: "leaky",
          command: "echo",
          args: [],
          env: { GITHUB_TOKEN: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij" },
          source: "user",
        },
      ],
      catalogVersion: "0.1.0",
    });

    const result = validateConfig();

    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(result.details.some((d) => d.includes("GitHub PAT"))).toBe(true);
  });
});
