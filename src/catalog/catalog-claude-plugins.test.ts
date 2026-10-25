/** `claude_plugins` entries show in `agentbrew catalog` and `--search`, and are never recommended. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = {
  name: "demo-guard",
  description: "Guards the usage window",
  category: "guardrails",
  recommended: false,
  repo: "example/demo-guard",
  commit: "0123456789abcdef0123456789abcdef01234567",
  plugin: "demo-guard",
  marketplace: "demo-market",
};

vi.mock("../state.js", () => ({ loadState: vi.fn().mockReturnValue(undefined) }));
vi.mock("../sources.js", () => ({ showSources: vi.fn() }));
vi.mock("./types.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types.js")>();
  return {
    ...original,
    loadCatalog: vi.fn(() => ({ skills: [], mcp_servers: [], rules: [], cli_tools: [], claude_plugins: [plugin] })),
    getSourceSkills: vi.fn().mockReturnValue([]),
  };
});

import { showCatalog } from "./browse.js";

const printed = () => (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("catalog listing of Claude Code plugins", () => {
  it("lists them, with the pinned commit, in the full catalog", async () => {
    await showCatalog({});
    expect(printed()).toContain("Claude Code Plugins");
    expect(printed()).toContain("demo-guard");
    expect(printed()).toContain("0123456789ab");
  });

  it("finds them with --search", async () => {
    await showCatalog({ search: "usage window" });
    expect(printed()).toContain("demo-guard");
    expect(printed()).not.toContain("No results");
  });

  it("includes them in --json output", async () => {
    await showCatalog({ format: "json" });
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    const json = JSON.parse(String(calls.at(-1)?.[0]));
    expect(json.claudePlugins).toEqual([expect.objectContaining({ name: "demo-guard", commit: plugin.commit })]);
  });
});
