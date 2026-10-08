import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("../manifest.js", () => ({
  loadManifest: vi.fn(() => ({ hashes: {}, managedHookKeys: [] })),
}));

vi.mock("../state.js", () => ({
  loadState: vi.fn(),
}));

vi.mock("../hooks/manifest.js", () => ({
  loadManagedHooksFromManifest: vi.fn(() => ({ managed: [], resolved: { hooks: [] } })),
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
      },
      {
        name: "cursor",
        detected: true,
        skillsDir: "~/.cursor/skills",
        hooksFile: "~/.cursor/hooks.json",
        hooksFormat: "cursor",
      },
      {
        name: "project-hooks-agent",
        detected: true,
        skillsDir: "~/.config/project-hooks-agent/skills",
        hooksFile: ".project-hooks-agent/hooks.v1.json",
        hooksFormat: "claude-direct",
        hooksScope: "project",
      },
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
import { loadManagedHooksFromManifest } from "../hooks/manifest.js";
import { loadManifest } from "../manifest.js";
import { loadState } from "../state.js";
import { checkHooksDrift } from "./hooks.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockLoadState = vi.mocked(loadState);
const mockLoadManifest = vi.mocked(loadManifest);
const mockLoadManagedHooks = vi.mocked(loadManagedHooksFromManifest);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("checkHooksDrift", () => {
  it("should return empty when state is undefined", () => {
    mockLoadState.mockReturnValue(undefined);
    expect(checkHooksDrift()).toEqual([]);
  });

  it("should return empty when no managed hooks", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [],
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        permissions: { defaultMode: "bypassPermissions" },
        skipAutoPermissionPrompt: true,
      }),
    );
    expect(checkHooksDrift()).toEqual([]);
  });

  it("should return empty when hooks are not in state", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        permissions: { defaultMode: "bypassPermissions" },
        skipAutoPermissionPrompt: true,
      }),
    );
    expect(checkHooksDrift()).toEqual([]);
  });

  it("should detect drift when hooks file is missing", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [{ event: "PreToolUse", type: "command", command: "echo a", source: "agentfile" }],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeys: ["PreToolUse:*"],
    } as never);
    mockExistsSync.mockReturnValue(false);

    const drift = checkHooksDrift();
    expect(drift).toHaveLength(1);
    expect(drift[0].agent).toBe("claude-code");
    expect(drift[0].type).toBe("hooks");
    expect(drift[0].detail).toContain("hooks file missing");
  });

  it("should detect drift when managed hooks are missing from deployed config", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [{ event: "PreToolUse", matcher: "Bash", type: "command", command: "echo a", source: "agentfile" }],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeys: ["PreToolUse:Bash"],
    } as never);
    mockExistsSync.mockReturnValue(true);
    // Settings file exists but has no hooks section
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        permissions: { defaultMode: "bypassPermissions" },
        skipAutoPermissionPrompt: true,
      }),
    );

    const drift = checkHooksDrift();
    expect(
      drift.some((item) => item.detail.includes("missing hook(s)") && item.detail.includes("PreToolUse:Bash")),
    ).toBe(true);
  });

  it("should return no drift when hooks are properly deployed", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [{ event: "PreToolUse", matcher: "Bash", type: "command", command: "echo a", source: "agentfile" }],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeys: ["PreToolUse:Bash"],
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo a" }] }],
        },
        permissions: { defaultMode: "bypassPermissions" },
        skipAutoPermissionPrompt: true,
      }),
    );

    const drift = checkHooksDrift();
    expect(drift).toEqual([]);
  });

  it("should skip agents without hooksFile", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [
        { name: "claude-code", detected: true },
        { name: "unsupported", detected: true },
      ],
      hooks: [{ event: "PreToolUse", type: "command", command: "echo a", source: "agentfile" }],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeys: ["PreToolUse:*"],
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: "command", command: "echo a" }] }],
        },
        permissions: { defaultMode: "bypassPermissions" },
        skipAutoPermissionPrompt: true,
      }),
    );

    const drift = checkHooksDrift();
    // Only claude-code checked, not unsupported
    expect(drift).toEqual([]);
  });

  it("accepts Cursor native hooks.json entries when managed hooks are deployed", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "cursor", detected: true }],
      hooks: [
        {
          event: "PreToolUse",
          matcher: "Write",
          type: "command",
          command: "echo cursor",
          source: "agentfile",
          agents: ["cursor"],
        },
      ],
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
        hooks: { preToolUse: [{ matcher: "Write", command: "echo cursor" }] },
      }),
    );

    expect(checkHooksDrift()).toEqual([]);
  });

  it("does not use Claude legacy managed keys to report Cursor-only drift", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "cursor", detected: true }],
      hooks: [
        {
          event: "PreToolUse",
          matcher: "Write",
          type: "command",
          command: "echo claude",
          source: "agentfile",
          agents: ["claude-code"],
        },
      ],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeys: ["PreToolUse:Write"],
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: 1, hooks: {} }));

    expect(checkHooksDrift()).toEqual([]);
  });

  it("resolves project-scoped hooks from the project-local hooks file", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "project-hooks-agent", detected: true }],
      hooks: [
        {
          event: "Stop",
          type: "command",
          command: "echo project-hooks",
          source: "agentfile",
          agents: ["project-hooks-agent"],
        },
      ],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeysByAgent: { "project-hooks-agent": ["Stop:*"] },
    } as never);
    mockExistsSync.mockImplementation((path) => path === `${process.cwd()}/.project-hooks-agent/hooks.v1.json`);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        Stop: [{ hooks: [{ type: "command", command: "echo project-hooks" }] }],
      }),
    );

    expect(checkHooksDrift()).toEqual([]);
    expect(mockExistsSync).toHaveBeenCalledWith(`${process.cwd()}/.project-hooks-agent/hooks.v1.json`);
  });

  it("treats explicit wildcard matchers as the default hook matcher", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [{ event: "Stop", type: "command", command: "echo all", source: "agentfile" }],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeysByAgent: { "claude-code": ["Stop:*"] },
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: { Stop: [{ matcher: "*", hooks: [{ type: "command", command: "echo all" }] }] },
        permissions: { defaultMode: "bypassPermissions" },
        skipAutoPermissionPrompt: true,
      }),
    );

    expect(checkHooksDrift()).toEqual([]);
  });

  it("should skip agents not detected", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [], // claude-code NOT in detected agents
      hooks: [{ event: "PreToolUse", type: "command", command: "echo a", source: "agentfile" }],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeys: ["PreToolUse:*"],
    } as never);

    const drift = checkHooksDrift();
    expect(drift).toEqual([]);
    // Should not even call existsSync for settings file
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it("should handle malformed settings JSON gracefully", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [{ event: "PreToolUse", type: "command", command: "echo a", source: "agentfile" }],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeys: ["PreToolUse:*"],
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not valid json");

    const drift = checkHooksDrift();
    expect(drift.some((item) => item.detail.includes("missing hook(s)"))).toBe(true);
    expect(drift.some((item) => item.detail.includes("permission defaults"))).toBe(true);
  });

  it("flags legacy Exec/Shell permission patterns in Claude settings", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [],
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeys: [] } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        permissions: {
          defaultMode: "bypassPermissions",
          allow: ["Exec(git *)"],
          deny: ["Exec(sudo *)"],
        },
        skipAutoPermissionPrompt: true,
        hooks: {},
      }),
    );

    const drift = checkHooksDrift();
    expect(drift.some((item) => item.detail.includes("Legacy Exec/Shell permission patterns"))).toBe(true);
  });

  it("should include diff.added for missing hooks", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [
        { event: "PreToolUse", matcher: "Bash", type: "command", command: "echo a", source: "agentfile" },
        { event: "Stop", type: "prompt", prompt: "check", source: "agentfile" },
      ],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeys: ["PreToolUse:Bash", "Stop:*"],
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        permissions: { defaultMode: "bypassPermissions" },
        skipAutoPermissionPrompt: true,
      }),
    );

    const drift = checkHooksDrift();
    expect(drift).toHaveLength(1);
    expect(drift[0].diff?.added).toContain("PreToolUse:Bash echo a");
    expect(drift[0].diff?.added).toContain("Stop:* check");
  });

  it("reports a manifest hook missing from a group that a state hook keeps present", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [{ event: "PreToolUse", matcher: "Bash", type: "command", command: "state.sh", source: "agentfile" }],
    } as never);
    mockLoadManagedHooks.mockReturnValueOnce({
      managed: [
        {
          event: "PreToolUse",
          matcher: "Bash",
          type: "command",
          command: "bash /deploy/a.sh",
          source: "agentbrew-hooks-manifest",
        },
      ],
      resolved: { hooks: [] },
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeysByAgent: { "claude-code": ["PreToolUse:Bash"] },
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "state.sh" }] }] },
        permissions: { defaultMode: "bypassPermissions" },
        skipAutoPermissionPrompt: true,
      }),
    );

    const drift = checkHooksDrift();
    expect(drift).toHaveLength(1);
    expect(drift[0].diff?.added).toEqual(["PreToolUse:Bash bash /deploy/a.sh"]);
  });

  it("reports a missing hook command even when its event:matcher group exists", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [
        { event: "PreToolUse", matcher: "Bash", type: "command", command: "echo a", source: "agentfile" },
        { event: "PreToolUse", matcher: "Bash", type: "command", command: "echo b", source: "agentfile" },
      ],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeysByAgent: { "claude-code": ["PreToolUse:Bash"] },
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo a" }] }] },
        permissions: { defaultMode: "bypassPermissions" },
        skipAutoPermissionPrompt: true,
      }),
    );

    const drift = checkHooksDrift();
    expect(drift).toHaveLength(1);
    expect(drift[0].diff?.added).toEqual(["PreToolUse:Bash echo b"]);
  });

  it("accepts a deployed command that a post-sync step put behind a wrapper prefix", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "cursor", detected: true }],
      hooks: [],
    } as never);
    mockLoadManagedHooks.mockReturnValueOnce({
      managed: [
        {
          event: "Stop",
          type: "command",
          command: "bash /deploy/a.sh",
          source: "agentbrew-hooks-manifest",
          agents: ["cursor"],
        },
      ],
      resolved: { hooks: [] },
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeysByAgent: { cursor: ["stop:*"] } } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: 1,
        hooks: { stop: [{ matcher: "*", command: "/opt/wrap/with-path.sh bash /deploy/a.sh" }] },
      }),
    );

    expect(checkHooksDrift()).toEqual([]);
  });

  it("detects Claude Code permission default drift even when no hooks are managed", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [],
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ permissions: { defaultMode: "default" } }));

    const drift = checkHooksDrift();
    expect(drift).toEqual([
      {
        agent: "claude-code",
        type: "hooks",
        detail: "Claude Code permission defaults not pinned to bypassPermissions — Run: agentbrew sync --only hooks",
        diff: { updated: ["permissions.defaultMode", "skipAutoPermissionPrompt"] },
      },
    ]);
  });
});
