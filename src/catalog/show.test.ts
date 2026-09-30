import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "./types.js";

vi.mock("../state.js", () => ({
  loadState: vi.fn(),
}));

vi.mock("./types.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types.js")>();
  return {
    ...original,
    loadCatalog: vi.fn(),
    getSourceSkills: vi.fn(() => []),
  };
});

vi.mock("../sync/skills-sync.js", () => ({
  getSkillSources: vi.fn(() => []),
}));

vi.mock("../suggest.js", () => ({
  formatSuggestion: vi.fn(() => undefined),
}));

import { loadState } from "../state.js";
import { formatSuggestion } from "../suggest.js";
import { getSkillSources } from "../sync/skills-sync.js";
import { showCatalogItem } from "./show.js";
import { getSourceSkills, loadCatalog } from "./types.js";

const emptyCatalog: Catalog = {
  skills: [],
  mcp_servers: [],
  rules: [],
  cli_tools: [],
};

let testDir: string;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  testDir = join(tmpdir(), `show-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });

  vi.mocked(loadCatalog).mockReturnValue(emptyCatalog);
  vi.mocked(loadState).mockReturnValue(undefined);
  vi.mocked(getSourceSkills).mockReturnValue([]);
  vi.mocked(getSkillSources).mockReturnValue([]);
  vi.mocked(formatSuggestion).mockReturnValue(undefined);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("showCatalogItem", () => {
  it("shows not-found message when item does not exist", async () => {
    await showCatalogItem("nonexistent-skill");

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("not found");
  });

  it("shows suggestion when similar name exists", async () => {
    vi.mocked(formatSuggestion).mockReturnValue("Did you mean 'debug'?");

    await showCatalogItem("debu");

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("Did you mean");
  });

  it("shows catalog fallback message when no suggestion exists", async () => {
    vi.mocked(formatSuggestion).mockReturnValue(undefined);

    await showCatalogItem("xyz-does-not-exist");

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("agentbrew catalog");
  });

  it("shows MCP server details", async () => {
    vi.mocked(loadCatalog).mockReturnValue({
      ...emptyCatalog,
      mcp_servers: [
        {
          name: "my-mcp",
          description: "A test MCP server",
          command: "npx",
          args: ["my-mcp"],
          category: "dev-tools",
          recommended: false,
        },
      ],
    });

    await showCatalogItem("my-mcp");

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("my-mcp");
    expect(calls).toContain("MCP server");
    expect(calls).toContain("A test MCP server");
  });

  it("shows MCP server env vars when present", async () => {
    vi.mocked(loadCatalog).mockReturnValue({
      ...emptyCatalog,
      mcp_servers: [
        {
          name: "env-mcp",
          description: "MCP with env",
          command: "npx",
          args: ["env-mcp"],
          env: { API_KEY: "your-key", API_SECRET: "your-secret" },
          category: "dev-tools",
          recommended: false,
        },
      ],
    });

    await showCatalogItem("env-mcp");

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("API_KEY");
    expect(calls).toContain("Env:");
  });

  it("shows rule details", async () => {
    vi.mocked(loadCatalog).mockReturnValue({
      ...emptyCatalog,
      rules: [
        {
          name: "my-rule",
          description: "A test rule",
          category: "style",
          recommended: true,
          content: "# My Rule\nDo things right.",
        },
      ],
    });

    await showCatalogItem("my-rule");

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("my-rule");
    expect(calls).toContain("rule");
    expect(calls).toContain("A test rule");
  });

  it("shows CLI tool details", async () => {
    vi.mocked(loadCatalog).mockReturnValue({
      ...emptyCatalog,
      cli_tools: [
        {
          name: "my-cli",
          description: "A CLI tool",
          category: "dev-tools",
          recommended: false,
          commands: ["my-cli start", "my-cli stop"],
        },
      ],
    });

    await showCatalogItem("my-cli");

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("my-cli");
    expect(calls).toContain("CLI tool");
    expect(calls).toContain("my-cli start");
  });

  it("shows CLI tool env vars when present", async () => {
    vi.mocked(loadCatalog).mockReturnValue({
      ...emptyCatalog,
      cli_tools: [
        {
          name: "env-cli",
          description: "CLI with env",
          category: "dev-tools",
          recommended: false,
          commands: ["env-cli run"],
          env: { TOKEN: "your-token" },
        },
      ],
    });

    await showCatalogItem("env-cli");

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("TOKEN");
    expect(calls).toContain("Env vars:");
  });

  it("shows skill details from catalog", async () => {
    vi.mocked(loadCatalog).mockReturnValue({
      ...emptyCatalog,
      skills: [
        {
          name: "debug",
          description: "Debug skill",
          source: "minsky",
          category: "dev",
          recommended: true,
        },
      ],
    });

    await showCatalogItem("debug");

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("debug");
    expect(calls).toContain("skill");
  });

  it("shows SKILL.md content when local skill file exists", async () => {
    vi.mocked(loadCatalog).mockReturnValue({
      ...emptyCatalog,
      skills: [
        {
          name: "local-skill",
          description: "A local skill",
          source: "local",
          category: "dev",
          recommended: false,
        },
      ],
    });

    const skillDir = join(testDir, "local-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Local Skill\nThis is the skill content.");

    vi.mocked(getSkillSources).mockReturnValue([
      {
        label: "test-source",
        path: testDir,
        scanner: () => [skillDir],
      },
    ]);

    await showCatalogItem("local-skill");

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("This is the skill content");
  });

  it("shows install hint when no local SKILL.md is found", async () => {
    vi.mocked(loadCatalog).mockReturnValue({
      ...emptyCatalog,
      skills: [
        {
          name: "remote-skill",
          description: "A remote skill",
          source: "remote",
          category: "dev",
          recommended: false,
        },
      ],
    });

    await showCatalogItem("remote-skill");

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("Install the skill");
  });
});
