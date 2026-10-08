import yaml from "js-yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateIO } from "./core/state-manager.js";

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockCopyFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockChmodSync = vi.fn();

vi.mock("node:fs", () => ({
  chmodSync: (...args: unknown[]) => mockChmodSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  copyFileSync: (...args: unknown[]) => mockCopyFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

vi.mock("write-file-atomic", () => ({
  sync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

vi.mock("./core/state-manager.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./core/state-manager.js")>();
  return {
    ...original,
    getStateManager: vi.fn((...args: Parameters<typeof original.getStateManager>) => original.getStateManager(...args)),
    initStateManager: vi.fn((...args: Parameters<typeof original.initStateManager>) =>
      original.initStateManager(...args),
    ),
    resetStateManager: original.resetStateManager,
  };
});

import {
  createInMemoryStateManager,
  getStateManager,
  initStateManager,
  replaceStateManager,
  resetStateManager,
} from "./core/state-manager.js";
import {
  defaultState,
  getStatePath,
  invalidateState,
  loadState,
  requireState,
  saveState,
  stateModuleDiskIO,
} from "./state.js";

beforeEach(() => {
  resetStateManager();
  vi.mocked(getStateManager).mockReset();
  vi.mocked(initStateManager).mockReset();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
});

describe("getStatePath", () => {
  it("returns a path ending in state.yaml under .config/agentbrew", () => {
    const p = getStatePath();
    expect(p).toContain(".config/agentbrew/state.yaml");
  });
});

describe("defaultState", () => {
  it("returns a valid default state", () => {
    const state = defaultState();
    expect(state.schemaVersion).toBe(1);
    expect(state.agents).toEqual([]);
    expect(state.catalogVersion).toBe("0.1.0");
  });
});

describe("loadState", () => {
  it("reuses existing singleton if already initialized", () => {
    const manager = createInMemoryStateManager({ ...defaultState(), schemaVersion: 1 });
    replaceStateManager(manager);
    vi.mocked(getStateManager).mockReturnValue(manager);
    const result = loadState();
    expect(result?.schemaVersion).toBe(1);
    expect(initStateManager).not.toHaveBeenCalled();
  });
});

describe("requireState", () => {
  it("delegates to manager.require()", () => {
    const manager = createInMemoryStateManager(defaultState());
    const requireSpy = vi.spyOn(manager, "require");
    replaceStateManager(manager);
    vi.mocked(getStateManager).mockReturnValue(manager);
    const result = requireState();
    expect(requireSpy).toHaveBeenCalledWith(undefined);
    expect(result?.schemaVersion).toBe(1);
  });

  it("passes options through to manager.require()", () => {
    const manager = createInMemoryStateManager(defaultState());
    const requireSpy = vi.spyOn(manager, "require");
    replaceStateManager(manager);
    vi.mocked(getStateManager).mockReturnValue(manager);
    requireState({ quiet: true });
    expect(requireSpy).toHaveBeenCalledWith({ quiet: true });
  });
});

describe("saveState", () => {
  it("delegates to manager.save()", () => {
    const manager = createInMemoryStateManager(defaultState());
    const saveSpy = vi.spyOn(manager, "save");
    replaceStateManager(manager);
    vi.mocked(getStateManager).mockReturnValue(manager);
    const state = defaultState();
    saveState(state);
    expect(saveSpy).toHaveBeenCalledWith(state);
  });
});

describe("invalidateState", () => {
  it("delegates to manager.invalidate()", () => {
    const manager = createInMemoryStateManager(defaultState());
    const invalidateSpy = vi.spyOn(manager, "invalidate");
    replaceStateManager(manager);
    vi.mocked(getStateManager).mockReturnValue(manager);
    invalidateState();
    expect(invalidateSpy).toHaveBeenCalled();
  });
});

/** Direct access to the module's diskIO for fs-mock tests. */
function extractDiskIO(): StateIO {
  return stateModuleDiskIO;
}

describe("diskIO.read", () => {
  it("returns undefined when state file does not exist", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    expect(diskIO.read()).toBeUndefined();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("reads and parses valid YAML state file", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("schemaVersion: 1\nagents: []\n");
    const result = diskIO.read();
    expect(result).toEqual({ schemaVersion: 1, agents: [] });
    expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringContaining("state.yaml"), "utf-8");
  });

  it("handles corrupted file with Error and sets exitCode", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("Invalid YAML");
    });
    const result = diskIO.read();
    expect(result).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("corrupted"));
  });

  it("handles corrupted file with non-Error thrown value", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw "string error";
    });
    const result = diskIO.read();
    expect(result).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("corrupted"));
  });
});

