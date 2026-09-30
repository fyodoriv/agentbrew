import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogCliTool, CatalogData } from "./types.js";

vi.mock("../state.js", () => ({
  loadState: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../sources.js", () => ({
  showSources: vi.fn(),
}));

vi.mock("./types.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types.js")>();
  return {
    ...original,
    loadCatalog: vi.fn().mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    }),
    getSourceSkills: vi.fn().mockReturnValue([]),
  };
});

import { showSources } from "../sources.js";
import { loadState } from "../state.js";
import { catalogToMarkdown, showCatalog } from "./browse.js";
import { getSourceSkills, loadCatalog } from "./types.js";

const mockLoadCatalog = vi.mocked(loadCatalog);
const mockLoadState = vi.mocked(loadState);
const mockShowSources = vi.mocked(showSources);
const mockGetSourceSkills = vi.mocked(getSourceSkills);

function makeCliTool(overrides: Partial<CatalogCliTool> = {}): CatalogCliTool {
  return {
    name: "test-tool",
    description: "A test CLI tool",
    category: "testing",
    recommended: false,
    commands: ["test-tool run", "test-tool check"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockLoadState.mockReturnValue(undefined);
  mockGetSourceSkills.mockReturnValue([]);
  mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [], rules: [], cli_tools: [] });
});

// ── catalogToMarkdown — cliTools section (lines 150-156) ──────────────────────

describe("catalogToMarkdown — cliTools section", () => {
  it("includes CLI Tools section when cliTools are provided (lines 150-156)", () => {
    const data: CatalogData = {
      skills: [],
      mcpServers: [],
      rules: [],
      cliTools: [makeCliTool({ name: "gh", description: "GitHub CLI", commands: ["gh pr create", "gh pr list"] })],
    };

    const markdown = catalogToMarkdown(data);

    expect(markdown).toContain("## CLI Tools");
    expect(markdown).toContain("| Name | Description | Commands | Recommended |");
    expect(markdown).toContain("gh");
    expect(markdown).toContain("GitHub CLI");
    expect(markdown).toContain("gh pr create");
  });

  it("marks recommended CLI tools with a star in markdown", () => {
    const data: CatalogData = {
      skills: [],
      mcpServers: [],
      rules: [],
      cliTools: [makeCliTool({ recommended: true })],
    };

    const markdown = catalogToMarkdown(data);

    expect(markdown).toContain("★");
  });

  it("omits CLI Tools section when cliTools array is empty", () => {
    const data: CatalogData = { skills: [], mcpServers: [], rules: [], cliTools: [] };

    const markdown = catalogToMarkdown(data);

    expect(markdown).not.toContain("## CLI Tools");
  });
});

// ── showCatalog — source skill search filter (line 216) ──────────────────────

describe("showCatalog — source skill search filter", () => {
  it("filters source skills by search term (line 216)", async () => {
    mockGetSourceSkills.mockReturnValue([
      {
        name: "special-skill",
        description: "A very unique skill",
        category: "custom",
        source: "https://github.com/org/repo",
        recommended: false,
        installed: false,
      },
      {
        name: "other-skill",
        description: "A different skill",
        category: "custom",
        source: "https://github.com/org/repo",
        recommended: false,
        installed: false,
      },
    ]);
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [], rules: [], cli_tools: [] });
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [
        {
          url: "https://github.com/org/repo",
          type: "github" as const,
          skillsInstalled: ["special-skill"],
          availableItems: [],
          addedAt: "",
        },
      ],
      mcpServers: [],
      catalogVersion: "0",
    });

    await showCatalog({ skills: true, search: "unique" });

    const allCalls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join("\n");
    expect(allCalls).toContain("special-skill");
    expect(allCalls).not.toContain("other-skill");
  });
});

// ── showCatalog — CLI Tools display (lines 267, 271-278) ─────────────────────

describe("showCatalog — CLI Tools display", () => {
  it("displays CLI tools section when cli_tools are present (lines 271-278)", async () => {
    const tool = makeCliTool({ name: "agentbrew", description: "AI agent manager", recommended: true });
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [],
      cli_tools: [tool],
    });

    await showCatalog({ cli: true });

    const allCalls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join("\n");
    expect(allCalls).toContain("agentbrew");
    expect(allCalls).toContain("AI agent manager");
  });

  it("filters CLI tools by search term (line 267)", async () => {
    const tool = makeCliTool({ name: "matching-tool", description: "matches the search" });
    const other = makeCliTool({ name: "other-tool", description: "does not match" });
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [],
      cli_tools: [tool, other],
    });

    await showCatalog({ cli: true, search: "matching" });

    const allCalls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join("\n");
    expect(allCalls).toContain("matching-tool");
    expect(allCalls).not.toContain("other-tool");
  });

  it("omits CLI Tools section when no tools match the search", async () => {
    const tool = makeCliTool({ name: "some-tool", description: "tool description" });
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [],
      cli_tools: [tool],
    });

    await showCatalog({ cli: true, search: "zzz-no-match" });

    const allCalls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join("\n");
    expect(allCalls).not.toContain("CLI Tools");
  });

  it("calls showSources when sources option is set", async () => {
    await showCatalog({ sources: true });
    expect(mockShowSources).toHaveBeenCalledWith(expect.objectContaining({ showFooter: false }));
  });
});

