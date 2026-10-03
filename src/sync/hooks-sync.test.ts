import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("../manifest.js", () => ({
  loadManifest: vi.fn(() => ({ hashes: {}, managedHookKeys: [] })),
  saveManifest: vi.fn(),
}));

vi.mock("../state.js", () => ({
  loadState: vi.fn(),
}));

vi.mock("../hooks/manifest.js", () => ({
  loadManagedHooksFromManifest: vi.fn(() => ({ managed: [], resolved: { hooks: [] } })),
}));

vi.mock("../hooks/deploy.js", () => ({
  defaultDeployDir: vi.fn(() => "/home/test/.claude/codeassist/hooks-scripts"),
  deployHookScripts: vi.fn(() => ({ deployed: 0, skipped: 0, errors: [] })),
}));

vi.mock("../types.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../types.js")>();
  return {
    ...original,
    AGENT_DEFINITIONS: [
      {
        name: "claude-code",
        detected: true,
        skillsDir: "~/.claude/skills",
        hooksFile: "~/.claude/settings.json",
        hooksKey: "hooks",
        hooksFormat: "claude-settings",
      },
      {
        name: "cursor",
        detected: true,
        skillsDir: "~/.cursor/skills",
        hooksFile: "~/.cursor/hooks.json",
        hooksFormat: "cursor",
      },
      {
        name: "devin",
        detected: true,
        skillsDir: "~/.config/devin/skills",
        hooksFile: ".devin/hooks.v1.json",
        hooksFormat: "claude-direct",
        hooksScope: "project",
      },
      // Unsupported: has no `hooksFile` field. Exercises the
      // `getHooksTargets()` filter path — a regression that flipped the
      // capability check would incorrectly treat this agent as a write target.
      {
        name: "unsupported",
        detected: true,
        skillsDir: "~/.unsupported/skills",
      },
    ],
  };
});

vi.mock("../utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../utils.js")>();
  return {
    ...original,
    expandHome: vi.fn((p: string) => p.replace("~", "/home/test")),
  };
});

import { existsSync, readFileSync } from "node:fs";
import { sync as writeFileSync } from "write-file-atomic";
import { loadManagedHooksFromManifest } from "../hooks/manifest.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { loadState } from "../state.js";
import type { ManagedHook } from "../types.js";
import {
  applyClaudeCodePermissionDefaults,
  computeHooksDiff,
  filterHooksForTarget,
  hookKey,
  mergeHooksConfig,
  syncHooks,
  toClaudeHooksConfig,
  toCursorHooksConfig,
} from "./hooks-sync.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockLoadState = vi.mocked(loadState);
const mockLoadManifest = vi.mocked(loadManifest);
const mockSaveManifest = vi.mocked(saveManifest);
const mockLoadManagedHooks = vi.mocked(loadManagedHooksFromManifest);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── Pure functions ──────────────────────────────────────────────────────────

describe("hookKey", () => {
  it("should combine event and matcher", () => {
    expect(hookKey("PreToolUse", "Bash")).toBe("PreToolUse:Bash");
  });

  it("should default matcher to *", () => {
    expect(hookKey("PostToolUse")).toBe("PostToolUse:*");
    expect(hookKey("Stop", undefined)).toBe("Stop:*");
  });
});

