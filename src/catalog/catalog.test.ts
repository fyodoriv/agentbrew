import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, McpServer, SkillSourceDir, Source } from "../types.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    cpSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

vi.mock("../state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, saveState: vi.fn() };
});

vi.mock("../sync/mcp-sync.js", () => ({
  addMcpServer: vi.fn(),
}));

vi.mock("../sync/rules-sync.js", () => ({
  loadSharedRules: vi.fn(() => undefined),
  saveSharedRules: vi.fn(),
}));

vi.mock("../sync/skills-sync.js", () => ({
  getSkillSources: vi.fn(() => []),
}));

vi.mock("./index-source.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./index-source.js")>();
  return {
    ...original,
    classifyGitError: vi.fn(() => "Check your internet connection and that the URL is correct."),
    getSourceCachePath: vi.fn(),
    isGitHubEnterprise: vi.fn(() => false),
    isSourceFailed: vi.fn(() => false),
    scanDirectoryForSkills: vi.fn(() => []),
  };
});

vi.mock("../add-source.js", () => ({
  detectSourceType: vi.fn((source: string) => {
    if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(source)) return "github";
    if (source.startsWith("/")) return "local";
    return "url";
  }),
  registerSkillSourceDir: vi.fn(),
}));

import { cpSync } from "node:fs";
import { registerSkillSourceDir } from "../add-source.js";
import { buildSchedulerDeepSmokeMap } from "../mcp/catalog-smoke.js";
import { loadState, saveState } from "../state.js";
import { addMcpServer } from "../sync/mcp-sync.js";
import { loadSharedRules, saveSharedRules } from "../sync/rules-sync.js";
import { getSkillSources } from "../sync/skills-sync.js";
import { catalogToJson, catalogToMarkdown, getCatalogData, showCatalog } from "./browse.js";
import { getSourceCachePath, scanDirectoryForSkills } from "./index-source.js";
import { findInAllSources, flushInstallSummary, install } from "./install.js";
import { resetSourceFallbackAnnounced } from "./install-skill.js";
import { mockSkillCacheExists } from "./mock-skill-cache-exists.js";
import { showCatalogItem } from "./show.js";
import { getSourceSkills, loadCatalog } from "./types.js";

const mockGetSkillSources = vi.mocked(getSkillSources);

const mockCpSync = vi.mocked(cpSync);
const mockGetSourceCachePath = vi.mocked(getSourceCachePath);
const mockLoadState = vi.mocked(loadState);
const mockAddMcpServer = vi.mocked(addMcpServer);
const mockSaveState = vi.mocked(saveState);
const mockScanDirectoryForSkills = vi.mocked(scanDirectoryForSkills);
const mockRegisterSkillSourceDir = vi.mocked(registerSkillSourceDir);
const mockLoadSharedRules = vi.mocked(loadSharedRules);
const mockSaveSharedRules = vi.mocked(saveSharedRules);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Default: getSourceCachePath returns a fake cache path
  mockGetSourceCachePath.mockReturnValue("/cache/obra_superpowers");
  // Reset the source-fallback banner-dedup cache so each test starts clean and
  // sees the banner (first-skill-per-source behavior) rather than the compact
  // "also selected" line.
  resetSourceFallbackAnnounced();
});

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    agents: [] as AgentConfig[],
    sources: [] as Source[],
    mcpServers: [] as McpServer[],
    catalogVersion: "0.1.0",
    skillSourceDirs: [] as SkillSourceDir[],
    ...overrides,
  };
}

describe("showCatalog", () => {
  it("shows all sections by default", async () => {
    mockLoadState.mockReturnValue(makeState());
    await showCatalog({});
    expect(console.log).toHaveBeenCalled();
  });

  it("shows only skills when filtered", async () => {
    mockLoadState.mockReturnValue(makeState());
    await showCatalog({ skills: true });
    expect(console.log).toHaveBeenCalled();
  });

  it("shows only mcp when filtered", async () => {
    mockLoadState.mockReturnValue(makeState());
    await showCatalog({ mcp: true });
    expect(console.log).toHaveBeenCalled();
  });

  it("shows only rules when filtered", async () => {
    mockLoadState.mockReturnValue(makeState());
    await showCatalog({ rules: true });
    expect(console.log).toHaveBeenCalled();
  });

  it("filters by search term", async () => {
    mockLoadState.mockReturnValue(makeState());
    await showCatalog({ search: "react" });
    expect(console.log).toHaveBeenCalled();
  });

  it("shows source skills alongside built-in", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        sources: [
          {
            url: "my-org/skills",
            type: "github",
            skillsInstalled: ["custom-skill"],
            availableItems: [
              { name: "custom-skill", description: "A custom skill", type: "skill" },
              { name: "another-skill", description: "Another one", type: "skill" },
            ],
            addedAt: "2026-01-01",
            indexedAt: "2026-01-01",
          },
        ],
      }),
    );
    await showCatalog({ skills: true });
    expect(console.log).toHaveBeenCalled();
  });
});

