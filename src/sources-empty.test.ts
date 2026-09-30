import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:fs at module level so loadSources() returns [] (covers line 31)
vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockImplementation(() => {
    throw new Error("ENOENT: no such file");
  }),
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock("./state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, saveState: vi.fn() };
});

import { loadSources, showSources } from "./sources.js";
import { loadState } from "./state.js";

const mockLoadState = vi.mocked(loadState);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadSources — empty fallback (line 31)", () => {
  it("returns empty array when sources.yaml cannot be read", () => {
    const result = loadSources();
    expect(result).toEqual([]);
  });
});

describe("showSources — no sources at all (lines 126-128)", () => {
  it("shows 'No sources found' when both registry and personal sources are empty", () => {
    mockLoadState.mockReturnValue(undefined);

    showSources();

    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("No sources found");
    expect(output).toContain("agentbrew install");
  });
});