describe("toClaudeHooksConfig", () => {
  it("should return empty object for no hooks", () => {
    expect(toClaudeHooksConfig([])).toEqual({});
  });

  it("should group hooks by event", () => {
    const hooks: ManagedHook[] = [
      { event: "PreToolUse", type: "command", command: "echo pre", source: "agentfile" },
      { event: "PostToolUse", type: "command", command: "echo post", source: "agentfile" },
    ];
    const config = toClaudeHooksConfig(hooks);
    expect(config).toHaveProperty("PreToolUse");
    expect(config).toHaveProperty("PostToolUse");
    expect(config.PreToolUse).toHaveLength(1);
    expect(config.PostToolUse).toHaveLength(1);
  });

  it("should create groups with matchers", () => {
    const hooks: ManagedHook[] = [
      { event: "PreToolUse", matcher: "Bash", type: "command", command: "echo bash", source: "user" },
    ];
    const config = toClaudeHooksConfig(hooks);
    expect(config.PreToolUse[0].matcher).toBe("Bash");
    expect(config.PreToolUse[0].hooks).toEqual([{ type: "command", command: "echo bash" }]);
  });

  it("should merge hooks with same event and matcher into one group", () => {
    const hooks: ManagedHook[] = [
      { event: "PreToolUse", matcher: "Bash", type: "command", command: "echo a", source: "agentfile" },
      { event: "PreToolUse", matcher: "Bash", type: "command", command: "echo b", source: "agentfile" },
    ];
    const config = toClaudeHooksConfig(hooks);
    expect(config.PreToolUse).toHaveLength(1);
    expect(config.PreToolUse[0].hooks).toHaveLength(2);
  });

  it("should separate hooks with different matchers", () => {
    const hooks: ManagedHook[] = [
      { event: "PreToolUse", matcher: "Bash", type: "command", command: "echo bash", source: "agentfile" },
      { event: "PreToolUse", matcher: "Write", type: "command", command: "echo write", source: "agentfile" },
    ];
    const config = toClaudeHooksConfig(hooks);
    expect(config.PreToolUse).toHaveLength(2);
  });

  it("should handle prompt type hooks", () => {
    const hooks: ManagedHook[] = [
      { event: "Stop", type: "prompt", prompt: "Review your changes", source: "agentfile" },
    ];
    const config = toClaudeHooksConfig(hooks);
    expect(config.Stop[0].matcher).toBe("*");
    expect(config.Stop[0].hooks[0]).toEqual({ type: "prompt", prompt: "Review your changes" });
  });

  it("should write an explicit wildcard matcher for hooks without a matcher", () => {
    const hooks: ManagedHook[] = [
      { event: "Stop", type: "command", command: "verify", source: "agentfile" },
      { event: "UserPromptSubmit", type: "command", command: "lint-prompt", source: "agentfile" },
    ];
    const config = toClaudeHooksConfig(hooks);
    expect(config.Stop[0]).toEqual({ matcher: "*", hooks: [{ type: "command", command: "verify" }] });
    expect(config.UserPromptSubmit[0]).toEqual({
      matcher: "*",
      hooks: [{ type: "command", command: "lint-prompt" }],
    });
  });

  it("should include timeout when set", () => {
    const hooks: ManagedHook[] = [
      { event: "PreToolUse", type: "command", command: "echo x", timeout: 5000, source: "agentfile" },
    ];
    const config = toClaudeHooksConfig(hooks);
    expect(config.PreToolUse[0].hooks[0].timeout).toBe(5000);
  });
});

describe("filterHooksForTarget", () => {
  it("keeps hooks with no agent filter for every target", () => {
    const hooks: ManagedHook[] = [{ event: "PreToolUse", type: "command", command: "echo x", source: "agentfile" }];
    expect(filterHooksForTarget(hooks, "cursor")).toEqual(hooks);
  });

  it("keeps only hooks targeted at the requested agent", () => {
    const hooks: ManagedHook[] = [
      {
        event: "PreToolUse",
        type: "command",
        command: "claude",
        source: "agentbrew-hooks-manifest",
        agents: ["claude-code"],
      },
      {
        event: "PreToolUse",
        type: "command",
        command: "cursor",
        source: "agentbrew-hooks-manifest",
        agents: ["cursor"],
      },
    ];
    expect(filterHooksForTarget(hooks, "cursor").map((hook) => hook.command)).toEqual(["cursor"]);
  });
});

describe("toCursorHooksConfig", () => {
  it("transforms Claude event names to Cursor event names", () => {
    expect(
      toCursorHooksConfig({
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo x" }] }],
        UserPromptSubmit: [{ hooks: [{ type: "prompt", prompt: "check" }] }],
      }),
    ).toEqual({
      preToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo x" }] }],
      beforeSubmitPrompt: [{ hooks: [{ type: "prompt", prompt: "check" }] }],
    });
  });
});