describe("install", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await install("test");
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("shows popular items when no name and no --recommended", async () => {
    mockLoadState.mockReturnValue(makeState());
    await install(undefined);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Popular skills"));
  });

  it("warns when name not found in catalog or sources", async () => {
    mockLoadState.mockReturnValue(makeState());
    await install("nonexistent-thing-xyz");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found in catalog or sources"));
  });

  it("installs MCP server from catalog by name", async () => {
    mockLoadState.mockReturnValue(makeState());
    await install("context7");
    expect(mockAddMcpServer).toHaveBeenCalled();
  });

  it("installs skill from added source using native git cache", async () => {
    const source: Source = {
      url: "my-org/skills",
      type: "github",
      skillsInstalled: [],
      availableItems: [{ name: "my-custom-skill", description: "Custom", type: "skill" }],
      addedAt: "2026-01-01",
    };
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/my-org_skills");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/my-org_skills", "my-custom-skill");
    await install("my-custom-skill");
    expect(mockGetSourceCachePath).toHaveBeenCalled();
    expect(mockCpSync).toHaveBeenCalled();
    expect(mockSaveState).toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  it("skips install and reports already-installed when skill dir exists", async () => {
    const source: Source = {
      url: "my-org/skills",
      type: "github",
      skillsInstalled: ["my-custom-skill"],
      availableItems: [{ name: "my-custom-skill", description: "Custom", type: "skill" }],
      addedAt: "2026-01-01",
    };
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    // Skill already in installed-skills dir
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(true);
    await install("my-custom-skill");
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
    // "already installed" is batched — flush to print summary
    flushInstallSummary();
    const allOutput = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(allOutput).toContain("already installed");
    existsSpy.mockRestore();
  });

  it("reports failure when source cache is unavailable", async () => {
    const source: Source = {
      url: "my-org/skills",
      type: "github",
      skillsInstalled: [],
      availableItems: [{ name: "my-custom-skill", description: "Custom", type: "skill" }],
      addedAt: "2026-01-01",
    };
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue(undefined);
    await install("my-custom-skill");
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to fetch"));
  });

  it("reports failure when skill not found in cache", async () => {
    const source: Source = {
      url: "my-org/skills",
      type: "github",
      skillsInstalled: [],
      availableItems: [{ name: "ghost-skill", description: "Ghost", type: "skill" }],
      addedAt: "2026-01-01",
    };
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/my-org_skills");
    // existsSync returns false — SKILL.md not found in any candidate dir
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    await install("ghost-skill");
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found in"));
    existsSpy.mockRestore();
  });

  it("registers source dir when skill not found but source contains skills", async () => {
    const source: Source = {
      url: "my-org/skill-registry",
      type: "github",
      skillsInstalled: [],
      availableItems: [{ name: "skill-registry", description: "Registry", type: "skill" }],
      addedAt: "2026-01-01",
    };
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/my-org_skill-registry");
    // existsSync returns false — no individual skill found in cache
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    // scanDirectoryForSkills returns skills found in the source root
    mockScanDirectoryForSkills.mockReturnValue([
      { name: "skill-a", description: "Skill A", type: "skill" },
      { name: "skill-b", description: "Skill B", type: "skill" },
    ]);
    await install("skill-registry");
    expect(mockRegisterSkillSourceDir).toHaveBeenCalledWith(
      expect.any(Object),
      "my-org/skill-registry",
      expect.arrayContaining([
        expect.objectContaining({ name: "skill-a", type: "skill" }),
        expect.objectContaining({ name: "skill-b", type: "skill" }),
      ]),
    );
    expect(mockSaveState).toHaveBeenCalled();
    // Message now names the source URL and the selected skill explicitly (see
    // `sync-source-install-dedup-and-messaging`). Match the banner + count.
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Registered source my-org/skill-registry"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("2 skills available"));
    existsSpy.mockRestore();
    mockScanDirectoryForSkills.mockReturnValue([]);
  });

  it("installs recommended items", async () => {
    mockLoadState.mockReturnValue(makeState());
    await install(undefined, { recommended: true });
    expect(console.log).toHaveBeenCalled();
  });

  it("installs a catalog rule and writes to shared-rules.md", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadSharedRules.mockReturnValue("# Existing rules\n");
    await install("conventional-commits");
    expect(mockSaveSharedRules).toHaveBeenCalledWith(expect.stringContaining("conventional-commits"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("added to shared-rules.md"));
  });

  it("reports already present when rule marker exists in shared-rules.md", async () => {
    // Dedup is marker-based — if `<!-- rule: conventional-commits -->`
    // already appears in shared-rules.md, installing the rule is a no-op
    // regardless of whether the body matches the catalog version exactly.
    mockLoadState.mockReturnValue(makeState());
    mockLoadSharedRules.mockReturnValue(
      "# Rules\n\n<!-- rule: conventional-commits -->\nHand-written version of this rule.\n",
    );
    await install("conventional-commits");
    expect(mockSaveSharedRules).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("already present"));
  });

  it("reports skipped when no shared-rules.md exists", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadSharedRules.mockReturnValue(undefined);
    await install("conventional-commits");
    expect(mockSaveSharedRules).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("No shared rules file found"));
  });
});

