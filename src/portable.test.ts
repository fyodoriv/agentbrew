import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ""),
    readdirSync: vi.fn(() => []),
    mkdirSync: vi.fn(),
  };
});

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("./state.js", () => ({
  loadState: vi.fn(),
  requireState: vi.fn(),
  saveState: vi.fn(),
}));

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { sync as writeFileSync } from "write-file-atomic";
import type { ExportBundle } from "./portable.js";
import { applyBundle, buildExportBundle, exportConfig, importConfig, parseBundle } from "./portable.js";
import { loadState, requireState, saveState } from "./state.js";
import type { AgentBrewState } from "./types.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockRequireState = vi.mocked(requireState);
const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeState(): AgentBrewState {
  return {
    agents: [{ name: "claude-code", detected: true, skillsDir: "~/.claude/skills" }],
    sources: [
      {
        url: "user/repo",
        type: "github" as const,
        skillsInstalled: ["commit"],
        availableItems: [],
        addedAt: "2025-01-01",
      },
    ],
    mcpServers: [
      { name: "pg", command: "npx", args: ["-y", "@pg/mcp"], env: { DB: "local" }, source: "catalog" as const },
      { name: "fs", command: "npx", args: ["-y", "@fs/mcp"], env: {}, source: "user" as const },
    ],
    catalogVersion: "0.1.0",
  };
}

function makeBundle(overrides?: Partial<ExportBundle>): ExportBundle {
  return {
    version: "1",
    exportedAt: "2025-06-01T00:00:00.000Z",
    mcpServers: [{ name: "new-mcp", command: "npx", args: ["-y", "new-mcp"], env: {}, source: "catalog" as const }],
    sources: [{ url: "new/repo", type: "github" as const, skillsInstalled: ["test-skill"] }],
    ...overrides,
  };
}

describe("buildExportBundle", () => {
  it("throws when state is not initialized", () => {
    mockRequireState.mockReturnValue(undefined);
    expect(() => buildExportBundle()).toThrow("agentbrew not initialized");
  });

  it("exports MCP servers and sources", () => {
    mockRequireState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);

    const bundle = buildExportBundle();
    expect(bundle.version).toBe("1");
    expect(bundle.exportedAt).toBeTruthy();
    expect(bundle.mcpServers).toHaveLength(2);
    expect(bundle.mcpServers[0].name).toBe("pg");
    expect(bundle.mcpServers[1].name).toBe("fs");
    expect(bundle.sources).toHaveLength(1);
    expect(bundle.sources[0].url).toBe("user/repo");
  });

  it("strips source fields to portable subset", () => {
    mockRequireState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);

    const bundle = buildExportBundle();
    const source = bundle.sources[0];
    expect(source).toEqual({
      url: "user/repo",
      type: "github",
      skillsInstalled: ["commit"],
    });
    expect((source as Record<string, unknown>).availableItems).toBeUndefined();
    expect((source as Record<string, unknown>).addedAt).toBeUndefined();
  });

  it("includes shared rules when file exists", () => {
    mockRequireState.mockReturnValue(makeState());
    mockExistsSync.mockImplementation((path) => String(path).includes("shared-rules.md"));
    mockReadFileSync.mockReturnValue("# My Rules\nBe nice.");

    const bundle = buildExportBundle();
    expect(bundle.sharedRules).toBe("# My Rules\nBe nice.");
  });

  it("includes commands when directory exists", () => {
    mockRequireState.mockReturnValue(makeState());
    mockExistsSync.mockImplementation((path) => String(path).includes("commands"));
    mockReaddirSync.mockReturnValue(["deploy.md", "test.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue("# Command content");

    const bundle = buildExportBundle();
    expect(bundle.commands).toEqual({
      deploy: "# Command content",
      test: "# Command content",
    });
  });

  it("includes skillSourceDirs when present", () => {
    const state = makeState();
    state.skillSourceDirs = [
      { label: "my-project", path: "/Users/me/projects/skills" },
      { label: "shared", path: "~/shared-skills" },
    ];
    mockRequireState.mockReturnValue(state);
    mockExistsSync.mockReturnValue(false);

    const bundle = buildExportBundle();
    expect(bundle.skillSourceDirs).toHaveLength(2);
    expect(bundle.skillSourceDirs![0].label).toBe("my-project");
    expect(bundle.skillSourceDirs![1].path).toBe("~/shared-skills");
  });

  it("omits optional fields when empty", () => {
    mockRequireState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);

    const bundle = buildExportBundle();
    expect(bundle.skillSourceDirs).toBeUndefined();
    expect(bundle.sharedRules).toBeUndefined();
    expect(bundle.commands).toBeUndefined();
  });
});