describe("mergeHooksConfig", () => {
  it("should return desired config when no existing config", () => {
    const desired = {
      PreToolUse: [{ hooks: [{ type: "command" as const, command: "echo a" }] }],
    };
    const { merged, managedKeys } = mergeHooksConfig({}, desired, new Set());
    expect(merged).toEqual(desired);
    expect(managedKeys).toEqual(["PreToolUse:*"]);
  });

  it("should preserve user hooks not previously managed", () => {
    const existing = {
      PreToolUse: [{ matcher: "UserMatcher", hooks: [{ type: "command" as const, command: "user-cmd" }] }],
    };
    const desired = {
      PreToolUse: [{ hooks: [{ type: "command" as const, command: "managed-cmd" }] }],
    };
    const { merged } = mergeHooksConfig(existing, desired, new Set());
    // Both user and managed hooks should be present
    expect(merged.PreToolUse).toHaveLength(2);
  });

  it("should remove previously managed hooks that are no longer desired", () => {
    const existing = {
      PreToolUse: [
        { matcher: "OldManaged", hooks: [{ type: "command" as const, command: "old" }] },
        { matcher: "UserHook", hooks: [{ type: "command" as const, command: "user" }] },
      ],
    };
    const desired = {};
    const previousManagedKeys = new Set(["PreToolUse:OldManaged"]);
    const { merged } = mergeHooksConfig(existing, desired, previousManagedKeys);
    // Only user hook should remain
    expect(merged.PreToolUse).toHaveLength(1);
    expect(merged.PreToolUse[0].matcher).toBe("UserHook");
  });

  it("should handle events only in desired", () => {
    const desired = {
      Stop: [{ hooks: [{ type: "prompt" as const, prompt: "check" }] }],
    };
    const { merged, managedKeys } = mergeHooksConfig({}, desired, new Set());
    expect(merged.Stop).toHaveLength(1);
    expect(managedKeys).toContain("Stop:*");
  });

  it("should handle events only in existing", () => {
    const existing = {
      PreToolUse: [{ hooks: [{ type: "command" as const, command: "user" }] }],
    };
    const { merged } = mergeHooksConfig(existing, {}, new Set());
    expect(merged.PreToolUse).toHaveLength(1);
  });

  it("should drop empty event arrays", () => {
    const existing = {
      PreToolUse: [{ matcher: "ManagedOnly", hooks: [{ type: "command" as const, command: "x" }] }],
    };
    const previousManagedKeys = new Set(["PreToolUse:ManagedOnly"]);
    const { merged } = mergeHooksConfig(existing, {}, previousManagedKeys);
    expect(merged.PreToolUse).toBeUndefined();
  });
});

describe("computeHooksDiff", () => {
  it("should detect added hooks", () => {
    const desired = {
      PreToolUse: [{ hooks: [{ type: "command" as const, command: "echo a" }] }],
    };
    const diff = computeHooksDiff({}, desired, new Set());
    expect(diff).toEqual([{ key: "PreToolUse:*", type: "add" }]);
  });

  it("should detect updated hooks", () => {
    const current = {
      PreToolUse: [{ hooks: [{ type: "command" as const, command: "echo old" }] }],
    };
    const desired = {
      PreToolUse: [{ hooks: [{ type: "command" as const, command: "echo new" }] }],
    };
    const diff = computeHooksDiff(current, desired, new Set());
    expect(diff).toEqual([{ key: "PreToolUse:*", type: "update" }]);
  });

  it("should return empty when nothing changed", () => {
    const config = {
      PreToolUse: [{ hooks: [{ type: "command" as const, command: "echo a" }] }],
    };
    const diff = computeHooksDiff(config, config, new Set());
    expect(diff).toEqual([]);
  });

  it("should detect pruned hooks", () => {
    const current = {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command" as const, command: "echo x" }] }],
    };
    const previousManagedKeys = new Set(["PreToolUse:Bash"]);
    const diff = computeHooksDiff(current, {}, previousManagedKeys);
    expect(diff).toEqual([{ key: "PreToolUse:Bash", type: "prune" }]);
  });

  it("should combine add, update, and prune in one diff", () => {
    const current = {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command" as const, command: "old" }] }],
      Stop: [{ hooks: [{ type: "prompt" as const, prompt: "old-stop" }] }],
    };
    const desired = {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command" as const, command: "new" }] }],
      PostToolUse: [{ hooks: [{ type: "command" as const, command: "added" }] }],
    };
    const previousManagedKeys = new Set(["PreToolUse:Bash", "Stop:*"]);
    const diff = computeHooksDiff(current, desired, previousManagedKeys);
    expect(diff).toContainEqual({ key: "PreToolUse:Bash", type: "update" });
    expect(diff).toContainEqual({ key: "PostToolUse:*", type: "add" });
    expect(diff).toContainEqual({ key: "Stop:*", type: "prune" });
  });

  it("should not prune keys that are still desired", () => {
    const current = {
      PreToolUse: [{ hooks: [{ type: "command" as const, command: "a" }] }],
    };
    const desired = {
      PreToolUse: [{ hooks: [{ type: "command" as const, command: "a" }] }],
    };
    const previousManagedKeys = new Set(["PreToolUse:*"]);
    const diff = computeHooksDiff(current, desired, previousManagedKeys);
    expect(diff).toEqual([]);
  });
});

