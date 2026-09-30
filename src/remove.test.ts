import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("./state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, saveState: vi.fn(), getStatePath: vi.fn(() => "/tmp/state.yaml") };
});

vi.mock("./sync/mcp-sync.js", () => ({
  removeMcpServer: vi.fn(),
}));

vi.mock("./add-source.js", () => ({
  removeSource: vi.fn(),
}));

vi.mock("./agentfile.js", () => ({
  getConfigServers: vi.fn(() => []),
  getStateSources: vi.fn(() => []),
}));

vi.mock("./clean.js", () => ({
  clean: vi.fn(),
  detectItemTypes: vi.fn(() => []),
}));

vi.mock("./suggest.js", () => ({
  formatSuggestion: vi.fn(() => undefined),
}));

vi.mock("./catalog/types.js", () => ({
  loadCatalog: vi.fn(() => ({ skills: [], mcp_servers: [], rules: [], cli_tools: [] })),
}));

vi.mock("./catalog/install-other.js", () => ({
  removeRuleFromSharedRules: vi.fn(() => "removed"),
}));

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
}));

import { ExitPromptError } from "@inquirer/core";
import { confirm } from "@inquirer/prompts";
import { removeSource } from "./add-source.js";
import { getConfigServers, getStateSources } from "./agentfile.js";
import { removeRuleFromSharedRules } from "./catalog/install-other.js";
import { loadCatalog } from "./catalog/types.js";
import { clean, detectItemTypes } from "./clean.js";
import { remove } from "./remove.js";
import { loadState } from "./state.js";
import { removeMcpServer } from "./sync/mcp-sync.js";

import type { AgentBrewState } from "./types.js";

const mockLoadState = vi.mocked(loadState);
const mockRemoveMcpServer = vi.mocked(removeMcpServer);
const mockRemoveSource = vi.mocked(removeSource);
const mockConfirm = vi.mocked(confirm);
const mockClean = vi.mocked(clean);
const mockDetectItemTypes = vi.mocked(detectItemTypes);
const mockGetConfigServers = vi.mocked(getConfigServers);
const mockGetStateSources = vi.mocked(getStateSources);
const mockLoadCatalog = vi.mocked(loadCatalog);
const mockRemoveRuleFromSharedRules = vi.mocked(removeRuleFromSharedRules);

function makeState(overrides?: Partial<AgentBrewState>): AgentBrewState {
  return {
    agents: [],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockConfirm.mockResolvedValue(true);
  // vi.clearAllMocks does not reset mockReturnValue — explicitly restore per-test
  // defaults so state doesn't leak across tests (e.g. a prior test setting
  // detectItemTypes to ["skill"] would otherwise shadow the rule auto-detect).
  mockDetectItemTypes.mockReturnValue([]);
  mockGetConfigServers.mockReturnValue([]);
  mockGetStateSources.mockReturnValue([]);
  mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [], rules: [], cli_tools: [] });
  mockRemoveRuleFromSharedRules.mockReturnValue("removed");
});

