import { describe, expect, it, vi } from "vitest";
import type { AgentBrewState } from "../types.js";
import { createContext, createTestContext } from "./context.js";
import { createSilentLogger } from "./logger.js";
import { createInMemoryStateManager, getStateManager } from "./state-manager.js";

vi.mock("./state-manager.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./state-manager.js")>();
  return {
    ...original,
    getStateManager: vi.fn(),
  };
});

function makeState(overrides: Partial<AgentBrewState> = {}): AgentBrewState {
  return {
    schemaVersion: 1,
    agents: [],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
    ...overrides,
  };
}

describe("createSilentLogger", () => {
  it("log/info/warn/error/success are no-ops", () => {
    const logger = createSilentLogger();
    // These should not throw
    logger.log("test");
    logger.info("test");
    logger.warn("test");
    logger.error("test");
    logger.success("✓", "test");
  });

  it("formatting methods return input unchanged", () => {
    const logger = createSilentLogger();
    expect(logger.bold("hello")).toBe("hello");
    expect(logger.dim("hello")).toBe("hello");
    expect(logger.green("hello")).toBe("hello");
    expect(logger.yellow("hello")).toBe("hello");
    expect(logger.red("hello")).toBe("hello");
    expect(logger.cyan("hello")).toBe("hello");
    expect(logger.blue("hello")).toBe("hello");
  });
});

describe("createInMemoryStateManager", () => {
  it("starts with provided initial state", () => {
    const state = makeState();
    const sm = createInMemoryStateManager(state);
    expect(sm.load()).toBe(state);
    expect(sm.require()).toBe(state);
  });

  it("starts undefined when no initial state", () => {
    const sm = createInMemoryStateManager();
    expect(sm.load()).toBeUndefined();
    expect(sm.require()).toBeUndefined();
  });

  it("save updates current state", () => {
    const sm = createInMemoryStateManager();
    const state = makeState({ catalogVersion: "2.0.0" });
    sm.save(state);
    expect(sm.current).toBe(state);
    expect(sm.load()).toBe(state);
  });
});

describe("createTestContext", () => {
  it("provides silent logger and in-memory state", () => {
    const state = makeState();
    const ctx = createTestContext(state);
    expect(ctx.logger.bold("x")).toBe("x");
    expect(ctx.state.load()).toBe(state);
  });

  it("exposes stateManager for assertions", () => {
    const state = makeState();
    const ctx = createTestContext(state);
    const newState = makeState({ catalogVersion: "3.0.0" });
    ctx.state.save(newState);
    expect(ctx.stateManager.current).toBe(newState);
  });

  it("works with no initial state", () => {
    const ctx = createTestContext();
    expect(ctx.state.load()).toBeUndefined();
  });
});

describe("createContext", () => {
  function makeMockStateManager(state?: AgentBrewState) {
    const sm = createInMemoryStateManager(state);
    vi.mocked(getStateManager).mockReturnValue(sm);
    return sm;
  }

  it("returns a context with a logger and lazy state proxy", () => {
    makeMockStateManager();
    const ctx = createContext();
    expect(ctx.logger).toBeDefined();
    expect(ctx.state).toBeDefined();
  });

  it("state.load() delegates to getStateManager().load()", () => {
    const state = makeState({ catalogVersion: "1.0.0" });
    makeMockStateManager(state);
    const ctx = createContext();
    expect(ctx.state.load()).toBe(state);
  });

  it("state.require() delegates to getStateManager().require()", () => {
    const state = makeState();
    makeMockStateManager(state);
    const ctx = createContext();
    expect(ctx.state.require()).toBe(state);
  });

  it("state.save() delegates to getStateManager().save()", () => {
    const sm = makeMockStateManager();
    const ctx = createContext();
    const newState = makeState({ catalogVersion: "9.0.0" });
    ctx.state.save(newState);
    expect(sm.load()).toBe(newState);
  });

  it("state.update() delegates to getStateManager().update()", () => {
    const state = makeState({ catalogVersion: "1.0.0" });
    const sm = makeMockStateManager(state);
    const ctx = createContext();
    ctx.state.update((s) => {
      s.catalogVersion = "2.0.0";
    });
    expect(sm.load()?.catalogVersion).toBe("2.0.0");
  });

  it("state.invalidate() delegates to getStateManager().invalidate()", () => {
    const sm = makeMockStateManager(makeState());
    const invalidateSpy = vi.spyOn(sm, "invalidate");
    const ctx = createContext();
    ctx.state.invalidate();
    expect(invalidateSpy).toHaveBeenCalledOnce();
  });

  it("state.agents() delegates to getStateManager().agents()", () => {
    makeMockStateManager(makeState());
    const ctx = createContext();
    expect(ctx.state.agents()).toEqual([]);
  });

  it("state.sources() delegates to getStateManager().sources()", () => {
    makeMockStateManager(makeState());
    const ctx = createContext();
    expect(ctx.state.sources()).toEqual([]);
  });

  it("state.mcpServers() delegates to getStateManager().mcpServers()", () => {
    makeMockStateManager(makeState());
    const ctx = createContext();
    expect(ctx.state.mcpServers()).toEqual([]);
  });

  it("passes quiet option to logger", () => {
    makeMockStateManager();
    // quiet:true produces a real logger that suppresses output — just verify it doesn't throw
    const ctx = createContext({ quiet: true });
    expect(() => ctx.logger.info("test")).not.toThrow();
  });
});
