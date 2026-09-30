import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the single state module used by both adapters.ts and agents.ts so we
// control state.team without touching the developer's real ~/.config state.
vi.mock("./state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, saveState: vi.fn() };
});

import { loadAgentDefinitions, resetAgentDefinitionsCache } from "./core/agents.js";
import { getAdapter, resetOverlayAdapterCache } from "./mcp/adapters.js";
import { loadState } from "./state.js";

const mockedLoadState = vi.mocked(loadState);

// A minimal CommonJS adapter conforming to McpFormatAdapter — what a team
// overlay ships at adapters/<format>/adapter.js.
const STUB_ADAPTER = `
class StubAdapter {
  readEntries() { return {}; }
  writeEntries() {}
  toEntry() { return { stub: true }; }
  entriesMatch() { return false; }
  applyUpdate() {}
  isPrunable() { return true; }
  discoverServers() { return []; }
  removeServer() { return false; }
}
module.exports = StubAdapter;
`;

function teamWith(extra: Record<string, unknown>): unknown {
  return { agents: [], team: { label: "t", url: "u", cachedAt: "", lastSyncedAt: "", ...extra } };
}

describe("overlay MCP-format adapter injection", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "overlay-adapter-"));
    mockedLoadState.mockReset();
    resetOverlayAdapterCache();
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    resetOverlayAdapterCache();
  });

  it("loads an overlay adapter for a non-core format from state.team.adapterDirs", () => {
    const dir = join(tmp, "example-fmt");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "adapter.js"), STUB_ADAPTER);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", main: "adapter.js", type: "commonjs" }));
    mockedLoadState.mockReturnValue(teamWith({ adapterDirs: [dir] }) as never);

    const adapter = getAdapter({ name: "agent-x", mcpFormat: "example-fmt" });
    expect(adapter.toEntry({} as never, "agent-x")).toEqual({ stub: true });
  });

  it("returns a core adapter for core formats without reading state", () => {
    const adapter = getAdapter({ name: "a", mcpFormat: "json" });
    expect(adapter).toBeDefined();
    expect(mockedLoadState).not.toHaveBeenCalled();
  });

  it("throws a clear error for an unknown format with no overlay", () => {
    mockedLoadState.mockReturnValue({ agents: [], team: undefined } as never);
    expect(() => getAdapter({ name: "a", mcpFormat: "no-such-format" })).toThrow(
      /No MCP adapter for format "no-such-format"/,
    );
  });

  it("ignores an overlay dir whose basename does not match the format", () => {
    const dir = join(tmp, "other-fmt");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "adapter.js"), STUB_ADAPTER);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", main: "adapter.js", type: "commonjs" }));
    mockedLoadState.mockReturnValue(teamWith({ adapterDirs: [dir] }) as never);

    expect(() => getAdapter({ name: "a", mcpFormat: "example-fmt" })).toThrow(/No MCP adapter/);
  });
});

describe("overlay agent injection", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "overlay-agents-"));
    mockedLoadState.mockReset();
    resetAgentDefinitionsCache();
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    resetAgentDefinitionsCache();
  });

  it("merges overlay agents from state.team.agentsOverlayPath", () => {
    const overlayYaml = join(tmp, "agents-overlay.yaml");
    writeFileSync(overlayYaml, "- name: my-overlay-agent\n  skillsDir: ~/.my-overlay/skills\n");
    mockedLoadState.mockReturnValue(teamWith({ agentsOverlayPath: overlayYaml }) as never);

    const agents = loadAgentDefinitions();
    expect(agents.some((a) => a.name === "my-overlay-agent")).toBe(true);
    // Core agents still load alongside the overlay agent.
    expect(agents.length).toBeGreaterThan(1);
  });

  it("does not merge overlay agents when no team is set", () => {
    mockedLoadState.mockReturnValue({ agents: [], team: undefined } as never);
    const agents = loadAgentDefinitions();
    expect(agents.some((a) => a.name === "my-overlay-agent")).toBe(false);
    expect(agents.length).toBeGreaterThan(0);
  });

  it("core wins on a name collision with an overlay agent", () => {
    const overlayYaml = join(tmp, "agents-overlay.yaml");
    // Re-declare an existing core agent name with a bogus skillsDir.
    const coreName = loadAgentDefinitions()[0]?.name ?? "claude-code";
    resetAgentDefinitionsCache();
    writeFileSync(overlayYaml, `- name: ${coreName}\n  skillsDir: ~/.bogus-overlay/skills\n`);
    mockedLoadState.mockReturnValue(teamWith({ agentsOverlayPath: overlayYaml }) as never);

    const agents = loadAgentDefinitions();
    const matches = agents.filter((a) => a.name === coreName);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.skillsDir).not.toContain("bogus-overlay");
  });
});