describe("getCatalogData", () => {
  beforeEach(() => {
    mockLoadState.mockReturnValue(makeState());
  });

  it("returns all sections when no filter specified", () => {
    const data = getCatalogData({});
    expect(data.skills.length).toBeGreaterThan(0);
    expect(data.mcpServers.length).toBeGreaterThan(0);
    expect(data.rules.length).toBeGreaterThan(0);
  });

  it("filters to skills only", () => {
    const data = getCatalogData({ skills: true });
    expect(data.skills.length).toBeGreaterThan(0);
    expect(data.mcpServers).toHaveLength(0);
    expect(data.rules).toHaveLength(0);
  });

  it("filters to mcp only", () => {
    const data = getCatalogData({ mcp: true });
    expect(data.skills).toHaveLength(0);
    expect(data.mcpServers.length).toBeGreaterThan(0);
    expect(data.rules).toHaveLength(0);
  });

  it("applies search filter", () => {
    const all = getCatalogData({});
    const filtered = getCatalogData({ search: "zzzzz_nonexistent" });
    expect(filtered.skills.length).toBeLessThan(all.skills.length);
  });
});

describe("strategic-review in catalog", () => {
  it("includes strategic-review skill in catalog data", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ skills: true });
    const strategicReview = data.skills.find((s) => s.name === "strategic-review");
    expect(strategicReview).toBeDefined();
    expect(strategicReview!.description).toContain("strategic");
    expect(strategicReview!.category).toBe("quality");
    expect(strategicReview!.recommended).toBe(true);
  });

  it("finds strategic-review via search", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ search: "strategic" });
    expect(data.skills.some((s) => s.name === "strategic-review")).toBe(true);
  });

  it("finds strategic-review via pivot search", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ search: "pivot" });
    expect(data.skills.some((s) => s.name === "strategic-review")).toBe(true);
  });
});

describe("browser-harness in catalog", () => {
  it("includes browser-harness skill in catalog data with the browser-use/browser-harness source", () => {
    // browser-harness is the second OSS browser harness in the catalog
    // (alongside agent-browser and actionbook). Pin name, source and
    // category so a future refactor can't silently drop the entry or
    // shove it into mcp_servers (it has no MCP protocol — see the
    // catalog-add-browser-harness task body for the wrong-bucket
    // analysis).
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ skills: true });
    const browserHarness = data.skills.find((s) => s.name === "browser-harness");
    expect(browserHarness).toBeDefined();
    expect(browserHarness!.source).toBe("browser-use/browser-harness");
    expect(browserHarness!.category).toBe("browser");
    // recommended: false — agent-browser stays the default for production
    // browser automation; browser-harness is the experimental
    // self-modifying alternative. The recommendation flip would be a
    // separate strategic call.
    expect(browserHarness!.recommended).toBe(false);
  });

  it("disambiguates browser-harness from agent-browser in the description", () => {
    // Both skills overlap in the browser-automation space but solve the
    // same problem with different philosophies (raw CDP self-modifying vs
    // pre-built CLI). The description must reference agent-browser so
    // users don't install both expecting them to compose.
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ skills: true });
    const browserHarness = data.skills.find((s) => s.name === "browser-harness");
    expect(browserHarness).toBeDefined();
    expect(browserHarness!.description).toMatch(/agent-browser/u);
  });
});

describe("tinyfish in catalog", () => {
  it("includes tinyfish MCP server in the web category with hosted-SaaS configuration", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ mcp: true });
    const tinyfish = data.mcpServers.find((s) => s.name === "tinyfish");
    expect(tinyfish).toBeDefined();
    expect(tinyfish!.category).toBe("web");
    expect(tinyfish!.recommended).toBe(false);
  });

  it("disambiguates tinyfish from local browser-automation MCPs in the description", () => {
    // tinyfish is hosted SaaS; playwright/agent-browser are local. The
    // catalog description must call out the difference so users don't
    // install all three thinking they overlap.
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ mcp: true });
    const tinyfish = data.mcpServers.find((s) => s.name === "tinyfish");
    expect(tinyfish).toBeDefined();
    // Description must reference at least one neighbour by name to be
    // useful disambiguation text.
    const description = tinyfish!.description;
    const mentionsNeighbour = /playwright|hosted/iu.test(description);
    expect(mentionsNeighbour).toBe(true);
  });
});