describe("remove", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await remove("anything");
    expect(mockRemoveMcpServer).not.toHaveBeenCalled();
    expect(mockRemoveSource).not.toHaveBeenCalled();
  });

  it("removes an MCP server by name when confirmed", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockGetConfigServers.mockReturnValue([{ name: "my-server", command: "npx", args: [], env: {}, source: "user" }]);
    await remove("my-server");
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ default: false }));
    expect(mockRemoveMcpServer).toHaveBeenCalledWith("my-server");
    expect(mockRemoveSource).not.toHaveBeenCalled();
  });

  it("does not remove when user declines confirmation", async () => {
    mockConfirm.mockResolvedValue(false);
    mockLoadState.mockReturnValue(makeState());
    mockGetConfigServers.mockReturnValue([{ name: "my-server", command: "npx", args: [], env: {}, source: "user" }]);
    await remove("my-server");
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockRemoveMcpServer).not.toHaveBeenCalled();
  });

  it("skips confirmation when --yes is passed", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockGetConfigServers.mockReturnValue([{ name: "my-server", command: "npx", args: [], env: {}, source: "user" }]);
    await remove("my-server", { yes: true });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockRemoveMcpServer).toHaveBeenCalledWith("my-server");
  });

  it("cancels gracefully on Ctrl+C (ExitPromptError)", async () => {
    mockConfirm.mockRejectedValue(new ExitPromptError());
    mockLoadState.mockReturnValue(makeState());
    mockGetConfigServers.mockReturnValue([{ name: "my-server", command: "npx", args: [], env: {}, source: "user" }]);
    await remove("my-server");
    expect(mockRemoveMcpServer).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Cancelled"));
  });

  it("re-throws non-ExitPromptError from confirm", async () => {
    mockConfirm.mockRejectedValue(new Error("unexpected"));
    mockLoadState.mockReturnValue(makeState());
    mockGetConfigServers.mockReturnValue([{ name: "my-server", command: "npx", args: [], env: {}, source: "user" }]);
    await expect(remove("my-server")).rejects.toThrow("unexpected");
  });

  it("removes a source by URL", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockGetStateSources.mockReturnValue([
      { url: "user/repo", type: "github", skillsInstalled: [], availableItems: [], addedAt: "" },
    ] as never);
    await remove("user/repo");
    expect(mockRemoveSource).toHaveBeenCalledWith("user/repo");
    expect(mockRemoveMcpServer).not.toHaveBeenCalled();
  });

  it("prefers MCP server when name matches both", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockGetConfigServers.mockReturnValue([{ name: "ambiguous", command: "npx", args: [], env: {}, source: "user" }]);
    mockGetStateSources.mockReturnValue([
      { url: "ambiguous", type: "url", skillsInstalled: [], availableItems: [], addedAt: "" },
    ] as never);
    await remove("ambiguous");
    expect(mockRemoveMcpServer).toHaveBeenCalledWith("ambiguous");
    expect(mockRemoveSource).not.toHaveBeenCalled();
  });

  it("shows not-found message for unknown name", async () => {
    mockLoadState.mockReturnValue(makeState());
    await remove("nonexistent");
    expect(mockRemoveMcpServer).not.toHaveBeenCalled();
    expect(mockRemoveSource).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("sets process.exitCode = 1 when item not found", async () => {
    process.exitCode = undefined;
    mockLoadState.mockReturnValue(makeState());
    await remove("nonexistent");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("skips confirmation prompt for dry-run", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockGetConfigServers.mockReturnValue([{ name: "my-server", command: "npx", args: [], env: {}, source: "user" }]);
    await remove("my-server", { dryRun: true });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockRemoveMcpServer).not.toHaveBeenCalled();
  });

  it("removes a skill when detectItemTypes returns skill", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockDetectItemTypes.mockReturnValue(["skill"]);
    await remove("my-skill", { yes: true });
    expect(mockClean).toHaveBeenCalledWith("my-skill", { type: "skill", yes: true });
    expect(mockRemoveMcpServer).not.toHaveBeenCalled();
  });

  it("removes a command when detectItemTypes returns command", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockDetectItemTypes.mockReturnValue(["command"]);
    await remove("my-command", { yes: true });
    expect(mockClean).toHaveBeenCalledWith("my-command", { type: "command", yes: true });
  });

  it("shows dry-run output with agent count for MCP servers", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [
          { name: "claude-code", detected: true, mcpConfig: "/tmp/mcp.json" },
          { name: "cursor", detected: true, mcpConfig: "/tmp/cursor.json" },
        ] as AgentBrewState["agents"],
      }),
    );
    mockGetConfigServers.mockReturnValue([{ name: "my-server", command: "npx", args: [], env: {}, source: "user" }]);
    await remove("my-server", { dryRun: true });
    const allOutput = vi.mocked(console.log).mock.calls.flat().join(" ");
    expect(allOutput).toContain("2 agent config(s)");
  });

  // ── Catalog rule auto-detect (rules-remove-subcommand) ─────────────────────

  it("auto-detects a catalog rule by name and dispatches to removeRuleFromSharedRules", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        {
          name: "conventional-commits",
          description: "use conventional commit format",
          category: "git",
          recommended: true,
          content: "Use feat:, fix:, etc.",
        },
      ],
      cli_tools: [],
    });
    await remove("conventional-commits", { yes: true });
    expect(mockRemoveRuleFromSharedRules).toHaveBeenCalledWith("conventional-commits");
    expect(mockRemoveMcpServer).not.toHaveBeenCalled();
    expect(mockRemoveSource).not.toHaveBeenCalled();
    expect(mockClean).not.toHaveBeenCalled();
  });

  it("prefers MCP server over catalog rule when name matches both", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockGetConfigServers.mockReturnValue([{ name: "ambiguous", command: "npx", args: [], env: {}, source: "user" }]);
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        {
          name: "ambiguous",
          description: "x",
          category: "y",
          recommended: false,
          content: "z",
        },
      ],
      cli_tools: [],
    });
    await remove("ambiguous", { yes: true });
    expect(mockRemoveMcpServer).toHaveBeenCalledWith("ambiguous");
    expect(mockRemoveRuleFromSharedRules).not.toHaveBeenCalled();
  });

  it("prints friendly message when rule is not installed", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        {
          name: "test-rule",
          description: "x",
          category: "y",
          recommended: false,
          content: "z",
        },
      ],
      cli_tools: [],
    });
    mockRemoveRuleFromSharedRules.mockReturnValue("not-installed");
    await remove("test-rule", { yes: true });
    expect(mockRemoveRuleFromSharedRules).toHaveBeenCalledWith("test-rule");
    const allOutput = vi.mocked(console.log).mock.calls.flat().join(" ");
    expect(allOutput).toContain("not installed");
  });

  it("prints friendly message when shared-rules.md is missing", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        {
          name: "test-rule",
          description: "x",
          category: "y",
          recommended: false,
          content: "z",
        },
      ],
      cli_tools: [],
    });
    mockRemoveRuleFromSharedRules.mockReturnValue("no-rules-file");
    await remove("test-rule", { yes: true });
    expect(mockRemoveRuleFromSharedRules).toHaveBeenCalledWith("test-rule");
    const allOutput = vi.mocked(console.log).mock.calls.flat().join(" ");
    expect(allOutput).toContain("No shared-rules.md");
  });

  it("includes catalog rule names in the not-found suggestion pool", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        {
          name: "conventional-commits",
          description: "x",
          category: "y",
          recommended: false,
          content: "z",
        },
      ],
      cli_tools: [],
    });
    const { formatSuggestion } = await import("./suggest.js");
    const mockFormatSuggestion = vi.mocked(formatSuggestion);
    await remove("conv-commits");
    const pool = mockFormatSuggestion.mock.calls[0]?.[1];
    expect(pool).toContain("conventional-commits");
  });
});
