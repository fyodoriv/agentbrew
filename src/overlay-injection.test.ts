/**
 * Executable overlay adapters and overlay agents were removed in 1.0 (#208).
 * A legacy `team:` block left in state.yaml must load no code and add no agent.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, saveState: vi.fn() };
});

import { loadAgentDefinitions, resetAgentDefinitionsCache } from "./core/agents.js";
import { getAdapter } from "./mcp/adapters.js";
import { loadState } from "./state.js";

describe("legacy team overlay state after 1.0", () => {
  it("never loads an overlay adapter and never merges overlay agents", () => {
    const tmp = mkdtempSync(join(tmpdir(), "legacy-overlay-"));
    const marker = join(tmp, "ran");
    const adapterDir = join(tmp, "overlay-desktop");
    mkdirSync(adapterDir);
    writeFileSync(join(adapterDir, "adapter.js"), `require("fs").writeFileSync(${JSON.stringify(marker)}, "x");`);
    const agentsPath = join(tmp, "agents.yaml");
    writeFileSync(agentsPath, "- name: overlay-desktop\n  skillsDir: ~/.overlay/skills\n");
    vi.mocked(loadState).mockReturnValue({
      agents: [],
      team: { label: "t", url: "u", adapterDirs: [adapterDir], agentsOverlayPath: agentsPath },
    } as never);

    expect(() => getAdapter({ name: "overlay-desktop", mcpFormat: "overlay-desktop" })).toThrow(/No MCP adapter/);
    resetAgentDefinitionsCache();
    expect(loadAgentDefinitions().some((a) => a.name === "overlay-desktop")).toBe(false);
    expect(require("node:fs").existsSync(marker)).toBe(false);
  });
});