describe("skill source ownership", () => {
  it("keeps migrated skills on one upstream or personal source", () => {
    mockLoadState.mockReturnValue(makeState());

    const catalog = loadCatalog();
    const skillsByName = new Map(catalog.skills.map((skill) => [skill.name, skill]));
    const expectedSources = {
      "grill-with-docs": "mattpocock/skills",
      "improve-codebase-architecture": "mattpocock/skills",
      "doubt-driven-development": "addyosmani/agent-skills",
      "spec-driven-development": "addyosmani/agent-skills",
      prototype: "mattpocock/skills",
      handoff: "fyodoriv/agentbrew",
      "to-issues": "fyodoriv/agentbrew",
      analyze: "fyodoriv/agentbrew",
      "ubiquitous-language": "fyodoriv/agentbrew",
      caveman: "fyodoriv/agentbrew",
      "project-audit": "fyodoriv/agentbrew",
      "git-diagnose-codebase": "fyodoriv/agentbrew",
      "strategic-review": "fyodoriv/agentbrew",
      iterate: "fyodoriv/agentbrew",
      rfc: "fyodoriv/agentbrew",
      "markdown-for-gdoc": "fyodoriv/agentbrew",
      "writing-plans": "fyodoriv/agentbrew",
      "task-command-center": "fyodoriv/agentbrew",
      "cli-design": "fyodoriv/agentbrew",
      "companion-researcher": "fyodoriv/agentbrew",
      "companion-competitor-watch": "fyodoriv/agentbrew",
      "companion-docs-sync": "fyodoriv/agentbrew",
      "companion-skill-curate": "fyodoriv/agentbrew",
      "companion-task-groom": "fyodoriv/agentbrew",
      "companion-test-gaps": "fyodoriv/agentbrew",
      grind: "fyodoriv/agentbrew",
      "grind-report": "fyodoriv/agentbrew",
      sweep: "fyodoriv/agentbrew",
      "update-tooling": "fyodoriv/dotfiles",
    } as const;

    for (const [name, source] of Object.entries(expectedSources)) {
      expect(skillsByName.get(name)?.source, name).toBe(source);
    }

    for (const removedName of ["grill", "arch", "doubt", "spec", "autoresearch"]) {
      expect(skillsByName.has(removedName), removedName).toBe(false);
    }

    expect(new Set(catalog.skills.map((skill) => skill.name)).size).toBe(catalog.skills.length);
  });
});

describe("catalog MCP smoke calls", () => {
  // A `probeSuppression` with a reason documents that the probe cannot get far
  // enough to call a smoke tool (Figma's per-client OAuth, for example), so the
  // requirement does not apply to those entries.
  it("requires every recommended MCP server to declare a smokeCall or say why it cannot", () => {
    mockLoadState.mockReturnValue(makeState());

    const missing = loadCatalog()
      .mcp_servers.filter((server) => server.recommended)
      .filter((server) => !server.smokeCall && !server.probeSuppression?.reason)
      .map((server) => server.name);

    expect(missing).toEqual([]);
  });

  it("keeps profile-owning browser MCPs isolated for multi-agent probes", () => {
    mockLoadState.mockReturnValue(makeState());

    const catalog = loadCatalog();
    const browserMcpNames = ["playwright", "chrome-devtools"];
    const missing = browserMcpNames.filter((name) => {
      const server = catalog.mcp_servers.find((entry) => entry.name === name);
      return !server?.args?.includes("--isolated");
    });

    expect(missing).toEqual([]);
  });

  it("pins playwright to the stable Chrome channel, not bundled Chrome-for-Testing", () => {
    mockLoadState.mockReturnValue(makeState());

    const catalog = loadCatalog();
    const playwright = catalog.mcp_servers.find((entry) => entry.name === "playwright");
    const args = playwright?.args ?? [];
    const browserIdx = args.indexOf("--browser");

    expect(browserIdx).toBeGreaterThanOrEqual(0);
    expect(args[browserIdx + 1]).toBe("chrome");
  });

  it("keeps every browser-category MCP smoke call out of scheduler probes", () => {
    mockLoadState.mockReturnValue(makeState());

    const catalog = loadCatalog();
    const schedulerMap = buildSchedulerDeepSmokeMap(catalog);
    const browserNames = catalog.mcp_servers.filter((entry) => entry.category === "browser").map((entry) => entry.name);

    expect(browserNames).toContain("playwright");
    expect(browserNames).toContain("chrome-devtools");
    expect(browserNames.filter((name) => schedulerMap.has(name))).toEqual([]);
  });

  it("does not recommend ask-human-mcp while its stdio launcher is broken", () => {
    mockLoadState.mockReturnValue(makeState());

    const askHuman = loadCatalog().mcp_servers.find((server) => server.name === "ask-human");

    expect(askHuman?.recommended).toBe(false);
    expect(askHuman?.note).toContain("Already running asyncio in this thread");
    expect(askHuman?.probeSuppression).toEqual({
      statuses: ["init_timeout"],
      reason: expect.stringContaining("Already running asyncio in this thread"),
      retryPolicy: "probe-every-tick-no-heal-until-catalog-change",
    });
  });
});