describe("diskIO.write", () => {
  it("creates directory and writes serialized YAML", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = { schemaVersion: 1, agents: [], catalogVersion: "0.1.0" } as never;
    diskIO.write(state);
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("state.yaml"),
      expect.stringContaining("schemaVersion"),
      "utf-8",
    );
  });

  it("creates backup when state file already exists", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(true);
    const state = { schemaVersion: 1, agents: [] } as never;
    diskIO.write(state);
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      expect.stringContaining("state.yaml"),
      expect.stringContaining("state.yaml.bak"),
    );
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("skips backup when state file does not exist", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = { schemaVersion: 1, agents: [] } as never;
    diskIO.write(state);
    expect(mockCopyFileSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("strips non-serializable function values before YAML serialization", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = {
      schemaVersion: 1,
      agents: [
        {
          name: "cursor",
          detected: true,
          skillsDir: "~/.cursor/skills",
          commandTransform: (s: string) => s,
        },
      ],
      catalogVersion: "0.1.0",
    } as never;
    // Should not throw — previously threw "unacceptable kind of an object to dump [object Function]"
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("cursor");
    expect(written).not.toContain("commandTransform");
  });

  it("strips arrow functions nested inside agent arrays", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = {
      schemaVersion: 1,
      agents: [
        { name: "cursor", detected: true, skillsDir: "~/.cursor/skills", commandTransform: () => "x" },
        { name: "kiro", detected: true, skillsDir: "~/.kiro/skills", commandTransform: () => "y" },
        { name: "gemini-cli", detected: true, skillsDir: "~/.gemini/skills", commandTransform: () => "z" },
      ],
      catalogVersion: "0.1.0",
    } as never;
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("cursor");
    expect(written).toContain("kiro");
    expect(written).toContain("gemini-cli");
    expect(written).not.toContain("commandTransform");
  });

  it("strips class instances and methods from state", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    class Transformer {
      run() {
        return "x";
      }
    }
    const state = {
      schemaVersion: 1,
      agents: [{ name: "test", detected: true, skillsDir: "x", commandTransform: new Transformer().run }],
      catalogVersion: "0.1.0",
    } as never;
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).not.toContain("commandTransform");
    expect(written).not.toContain("Transformer");
  });

  it("strips deeply nested function values anywhere in state", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = {
      schemaVersion: 1,
      agents: [],
      catalogVersion: "0.1.0",
      mcpServers: [
        {
          name: "test-server",
          command: "npx",
          args: [],
          env: { KEY: "val", nested: { fn: () => "boom" } },
          source: "user",
        },
      ],
    } as never;
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("test-server");
    expect(written).not.toContain("[object Function]");
  });

  it("preserves all serializable data through the sanitization step", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = {
      schemaVersion: 1,
      agents: [
        {
          name: "claude-code",
          detected: true,
          skillsDir: "~/.claude/skills",
          mcpConfig: "~/.claude.json",
          rulesFile: "~/.claude/CLAUDE.md",
          commandsDir: "~/.claude/commands",
          agentsDir: "~/.claude/agents",
        },
      ],
      mcpServers: [
        { name: "pg", command: "npx", args: ["pg-mcp", "--port", "5432"], env: { DB: "prod" }, source: "user" },
      ],
      sources: [
        {
          url: "https://github.com/org/repo",
          type: "github",
          skillsInstalled: ["debug"],
          addedAt: "2024-01-01T00:00:00.000Z",
          availableItems: [],
        },
      ],
      skillSourceDirs: [{ label: "my-project", path: "/path/to/skills" }],
      catalogVersion: "0.1.0",
    } as never;
    diskIO.write(state);
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    // Verify all data fields survived
    expect(written).toContain("claude-code");
    expect(written).toContain("~/.claude/skills");
    expect(written).toContain("~/.claude.json");
    expect(written).toContain("~/.claude/CLAUDE.md");
    expect(written).toContain("~/.claude/commands");
    expect(written).toContain("~/.claude/agents");
    expect(written).toContain("pg");
    expect(written).toContain("pg-mcp");
    expect(written).toContain("5432");
    expect(written).toContain("DB");
    expect(written).toContain("prod");
    expect(written).toContain("https://github.com/org/repo");
    expect(written).toContain("debug");
    expect(written).toContain("my-project");
    expect(written).toContain("/path/to/skills");
  });

  it("handles state with undefined optional fields without data loss", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = {
      schemaVersion: 1,
      agents: [{ name: "test", detected: false, skillsDir: "x" }],
      catalogVersion: "0.1.0",
      mcpServers: undefined,
      sources: undefined,
      skillSourceDirs: undefined,
    } as never;
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("test");
    expect(written).toContain("schemaVersion: 1");
  });

  it("handles empty state with no agents", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = { schemaVersion: 1, agents: [], catalogVersion: "0.1.0" } as never;
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("agents: []");
  });

  it("sets state.yaml permissions to 0600 after writing", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = { schemaVersion: 1, agents: [], catalogVersion: "0.1.0" } as never;
    diskIO.write(state);
    expect(mockChmodSync).toHaveBeenCalledWith(expect.stringContaining("state.yaml"), 0o600);
  });

  it("handles state where every agent has a commandTransform function", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const agents = Array.from({ length: 10 }, (_, i) => ({
      name: `agent-${i}`,
      detected: true,
      skillsDir: `~/.agent-${i}/skills`,
      commandTransform: (s: string) => s.toUpperCase(),
    }));
    const state = { schemaVersion: 1, agents, catalogVersion: "0.1.0" } as never;
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    for (let i = 0; i < 10; i++) {
      expect(written).toContain(`agent-${i}`);
    }
    expect(written).not.toContain("commandTransform");
  });

  it("produces valid YAML that can be re-parsed after sanitization", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = {
      schemaVersion: 1,
      agents: [{ name: "cursor", detected: true, skillsDir: "~/.cursor/skills", commandTransform: () => "x" }],
      mcpServers: [{ name: "srv", command: "echo", args: ["hi"], env: {}, source: "user" }],
      catalogVersion: "0.1.0",
    } as never;
    diskIO.write(state);
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    // Parse the written YAML back — must not throw
    const parsed = yaml.load(written) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.catalogVersion).toBe("0.1.0");
    const agents = parsed.agents as Array<Record<string, unknown>>;
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("cursor");
    expect(agents[0].commandTransform).toBeUndefined();
    const servers = parsed.mcpServers as Array<Record<string, unknown>>;
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("srv");
  });
});

