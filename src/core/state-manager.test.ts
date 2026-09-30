import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentBrewState } from "../types.js";
import type { StateIO } from "./state-manager.js";
import {
  CURRENT_SCHEMA_VERSION,
  createInMemoryStateManager,
  createStateManager,
  getStateManager,
  initStateManager,
  migrateState,
  resetStateManager,
  validateState,
} from "./state-manager.js";

function makeState(overrides: Partial<AgentBrewState> = {}): AgentBrewState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    agents: [{ name: "claude-code", detected: true, skillsDir: "~/.claude/skills" }],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
    ...overrides,
  } as AgentBrewState;
}

function mockIO(state?: AgentBrewState): StateIO & { written: AgentBrewState[] } {
  let current = state;
  const io = {
    written: [] as AgentBrewState[],
    read() {
      return current;
    },
    write(s: AgentBrewState) {
      current = s;
      io.written.push(s);
    },
  };
  return io;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStateManager();
});

describe("createStateManager", () => {
  it("load delegates to io.read", () => {
    const state = makeState();
    const io = mockIO(state);
    const manager = createStateManager(io);
    expect(manager.load()).toBe(state);
  });

  it("load returns undefined when no state", () => {
    const io = mockIO();
    const manager = createStateManager(io);
    expect(manager.load()).toBeUndefined();
  });

  it("load caches — reads io only once", () => {
    const state = makeState();
    const io = mockIO(state);
    const readSpy = vi.spyOn(io, "read");
    const manager = createStateManager(io);

    manager.load();
    manager.load();
    manager.load();
    expect(readSpy).toHaveBeenCalledOnce();
  });

  it("require returns state when initialized", () => {
    const state = makeState();
    const io = mockIO(state);
    const manager = createStateManager(io);
    expect(manager.require()).toBe(state);
  });

  it("require logs init message when no state", () => {
    const io = mockIO();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = createStateManager(io);
    expect(manager.require()).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("agentbrew not initialized"));
    spy.mockRestore();
  });

  it("require suppresses message when quiet is true", () => {
    const io = mockIO();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = createStateManager(io);
    expect(manager.require({ quiet: true })).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("save delegates to io.write and sets schemaVersion", () => {
    const state = makeState();
    const io = mockIO();
    const manager = createStateManager(io);
    manager.save(state);
    expect(io.written).toHaveLength(1);
    expect(io.written[0].schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("save updates cache — subsequent load returns saved state", () => {
    const io = mockIO();
    const manager = createStateManager(io);
    expect(manager.load()).toBeUndefined();

    const state = makeState();
    manager.save(state);
    expect(manager.load()).toBe(state);
  });

  it("update mutates state in-place and writes", () => {
    const state = makeState();
    const io = mockIO(state);
    const manager = createStateManager(io);

    manager.update((s) => {
      s.catalogVersion = "2.0.0";
    });

    expect(io.written).toHaveLength(1);
    expect(manager.load()?.catalogVersion).toBe("2.0.0");
  });

  it("update is no-op when no state loaded", () => {
    const io = mockIO();
    const manager = createStateManager(io);
    manager.update((s) => {
      s.catalogVersion = "2.0.0";
    });
    expect(io.written).toHaveLength(0);
  });

  it("invalidate forces re-read from io", () => {
    const state = makeState();
    const io = mockIO(state);
    const readSpy = vi.spyOn(io, "read");
    const manager = createStateManager(io);

    manager.load();
    manager.invalidate();
    manager.load();
    expect(readSpy).toHaveBeenCalledTimes(2);
  });
});

describe("typed accessors", () => {
  it("agents returns agents array", () => {
    const state = makeState();
    const manager = createStateManager(mockIO(state));
    expect(manager.agents()).toEqual(state.agents);
  });

  it("sources returns sources array", () => {
    const manager = createStateManager(
      mockIO(
        makeState({ sources: [{ url: "a/b", type: "github", skillsInstalled: [], availableItems: [], addedAt: "" }] }),
      ),
    );
    expect(manager.sources()).toHaveLength(1);
  });

  it("mcpServers returns empty array when no state", () => {
    const manager = createStateManager(mockIO());
    expect(manager.mcpServers()).toEqual([]);
  });
});

describe("migrateState", () => {
  it("adds schemaVersion to v0 state", () => {
    const old = makeState({ schemaVersion: undefined });
    delete (old as unknown as Record<string, unknown>).schemaVersion;
    const migrated = migrateState(old);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("returns same object when already at current version", () => {
    const state = makeState({ schemaVersion: CURRENT_SCHEMA_VERSION });
    expect(migrateState(state)).toBe(state);
  });

  it("normalizes null skillsInstalled to empty array", () => {
    const state = makeState({
      sources: [
        {
          url: "test/repo",
          type: "github",
          skillsInstalled: null as unknown as string[],
          availableItems: [],
          addedAt: "",
        },
      ],
    });
    const migrated = migrateState(state);
    expect(migrated.sources?.[0].skillsInstalled).toEqual([]);
  });

  it("normalizes null availableItems to empty array", () => {
    const state = makeState({
      sources: [
        {
          url: "test/repo",
          type: "github",
          skillsInstalled: ["a"],
          availableItems: null as unknown as [],
          addedAt: "",
        },
      ],
    });
    const migrated = migrateState(state);
    expect(migrated.sources?.[0].availableItems).toEqual([]);
  });

  it("repairs git@ sources misclassified as type github on load", () => {
    const state = makeState({
      sources: [
        {
          url: "git@corp-ghe.example.com:acme/team-skills.git",
          type: "github",
          skillsInstalled: [],
          availableItems: [],
          addedAt: "",
        },
      ],
    });
    const migrated = migrateState(state);
    expect(migrated.sources?.[0].type).toBe("url");
  });

  it("normalizes null args on mcpServers to empty array", () => {
    const state = makeState({
      mcpServers: [
        {
          name: "test-server",
          command: "npx",
          args: null as unknown as string[],
          env: {},
          source: "user",
        },
      ],
    });
    const migrated = migrateState(state);
    expect(migrated.mcpServers?.[0].args).toEqual([]);
  });

  it("normalizes null env on mcpServers to empty object", () => {
    const state = makeState({
      mcpServers: [
        {
          name: "test-server",
          command: "npx",
          args: [],
          env: null as unknown as Record<string, string>,
          source: "user",
        },
      ],
    });
    const migrated = migrateState(state);
    expect(migrated.mcpServers?.[0].env).toEqual({});
  });

  it("normalizes deprecated memory-server args during migration", () => {
    const state = makeState({
      mcpServers: [
        {
          name: "memory",
          command: "uvx",
          args: ["--from", "mcp-memory-service", "memory-server"],
          env: {},
          source: "agentfile",
        },
      ],
    });
    const migrated = migrateState(state);
    expect(migrated.mcpServers?.[0].command).toBe("uvx");
    expect(migrated.mcpServers?.[0].args).toEqual(["--from", "mcp-memory-service", "memory", "server"]);
  });

  it("normalizes both null args and null env together", () => {
    const state = makeState({
      mcpServers: [
        {
          name: "both-null",
          command: "node",
          args: null as unknown as string[],
          env: null as unknown as Record<string, string>,
          source: "catalog",
        },
      ],
    });
    const migrated = migrateState(state);
    expect(migrated.mcpServers?.[0].args).toEqual([]);
    expect(migrated.mcpServers?.[0].env).toEqual({});
  });

  it("preserves valid args and env on mcpServers", () => {
    const state = makeState({
      mcpServers: [
        {
          name: "valid-server",
          command: "npx",
          args: ["-y", "@test/mcp"],
          env: { API_KEY: "test" },
          source: "user",
        },
      ],
    });
    const migrated = migrateState(state);
    expect(migrated.mcpServers?.[0].args).toEqual(["-y", "@test/mcp"]);
    expect(migrated.mcpServers?.[0].env).toEqual({ API_KEY: "test" });
  });

  it("preserves valid skillsInstalled arrays", () => {
    const state = makeState({
      sources: [
        { url: "test/repo", type: "github", skillsInstalled: ["debug", "taste"], availableItems: [], addedAt: "" },
      ],
    });
    const migrated = migrateState(state);
    expect(migrated.sources?.[0].skillsInstalled).toEqual(["debug", "taste"]);
  });
});

describe("singleton", () => {
  it("getStateManager throws before init", () => {
    expect(() => getStateManager()).toThrow("StateManager not initialized");
  });

  it("initStateManager sets the singleton", () => {
    const io = mockIO(makeState());
    initStateManager(io);
    expect(getStateManager().load()).toBeDefined();
  });

  it("resetStateManager clears singleton", () => {
    initStateManager(mockIO(makeState()));
    resetStateManager();
    expect(() => getStateManager()).toThrow();
  });
});

describe("createInMemoryStateManager", () => {
  it("starts with undefined when no initial state", () => {
    const manager = createInMemoryStateManager();
    expect(manager.current).toBeUndefined();
    expect(manager.load()).toBeUndefined();
  });

  it("starts with initial state when provided", () => {
    const state = makeState();
    const manager = createInMemoryStateManager(state);
    expect(manager.current).toBe(state);
    expect(manager.load()?.agents).toEqual(state.agents);
  });

  it("require returns current state", () => {
    const state = makeState();
    const manager = createInMemoryStateManager(state);
    expect(manager.require()?.catalogVersion).toBe(state.catalogVersion);
  });

  it("require returns undefined when no state (does not log)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = createInMemoryStateManager();
    expect(manager.require()).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("save updates current state", () => {
    const manager = createInMemoryStateManager();
    const state = makeState();
    manager.save(state);
    expect(manager.current).toBe(state);
    expect(manager.load()?.agents).toEqual(state.agents);
  });

  it("save overwrites previous state", () => {
    const state1 = makeState();
    const state2 = makeState({ catalogVersion: "0.2.0" });
    const manager = createInMemoryStateManager(state1);
    manager.save(state2);
    expect(manager.current).toBe(state2);
    expect(manager.load()?.catalogVersion).toBe("0.2.0");
  });

  it("update mutates in-place", () => {
    const state = makeState();
    const manager = createInMemoryStateManager(state);
    manager.update((s) => {
      s.catalogVersion = "3.0.0";
    });
    expect(manager.current?.catalogVersion).toBe("3.0.0");
  });
});

describe("function serialization safety", () => {
  it("save caches the original object with functions — cache is NOT sanitized", () => {
    const io = mockIO();
    const manager = createStateManager(io);
    const fn = (s: string) => s;
    const state = makeState({
      agents: [{ name: "cursor", detected: true, skillsDir: "x", commandTransform: fn } as never],
    });
    manager.save(state);
    // The cache retains the original object reference
    const cached = manager.load();
    expect(cached?.agents[0]).toBe(state.agents[0]);
  });

  it("io.write receives state with functions — diskIO must sanitize", () => {
    const io = mockIO();
    const writeSpy = vi.spyOn(io, "write");
    const manager = createStateManager(io);
    const fn = (s: string) => s;
    const state = makeState({
      agents: [{ name: "cursor", detected: true, skillsDir: "x", commandTransform: fn } as never],
    });
    manager.save(state);
    // The state manager passes the object as-is to io.write — it's the IO layer's job to sanitize
    const written = writeSpy.mock.calls[0][0];
    expect(typeof (written.agents[0] as unknown as Record<string, unknown>).commandTransform).toBe("function");
  });

  it("invalidate after save forces re-read — if IO strips functions, loaded state is clean", () => {
    // Simulate an IO that strips functions (like the real diskIO does)
    let stored: AgentBrewState | undefined;
    const sanitizingIO: StateIO = {
      read: () => (stored ? JSON.parse(JSON.stringify(stored)) : undefined),
      write: (s) => {
        stored = s;
      },
    };
    const manager = createStateManager(sanitizingIO);
    const fn = (s: string) => s;
    const state = makeState({
      agents: [{ name: "cursor", detected: true, skillsDir: "x", commandTransform: fn } as never],
    });
    manager.save(state);
    manager.invalidate();
    const loaded = manager.load();
    // After re-read through sanitizing IO, functions are gone
    expect((loaded?.agents[0] as unknown as Record<string, unknown>).commandTransform).toBeUndefined();
    expect(loaded?.agents[0].name).toBe("cursor");
  });

  it("update path also writes via io.write — functions pass through to IO", () => {
    const io = mockIO(makeState());
    const writeSpy = vi.spyOn(io, "write");
    const manager = createStateManager(io);
    manager.load();
    manager.update((s) => {
      (s.agents[0] as unknown as Record<string, unknown>).commandTransform = () => "injected";
    });
    const written = writeSpy.mock.calls[0][0];
    expect(typeof (written.agents[0] as unknown as Record<string, unknown>).commandTransform).toBe("function");
  });

  it("in-memory state manager retains functions in cache (no disk IO)", () => {
    const fn = (s: string) => s;
    const state = makeState({
      agents: [{ name: "cursor", detected: true, skillsDir: "x", commandTransform: fn } as never],
    });
    const manager = createInMemoryStateManager(state);
    const loaded = manager.load();
    // In-memory manager has no sanitization — functions are retained
    expect(typeof (loaded?.agents[0] as unknown as Record<string, unknown>).commandTransform).toBe("function");
  });

  it("in-memory manager save + load retains functions (by design — no disk)", () => {
    const manager = createInMemoryStateManager();
    const fn = () => "transform";
    const state = makeState({
      agents: [{ name: "test", detected: true, skillsDir: "x", commandTransform: fn } as never],
    });
    manager.save(state);
    const loaded = manager.load();
    expect(typeof (loaded?.agents[0] as unknown as Record<string, unknown>).commandTransform).toBe("function");
  });

  it("multiple saves with functions do not accumulate issues", () => {
    const io = mockIO();
    const manager = createStateManager(io);
    for (let i = 0; i < 5; i++) {
      const state = makeState({
        agents: [{ name: `agent-${i}`, detected: true, skillsDir: "x", commandTransform: () => `v${i}` } as never],
      });
      manager.save(state);
    }
    expect(io.written).toHaveLength(5);
    expect(io.written[4].agents[0].name).toBe("agent-4");
  });

  it("save then update cycle with function injection is handled", () => {
    const io = mockIO();
    const manager = createStateManager(io);
    const state = makeState();
    manager.save(state);
    // Inject a function via update
    manager.update((s) => {
      (s.agents[0] as unknown as Record<string, unknown>).commandTransform = () => "bad";
      s.catalogVersion = "updated";
    });
    expect(io.written).toHaveLength(2);
    expect(io.written[1].catalogVersion).toBe("updated");
  });
});

describe("validateState", () => {
  it("returns no warnings for a valid state", () => {
    const state = makeState({
      mcpServers: [
        { name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp@latest"], env: {}, source: "catalog" },
      ],
    });
    const warnings = validateState(state);
    expect(warnings).toEqual([]);
  });

  it("returns no warnings for state with no MCP servers", () => {
    const state = makeState({ mcpServers: undefined });
    const warnings = validateState(state);
    expect(warnings).toEqual([]);
  });

  it("warns when an MCP server has an empty command", () => {
    const state = makeState({
      mcpServers: [{ name: "broken", command: "", args: [], env: {}, source: "user" }],
    });
    const warnings = validateState(state);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("broken");
    expect(warnings[0]).toContain("command");
  });

  it("warns when an MCP server has a missing name", () => {
    const state = makeState({
      mcpServers: [{ name: "", command: "npx", args: [], env: {}, source: "user" }],
    });
    const warnings = validateState(state);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("name");
  });

  it("warns when duplicate MCP server names exist", () => {
    const state = makeState({
      mcpServers: [
        { name: "pg", command: "npx", args: ["pg-mcp"], env: {}, source: "user" },
        { name: "pg", command: "npx", args: ["pg-mcp-v2"], env: {}, source: "catalog" },
      ],
    });
    const warnings = validateState(state);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.includes("duplicate") && w.includes("pg"))).toBe(true);
  });

  it("warns when an MCP server env value is not a string", () => {
    const state = makeState({
      mcpServers: [
        {
          name: "bad-env",
          command: "npx",
          args: [],
          env: { PORT: 5432 as unknown as string },
          source: "user",
        },
      ],
    });
    const warnings = validateState(state);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("bad-env");
    expect(warnings[0]).toContain("PORT");
  });

  it("warns when an MCP server has both empty command and no url (stdio with no command)", () => {
    const state = makeState({
      mcpServers: [{ name: "no-transport", command: "", args: [], env: {}, source: "user" }],
    });
    const warnings = validateState(state);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toContain("command");
  });

  it("skips command check for url-based (SSE/streamable) servers", () => {
    const state = makeState({
      mcpServers: [
        { name: "remote", command: "", args: [], env: {}, source: "user", url: "http://localhost:3000/sse" },
      ],
    });
    const warnings = validateState(state);
    expect(warnings).toEqual([]);
  });

  it("collects multiple warnings from multiple servers", () => {
    const state = makeState({
      mcpServers: [
        { name: "", command: "", args: [], env: {}, source: "user" },
        { name: "ok", command: "npx", args: [], env: { A: 1 as unknown as string }, source: "user" },
      ],
    });
    const warnings = validateState(state);
    // At least: empty name, empty command, non-string env
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });

  it("warns when skillSourceDirs has an entry with an empty path", () => {
    const state = makeState({
      skillSourceDirs: [{ label: "my-skills", path: "" }],
    });
    const warnings = validateState(state);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("skillSourceDirs");
    expect(warnings[0]).toContain("path");
  });

  it("warns when skillSourceDirs has an entry with an empty label", () => {
    const state = makeState({
      skillSourceDirs: [{ label: "", path: "/some/path" }],
    });
    const warnings = validateState(state);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("skillSourceDirs");
    expect(warnings[0]).toContain("label");
  });

  describe("integration with createStateManager", () => {
    it("logs warnings when loading state with validation issues", () => {
      const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const state = makeState({
        mcpServers: [{ name: "bad", command: "", args: [], env: {}, source: "user" }],
      });
      const io = mockIO(state);
      const manager = createStateManager(io);
      manager.load();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("bad"));
      warnSpy.mockRestore();
    });

    it("still returns the state even with validation warnings", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const state = makeState({
        mcpServers: [{ name: "bad", command: "", args: [], env: {}, source: "user" }],
      });
      const io = mockIO(state);
      const manager = createStateManager(io);
      const loaded = manager.load();
      expect(loaded).toBeDefined();
      expect(loaded?.mcpServers).toHaveLength(1);
    });
  });
});
