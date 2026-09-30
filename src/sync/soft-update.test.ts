import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state.js", () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
  requireState: vi.fn(),
}));

vi.mock("../catalog/index-source.js", () => ({
  getSourceCachePath: vi.fn(),
}));

import { getSourceCachePath } from "../catalog/index-source.js";
import { loadState, saveState } from "../state.js";
import type { AgentBrewState, Source } from "../types.js";
import {
  CATALOG_SOURCE_CACHE_TTL_MS,
  formatSoftUpdateSummary,
  isAgentbrewProvidedSkillSource,
  softUpdateStaleOverlaySources,
} from "./soft-update.js";

const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);
const mockGetSourceCachePath = vi.mocked(getSourceCachePath);

// Deterministic clock for TTL assertions — avoids Date.now() drift across suites.
const NOW_MS = Date.parse("2026-01-15T12:00:00.000Z");

/** Build a minimal state object with just the sources we care about. */
function makeState(sources: Source[]): AgentBrewState {
  return {
    sources,
    mcpServers: [],
    agents: [],
    catalogVersion: "0.1.0",
  } as AgentBrewState;
}

/** Default source factory — override just the fields each test needs. */
function catalogSource(overrides: Partial<Source> = {}): Source {
  return {
    url: "your-org/example-app",
    type: "github",
    skillsInstalled: [],
    availableItems: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    origin: "catalog",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSourceCachePath.mockReturnValue("/fake/cache/path");
});