describe("parseBundle", () => {
  it("throws when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => parseBundle("missing.yaml")).toThrow("File not found");
  });

  it("parses valid YAML bundle", () => {
    mockExistsSync.mockReturnValue(true);
    const yamlContent = `version: "1"\nexportedAt: "2025-01-01"\nmcpServers: []\nsources: []`;
    mockReadFileSync.mockReturnValue(yamlContent);

    const bundle = parseBundle("export.yaml");
    expect(bundle.version).toBe("1");
    expect(bundle.mcpServers).toEqual([]);
    expect(bundle.sources).toEqual([]);
  });

  it("parses valid JSON bundle", () => {
    mockExistsSync.mockReturnValue(true);
    const jsonContent = JSON.stringify({ version: "1", exportedAt: "2025-01-01", mcpServers: [], sources: [] });
    mockReadFileSync.mockReturnValue(jsonContent);

    const bundle = parseBundle("export.json");
    expect(bundle.version).toBe("1");
  });

  it("throws on unsupported version", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`version: "2"\nmcpServers: []\nsources: []`);

    expect(() => parseBundle("bad.yaml")).toThrow("Unsupported bundle version: 2");
  });

  it("throws when mcpServers is missing", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`version: "1"\nsources: []`);

    expect(() => parseBundle("bad.yaml")).toThrow("mcpServers must be an array");
  });

  it("throws when sources is missing", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`version: "1"\nmcpServers: []`);

    expect(() => parseBundle("bad.yaml")).toThrow("sources must be an array");
  });
});