describe("code-context MCP catalog entries", () => {
  it("confirms context7 is recommended stdio docs MCP with smokeCall", () => {
    mockLoadState.mockReturnValue(makeState());

    const context7 = loadCatalog().mcp_servers.find((server) => server.name === "context7");

    expect(context7?.recommended).toBe(true);
    expect(context7?.command).toBe("npx");
    expect(context7?.args).toContain("@upstash/context7-mcp@latest");
    expect(context7?.smokeCall?.tool).toBe("resolve-library-id");
  });

  it("registers sourcegraph as HTTP MCP with token setup wizard", () => {
    mockLoadState.mockReturnValue(makeState());

    const sourcegraph = loadCatalog().mcp_servers.find((server) => server.name === "sourcegraph");

    expect(sourcegraph).toBeDefined();
    expect(sourcegraph!.url).toBe("${SOURCEGRAPH_URL}/.api/mcp");
    expect(sourcegraph!.headers?.Authorization).toBe("token ${SOURCEGRAPH_ACCESS_TOKEN}");
    expect(sourcegraph!.setup?.SOURCEGRAPH_URL?.steps?.length).toBeGreaterThan(0);
    expect(sourcegraph!.setup?.SOURCEGRAPH_ACCESS_TOKEN?.steps?.length).toBeGreaterThan(0);
    expect(sourcegraph!.smokeCall?.tool).toBe("list_repos");
  });

  it("registers composio as HTTP MCP replacing per-vendor SaaS connectors", () => {
    mockLoadState.mockReturnValue(makeState());
    const catalog = loadCatalog();

    const composio = catalog.mcp_servers.find((server) => server.name === "composio");
    expect(composio).toBeDefined();
    expect(composio!.url).toBe("https://connect.composio.dev/mcp");
    expect(composio!.headers?.["x-consumer-api-key"]).toBe("${COMPOSIO_CONSUMER_API_KEY}");
    expect(composio!.setup?.COMPOSIO_CONSUMER_API_KEY?.steps?.length).toBeGreaterThan(0);
    expect(composio!.smokeCall?.tool).toBe("COMPOSIO_SEARCH_TOOLS");

    expect(catalog.mcp_servers.some((server) => server.name === "notion")).toBe(false);
    expect(catalog.mcp_servers.some((server) => server.name === "atlassian")).toBe(false);
  });
});

describe("tasks-mcp in catalog", () => {
  it("uses a Node 18 compatible package version", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ mcp: true });
    const tasksMcp = data.mcpServers.find((s) => s.name === "tasks-mcp");
    expect(tasksMcp).toBeDefined();
    expect(tasksMcp!.command).toBe("npx");
    expect(tasksMcp!.args).toEqual(["-y", "tasks-mcp@0.10.2"]);
  });
});

describe("memory in catalog", () => {
  it("uses the local semantic SQLite backend without cloud credentials", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ mcp: true });
    const memory = data.mcpServers.find((server) => server.name === "memory");
    expect(memory).toBeDefined();
    expect(memory!.command).toBe("uvx");
    expect(memory!.args).toEqual(["--system-certs", "--from", "mcp-memory-service[sqlite]", "memory", "server"]);
    expect(memory!.env).toEqual({
      MCP_MEMORY_STORAGE_BACKEND: "sqlite_vec",
      MCP_HYBRID_FUSION_METHOD: "rrf",
    });
    expect(memory!.category).toBe("memory");
  });
});

describe("skillclaw in catalog", () => {
  it("includes skillclaw MCP server in catalog data with the memory category", () => {
    // SkillClaw is skill-evolution rather than memory, but per the open
    // question in the catalog-add task: don't create a single-entry
    // category prematurely. Sits in `memory` next to mempalace + openviking
    // until a second skill-evolution entry surfaces.
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ mcp: true });
    const skillclaw = data.mcpServers.find((s) => s.name === "skillclaw");
    expect(skillclaw).toBeDefined();
    expect(skillclaw!.category).toBe("memory");
    expect(skillclaw!.recommended).toBe(false);
  });

  it("disambiguates skillclaw from memory MCPs in the description", () => {
    // SkillClaw is skill-evolution, not memory. The catalog description
    // must spell out the protocol difference so users don't install all
    // three (mempalace + openviking + skillclaw) thinking they overlap.
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ mcp: true });
    const skillclaw = data.mcpServers.find((s) => s.name === "skillclaw");
    expect(skillclaw).toBeDefined();
    const description = skillclaw!.description;
    const mentionsNeighbour = /mempalace|openviking|memory/iu.test(description);
    expect(mentionsNeighbour).toBe(true);
  });
});

describe("mempalace in catalog", () => {
  it("includes mempalace MCP server in catalog data with the memory category", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ mcp: true });
    const mempalace = data.mcpServers.find((s) => s.name === "mempalace");
    expect(mempalace).toBeDefined();
    expect(mempalace!.category).toBe("memory");
    // recommended: false stays per the catalog-add task body — memory MCPs
    // are per-user opinion (each user picks between mempalace, openviking).
    expect(mempalace!.recommended).toBe(false);
  });

  it("flags the functional overlap with openviking in the description", () => {
    // Both mempalace and openviking are local-first memory MCPs. The
    // catalog description must spell out the overlap so users don't
    // install both expecting them to compose.
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ mcp: true });
    const mempalace = data.mcpServers.find((s) => s.name === "mempalace");
    expect(mempalace).toBeDefined();
    expect(mempalace!.description).toMatch(/openviking/u);
  });
});

