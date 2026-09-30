import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./state.js", () => {
  const requireState = vi.fn();
  return { requireState, loadState: requireState, saveState: vi.fn() };
});

vi.mock("./catalog/index-source.js", () => ({
  indexSource: vi.fn(),
}));

vi.mock("./sources.js", () => ({
  loadSources: vi.fn().mockReturnValue([]),
}));

import { indexSource } from "./catalog/index-source.js";
import { fetchSources, isCacheFresh } from "./fetch-sources.js";
import { loadSources } from "./sources.js";
import { requireState, saveState } from "./state.js";
import type { Source } from "./types.js";

const mockRequireState = vi.mocked(requireState);
const mockSaveState = vi.mocked(saveState);
const mockIndexSource = vi.mocked(indexSource);
const mockLoadSources = vi.mocked(loadSources);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockLoadSources.mockReturnValue([]);
});

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    url: "my-org/skills",
    type: "github",
    skillsInstalled: [],
    availableItems: [],
    addedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeState(sources: Source[] = []) {
  return {
    agents: [],
    sources,
    mcpServers: [],
    catalogVersion: "0.1.0",
  };
}

describe("isCacheFresh", () => {
  it("returns false when indexedAt is undefined", () => {
    expect(isCacheFresh(makeSource())).toBe(false);
  });

  it("returns false when indexedAt is older than 24h", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(isCacheFresh(makeSource({ indexedAt: old }))).toBe(false);
  });

  it("returns true when indexedAt is within 24h", () => {
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    expect(isCacheFresh(makeSource({ indexedAt: recent }))).toBe(true);
  });
});

describe("fetchSources", () => {
  it("returns empty when state is not initialized", async () => {
    mockRequireState.mockReturnValue(undefined as never);
    const results = await fetchSources();
    expect(results).toEqual([]);
  });

  it("indexes sources and saves state", async () => {
    const source = makeSource();
    mockRequireState.mockReturnValue(makeState([source]) as never);
    mockIndexSource.mockReturnValue([{ name: "debug", description: "Debugging skill", type: "skill" }]);

    const results = await fetchSources();
    expect(results).toHaveLength(1);
    expect(results[0].itemCount).toBe(1);
    expect(results[0].skipped).toBe(false);
    expect(mockSaveState).toHaveBeenCalled();
  });

  it("skips fresh cache without --force", async () => {
    const source = makeSource({ indexedAt: new Date().toISOString() });
    mockRequireState.mockReturnValue(makeState([source]) as never);

    const results = await fetchSources();
    expect(results).toHaveLength(1);
    expect(results[0].skipped).toBe(true);
    expect(mockIndexSource).not.toHaveBeenCalled();
  });

  it("re-fetches with --force even if cache is fresh", async () => {
    const source = makeSource({ indexedAt: new Date().toISOString() });
    mockRequireState.mockReturnValue(makeState([source]) as never);
    mockIndexSource.mockReturnValue([]);

    const results = await fetchSources({ force: true });
    expect(results).toHaveLength(1);
    expect(results[0].skipped).toBe(false);
    expect(mockIndexSource).toHaveBeenCalled();
  });

  it("counts new items since last fetch", async () => {
    const source = makeSource({
      availableItems: [{ name: "debug", description: "old", type: "skill" }],
    });
    mockRequireState.mockReturnValue(makeState([source]) as never);
    mockIndexSource.mockReturnValue([
      { name: "debug", description: "old", type: "skill" },
      { name: "plan", description: "new", type: "skill" },
    ]);

    const results = await fetchSources();
    expect(results[0].newItems).toBe(1);
  });

  it("handles indexSource errors gracefully", async () => {
    const source = makeSource();
    mockRequireState.mockReturnValue(makeState([source]) as never);
    mockIndexSource.mockImplementation(() => {
      throw new Error("git clone failed");
    });

    const results = await fetchSources();
    expect(results).toHaveLength(1);
    expect(results[0].error).toBe("git clone failed");
    expect(results[0].itemCount).toBe(0);
    expect(mockSaveState).toHaveBeenCalled();
  });

  it("adds registry sources to state if not already present", async () => {
    mockLoadSources.mockReturnValue([
      {
        name: "vercel-labs/skills",
        description: "Vercel skills",
        provides: ["skills"],
        category: "meta",
        recommended: true,
      },
    ]);
    const state = makeState([]);
    mockRequireState.mockReturnValue(state as never);
    mockIndexSource.mockReturnValue([]);

    await fetchSources();
    expect(state.sources).toHaveLength(1);
    expect(state.sources[0].url).toBe("vercel-labs/skills");
  });

  it("does not duplicate registry sources already in state", async () => {
    mockLoadSources.mockReturnValue([
      {
        name: "vercel-labs/skills",
        description: "Vercel skills",
        provides: ["skills"],
        category: "meta",
        recommended: true,
      },
    ]);
    const existing = makeSource({ url: "vercel-labs/skills" });
    const state = makeState([existing]);
    mockRequireState.mockReturnValue(state as never);
    mockIndexSource.mockReturnValue([]);

    await fetchSources();
    expect(state.sources).toHaveLength(1);
  });
});