describe("applyClaudeCodePermissionDefaults", () => {
  it("sets bypassPermissions and skips the auto permission prompt", () => {
    const settings = { permissions: { defaultMode: "default" } };
    const changed = applyClaudeCodePermissionDefaults(settings);
    expect(changed).toBe(true);
    expect(settings).toEqual({
      permissions: { defaultMode: "bypassPermissions" },
      skipAutoPermissionPrompt: true,
    });
  });

  it("migrates legacy Exec/Shell permission patterns to Bash", () => {
    const settings = {
      permissions: {
        defaultMode: "bypassPermissions",
        allow: ["Exec(git *)"],
        deny: ["Exec(sudo *)", "Shell(ls)"],
      },
      skipAutoPermissionPrompt: true,
    };
    const changed = applyClaudeCodePermissionDefaults(settings);
    expect(changed).toBe(true);
    expect(settings.permissions).toEqual({
      defaultMode: "bypassPermissions",
      allow: ["Bash(git *)"],
      deny: ["Bash(sudo *)", "Bash(ls)"],
    });
  });

  it("returns false when permission defaults are already correct", () => {
    const settings = {
      permissions: { defaultMode: "bypassPermissions" },
      skipAutoPermissionPrompt: true,
    };
    expect(applyClaudeCodePermissionDefaults(settings)).toBe(false);
  });
});

// ── Sync engine ─────────────────────────────────────────────────────────────

