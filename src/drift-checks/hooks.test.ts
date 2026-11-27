import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => ({
  constants: (await importOriginal<typeof import("node:fs")>()).constants,
  closeSync: vi.fn(),
  existsSync: vi.fn(),
  fstatSync: vi.fn(),
  openSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("../manifest.js", () => ({
  loadManifest: vi.fn(() => ({ hashes: {}, managedHookKeys: [] })),
}));

vi.mock("../state.js", () => ({
  loadState: vi.fn(),
}));

vi.mock("../hooks/manifest.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks/manifest.js")>()),
  loadManagedHooksFromManifest: vi.fn(() => ({ managed: [], resolved: { hooks: [] } })),
}));

vi.mock("../types.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../types.js")>();
  return {
    ...original,
    AGENT_DEFINITIONS: [
      { name: "codex", skillsDir: "~/.codex/skills", hooksFile: "~/.codex/hooks.json", hooksFormat: "codex" },
      {
        name: "claude-code",
        detected: true,
        skillsDir: "~/.claude/skills",
        hooksFile: "~/.claude/settings.json",
        hooksKey: "hooks",
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

import { existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import { defaultDeployDir } from "../hooks/deploy.js";
import { loadManagedHooksFromManifest, manifestEntryToManagedHook } from "../hooks/manifest.js";
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
  vi.unstubAllEnvs();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("checkHooksDrift", () => {
  it("does not report unsupported Codex hooks as missing", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "codex", detected: true }],
      hooks: [{ event: "Notification", type: "command", command: "notify", source: "agentfile" }],
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"hooks":{}}');
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeysByAgent: { codex: ["Notification:*"] } });
    expect(await checkHooksDrift()).toEqual([]);
  });

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

  it("reports no bypass-permission drift when claudePermissions is keep", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [],
      claudePermissions: "keep",
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ permissions: { allow: ["Edit(~/notes/**)"] } }));
    expect(checkHooksDrift()).toEqual([]);
  });

  it("reports bypass-permission drift by default when prompts are on", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "claude-code", detected: true }],
      hooks: [],
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ permissions: { allow: ["Edit(~/notes/**)"] } }));
    const drift = checkHooksDrift();
    expect(drift.map((d) => d.diff?.updated)).toContainEqual(["permissions.defaultMode", "skipAutoPermissionPrompt"]);
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

  it.each([
    { name: "a managed stale copy", owned: true, registered: true, current: false, expected: ["example-stop"] },
    { name: "a managed current copy", owned: true, registered: true, current: true, expected: [] },
    { name: "a user-owned copy at the same path", owned: false, registered: true, current: false, expected: [] },
    { name: "a tracked copy with a user-owned command", owned: true, registered: false, current: false, expected: [] },
    {
      name: "a legacy managed stale copy",
      owned: true,
      registered: undefined,
      current: false,
      expected: ["example-stop"],
    },
  ])("reports deployed content drift for $name", ({ owned, registered, current, expected }) => {
    const repoRoot = "/fixture";
    const deployDir = defaultDeployDir();
    const entry = {
      id: "example-stop",
      event: "Stop",
      description: "Example",
      script: "checks/example-stop.sh",
      tier: "deterministic",
      verdict: "warn",
    } as const;
    const hook = manifestEntryToManagedHook(entry, deployDir);
    const source = "#!/bin/bash\nprintf 'current\\n'\n";
    const deployedPath = join(deployDir, `${entry.id}.sh`);
    const files = new Map([
      [join(repoRoot, "hooks", entry.script), source],
      [deployedPath, current ? source : "#!/bin/bash\nprintf 'old\\n'\n"],
      [join(deployDir, ".agentbrew-deployed-hooks.json"), JSON.stringify(owned ? [entry.id] : [])],
      [
        "/home/test/.claude/settings.json",
        JSON.stringify({
          hooks: { Stop: [{ hooks: [{ type: "command", command: hook.command }] }] },
          permissions: { defaultMode: "bypassPermissions" },
          skipAutoPermissionPrompt: true,
        }),
      ],
    ]);

    vi.stubEnv("AGENTBREW_REPO_ROOT", repoRoot);
    mockLoadState.mockReturnValue({ agents: [{ name: "claude-code", detected: true }], hooks: [] } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeys: ["Stop:*"],
      managedHookIdsByAgent:
        registered === undefined
          ? undefined
          : { "claude-code": [`Stop:* ${registered ? hook.command : "echo other"}`] },
    });
    mockLoadManagedHooks.mockReturnValueOnce({
      managed: [hook],
      resolved: { hooks: [entry], disabledByOverlay: [], enabledByOverlay: [], offByDefault: [], overrides: [] },
    });
    mockExistsSync.mockImplementation((path) => files.has(String(path)));
    const descriptorPaths: string[] = [];
    vi.mocked(openSync).mockImplementation((path) => descriptorPaths.push(String(path)) - 1);
    vi.mocked(fstatSync).mockImplementation(() => ({ isFile: () => true }) as never);
    mockReadFileSync.mockImplementation((path, options) => {
      const filePath = typeof path === "number" ? descriptorPaths[path] : String(path);
      const value = files.get(filePath);
      if (value === undefined) throw new Error(`Unexpected fixture read: ${path}`);
      return options ? value : Buffer.from(value);
    });

    const drift = checkHooksDrift();
    expect(
      drift
        .filter((item) => item.detail.includes("stale deployed hook script"))
        .flatMap((item) => item.diff?.updated ?? []),
    ).toEqual(expected);
    expect(drift.some((item) => item.detail.includes("missing hook(s)"))).toBe(false);
    expect(descriptorPaths.includes(deployedPath)).toBe(owned && registered !== false);
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

  it("accepts Codex native hooks.json entries when managed hooks are deployed", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "codex", detected: true }],
      hooks: [
        {
          event: "PreToolUse",
          matcher: "Write",
          type: "command",
          command: "echo codex",
          source: "agentfile",
          agents: ["codex"],
        },
      ],
    } as never);
    mockLoadManifest.mockReturnValue({
      hashes: {},
      managedHookKeys: ["PreToolUse:Write"],
      managedHookKeysByAgent: { codex: ["PreToolUse:Write"] },
    } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "echo codex" }] }] },
      }),
    );

    expect(checkHooksDrift()).toEqual([]);
  });

  it("does not use Claude legacy managed keys to report Codex-only drift", () => {
    mockLoadState.mockReturnValue({
      mcpServers: [],
      agents: [{ name: "codex", detected: true }],
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
    mockReadFileSync.mockReturnValue(JSON.stringify({ hooks: {} }));

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
      agents: [{ name: "codex", detected: true }],
      hooks: [],
    } as never);
    mockLoadManagedHooks.mockReturnValueOnce({
      managed: [
        {
          event: "Stop",
          type: "command",
          command: "bash /deploy/a.sh",
          source: "agentbrew-hooks-manifest",
          agents: ["codex"],
        },
      ],
      resolved: { hooks: [] },
    } as never);
    mockLoadManifest.mockReturnValue({ hashes: {}, managedHookKeysByAgent: { codex: ["Stop:*"] } } as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "/opt/wrap/with-path.sh bash /deploy/a.sh" }] }] },
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