describe("diskIO.write exotic edge cases", () => {
  it("strips RegExp objects from state", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = {
      schemaVersion: 1,
      agents: [{ name: "test", detected: true, skillsDir: "x", pattern: /foo/gi }],
      catalogVersion: "0.1.0",
    } as never;
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("test");
    expect(written).not.toContain("/foo/gi");
  });

  it("handles getter properties by serializing their values", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const agent = {
      name: "getter-agent",
      detected: true,
      skillsDir: "x",
      get computed() {
        return "computed-value";
      },
    };
    const state = { schemaVersion: 1, agents: [agent], catalogVersion: "0.1.0" } as never;
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("getter-agent");
    expect(written).toContain("computed-value");
  });

  it("handles agents with extra unexpected properties gracefully", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = {
      schemaVersion: 1,
      agents: [
        {
          name: "extended",
          detected: true,
          skillsDir: "x",
          commandTransform: () => "fn",
          extraString: "kept",
          extraNumber: 42,
          extraBool: true,
          extraNull: null,
          extraArray: [1, 2, 3],
          extraNested: { deep: { value: "here" } },
        },
      ],
      catalogVersion: "0.1.0",
    } as never;
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).not.toContain("commandTransform");
    expect(written).toContain("extraString");
    expect(written).toContain("kept");
    expect(written).toContain("42");
    expect(written).toContain("here");
  });

  it("handles Date objects by converting to ISO string", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = {
      schemaVersion: 1,
      agents: [],
      catalogVersion: "0.1.0",
      // Date object embedded in a value the serializer surfaces — agentbrew normally writes
      // ISO strings, but the test guards against accidental "[object Object]" leakage if a
      // future caller pushes a raw Date.
      sources: [
        {
          url: "https://example.com",
          type: "github",
          skillsInstalled: [],
          availableItems: [],
          addedAt: new Date("2024-01-15T00:00:00Z"),
        },
      ],
    } as never;
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("2024-01-15");
  });

  it("handles sparse arrays without crashing", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const sparseArr: string[] = [];
    sparseArr[0] = "first";
    sparseArr[5] = "sixth";
    const state = {
      schemaVersion: 1,
      agents: [{ name: "sparse", detected: true, skillsDir: "x", mcpConfig: "y" }],
      mcpServers: [{ name: "srv", command: "echo", args: sparseArr, env: {}, source: "user" }],
      catalogVersion: "0.1.0",
    } as never;
    expect(() => diskIO.write(state)).not.toThrow();
  });

  it("handles prototype chain pollution — only own properties are serialized", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const proto = { polluted: "from-prototype", evilFn: () => "hack" };
    const agent = Object.create(proto);
    agent.name = "clean-agent";
    agent.detected = true;
    agent.skillsDir = "x";
    const state = { schemaVersion: 1, agents: [agent], catalogVersion: "0.1.0" } as never;
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("clean-agent");
    // JSON.stringify only serializes own enumerable properties, so prototype props are excluded
    expect(written).not.toContain("evilFn");
  });

  it("handles NaN and Infinity by converting to null", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const state = {
      schemaVersion: 1,
      agents: [{ name: "nan-agent", detected: true, skillsDir: "x", badNum: Number.NaN, infNum: Infinity }],
      catalogVersion: "0.1.0",
    } as never;
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("nan-agent");
    // NaN and Infinity become null via JSON.stringify
    expect(written).toContain("null");
  });

  it("handles state with many MCP servers and mixed function/data", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    const servers = Array.from({ length: 20 }, (_, i) => ({
      name: `server-${i}`,
      command: "npx",
      args: [`pkg-${i}`],
      env: i % 3 === 0 ? { fn: () => "bad" } : { KEY: `val-${i}` },
      source: "user",
    }));
    const state = {
      schemaVersion: 1,
      agents: [{ name: "test", detected: true, skillsDir: "x" }],
      mcpServers: servers,
      catalogVersion: "0.1.0",
    } as never;
    expect(() => diskIO.write(state)).not.toThrow();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    for (let i = 0; i < 20; i++) {
      expect(written).toContain(`server-${i}`);
    }
  });
});

describe("diskIO.write error handling", () => {
  it("catches mkdirSync failure and sets exitCode", () => {
    const diskIO = extractDiskIO();
    mockMkdirSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    const state = { schemaVersion: 1, agents: [], catalogVersion: "0.1.0" } as never;
    diskIO.write(state);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to write state.yaml"));
  });

  it("catches writeFileSync failure and sets exitCode", () => {
    const diskIO = extractDiskIO();
    mockExistsSync.mockReturnValue(false);
    mockWriteFileSync.mockImplementation(() => {
      throw new Error("ENOSPC: no space left on device");
    });
    const state = { schemaVersion: 1, agents: [], catalogVersion: "0.1.0" } as never;
    diskIO.write(state);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to write state.yaml"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("disk space"));
  });
});