describe("methodology skill sources in catalog", () => {
  it("includes ce-compound from EveryInc/compound-engineering-plugin", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ skills: true });
    const skill = data.skills.find((s) => s.name === "ce-compound");
    expect(skill).toBeDefined();
    expect(skill!.source).toBe("EveryInc/compound-engineering-plugin");
    expect(skill!.recommended).toBe(true);
  });

  it("includes qa from garrytan/gstack as recommended testing skill", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ skills: true });
    const skill = data.skills.find((s) => s.name === "qa");
    expect(skill).toBeDefined();
    expect(skill!.source).toBe("garrytan/gstack");
    expect(skill!.recommended).toBe(true);
    expect(skill!.category).toBe("testing");
  });

  it("indexes all three methodology sources in sources.yaml-backed catalog", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ skills: true });
    const sources = new Set(
      data.skills
        .filter((s) =>
          ["obra/superpowers", "EveryInc/compound-engineering-plugin", "garrytan/gstack"].includes(s.source ?? ""),
        )
        .map((s) => s.source),
    );
    expect(sources).toEqual(new Set(["obra/superpowers", "EveryInc/compound-engineering-plugin", "garrytan/gstack"]));
    expect(data.skills.filter((s) => s.source === "obra/superpowers").length).toBeGreaterThanOrEqual(13);
    expect(data.skills.filter((s) => s.source === "EveryInc/compound-engineering-plugin").length).toBe(29);
    expect(data.skills.filter((s) => s.source === "garrytan/gstack").length).toBe(16);
  });
});

describe("impeccable in catalog", () => {
  it("includes impeccable skill in catalog data with the pbakaus/impeccable source", () => {
    // Previously the `pbakaus/impeccable` source was registered in
    // sources.yaml but had no matching entry under `skills:` in catalog.yaml,
    // so `agentbrew catalog` and `agentbrew install` couldn't surface it. This
    // test pins the gap closure.
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ skills: true });
    const impeccable = data.skills.find((s) => s.name === "impeccable");
    expect(impeccable).toBeDefined();
    expect(impeccable!.source).toBe("pbakaus/impeccable");
    expect(impeccable!.category).toBe("design");
    // recommended: false stays — taste is already recommended in the same
    // category, and design skills are per-taste choices.
    expect(impeccable!.recommended).toBe(false);
  });

  it("disambiguates impeccable from taste / frontend-design / web-design-guidelines in the description", () => {
    // Multiple design skills share the catalog. The description has to
    // spell out the difference vs the other design skills in the catalog so users
    // don't install all four expecting them to compose.
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ skills: true });
    const impeccable = data.skills.find((s) => s.name === "impeccable");
    expect(impeccable).toBeDefined();
    // Description must reference at least one neighbour by name to be
    // useful disambiguation text.
    const description = impeccable!.description;
    const mentionsNeighbour =
      description.includes("taste") || description.includes("frontend-design") || description.includes("web-design");
    expect(mentionsNeighbour).toBe(true);
  });
});

describe("getCatalogData — installed flag for builtin catalog skills", () => {
  it("marks a builtin catalog skill as installed when its source URL has it in skillsInstalled", () => {
    // brainstorming is in catalog.yaml with source: obra/superpowers
    mockLoadState.mockReturnValue(
      makeState({
        sources: [
          {
            url: "obra/superpowers",
            type: "github" as const,
            skillsInstalled: ["brainstorming"],
            availableItems: [],
            addedAt: "",
          },
        ],
      }),
    );

    const data = getCatalogData({ skills: true });
    const brainstorming = data.skills.find((s) => s.name === "brainstorming");
    expect(brainstorming).toBeDefined();
    expect(brainstorming?.installed).toBe(true);
  });

  it("leaves a builtin catalog skill as not installed when absent from skillsInstalled", () => {
    mockLoadState.mockReturnValue(
      makeState({
        sources: [
          {
            url: "obra/superpowers",
            type: "github" as const,
            skillsInstalled: [],
            availableItems: [],
            addedAt: "",
          },
        ],
      }),
    );

    const data = getCatalogData({ skills: true });
    const brainstorming = data.skills.find((s) => s.name === "brainstorming");
    expect(brainstorming?.installed).toBe(false);
  });

  it("does not mark skill as installed when a different source URL has it", () => {
    mockLoadState.mockReturnValue(
      makeState({
        sources: [
          {
            url: "some-other/repo",
            type: "github" as const,
            skillsInstalled: ["brainstorming"],
            availableItems: [],
            addedAt: "",
          },
        ],
      }),
    );

    const data = getCatalogData({ skills: true });
    const brainstorming = data.skills.find((s) => s.name === "brainstorming");
    expect(brainstorming?.installed).toBe(false);
  });

  it("marks multiple catalog skills installed from different sources simultaneously", () => {
    mockLoadState.mockReturnValue(
      makeState({
        sources: [
          {
            url: "obra/superpowers",
            type: "github" as const,
            skillsInstalled: ["brainstorming"],
            availableItems: [],
            addedAt: "",
          },
          {
            url: "anthropics/skills",
            type: "github" as const,
            skillsInstalled: ["frontend-design"],
            availableItems: [],
            addedAt: "",
          },
        ],
      }),
    );

    const data = getCatalogData({ skills: true });
    expect(data.skills.find((s) => s.name === "brainstorming")?.installed).toBe(true);
    expect(data.skills.find((s) => s.name === "frontend-design")?.installed).toBe(true);
    expect(data.skills.find((s) => s.name === "qa")?.installed).toBe(false);
  });
});