describe("softUpdateStaleOverlaySources", () => {
  it("returns an empty result when state is missing", () => {
    mockLoadState.mockReturnValue(undefined);
    const result = softUpdateStaleOverlaySources({ now: NOW_MS });
    expect(result).toEqual({ refreshed: [], fresh: [], failed: [] });
    expect(mockGetSourceCachePath).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("returns an empty result when there are no sources", () => {
    mockLoadState.mockReturnValue(makeState([]));
    const result = softUpdateStaleOverlaySources({ now: NOW_MS });
    expect(result).toEqual({ refreshed: [], fresh: [], failed: [] });
    expect(mockGetSourceCachePath).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("ignores user-origin and agentfile-origin sources", () => {
    mockLoadState.mockReturnValue(
      makeState([
        catalogSource({ url: "user/added", origin: "user", indexedAt: "2020-01-01T00:00:00.000Z" }),
        catalogSource({ url: "agentfile/added", origin: "agentfile", indexedAt: "2020-01-01T00:00:00.000Z" }),
        catalogSource({ url: "project/added", origin: "project", indexedAt: "2020-01-01T00:00:00.000Z" }),
      ]),
    );

    const result = softUpdateStaleOverlaySources({ now: NOW_MS });
    expect(result.refreshed).toEqual([]);
    expect(result.fresh).toEqual([]);
    expect(mockGetSourceCachePath).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("refetches stale team-overlay and global Agentfile sources", () => {
    const staleAt = new Date(NOW_MS - (CATALOG_SOURCE_CACHE_TTL_MS + 60 * 1000)).toISOString();
    const teamSource = catalogSource({ url: "org/team-skills", origin: "team:acme", indexedAt: staleAt });
    const globalSource = catalogSource({ url: "org/global-skills", origin: "global", indexedAt: staleAt });
    mockLoadState.mockReturnValue(makeState([teamSource, globalSource]));

    const result = softUpdateStaleOverlaySources({ now: NOW_MS });
    expect(result.refreshed.sort()).toEqual(["org/global-skills", "org/team-skills"]);
    expect(mockGetSourceCachePath).toHaveBeenCalledTimes(2);
  });

  it("skips catalog-origin sources whose indexedAt is within the TTL", () => {
    // 10 min old — well within the 30-min TTL.
    const tenMinAgo = new Date(NOW_MS - 10 * 60 * 1000).toISOString();
    mockLoadState.mockReturnValue(makeState([catalogSource({ indexedAt: tenMinAgo })]));

    const result = softUpdateStaleOverlaySources({ now: NOW_MS });
    expect(result.fresh).toEqual(["your-org/example-app"]);
    expect(result.refreshed).toEqual([]);
    // No network hit within TTL — this is the "quiet on repeat runs" contract.
    expect(mockGetSourceCachePath).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("refetches catalog-origin sources older than the TTL", () => {
    // 31 min old — just past the 30-min TTL.
    const thirtyOneMinAgo = new Date(NOW_MS - (CATALOG_SOURCE_CACHE_TTL_MS + 60 * 1000)).toISOString();
    const source = catalogSource({ indexedAt: thirtyOneMinAgo });
    mockLoadState.mockReturnValue(makeState([source]));

    const result = softUpdateStaleOverlaySources({ now: NOW_MS });
    expect(result.refreshed).toEqual(["your-org/example-app"]);
    expect(result.fresh).toEqual([]);
    expect(mockGetSourceCachePath).toHaveBeenCalledWith(source);
    // indexedAt must advance so the next run is a fast no-op.
    expect(source.indexedAt).toBe(new Date(NOW_MS).toISOString());
    expect(mockSaveState).toHaveBeenCalledTimes(1);
  });

  it("treats missing indexedAt as stale", () => {
    const source = catalogSource({ indexedAt: undefined });
    mockLoadState.mockReturnValue(makeState([source]));

    const result = softUpdateStaleOverlaySources({ now: NOW_MS });
    expect(result.refreshed).toEqual(["your-org/example-app"]);
    expect(mockGetSourceCachePath).toHaveBeenCalledWith(source);
    expect(source.indexedAt).toBe(new Date(NOW_MS).toISOString());
  });

  it("treats malformed indexedAt as stale", () => {
    const source = catalogSource({ indexedAt: "not-an-iso-date" });
    mockLoadState.mockReturnValue(makeState([source]));

    const result = softUpdateStaleOverlaySources({ now: NOW_MS });
    expect(result.refreshed).toEqual(["your-org/example-app"]);
    expect(source.indexedAt).toBe(new Date(NOW_MS).toISOString());
  });

  it("classifies sources as failed when getSourceCachePath returns undefined (offline)", () => {
    mockGetSourceCachePath.mockReturnValue(undefined);
    const source = catalogSource({ indexedAt: undefined });
    mockLoadState.mockReturnValue(makeState([source]));

    const result = softUpdateStaleOverlaySources({ now: NOW_MS });
    expect(result.failed).toEqual(["your-org/example-app"]);
    expect(result.refreshed).toEqual([]);
    // indexedAt is not advanced so the next run will retry (no stuck-stale state).
    expect(source.indexedAt).toBeUndefined();
    // No state save when nothing actually refreshed.
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("classifies sources as failed when getSourceCachePath throws", () => {
    mockGetSourceCachePath.mockImplementation(() => {
      throw new Error("git clone failed: permission denied");
    });
    const source = catalogSource({ indexedAt: undefined });
    mockLoadState.mockReturnValue(makeState([source]));

    // Must not rethrow — sync must never crash on a refresh failure.
    const result = softUpdateStaleOverlaySources({ now: NOW_MS });
    expect(result.failed).toEqual(["your-org/example-app"]);
    expect(result.refreshed).toEqual([]);
    expect(source.indexedAt).toBeUndefined();
  });

  it("processes multiple overlay sources independently — one failure does not abort the rest", () => {
    mockGetSourceCachePath.mockImplementation((source: Source) => {
      if (source.url === "your-org/broken") return undefined;
      return "/fake/cache/path";
    });
    const sources = [
      catalogSource({ url: "your-org/example-app", indexedAt: undefined }),
      catalogSource({ url: "your-org/broken", indexedAt: undefined }),
      catalogSource({ url: "your-org/team-skills", indexedAt: undefined }),
    ];
    mockLoadState.mockReturnValue(makeState(sources));

    const result = softUpdateStaleOverlaySources({ now: NOW_MS });
    expect(result.refreshed.sort()).toEqual(["your-org/example-app", "your-org/team-skills"]);
    expect(result.failed).toEqual(["your-org/broken"]);
    // State still saved once because at least one source refreshed.
    expect(mockSaveState).toHaveBeenCalledTimes(1);
  });

  it("does not save state when nothing refreshed", () => {
    // All sources fresh.
    const recent = new Date(NOW_MS - 5 * 60 * 1000).toISOString();
    mockLoadState.mockReturnValue(
      makeState([catalogSource({ url: "a/b", indexedAt: recent }), catalogSource({ url: "c/d", indexedAt: recent })]),
    );

    softUpdateStaleOverlaySources({ now: NOW_MS });
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("uses Date.now() when no `now` is passed", () => {
    // Sanity check that the seam defaults to real time without crashing.
    mockLoadState.mockReturnValue(makeState([]));
    expect(() => softUpdateStaleOverlaySources()).not.toThrow();
  });
});

describe("isAgentbrewProvidedSkillSource", () => {
  it("treats catalog, global, and team overlay origins as agentbrew-managed", () => {
    expect(isAgentbrewProvidedSkillSource(catalogSource({ origin: "catalog" }))).toBe(true);
    expect(isAgentbrewProvidedSkillSource(catalogSource({ origin: "global" }))).toBe(true);
    expect(isAgentbrewProvidedSkillSource(catalogSource({ origin: "team:acme" }))).toBe(true);
  });

  it("does not treat user, agentfile, or project origins as agentbrew-managed", () => {
    expect(isAgentbrewProvidedSkillSource(catalogSource({ origin: "user" }))).toBe(false);
    expect(isAgentbrewProvidedSkillSource(catalogSource({ origin: "agentfile" }))).toBe(false);
    expect(isAgentbrewProvidedSkillSource(catalogSource({ origin: "project" }))).toBe(false);
    expect(isAgentbrewProvidedSkillSource(catalogSource({ origin: undefined }))).toBe(false);
  });
});

describe("formatSoftUpdateSummary", () => {
  it("returns undefined when nothing happened (no catalog sources)", () => {
    const summary = formatSoftUpdateSummary({ refreshed: [], fresh: [], failed: [] });
    expect(summary).toBeUndefined();
  });

  it("returns undefined when everything was fresh (keep repeat runs quiet)", () => {
    const summary = formatSoftUpdateSummary({ refreshed: [], fresh: ["a/b", "c/d"], failed: [] });
    expect(summary).toBeUndefined();
  });

  it("names the refresh counts when at least one source was refreshed", () => {
    const summary = formatSoftUpdateSummary({ refreshed: ["a/b"], fresh: ["c/d"], failed: [] });
    expect(summary).toContain("1 refreshed");
    expect(summary).toContain("1 cached");
  });

  it("flags offline failures in yellow so users notice", () => {
    const summary = formatSoftUpdateSummary({ refreshed: [], fresh: [], failed: ["a/b"] });
    expect(summary).toContain("1 offline");
  });
});
