import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import TOML from "@iarna/toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../utils.js")>();
  return { ...original, expandHome: vi.fn((p: string) => p) };
});
vi.mock("../state.js", () => ({ loadState: vi.fn() }));

import { loadState } from "../state.js";
import type { AgentBrewState, AgentConfig } from "../types.js";
import { expandHome } from "../utils.js";
import { formatModelLabel, getValueAtPath, resolveTargetModel, setValueAtPath, syncModels } from "./model-sync.js";

let testDir: string;
let mockHome: string;

function agent(name: string, detected = true): AgentConfig {
  return { name, detected, skillsDir: `~/.${name}/skills` };
}

function stateWith(overrides: Partial<AgentBrewState>): AgentBrewState {
  return {
    agents: [agent("claude-code"), agent("codex")],
    catalogVersion: "1",
    defaultModel: "claude-5-fable-max",
    ...overrides,
  };
}

function writeClaudeSettings(content: Record<string, unknown>): string {
  const dir = join(mockHome, ".claude");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "settings.json");
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`);
  return path;
}

function writeCodexConfig(content: TOML.JsonMap): string {
  const dir = join(mockHome, ".codex");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "config.toml");
  writeFileSync(path, TOML.stringify(content));
  return path;
}

beforeEach(() => {
  testDir = join(tmpdir(), `model-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mockHome = join(testDir, "mock-home");
  mkdirSync(mockHome, { recursive: true });
  vi.mocked(expandHome).mockImplementation((p: string) => p.replace(/^~/, mockHome));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("resolveTargetModel", () => {
  it("returns the default when no overrides exist", () => {
    expect(resolveTargetModel("claude-code", "claude-5-fable-max", undefined)).toBe("claude-5-fable-max");
  });

  it("returns the per-agent override string", () => {
    expect(resolveTargetModel("codex", "claude-5-fable-max", { codex: "gpt-5.1-codex" })).toBe("gpt-5.1-codex");
  });

  it("returns undefined (skip) for a null override", () => {
    expect(resolveTargetModel("claude-code", "claude-5-fable-max", { "claude-code": null })).toBeUndefined();
  });

  it("ignores overrides for other agents", () => {
    expect(resolveTargetModel("claude-code", "claude-5-fable-max", { codex: null })).toBe("claude-5-fable-max");
  });
});

describe("getValueAtPath / setValueAtPath", () => {
  it("reads and writes a top-level key", () => {
    const obj: Record<string, unknown> = { model: "old" };
    expect(getValueAtPath(obj, "model")).toBe("old");
    expect(setValueAtPath(obj, "model", "new")).toBe(true);
    expect(obj.model).toBe("new");
  });

  it("reads and writes a nested key, creating intermediate objects", () => {
    const obj: Record<string, unknown> = {};
    expect(getValueAtPath(obj, "agent.model")).toBeUndefined();
    expect(setValueAtPath(obj, "agent.model", "claude-5-fable-max")).toBe(true);
    expect(obj).toEqual({ agent: { model: "claude-5-fable-max" } });
  });

  it("refuses to overwrite a non-object intermediate value", () => {
    const obj: Record<string, unknown> = { agent: "a string, not an object" };
    expect(setValueAtPath(obj, "agent.model", "x")).toBe(false);
    expect(obj.agent).toBe("a string, not an object");
  });
});