// ── showCatalog — deprecation filter (Phase 2 of catalog-deprecation-markers) ─

describe("showCatalog — deprecation filter", () => {
  it("hides deprecated MCP servers by default", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [
        { name: "current-server", description: "Active server", category: "test", recommended: false },
        {
          name: "old-server",
          description: "Deprecated server",
          category: "test",
          recommended: false,
          deprecated: { since: "2026-05-26", reason: "Sunset" },
        },
      ],
      rules: [],
      cli_tools: [],
    });

    await showCatalog({ mcp: true });

    const allCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");
    expect(allCalls).toContain("current-server");
    expect(allCalls).not.toContain("old-server");
  });

  it("shows deprecated MCP servers with --include-deprecated flag + (deprecated) badge", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [
        { name: "current-server", description: "Active", category: "test", recommended: false },
        {
          name: "old-server",
          description: "Sunset",
          category: "test",
          recommended: false,
          deprecated: { since: "2026-05-26", reason: "Sunset", replacement: "current-server" },
        },
      ],
      rules: [],
      cli_tools: [],
    });

    await showCatalog({ mcp: true, includeDeprecated: true });

    const allCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");
    expect(allCalls).toContain("current-server");
    expect(allCalls).toContain("old-server");
    expect(allCalls).toContain("(deprecated)");
  });

  it("hides deprecated rules and CLI tools by default", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        { name: "current-rule", description: "Active", category: "test", recommended: false, content: "rule body" },
        {
          name: "old-rule",
          description: "Sunset",
          category: "test",
          recommended: false,
          content: "rule body",
          deprecated: { since: "2026-05-26", reason: "Replaced" },
        },
      ],
      cli_tools: [
        makeCliTool({ name: "current-tool" }),
        makeCliTool({
          name: "old-tool",
          deprecated: { since: "2026-05-26", reason: "Sunset" },
        }),
      ],
    });

    await showCatalog({});

    const allCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");
    expect(allCalls).toContain("current-rule");
    expect(allCalls).toContain("current-tool");
    expect(allCalls).not.toContain("old-rule");
    expect(allCalls).not.toContain("old-tool");
  });

  it("--include-deprecated affects all 4 catalog entry types", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "old-skill",
          description: "Sunset",
          source: "test",
          category: "test",
          recommended: false,
          deprecated: { since: "2026-05-26", reason: "Sunset" },
        },
      ],
      mcp_servers: [
        {
          name: "old-mcp",
          description: "Sunset",
          category: "test",
          recommended: false,
          deprecated: { since: "2026-05-26", reason: "Sunset" },
        },
      ],
      rules: [
        {
          name: "old-rule",
          description: "Sunset",
          category: "test",
          recommended: false,
          content: "x",
          deprecated: { since: "2026-05-26", reason: "Sunset" },
        },
      ],
      cli_tools: [
        makeCliTool({
          name: "old-cli",
          deprecated: { since: "2026-05-26", reason: "Sunset" },
        }),
      ],
    });

    await showCatalog({ includeDeprecated: true });

    const allCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");
    expect(allCalls).toContain("old-skill");
    expect(allCalls).toContain("old-mcp");
    expect(allCalls).toContain("old-rule");
    expect(allCalls).toContain("old-cli");
  });

  it("deprecation filter applies to --json output too (via getCatalogData)", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [
        { name: "current-server", description: "Active", category: "test", recommended: false },
        {
          name: "old-server",
          description: "Sunset",
          category: "test",
          recommended: false,
          deprecated: { since: "2026-05-26", reason: "Sunset" },
        },
      ],
      rules: [],
      cli_tools: [],
    });

    // Default (no --include-deprecated): old-server hidden from JSON
    await showCatalog({ mcp: true, format: "json" });
    let jsonOut = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");
    expect(jsonOut).toContain("current-server");
    expect(jsonOut).not.toContain("old-server");

    // With --include-deprecated: old-server appears in JSON
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [
        { name: "current-server", description: "Active", category: "test", recommended: false },
        {
          name: "old-server",
          description: "Sunset",
          category: "test",
          recommended: false,
          deprecated: { since: "2026-05-26", reason: "Sunset" },
        },
      ],
      rules: [],
      cli_tools: [],
    });
    await showCatalog({ mcp: true, format: "json", includeDeprecated: true });
    jsonOut = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");
    expect(jsonOut).toContain("current-server");
    expect(jsonOut).toContain("old-server");
  });
});