describe("syncHooks", () => {
  it("should return early when state is undefined", async () => {
    mockLoadState.mockReturnValue(undefined);
    await syncHooks();
    expect(mockSaveManifest).not.toHaveBeenCalled();
  });

  // Regression guard for getHooksTargets() filter: agents without a hooksFile
  // field must be silently skipped. If the filter flipped or the capability
  // flag were renamed, this test would catch it before the user did.
  // See TASKS.md `sync-unsupported-agent-coverage`.
  it("silently skips agents without a hooksFile, still writes supported ones", async () => {
    const hooks: ManagedHook[] = [
      { event: "PreToolUse", matcher: "Bash", type: "command", command: "echo", source: "agentfile" },
    ];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      // Both agents in state; only claude-code has a hooksFile in the
      // AGENT_DEFINITIONS mock above. cursor must be skipped.
      agents: [
        { name: "claude-code", detected: true },
        { name: "unsupported", detected: true },
      ],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(false);

    await syncHooks({ quiet: true });

    // Only one writeFileSync call — to claude-code's settings.json, not to the unsupported target.
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [filePath] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    expect(filePath).toContain("claude");
    expect(filePath).not.toContain("unsupported");
  });

  it("should sync hooks to agent settings file", async () => {
    const hooks: ManagedHook[] = [
      { event: "PreToolUse", matcher: "Bash", type: "command", command: "echo hi", source: "agentfile" },
    ];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(false);

    await syncHooks({ quiet: true });

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [filePath, content] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    expect(filePath).toContain("settings.json");
    const written = JSON.parse(content);
    expect(written.hooks).toBeDefined();
    expect(written.hooks.PreToolUse).toHaveLength(1);
    expect(written.hooks.PreToolUse[0].matcher).toBe("Bash");
    expect(written.permissions.defaultMode).toBe("bypassPermissions");
    expect(written.skipAutoPermissionPrompt).toBe(true);
  });

  it("keeps manifest hooks that share an event:matcher group with a state hook, state hook first", async () => {
    const stateHook: ManagedHook = {
      event: "PreToolUse",
      matcher: "Bash",
      type: "command",
      command: "state-bash.sh",
      source: "agentfile",
    };
    const manifestHook = (command: string): ManagedHook => ({
      event: "PreToolUse",
      matcher: "Bash",
      type: "command",
      command,
      timeout: 5,
      source: "agentbrew-hooks-manifest",
    });
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [stateHook],
    } as never);
    mockLoadManagedHooks.mockReturnValueOnce({
      // The third entry has the state hook's identity, so the state copy wins.
      managed: [manifestHook("bash /deploy/a.sh"), manifestHook("bash /deploy/b.sh"), manifestHook("state-bash.sh")],
      resolved: { hooks: [] },
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(false);

    await syncHooks({ quiet: true });

    const [, content] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    const written = JSON.parse(content);
    expect(written.hooks.PreToolUse).toHaveLength(1);
    expect(written.hooks.PreToolUse[0].matcher).toBe("Bash");
    expect(written.hooks.PreToolUse[0].hooks).toEqual([
      { type: "command", command: "state-bash.sh" },
      { type: "command", command: "bash /deploy/a.sh", timeout: 5 },
      { type: "command", command: "bash /deploy/b.sh", timeout: 5 },
    ]);
  });

  it("writes Cursor hooks.json with native camelCase event names", async () => {
    const hooks: ManagedHook[] = [
      {
        event: "PreToolUse",
        matcher: "Bash",
        type: "command",
        command: "echo cursor",
        source: "agentfile",
        agents: ["cursor"],
      },
    ];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "cursor", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(false);

    await syncHooks({ quiet: true });

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [filePath, content] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    expect(filePath).toContain("/home/test/.cursor/hooks.json");
    const written = JSON.parse(content);
    expect(written.version).toBe(1);
    expect(written.hooks.preToolUse[0].matcher).toBe("Bash");
    expect(written.hooks.preToolUse[0].command).toBe("echo cursor");
  });

  it("writes Devin hooks.v1.json project-locally with Claude direct format", async () => {
    const hooks: ManagedHook[] = [
      {
        event: "Stop",
        type: "command",
        command: "echo devin",
        source: "agentfile",
        agents: ["devin"],
      },
    ];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "devin", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(false);

    await syncHooks({ quiet: true });

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [filePath, content] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    expect(filePath.endsWith("/.devin/hooks.v1.json")).toBe(true);
    const written = JSON.parse(content);
    expect(written.hooks).toBeUndefined();
    expect(written.Stop[0].hooks[0].command).toBe("echo devin");
  });

  it("does not prune same-key Cursor user hooks from Claude-only legacy managed keys", async () => {
    const hooks: ManagedHook[] = [
      {
        event: "PreToolUse",
        matcher: "Write",
        type: "command",
        command: "echo claude",
        source: "agentfile",
        agents: ["claude-code"],
      },
    ];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "cursor", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: ["PreToolUse:Write"] } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: 1,
        hooks: { preToolUse: [{ matcher: "Write", command: "user-cursor" }] },
      }),
    );

    await syncHooks({ quiet: true });

    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("uses per-agent managed keys to prune stale Cursor hooks", async () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "cursor", detected: true }],
      hooks: [],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeys: ["PreToolUse:Write"],
      managedHookKeysByAgent: { cursor: ["preToolUse:Write"] },
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: 1,
        hooks: { preToolUse: [{ matcher: "Write", command: "old-cursor" }] },
      }),
    );

    await syncHooks({ quiet: true });

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written.version).toBe(1);
    expect(written.hooks.preToolUse).toBeUndefined();
  });

  it("writes Claude Code permission defaults even when hooks are already current", async () => {
    const hooks: ManagedHook[] = [{ event: "PreToolUse", type: "command", command: "echo x", source: "agentfile" }];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: ["PreToolUse:*"] } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "echo x" }] }],
        },
        permissions: { defaultMode: "default" },
      }),
    );

    await syncHooks({ quiet: true });

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const content = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(content.permissions.defaultMode).toBe("bypassPermissions");
    expect(content.skipAutoPermissionPrompt).toBe(true);
  });

  it("should preserve existing user hooks", async () => {
    const hooks: ManagedHook[] = [{ event: "PreToolUse", type: "command", command: "managed", source: "agentfile" }];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "UserMatcher", hooks: [{ type: "command", command: "user-cmd" }] }],
        },
      }),
    );

    await syncHooks({ quiet: true });

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const content = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    // Both user and managed hooks present
    expect(content.hooks.PreToolUse.length).toBeGreaterThanOrEqual(2);
  });

  it("should not write when dry-run is enabled", async () => {
    const hooks: ManagedHook[] = [{ event: "PreToolUse", type: "command", command: "echo hi", source: "agentfile" }];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(false);

    await syncHooks({ quiet: true, dryRun: true });

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockSaveManifest).not.toHaveBeenCalled();
  });

  it("should remove hooks from settings file when all hooks removed", async () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeys: ["PreToolUse:Bash"],
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo old" }] }],
        },
        otherKey: "preserved",
      }),
    );

    await syncHooks({ quiet: true });

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const content = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(content.hooks).toBeUndefined();
    expect(content.otherKey).toBe("preserved");
    expect(content.permissions.defaultMode).toBe("bypassPermissions");
  });

  it("should save manifest after sync", async () => {
    const hooks: ManagedHook[] = [{ event: "PreToolUse", type: "command", command: "echo x", source: "agentfile" }];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(false);

    await syncHooks({ quiet: true });

    expect(mockSaveManifest).toHaveBeenCalledOnce();
    const manifest = mockSaveManifest.mock.calls[0][0] as { managedHookKeys?: string[] };
    expect(manifest.managedHookKeys).toContain("PreToolUse:*");
    expect(
      (manifest as { managedHookKeysByAgent?: Record<string, string[]> }).managedHookKeysByAgent?.["claude-code"],
    ).toContain("PreToolUse:*");
  });

  it("should not save manifest when shared (ctx.manifest provided)", async () => {
    const hooks: ManagedHook[] = [{ event: "PreToolUse", type: "command", command: "echo x", source: "agentfile" }];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks,
    } as never);
    mockExistsSync.mockReturnValue(false);

    const sharedManifest = { hashes: {}, managedHookKeys: [] } as never;
    await syncHooks({ quiet: true }, { manifest: sharedManifest });

    expect(mockSaveManifest).not.toHaveBeenCalled();
  });

  it("should log header and summary when not quiet", async () => {
    const hooks: ManagedHook[] = [{ event: "PreToolUse", type: "command", command: "echo x", source: "agentfile" }];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(false);

    await syncHooks({ quiet: false });

    const logs = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(logs).toContain("Syncing 1 hook(s)");
    expect(logs).toContain("1 added");
  });

  it("should log dry-run header when dryRun and not quiet", async () => {
    const hooks: ManagedHook[] = [{ event: "PreToolUse", type: "command", command: "echo x", source: "agentfile" }];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(false);

    await syncHooks({ quiet: false, dryRun: true });

    const logs = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(logs).toContain("Dry run");
    expect(logs).toContain("Would apply:");
  });

  it("should log up-to-date in verbose mode with no changes", async () => {
    const hooks: ManagedHook[] = [{ event: "PreToolUse", type: "command", command: "echo x", source: "agentfile" }];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: ["PreToolUse:*"] } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "echo x" }] }],
        },
        permissions: { defaultMode: "bypassPermissions" },
        skipAutoPermissionPrompt: true,
      }),
    );

    await syncHooks({ quiet: false, verbose: true });

    const logs = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(logs).toContain("up to date");
  });

  it("should handle malformed settings file on read gracefully", async () => {
    const hooks: ManagedHook[] = [{ event: "PreToolUse", type: "command", command: "echo x", source: "agentfile" }];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not-valid-json{{{");

    await syncHooks({ quiet: true });

    // Should still write despite bad existing file (treats as empty)
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it("should handle hooks key being an array in settings file", async () => {
    const hooks: ManagedHook[] = [{ event: "PreToolUse", type: "command", command: "echo x", source: "agentfile" }];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ hooks: ["invalid-array"] }));

    await syncHooks({ quiet: true });

    // Should treat invalid hooks as empty and write new config
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it("should handle write with malformed existing file", async () => {
    const hooks: ManagedHook[] = [];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: ["PreToolUse:*"] } as never);
    mockExistsSync.mockReturnValue(true);
    // First call is for read in readSettingsHooks, returns valid JSON with hooks
    // Second call is for write in writeSettingsHooks, returns malformed JSON
    mockReadFileSync
      .mockReturnValueOnce(
        JSON.stringify({
          hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "old" }] }] },
        }),
      )
      .mockReturnValueOnce("bad json{");

    await syncHooks({ quiet: true });

    // Should still write (writeSettingsHooks catches the parse error)
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it("should log header when previousManagedKeys exist but hooks are empty", async () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [],
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: ["PreToolUse:Bash"] } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "old" }] }] },
      }),
    );

    await syncHooks({ quiet: false });

    const logs = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(logs).toContain("Syncing 0 hook(s)");
    expect(logs).toContain("pruned");
  });

  it("should not throw when writeFileSync fails", async () => {
    const hooks: ManagedHook[] = [
      { event: "PreToolUse", matcher: undefined, type: "command", command: "echo ok", source: "agentfile" },
    ];
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks,
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(false);
    mockWriteFileSync.mockImplementationOnce(() => {
      throw new Error("EACCES: permission denied");
    });

    await expect(syncHooks({ quiet: true })).resolves.not.toThrow();
  });
});

// `listHooks()` was removed 2026-05-03 alongside the hidden `agentbrew hooks
// list` subcommand (delete-instructions-and-hooks). The Agentfile is
// the canonical source for the hook inventory and `agentbrew status --verbose`
// is the deployment signal — the dedicated helper had no remaining caller and
// no user-story reference, so its describe block went with the deletion.