describe("applyBundle", () => {
  it("adds new MCP servers", () => {
    const state = makeState();
    const bundle = makeBundle();

    const result = applyBundle(state, bundle, true);
    expect(result.mcpServersAdded).toEqual(["new-mcp"]);
    expect(state.mcpServers ?? []).toHaveLength(3);
    expect((state.mcpServers ?? [])[2].name).toBe("new-mcp");
  });

  it("skips existing MCP servers in merge mode", () => {
    const state = makeState();
    const bundle = makeBundle({
      mcpServers: [{ name: "pg", command: "other", args: [], env: {}, source: "user" as const }],
    });

    const result = applyBundle(state, bundle, true);
    expect(result.mcpServersSkipped).toEqual(["pg"]);
    expect(result.mcpServersAdded).toEqual([]);
    expect((state.mcpServers ?? [])[0].command).toBe("npx"); // unchanged
  });

  it("replaces existing MCP servers in replace mode", () => {
    const state = makeState();
    const bundle = makeBundle({
      mcpServers: [{ name: "pg", command: "other-cmd", args: ["--new"], env: {}, source: "user" as const }],
    });

    const result = applyBundle(state, bundle, false);
    expect(result.mcpServersAdded).toEqual(["pg"]);
    expect(result.mcpServersSkipped).toEqual([]);
    expect((state.mcpServers ?? [])[0].command).toBe("other-cmd");
  });

  it("adds new sources", () => {
    const state = makeState();
    const bundle = makeBundle();

    const result = applyBundle(state, bundle, true);
    expect(result.sourcesAdded).toEqual(["new/repo"]);
    expect(state.sources).toHaveLength(2);
    // Imported sources are stamped as user-added so the team overlay
    // auto-register/auto-remove loop will not touch them.
    const imported = (state.sources ?? []).find((s) => s.url === "new/repo");
    expect(imported?.origin).toBe("user");
  });

  it("skips existing sources", () => {
    const state = makeState();
    const bundle = makeBundle({
      sources: [{ url: "user/repo", type: "github" as const, skillsInstalled: [] }],
    });

    const result = applyBundle(state, bundle, true);
    expect(result.sourcesSkipped).toEqual(["user/repo"]);
    expect(result.sourcesAdded).toEqual([]);
  });

  it("adds new skillSourceDirs from bundle", () => {
    const state = makeState();
    mockExistsSync.mockReturnValue(true);
    const bundle = makeBundle({
      skillSourceDirs: [{ label: "imported", path: "~/imported-skills" }],
    });

    const result = applyBundle(state, bundle, true);
    expect(result.skillSourceDirsAdded).toEqual(["imported"]);
    expect(state.skillSourceDirs).toHaveLength(1);
    expect(state.skillSourceDirs![0].path).toBe("~/imported-skills");
  });

  it("skips skillSourceDirs that already exist by path", () => {
    const state = makeState();
    state.skillSourceDirs = [{ label: "existing", path: "~/my-skills" }];
    const bundle = makeBundle({
      skillSourceDirs: [{ label: "dupe", path: "~/my-skills" }],
    });

    const result = applyBundle(state, bundle, true);
    expect(result.skillSourceDirsSkipped).toEqual(["dupe"]);
    expect(result.skillSourceDirsAdded).toEqual([]);
    expect(state.skillSourceDirs).toHaveLength(1);
  });

  it("skips absolute local paths that do not exist on this machine", () => {
    const state = makeState();
    mockExistsSync.mockReturnValue(false);
    const bundle = makeBundle({
      skillSourceDirs: [{ label: "remote-only", path: "/Users/other/skills" }],
    });

    const result = applyBundle(state, bundle, true);
    expect(result.skillSourceDirsSkipped).toHaveLength(1);
    expect(result.skillSourceDirsSkipped[0]).toContain("path not found");
    expect(state.skillSourceDirs ?? []).toHaveLength(0);
  });

  it("allows tilde paths without checking existence (portable)", () => {
    const state = makeState();
    const bundle = makeBundle({
      skillSourceDirs: [{ label: "tilde", path: "~/portable-skills" }],
    });

    const result = applyBundle(state, bundle, true);
    expect(result.skillSourceDirsAdded).toEqual(["tilde"]);
  });

  it("handles v1 bundles without skillSourceDirs gracefully", () => {
    const state = makeState();
    const bundle = makeBundle();
    // v1 bundles don't have skillSourceDirs — simulate by setting to undefined
    bundle.skillSourceDirs = undefined;

    const result = applyBundle(state, bundle, true);
    expect(result.skillSourceDirsAdded).toEqual([]);
    expect(result.skillSourceDirsSkipped).toEqual([]);
  });

  it("writes shared rules to filesystem when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const state = makeState();
    const bundle = makeBundle({ sharedRules: "# Imported rules" });

    const result = applyBundle(state, bundle, true);
    expect(result.rulesWritten).toBe(true);
    expect(writeFileSync).toHaveBeenCalledWith(expect.stringContaining("shared-rules.md"), "# Imported rules", "utf-8");
  });

  it("skips shared rules when file already exists and merge is true", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# Existing user rules");
    const state = makeState();
    const bundle = makeBundle({ sharedRules: "# Imported rules" });

    const result = applyBundle(state, bundle, true);
    expect(result.rulesWritten).toBe(false);
    expect(result.rulesSkipped).toBe(true);
  });

  it("writes commands to filesystem when files do not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const state = makeState();
    const bundle = makeBundle({ commands: { deploy: "# Deploy cmd", test: "# Test cmd" } });

    const result = applyBundle(state, bundle, true);
    expect(result.commandsWritten).toEqual(["deploy", "test"]);
    expect(writeFileSync).toHaveBeenCalledWith(expect.stringContaining("deploy.md"), "# Deploy cmd", "utf-8");
  });

  it("skips commands when files already exist and merge is true", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# Existing user command");
    const state = makeState();
    const bundle = makeBundle({ commands: { deploy: "# Deploy cmd" } });

    const result = applyBundle(state, bundle, true);
    expect(result.commandsWritten).toEqual([]);
    expect(result.commandsSkipped).toEqual(["deploy"]);
  });

  it("returns empty result when nothing to add", () => {
    const state = makeState();
    const bundle = makeBundle({
      mcpServers: [{ name: "pg", command: "npx", args: [], env: {}, source: "catalog" as const }],
      sources: [{ url: "user/repo", type: "github" as const, skillsInstalled: [] }],
    });

    const result = applyBundle(state, bundle, true);
    expect(result.mcpServersAdded).toEqual([]);
    expect(result.mcpServersSkipped).toEqual(["pg"]);
    expect(result.sourcesAdded).toEqual([]);
    expect(result.sourcesSkipped).toEqual(["user/repo"]);
  });
});