describe("catalogToJson", () => {
  it("outputs valid JSON with all sections", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({});
    const json = catalogToJson(data);
    const parsed = JSON.parse(json);
    expect(parsed.skills).toBeDefined();
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.rules).toBeDefined();
    expect(Array.isArray(parsed.skills)).toBe(true);
  });

  it("includes expected fields on skills", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ skills: true });
    const parsed = JSON.parse(catalogToJson(data));
    if (parsed.skills.length > 0) {
      const skill = parsed.skills[0];
      expect(skill).toHaveProperty("name");
      expect(skill).toHaveProperty("description");
      expect(skill).toHaveProperty("recommended");
      expect(skill).toHaveProperty("installed");
    }
  });
});

describe("catalogToMarkdown", () => {
  it("outputs markdown tables with headers", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({});
    const md = catalogToMarkdown(data);
    expect(md).toContain("## Skills");
    expect(md).toContain("| Name |");
    expect(md).toContain("|------|");
  });

  it("includes MCP Servers section", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ mcp: true });
    const md = catalogToMarkdown(data);
    expect(md).toContain("## MCP Servers");
    expect(md).toContain("| Command |");
  });

  it("returns empty string when no data", () => {
    mockLoadState.mockReturnValue(makeState());
    const data = getCatalogData({ skills: true, search: "zzzzz_nonexistent" });
    const md = catalogToMarkdown(data);
    expect(md).toBe("");
  });
});

describe("findInAllSources", () => {
  it("returns empty array when no sources match", () => {
    const state = {
      sources: [
        {
          url: "a/repo",
          type: "github" as const,
          skillsInstalled: [],
          availableItems: [{ name: "other", description: "", type: "skill" as const }],
          addedAt: "",
        },
      ],
    };
    expect(findInAllSources(state, "missing")).toEqual([]);
  });

  it("returns single match", () => {
    const state = {
      sources: [
        {
          url: "a/repo",
          type: "github" as const,
          skillsInstalled: [],
          availableItems: [{ name: "debug", description: "Debugging", type: "skill" as const }],
          addedAt: "",
        },
      ],
    };
    const results = findInAllSources(state, "debug");
    expect(results).toHaveLength(1);
    expect(results[0].source.url).toBe("a/repo");
    expect(results[0].item.name).toBe("debug");
  });

  it("returns multiple matches from different sources", () => {
    const state = {
      sources: [
        {
          url: "a/repo",
          type: "github" as const,
          skillsInstalled: [],
          availableItems: [{ name: "debug", description: "A version", type: "skill" as const }],
          addedAt: "",
        },
        {
          url: "b/repo",
          type: "github" as const,
          skillsInstalled: [],
          availableItems: [{ name: "debug", description: "B version", type: "skill" as const }],
          addedAt: "",
        },
      ],
    };
    const results = findInAllSources(state, "debug");
    expect(results).toHaveLength(2);
    expect(results[0].source.url).toBe("a/repo");
    expect(results[1].source.url).toBe("b/repo");
  });

  it("skips sources with no availableItems", () => {
    const state = {
      sources: [{ url: "a/repo", type: "github" as const, skillsInstalled: [], availableItems: [], addedAt: "" }],
    };
    expect(findInAllSources(state, "debug")).toEqual([]);
  });
});

