import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../utils.js")>();
  return { ...original, expandHome: vi.fn((p: string) => p) };
});
vi.mock("../state.js", () => ({ loadState: vi.fn() }));

import { loadState } from "../state.js";
import { syncModels } from "../sync/model-sync.js";
import type { AgentBrewState } from "../types.js";
import { expandHome } from "../utils.js";
import { checkModelsDrift } from "./models.js";

let testDir: string;
let settingsPath: string;

function state(overrides: Partial<AgentBrewState> = {}): AgentBrewState {
  return {
    agents: [{ name: "claude-code", detected: true, skillsDir: "~/.claude/skills" }],
    catalogVersion: "1",
    defaultModel: "claude-5-fable-max",
    ...overrides,
  };
}

function writeSettings(content: Record<string, unknown>): void {
  writeFileSync(settingsPath, `${JSON.stringify(content, null, 2)}\n`);
}

beforeEach(() => {
  testDir = join(tmpdir(), `models-drift-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(testDir, ".claude"), { recursive: true });
  settingsPath = join(testDir, ".claude", "settings.json");
  vi.mocked(expandHome).mockImplementation((p: string) => p.replace(/^~/, testDir));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("checkModelsDrift", () => {
  it("reports a manually flipped model as one drift issue naming the agent and expected model", () => {
    vi.mocked(loadState).mockReturnValue(state());
    writeSettings({ model: "some-other-model" });

    const drift = checkModelsDrift();

    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ agent: "claude-code", type: "models" });
    expect(drift[0].detail).toContain("claude-5-fable-max");
    expect(drift[0].detail).toContain("some-other-model");
  });

  it("does not write the config file", () => {
    vi.mocked(loadState).mockReturnValue(state());
    writeSettings({ model: "some-other-model" });

    checkModelsDrift();

    expect(JSON.parse(readFileSync(settingsPath, "utf-8")).model).toBe("some-other-model");
  });

  it("is clean after sync repairs the model", async () => {
    vi.mocked(loadState).mockReturnValue(state());
    writeSettings({ model: "some-other-model" });

    await syncModels({ quiet: true });

    expect(checkModelsDrift()).toEqual([]);
  });

  it("is clean when no defaultModel is set", () => {
    vi.mocked(loadState).mockReturnValue(state({ defaultModel: undefined }));
    writeSettings({ model: "some-other-model" });

    expect(checkModelsDrift()).toEqual([]);
  });

  it("skips an agent whose override is null", () => {
    vi.mocked(loadState).mockReturnValue(state({ modelOverrides: { "claude-code": null } }));
    writeSettings({ model: "some-other-model" });

    expect(checkModelsDrift()).toEqual([]);
  });
});