describe("importConfig", () => {
  const validBundleYaml = `version: "1"\nexportedAt: "2025-01-01"\nmcpServers:\n  - name: new-server\n    command: npx\n    args: []\n    env: {}\n    source: user\nsources: []`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(validBundleYaml);
  });

  it("throws when state is not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);

    await expect(importConfig({ file: "bundle.yaml" })).rejects.toThrow("agentbrew not initialized");
  });

  it("applies bundle and saves state in normal mode", async () => {
    mockLoadState.mockReturnValue(makeState());

    await importConfig({ file: "bundle.yaml" });

    expect(mockSaveState).toHaveBeenCalledOnce();
    const savedState = mockSaveState.mock.calls[0][0] as AgentBrewState;
    const addedServer = (savedState.mcpServers ?? []).find((s) => s.name === "new-server");
    expect(addedServer).toBeDefined();
  });

  it("merges by default (skips existing servers)", async () => {
    const yamlWithExisting = `version: "1"\nexportedAt: "2025-01-01"\nmcpServers:\n  - name: pg\n    command: other\n    args: []\n    env: {}\n    source: user\nsources: []`;
    mockReadFileSync.mockReturnValue(yamlWithExisting);
    mockLoadState.mockReturnValue(makeState());

    await importConfig({ file: "bundle.yaml" });

    const savedState = mockSaveState.mock.calls[0][0] as AgentBrewState;
    const pgServer = (savedState.mcpServers ?? []).find((s) => s.name === "pg");
    expect(pgServer?.command).toBe("npx"); // not replaced — merge mode skips
  });

  it("replaces existing servers when merge is false", async () => {
    const yamlWithExisting = `version: "1"\nexportedAt: "2025-01-01"\nmcpServers:\n  - name: pg\n    command: replaced-cmd\n    args: []\n    env: {}\n    source: user\nsources: []`;
    mockReadFileSync.mockReturnValue(yamlWithExisting);
    mockLoadState.mockReturnValue(makeState());

    await importConfig({ file: "bundle.yaml", merge: false });

    const savedState = mockSaveState.mock.calls[0][0] as AgentBrewState;
    const pgServer = (savedState.mcpServers ?? []).find((s) => s.name === "pg");
    expect(pgServer?.command).toBe("replaced-cmd");
  });

  it("does not save state in dry-run mode", async () => {
    mockLoadState.mockReturnValue(makeState());

    await importConfig({ file: "bundle.yaml", dryRun: true });

    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("logs dry-run header when dryRun is true", async () => {
    mockLoadState.mockReturnValue(makeState());

    await importConfig({ file: "bundle.yaml", dryRun: true });

    const logCalls = vi.mocked(console.log).mock.calls.map((args) => String(args[0]));
    const dryRunLog = logCalls.find((line) => line.includes("Dry run"));
    expect(dryRunLog).toBeDefined();
  });

  it("logs sync reminder after successful import", async () => {
    mockLoadState.mockReturnValue(makeState());

    await importConfig({ file: "bundle.yaml" });

    const logCalls = vi.mocked(console.log).mock.calls.map((args) => String(args[0]));
    const syncLog = logCalls.find((line) => line.includes("agentbrew sync"));
    expect(syncLog).toBeDefined();
  });

  it("logs skipped sources when all sources already exist", async () => {
    const yamlWithExistingSource = `version: "1"\nexportedAt: "2025-01-01"\nmcpServers: []\nsources:\n  - url: user/repo\n    type: github\n    skillsInstalled: []`;
    mockReadFileSync.mockReturnValue(yamlWithExistingSource);
    mockLoadState.mockReturnValue(makeState());

    await importConfig({ file: "bundle.yaml" });

    const logCalls = vi.mocked(console.log).mock.calls.map((args) => String(args[0]));
    expect(logCalls.some((line) => line.includes("skipped"))).toBe(true);
  });

  it("logs rules written when bundle contains sharedRules and rules file does not exist", async () => {
    const yamlWithRules = `version: "1"\nexportedAt: "2025-01-01"\nmcpServers: []\nsources: []\nsharedRules: "# project rules"`;
    mockReadFileSync.mockReturnValue(yamlWithRules);
    mockLoadState.mockReturnValue(makeState());
    // Bundle file exists, but shared-rules.md does not
    mockExistsSync.mockImplementation((p) => !String(p).includes("shared-rules"));

    await importConfig({ file: "bundle.yaml" });

    const logCalls = vi.mocked(console.log).mock.calls.map((args) => String(args[0]));
    expect(logCalls.some((line) => line.includes("Shared rules written"))).toBe(true);
  });

  it("logs commands written when bundle contains commands", async () => {
    const yamlWithCommands = `version: "1"\nexportedAt: "2025-01-01"\nmcpServers: []\nsources: []\ncommands:\n  deploy: "# Deploy cmd"`;
    mockReadFileSync.mockReturnValue(yamlWithCommands);
    mockLoadState.mockReturnValue(makeState());

    await importConfig({ file: "bundle.yaml" });

    const logCalls = vi.mocked(console.log).mock.calls.map((args) => String(args[0]));
    expect(logCalls.some((line) => line.includes("deploy"))).toBe(true);
  });

  it("logs skipped messages when everything already exists", async () => {
    const yamlAllExisting = `version: "1"\nexportedAt: "2025-01-01"\nmcpServers:\n  - name: pg\n    command: npx\n    args: []\n    env: {}\n    source: user\nsources:\n  - url: user/repo\n    type: github\n    skillsInstalled: []`;
    mockReadFileSync.mockReturnValue(yamlAllExisting);
    mockLoadState.mockReturnValue(makeState());

    await importConfig({ file: "bundle.yaml" });

    const logCalls = vi.mocked(console.log).mock.calls.map((args) => String(args[0]));
    expect(logCalls.some((line) => line.includes("skipped"))).toBe(true);
  });

  it("logs sources added when a new source is imported", async () => {
    const yamlWithNewSource = `version: "1"\nexportedAt: "2025-01-01"\nmcpServers: []\nsources:\n  - url: brand-new/repo\n    type: github\n    skillsInstalled: []`;
    mockReadFileSync.mockReturnValue(yamlWithNewSource);
    mockLoadState.mockReturnValue(makeState());

    await importConfig({ file: "bundle.yaml" });

    const logCalls = vi.mocked(console.log).mock.calls.map((args) => String(args[0]));
    expect(logCalls.some((line) => line.includes("brand-new/repo"))).toBe(true);
  });
});

describe("parseBundle errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when YAML content cannot be parsed", () => {
    mockExistsSync.mockReturnValue(true);
    // Return malformed YAML that yaml.load will throw on (indentation error)
    mockReadFileSync.mockReturnValue("key: :\n  bad: [invalid");
    expect(() => parseBundle("bad.yaml")).toThrow("Failed to parse bundle file");
  });

  it("throws when parsed YAML is not an object", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("just a plain string");
    expect(() => parseBundle("bad.yaml")).toThrow("Invalid bundle");
  });

  it("throws user-friendly error when readFileSync fails", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    expect(() => parseBundle("locked.yaml")).toThrow("Failed to parse bundle file");
    expect(() => parseBundle("locked.yaml")).toThrow("EACCES");
  });
});

describe("exportConfig", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("logs commands count when bundle has commands", async () => {
    const state = makeState();
    mockRequireState.mockReturnValue(state);
    mockExistsSync.mockImplementation((path) => String(path).includes("commands"));
    mockReaddirSync.mockReturnValue(["deploy.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue("# Deploy");

    await exportConfig();

    const logCalls = consoleSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    expect(logCalls.some((line: string) => line.includes("commands included"))).toBe(true);
  });
});