describe("install --from", () => {
  it("warns when source not found", async () => {
    mockLoadState.mockReturnValue(makeState());
    await install("debug", { from: "unknown/repo" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("warns when item not in specified source", async () => {
    const state = makeState();
    state.sources = [
      {
        url: "a/repo",
        type: "github" as const,
        skillsInstalled: [],
        availableItems: [{ name: "other", description: "", type: "skill" as const }],
        addedAt: "",
      },
    ];
    mockLoadState.mockReturnValue(state);
    await install("debug", { from: "a/repo" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found in source"));
  });

  it("installs from specified source using native cache", async () => {
    const state = makeState();
    state.sources = [
      {
        url: "a/repo",
        type: "github" as const,
        skillsInstalled: [],
        availableItems: [{ name: "debug", description: "Debugging", type: "skill" as const }],
        addedAt: "",
      },
    ];
    mockLoadState.mockReturnValue(state);
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "debug");
    await install("debug", { from: "a/repo" });
    expect(mockGetSourceCachePath).toHaveBeenCalled();
    expect(mockCpSync).toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

describe("showCatalogItem", () => {
  beforeEach(() => {
    mockLoadState.mockReturnValue(makeState());
    mockGetSkillSources.mockReturnValue([]);
  });

  it("shows skill details from catalog", async () => {
    await showCatalogItem("qa");
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("qa");
    expect(calls).toContain("skill");
  });

  it("shows MCP server details", async () => {
    await showCatalogItem("context7");
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("context7");
    expect(calls).toContain("MCP server");
    expect(calls).toContain("Command:");
  });

  it("shows rule details with content", async () => {
    await showCatalogItem("conventional-commits");
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("rule");
  });

  it("warns when item not found", async () => {
    await showCatalogItem("nonexistent-item-xyz");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("shows source skill details", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        sources: [
          {
            url: "my-org/skills",
            type: "github",
            skillsInstalled: ["custom-skill"],
            availableItems: [{ name: "custom-skill", description: "A custom skill", type: "skill" }],
            addedAt: "2026-01-01",
          },
        ],
      }),
    );
    await showCatalogItem("custom-skill");
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("custom-skill");
    expect(calls).toContain("skill");
  });

  it("shows SKILL.md content when locally available", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const testDir = mkdtempSync(join(tmpdir(), "catalog-show-"));
    const skillDir = join(testDir, "my-local-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: my-local-skill\n---\n\n## Steps\n\n1. Do the thing");

    mockGetSkillSources.mockReturnValue([
      {
        label: "test-source",
        path: testDir,
        scanner: (sourcePath: string) => {
          const { readdirSync, existsSync } = require("node:fs");
          return readdirSync(sourcePath)
            .map((e: string) => join(sourcePath, e))
            .filter((p: string) => existsSync(join(p, "SKILL.md")));
        },
      },
    ]);

    // Use a catalog skill name that matches our local skill
    mockLoadState.mockReturnValue(
      makeState({
        sources: [
          {
            url: "test/repo",
            type: "github",
            skillsInstalled: [],
            availableItems: [{ name: "my-local-skill", description: "Test", type: "skill" }],
            addedAt: "2026-01-01",
          },
        ],
      }),
    );

    await showCatalogItem("my-local-skill");
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("SKILL.md");
    expect(calls).toContain("Do the thing");
  });
});

describe("install — catalog skills use native cache", () => {
  it("copies skill files via cpSync for catalog skills", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockGetSourceCachePath.mockReturnValue("/cache/obra_superpowers");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/obra_superpowers", "test-driven-development");

    await install("test-driven-development");

    expect(mockGetSourceCachePath).toHaveBeenCalled();
    expect(mockCpSync).toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

describe("showCatalog with format", () => {
  beforeEach(() => {
    mockLoadState.mockReturnValue(makeState());
  });

  it("outputs JSON when format is json", async () => {
    await showCatalog({ format: "json" });
    const output = String((console.log as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("outputs markdown when format is markdown", async () => {
    await showCatalog({ format: "markdown" });
    const output = String((console.log as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(output).toContain("## Skills");
  });
});

describe("getSourceSkills", () => {
  function makeSource(overrides: Partial<Source> = {}): Source {
    return {
      url: "test/repo",
      type: "github",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "",
      ...overrides,
    };
  }

  it("marks skills listed in skillsInstalled as installed", () => {
    const source = makeSource({
      url: "tasksmd/tasks.md",
      skillsInstalled: ["next-task"],
      availableItems: [{ name: "next-task", description: "Pick next task", type: "skill" }],
    });

    const skills = getSourceSkills([source]);

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("next-task");
    expect(skills[0].installed).toBe(true);
  });

  it("marks skills absent from skillsInstalled as not installed", () => {
    const source = makeSource({
      url: "tasksmd/tasks.md",
      skillsInstalled: [],
      availableItems: [{ name: "next-task", description: "Pick next task", type: "skill" }],
    });

    const skills = getSourceSkills([source]);

    expect(skills[0].installed).toBe(false);
  });

  it("returns empty array when sources have no availableItems", () => {
    const source = makeSource({ availableItems: [] });

    const skills = getSourceSkills([source]);

    expect(skills).toHaveLength(0);
  });

  it("collects skills from multiple sources", () => {
    const sources = [
      makeSource({
        url: "tasksmd/tasks.md",
        skillsInstalled: ["next-task"],
        availableItems: [{ name: "next-task", description: "", type: "skill" }],
      }),
      makeSource({
        url: "obra/superpowers",
        skillsInstalled: [],
        availableItems: [{ name: "brainstorming", description: "", type: "skill" }],
      }),
    ];

    const skills = getSourceSkills(sources);

    expect(skills).toHaveLength(2);
    expect(skills.find((s) => s.name === "next-task")?.installed).toBe(true);
    expect(skills.find((s) => s.name === "brainstorming")?.installed).toBe(false);
  });

  it("sets source url as the skill's source field", () => {
    const source = makeSource({
      url: "tasksmd/tasks.md",
      availableItems: [{ name: "next-task", description: "", type: "skill" }],
    });

    const skills = getSourceSkills([source]);

    expect(skills[0].source).toBe("tasksmd/tasks.md");
  });

  it("handles sources with undefined availableItems gracefully", () => {
    const source = { ...makeSource(), availableItems: undefined as unknown as [] };

    const skills = getSourceSkills([source]);

    expect(skills).toHaveLength(0);
  });
});
