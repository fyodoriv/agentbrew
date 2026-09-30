import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, saveState: vi.fn() };
});

import { loadSources, showSources } from "./sources.js";
import { loadState } from "./state.js";

/**
 * Capture the JSON payload from `showSources({ json: true })` by reading
 * the global console.log spy's mock.calls. Same migration shape as PR #921 /
 * #922 / #923 / #924: edge-case tests now ride through the public API
 * surface (the `--json` flag exposed via `agentbrew catalog --sources --json`)
 * instead of importing `collectSourcesData` directly.
 */
function captureSourcesJson(options?: { search?: string }): {
  registry: Array<{ name: string }>;
  personal: Array<{ url: string }>;
} {
  const beforeCount = vi.mocked(console.log).mock.calls.length;
  showSources({ json: true, search: options?.search });
  const afterCount = vi.mocked(console.log).mock.calls.length;
  const newCalls = vi.mocked(console.log).mock.calls.slice(beforeCount, afterCount);
  const payload = newCalls.map((call) => call.join(" ")).join("\n");
  return JSON.parse(payload);
}

const mockLoadState = vi.mocked(loadState);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadSources", () => {
  it("returns an array of sources from sources.yaml", () => {
    const sources = loadSources();
    expect(Array.isArray(sources)).toBe(true);
    expect(sources.length).toBeGreaterThan(0);
  });

  it("each source has required fields", () => {
    const sources = loadSources();
    for (const source of sources) {
      expect(source.name).toBeDefined();
      expect(typeof source.name).toBe("string");
      expect(source.description).toBeDefined();
      expect(typeof source.description).toBe("string");
      expect(Array.isArray(source.provides)).toBe(true);
      expect(source.provides.length).toBeGreaterThan(0);
      expect(typeof source.category).toBe("string");
      expect(typeof source.recommended).toBe("boolean");
    }
  });

  it("contains known official sources", () => {
    const sources = loadSources();
    const names = sources.map((s) => s.name);
    expect(names).toContain("anthropics/skills");
    expect(names).toContain("vercel-labs/agent-skills");
    expect(names).toContain("obra/superpowers");
  });
});

describe("showSources", () => {
  it("displays registry sources when no state exists", () => {
    mockLoadState.mockReturnValue(undefined);

    showSources();

    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("Registry Sources");
  });

  it("shows footer by default", () => {
    mockLoadState.mockReturnValue(undefined);

    showSources();

    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("★ = recommended");
    expect(output).toContain("registry");
  });

  it("hides footer when showFooter is false", () => {
    mockLoadState.mockReturnValue(undefined);

    showSources({ showFooter: false });

    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).not.toContain("★ = recommended");
  });

  it("filters sources by search term", () => {
    mockLoadState.mockReturnValue(undefined);

    showSources({ search: "anthropic" });

    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("anthropics/skills");
  });

  it("shows personal sources when state has custom sources", () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [
        {
          url: "my-org/custom-skills",
          type: "github" as const,
          addedAt: "2025-06-01T00:00:00.000Z",
          skillsInstalled: ["my-skill"],
          availableItems: [],
          commitSha: "abc12345deadbeef",
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    showSources();

    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("Personal Sources");
    expect(output).toContain("my-org/custom-skills");
    expect(output).toContain("abc12345");
  });

  it("labels catalog-origin sources distinctly from user-added ones", () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [
        {
          url: "user/manual-add",
          type: "github" as const,
          addedAt: "2025-06-01T00:00:00.000Z",
          skillsInstalled: [],
          availableItems: [],
          origin: "user",
        },
        {
          url: "your-org/example-app",
          type: "github" as const,
          addedAt: "2025-06-01T00:00:00.000Z",
          skillsInstalled: [],
          availableItems: [],
          origin: "catalog",
        },
        {
          url: "myteam/agentfile-pinned",
          type: "github" as const,
          addedAt: "2025-06-01T00:00:00.000Z",
          skillsInstalled: [],
          availableItems: [],
          origin: "agentfile",
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    showSources();

    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    // Only catalog-origin sources get the [overlay] tag (so users know
    // these will disappear on `agentbrew team unset`).
    expect(output).toContain("your-org/example-app");
    expect(output).toContain("[overlay]");
    // User-added sources have no origin tag.
    expect(output).toContain("user/manual-add");
    // Agentfile-pinned sources get an [agentfile] tag for symmetry.
    expect(output).toContain("[agentfile]");
  });

  it("outputs valid JSON when json option is true", () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [
        {
          url: "my-org/custom-skills",
          type: "github" as const,
          addedAt: "2025-06-01T00:00:00.000Z",
          skillsInstalled: ["my-skill"],
          availableItems: [],
          commitSha: "abc12345deadbeef",
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    showSources({ json: true });

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const data = JSON.parse(output);
    expect(data.registry).toBeDefined();
    expect(Array.isArray(data.registry)).toBe(true);
    expect(data.personal).toBeDefined();
    expect(data.personal[0].url).toBe("my-org/custom-skills");
    expect(data.personal[0].skills).toEqual(["my-skill"]);
  });
});

describe("showSources --json", () => {
  it("returns structured registry and personal sources", () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [
        {
          url: "my-org/repo",
          type: "github" as const,
          addedAt: "2025-06-01",
          skillsInstalled: ["s1"],
          availableItems: [],
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    const data = captureSourcesJson();
    expect(data.registry.length).toBeGreaterThan(0);
    expect(data.personal).toHaveLength(1);
    expect(data.personal[0].url).toBe("my-org/repo");
  });

  it("filters by search term", () => {
    mockLoadState.mockReturnValue(undefined);
    const data = captureSourcesJson({ search: "anthropic" });
    expect(data.registry.some((s) => s.name.includes("anthropic"))).toBe(true);
  });

  it("filters personal sources by search term (line 57)", () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [
        {
          url: "my-org/typescript-skills",
          type: "github" as const,
          addedAt: "2025-06-01",
          skillsInstalled: [],
          availableItems: [],
        },
        {
          url: "my-org/react-skills",
          type: "github" as const,
          addedAt: "2025-06-01",
          skillsInstalled: [],
          availableItems: [],
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    const data = captureSourcesJson({ search: "typescript" });
    expect(data.personal.some((s) => s.url.includes("typescript"))).toBe(true);
    expect(data.personal.every((s) => s.url.includes("typescript"))).toBe(true);
  });
});

describe("showSources — personal sources search filter (line 111)", () => {
  it("filters personal sources by search when search term is provided", () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [
        {
          url: "my-org/typescript-skills",
          type: "github" as const,
          addedAt: "2025-06-01",
          skillsInstalled: [],
          availableItems: [],
        },
        {
          url: "my-org/react-skills",
          type: "github" as const,
          addedAt: "2025-06-01",
          skillsInstalled: [],
          availableItems: [],
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    showSources({ search: "typescript" });

    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("typescript-skills");
    expect(output).not.toContain("react-skills");
  });
});
