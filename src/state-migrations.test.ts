import { describe, expect, it, vi } from "vitest";
import { applySchemaMigrations, MIGRATIONS, printMigrationHints } from "./state-migrations.js";
import type { AgentBrewState } from "./types.js";

/**
 * Build a minimal state to attach migration-probed fields onto. The fields
 * we test are removed from the type, so we splice them on via `as unknown`.
 */
function makeState(extra: Record<string, unknown> = {}): AgentBrewState {
  const base: AgentBrewState = {
    agents: [],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
  } as AgentBrewState;
  return { ...base, ...extra } as AgentBrewState;
}

describe("applySchemaMigrations", () => {
  it("returns no hints when previousState is undefined (first init)", () => {
    expect(applySchemaMigrations(undefined)).toEqual([]);
  });

  it("returns no hints when previousState has none of the removed fields", () => {
    const state = makeState();
    expect(applySchemaMigrations(state)).toEqual([]);
  });

  it("runs every registered migration against the same state object", () => {
    // Synthetic probe: every registered migration should be invoked.
    // We don't assert which ones fire — just that none crash.
    const state = makeState();
    expect(() => applySchemaMigrations(state)).not.toThrow();
  });
});

describe("MIGRATIONS registry", () => {
  it("every migration has a non-empty stable id", () => {
    for (const m of MIGRATIONS) {
      expect(m.id).toMatch(/^[\w-]+$/);
    }
  });

  it("migration ids are unique", () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every migration has a predicate and hint function", () => {
    for (const m of MIGRATIONS) {
      expect(typeof m.predicate).toBe("function");
      expect(typeof m.hint).toBe("function");
    }
  });
});

describe("printMigrationHints", () => {
  it("is a no-op when no hints fired", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printMigrationHints([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("prints every line from every hint in order", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printMigrationHints([
      { id: "m1", lines: ["a", "b"] },
      { id: "m2", lines: ["c"] },
    ]);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenNthCalledWith(1, "a");
    expect(spy).toHaveBeenNthCalledWith(2, "b");
    expect(spy).toHaveBeenNthCalledWith(3, "c");
    spy.mockRestore();
  });
});