describe("syncModels", () => {
  it("writes the default model to claude-code settings.json preserving other keys", async () => {
    const path = writeClaudeSettings({ model: "claude-opus-4-8", permissions: { defaultMode: "bypassPermissions" } });
    vi.mocked(loadState).mockReturnValue(stateWith({ agents: [agent("claude-code")] }));

    await syncModels({ quiet: true });

    const written = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    expect(written.model).toBe("claude-5-fable-max");
    expect(written.permissions).toEqual({ defaultMode: "bypassPermissions" });
  });

  it("writes TOML for codex using the per-agent override id", async () => {
    const path = writeCodexConfig({ mcpServers: { playwright: { command: "npx" } } });
    vi.mocked(loadState).mockReturnValue(
      stateWith({ agents: [agent("codex")], modelOverrides: { codex: "gpt-5.1-codex" } }),
    );

    await syncModels({ quiet: true });

    const written = TOML.parse(readFileSync(path, "utf-8")) as { model?: string; mcpServers?: unknown };
    expect(written.model).toBe("gpt-5.1-codex");
    expect(written.mcpServers).toEqual({ playwright: { command: "npx" } });
  });

  it("skips an agent with a null override, leaving its file untouched", async () => {
    const path = writeClaudeSettings({ model: "claude-opus-4-8" });
    const before = readFileSync(path, "utf-8");
    vi.mocked(loadState).mockReturnValue(
      stateWith({ agents: [agent("claude-code")], modelOverrides: { "claude-code": null } }),
    );

    await syncModels({ quiet: true });

    expect(readFileSync(path, "utf-8")).toBe(before);
  });

  it("skips agents whose config file does not exist (never creates one)", async () => {
    vi.mocked(loadState).mockReturnValue(stateWith({ agents: [agent("claude-code")] }));

    await syncModels({ quiet: true });

    expect(() => readFileSync(join(mockHome, ".claude", "settings.json"), "utf-8")).toThrow();
  });

  it("skips undetected agents", async () => {
    const path = writeClaudeSettings({ model: "claude-opus-4-8" });
    const before = readFileSync(path, "utf-8");
    vi.mocked(loadState).mockReturnValue(stateWith({ agents: [agent("claude-code", false)] }));

    await syncModels({ quiet: true });

    expect(readFileSync(path, "utf-8")).toBe(before);
  });

  it("is a no-op when state has no defaultModel", async () => {
    const path = writeClaudeSettings({ model: "claude-opus-4-8" });
    const before = readFileSync(path, "utf-8");
    vi.mocked(loadState).mockReturnValue(stateWith({ agents: [agent("claude-code")], defaultModel: undefined }));

    await syncModels({ quiet: true });

    expect(readFileSync(path, "utf-8")).toBe(before);
  });

  it("does not rewrite a file that already has the target model", async () => {
    const path = writeClaudeSettings({ model: "claude-5-fable-max" });
    const before = readFileSync(path, "utf-8");
    vi.mocked(loadState).mockReturnValue(stateWith({ agents: [agent("claude-code")] }));

    await syncModels({ quiet: true });

    expect(readFileSync(path, "utf-8")).toBe(before);
  });

  it("dry-run reports but never writes", async () => {
    const path = writeClaudeSettings({ model: "claude-opus-4-8" });
    const before = readFileSync(path, "utf-8");
    vi.mocked(loadState).mockReturnValue(stateWith({ agents: [agent("claude-code")] }));

    await syncModels({ quiet: true, dryRun: true });

    expect(readFileSync(path, "utf-8")).toBe(before);
  });

  it("writes defaultEffort to claude-code effortLevel next to the model", async () => {
    const path = writeClaudeSettings({ model: "claude-opus-4-8", effortLevel: "xhigh", theme: "dark" });
    vi.mocked(loadState).mockReturnValue(
      stateWith({ agents: [agent("claude-code")], defaultModel: "claude-opus-5-5", defaultEffort: "medium" }),
    );

    await syncModels({ quiet: true });

    const written = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    expect(written.model).toBe("claude-opus-5-5");
    expect(written.effortLevel).toBe("medium");
    expect(written.theme).toBe("dark");
  });

  it("updates effort alone when the model already matches", async () => {
    const path = writeClaudeSettings({ model: "claude-opus-5-5", effortLevel: "xhigh" });
    vi.mocked(loadState).mockReturnValue(
      stateWith({ agents: [agent("claude-code")], defaultModel: "claude-opus-5-5", defaultEffort: "medium" }),
    );

    await syncModels({ quiet: true });

    expect((JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>).effortLevel).toBe("medium");
  });

  it("writes model_reasoning_effort for codex", async () => {
    const path = writeCodexConfig({ model: "gpt-5.1-codex" });
    vi.mocked(loadState).mockReturnValue(
      stateWith({ agents: [agent("codex")], defaultEffort: "medium", modelOverrides: { codex: "gpt-5.1-codex" } }),
    );

    await syncModels({ quiet: true });

    const written = TOML.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    expect(written.model_reasoning_effort).toBe("medium");
  });

  it("keeps an agent's own effort when its override is null", async () => {
    const path = writeClaudeSettings({ model: "claude-opus-4-8", effortLevel: "xhigh" });
    const before = readFileSync(path, "utf-8");
    vi.mocked(loadState).mockReturnValue(
      stateWith({ agents: [agent("claude-code")], defaultEffort: "medium", modelOverrides: { "claude-code": null } }),
    );

    await syncModels({ quiet: true });

    expect(readFileSync(path, "utf-8")).toBe(before);
  });
});

describe("formatModelLabel", () => {
  it("adds the effort when present", () => {
    expect(formatModelLabel("claude-opus-5-5", "medium")).toBe("claude-opus-5-5, medium effort");
    expect(formatModelLabel("claude-opus-5-5", undefined)).toBe("claude-opus-5-5");
  });
});
