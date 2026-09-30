import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadState } from "../state.js";
import type { Source } from "../types.js";
import { getSourceSkills, loadBaseCatalog, loadCatalog, matchesSearch } from "./types.js";

vi.mock("../state.js", () => ({
  loadState: vi.fn(() => undefined),
}));

const mockLoadState = vi.mocked(loadState);

describe("matchesSearch", () => {
  it("matches case-insensitively", () => {
    expect(matchesSearch("React Best Practices", "react")).toBe(true);
    expect(matchesSearch("react", "REACT")).toBe(true);
  });

  it("returns false when no match", () => {
    expect(matchesSearch("typescript", "python")).toBe(false);
  });

  it("matches partial substrings", () => {
    expect(matchesSearch("playwright-best-practices", "play")).toBe(true);
  });

  it("matches empty search against any text", () => {
    expect(matchesSearch("anything", "")).toBe(true);
  });
});

describe("getSourceSkills", () => {
  const makeSource = (overrides: Partial<Source> = {}): Source => ({
    url: "https://github.com/org/repo",
    type: "github",
    skillsInstalled: [],
    availableItems: [],
    addedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("returns empty array when no sources", () => {
    expect(getSourceSkills([])).toEqual([]);
  });

  it("returns empty array when sources have no availableItems", () => {
    const sources = [makeSource()];
    expect(getSourceSkills(sources)).toEqual([]);
  });

  it("transforms available items into DisplaySkill format", () => {
    const sources = [
      makeSource({
        url: "https://github.com/org/skills",
        availableItems: [{ name: "my-skill", description: "Does things", type: "skill" }],
      }),
    ];

    const result = getSourceSkills(sources);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "my-skill",
      description: "Does things",
      source: "https://github.com/org/skills",
      category: "community",
      recommended: false,
      installed: false,
    });
  });

  it("marks installed skills correctly", () => {
    const sources = [
      makeSource({
        skillsInstalled: ["installed-one"],
        availableItems: [
          { name: "installed-one", description: "Installed", type: "skill" },
          { name: "not-installed", description: "Not installed", type: "skill" },
        ],
      }),
    ];

    const result = getSourceSkills(sources);
    expect(result.find((s) => s.name === "installed-one")?.installed).toBe(true);
    expect(result.find((s) => s.name === "not-installed")?.installed).toBe(false);
  });

  it("collects skills from multiple sources", () => {
    const sources = [
      makeSource({
        url: "https://github.com/org/a",
        availableItems: [{ name: "skill-a", description: "A", type: "skill" }],
      }),
      makeSource({
        url: "https://github.com/org/b",
        availableItems: [{ name: "skill-b", description: "B", type: "skill" }],
      }),
    ];

    const result = getSourceSkills(sources);
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe("https://github.com/org/a");
    expect(result[1].source).toBe("https://github.com/org/b");
  });

  it("handles sources with undefined availableItems", () => {
    const sources = [makeSource({ availableItems: undefined })];
    expect(getSourceSkills(sources)).toEqual([]);
  });
});

describe("catalog loading boundaries", () => {
  it("keeps the base loader independent from a configured team overlay", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "agentbrew-catalog-"));
    const overlayPath = join(fixtureDir, "catalog-overlay.yaml");
    writeFileSync(
      overlayPath,
      [
        "mcp_servers:",
        "  - name: overlay-only-static-analysis-fixture",
        "    description: Overlay-only fixture",
        "    category: test",
        "    recommended: false",
        "",
      ].join("\n"),
    );
    mockLoadState.mockReturnValue({
      team: { catalogOverlayPath: overlayPath },
    } as never);

    try {
      const runtimeCatalog = loadCatalog();
      const baseCatalog = loadBaseCatalog();

      expect(runtimeCatalog.mcp_servers.some((server) => server.name === "overlay-only-static-analysis-fixture")).toBe(
        true,
      );
      expect(baseCatalog.mcp_servers.some((server) => server.name === "overlay-only-static-analysis-fixture")).toBe(
        false,
      );
    } finally {
      mockLoadState.mockReturnValue(undefined);
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
