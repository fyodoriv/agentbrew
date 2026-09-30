import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./utils.js", () => ({
  checkGitAvailable: vi.fn(() => true),
  checkPathConflicts: vi.fn(() => []),
  expandHome: vi.fn((p: string) => p),
  formatAge: vi.fn(() => "just now"),
  parseJsonc: vi.fn((s: string) => JSON.parse(s)),
  vscodeExtConfigPath: vi.fn(() => ""),
  vscodeSettingsPath: vi.fn(() => ""),
  parseKeyValuePairs: vi.fn(() => ({})),
}));

vi.mock("./agents.js", () => ({
  detectAgents: vi.fn(),
  discoverAllSkills: vi.fn(),
}));

vi.mock("./mcp/mcp.js", () => ({
  discoverMcpServers: vi.fn(),
}));

vi.mock("./state.js", () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
  defaultState: vi.fn(),
  getStatePath: vi.fn(() => "/mock/state.yaml"),
}));

vi.mock("./sync/auto-sync.js", () => ({
  installAutoSync: vi.fn(),
  isAutoSyncInstalled: vi.fn(() => false),
}));

// Mock shell-hook to prevent real `./~/.config/agentbrew/shell-hook.sh` pollution
// when the identity `expandHome` mock above leaks a literal tilde path into
// writeFileSync. Without this, postInit → installShellHook creates a `./~/`
// directory in the repo cwd on every test run.
vi.mock("./shell-hook.js", () => ({
  installShellHook: vi.fn(),
  isShellHookInstalled: vi.fn(() => true),
  uninstallShellHook: vi.fn(),
  detectShell: vi.fn(() => "bash"),
}));

vi.mock("./fetch-sources.js", () => ({
  fetchSources: vi.fn().mockResolvedValue([]),
}));

vi.mock("./catalog/install.js", () => ({
  install: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./agentfile.js", () => ({
  generateAgentfile: vi.fn(() => undefined),
  writeAgentfile: vi.fn(() => "/mock/Agentfile.yaml"),
  globalAgentfileDir: vi.fn(() => "/mock/.config/agentbrew"),
  loadAgentfile: vi.fn(() => undefined),
}));

vi.mock("./sync-runner.js", () => ({
  autoSync: vi.fn().mockResolvedValue(undefined),
}));

import { detectAgents, discoverAllSkills } from "./agents.js";
import { install } from "./catalog/install.js";
import { init, initForce } from "./init.js";
import { discoverMcpServers } from "./mcp/mcp.js";
import { defaultState, loadState, saveState } from "./state.js";
import { installAutoSync, isAutoSyncInstalled } from "./sync/auto-sync.js";
import { autoSync } from "./sync-runner.js";
import { checkGitAvailable, checkPathConflicts } from "./utils.js";

const mockInstallAutoSync = vi.mocked(installAutoSync);
const mockIsAutoSyncInstalled = vi.mocked(isAutoSyncInstalled);
const mockCheckGitAvailable = vi.mocked(checkGitAvailable);
const mockCheckPathConflicts = vi.mocked(checkPathConflicts);

const mockDetectAgents = vi.mocked(detectAgents);
const mockDiscoverAllSkills = vi.mocked(discoverAllSkills);
const mockDiscoverMcpServers = vi.mocked(discoverMcpServers);
const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);
const mockDefaultState = vi.mocked(defaultState);
const mockInstall = vi.mocked(install);
const mockAutoSync = vi.mocked(autoSync);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockDefaultState.mockReturnValue({
    agents: [],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
  });
});

describe("init", () => {
  it("refreshes recommended install + sync when state already exists (no more 'already initialized' early exit)", async () => {
    // Previously `init` exited early with "already initialized" when state existed,
    // forcing users to manually run `install --recommended && sync` to refresh.
    // The new contract: `init` is idempotent — always installs recommended + syncs,
    // and both steps are no-ops on a fully-synced system (installRecommended returns
    // early when nothing is pending; autoSync repairs drift or exits quietly).
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [{ name: "existing-server", command: "x", args: [], env: {}, source: "user" }],
      catalogVersion: "0.1.0",
    });
    mockDetectAgents.mockReturnValue([
      { name: "claude-code", detected: true, skillsDir: "~/.claude/skills", mcpConfig: "~/.claude.json" },
    ]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);

    await init();

    // The old "already initialized" warning must NOT fire anymore.
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).not.toContain("already initialized");

    // install --recommended and autoSync both fire — the user's "set up everything" expectation.
    expect(mockInstall).toHaveBeenCalledWith(undefined, { recommended: true });
    expect(mockAutoSync).toHaveBeenCalled();
  });

  it("runs install --recommended + autoSync even when discovery finds existing skills/servers (no isFirstRun gate)", async () => {
    // Previously `postInit` gated install+sync behind `isFirstRun` which was
    // `mcpServers.length === 0 && skills.size === 0` — so any user with prior
    // config was silently skipped. New contract: always install recommended
    // and sync (unless `--skip-install` / `--skip-sync`).
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "y" }]);
    mockDiscoverAllSkills.mockReturnValue(
      new Map([["commit", { name: "commit", source: "claude-code:x", path: "/x/commit" }]]),
    );
    mockDiscoverMcpServers.mockReturnValue([
      { name: "existing", command: "npx", args: [], env: {}, source: "discovered" },
    ]);

    await init();

    expect(mockInstall).toHaveBeenCalledWith(undefined, { recommended: true });
    expect(mockAutoSync).toHaveBeenCalled();
  });

  it("honors --skip-install by skipping install but still syncs", async () => {
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "y" }]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);

    await init({ skipInstall: true });

    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockAutoSync).toHaveBeenCalled();
  });

  it("honors --skip-sync by installing but not syncing", async () => {
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "y" }]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);

    await init({ skipSync: true });

    expect(mockInstall).toHaveBeenCalledWith(undefined, { recommended: true });
    expect(mockAutoSync).not.toHaveBeenCalled();
  });

  it("warns when no agents detected", async () => {
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([{ name: "cursor", detected: false, skillsDir: "x" }]);
    await init();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("No AI coding agents"));
  });

  it("initializes with detected agents", async () => {
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([
      { name: "claude-code", detected: true, skillsDir: "~/.claude/skills", mcpConfig: "~/.claude.json" },
    ]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);

    await init();
    expect(mockSaveState).toHaveBeenCalled();
  });

  it("auto-installs auto-sync backend for drift repair", async () => {
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([
      { name: "claude-code", detected: true, skillsDir: "~/.claude/skills", mcpConfig: "~/.claude.json" },
    ]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);
    mockIsAutoSyncInstalled.mockReturnValue(false);

    await init();
    expect(mockInstallAutoSync).toHaveBeenCalled();
  });

  it("skips auto-sync install when already present", async () => {
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([
      { name: "claude-code", detected: true, skillsDir: "~/.claude/skills", mcpConfig: "~/.claude.json" },
    ]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);
    mockIsAutoSyncInstalled.mockReturnValue(true);

    await init();
    expect(mockInstallAutoSync).not.toHaveBeenCalled();
  });

  it("discovers skills and MCP servers", async () => {
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "y" }]);
    mockDiscoverAllSkills.mockReturnValue(
      new Map([["commit", { name: "commit", source: "claude-code:x", path: "/x/commit" }]]),
    );
    mockDiscoverMcpServers.mockReturnValue([{ name: "pg", command: "npx", args: [], env: {}, source: "discovered" }]);

    await init();
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0];
    expect(saved.mcpServers).toHaveLength(1);
  });

  it("auto-installs recommended and shows Done on first run (no existing config)", async () => {
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "y" }]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);

    await init();
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("Summary");
    expect(calls).toContain("1 agents detected");
    expect(calls).toContain("Recommended skills");
    expect(calls).toContain("Done!");
  });
});

describe("init — PATH conflict detection", () => {
  it("warns when conflicting binaries are found in PATH", async () => {
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([
      { name: "claude-code", detected: true, skillsDir: "~/.claude/skills", mcpConfig: "~/.claude.json" },
    ]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);
    mockCheckPathConflicts.mockReturnValue(["/usr/local/bin/agentbrew"]);

    await init();
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).toContain("PATH conflict detected");
    expect(calls).toContain("/usr/local/bin/agentbrew");
    expect(calls).toContain("not a Node.js binary");
    // Should still save state — warning is advisory, not blocking
    expect(mockSaveState).toHaveBeenCalled();
  });

  it("does not warn when no conflicting binaries exist", async () => {
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([
      { name: "claude-code", detected: true, skillsDir: "~/.claude/skills", mcpConfig: "~/.claude.json" },
    ]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);
    mockCheckPathConflicts.mockReturnValue([]);

    await init();
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).not.toContain("PATH conflict detected");
  });

  it("warns about multiple conflicting binaries", async () => {
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([
      { name: "claude-code", detected: true, skillsDir: "~/.claude/skills", mcpConfig: "~/.claude.json" },
    ]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);
    mockCheckPathConflicts.mockReturnValue(["/home/user/.local/bin/agentbrew", "/usr/local/bin/agentbrew"]);

    await init();
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).toContain("/home/user/.local/bin/agentbrew");
    expect(calls).toContain("/usr/local/bin/agentbrew");
  });

  it("checks for PATH conflicts on initForce as well", async () => {
    mockDetectAgents.mockReturnValue([{ name: "cursor", detected: true, skillsDir: "x" }]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);
    mockCheckPathConflicts.mockReturnValue(["/usr/local/bin/agentbrew"]);

    await initForce();
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).toContain("PATH conflict detected");
    expect(mockSaveState).toHaveBeenCalled();
  });
});

describe("initForce", () => {
  it("re-initializes even when state exists", async () => {
    mockDetectAgents.mockReturnValue([{ name: "cursor", detected: true, skillsDir: "x" }]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);

    await initForce();
    expect(mockSaveState).toHaveBeenCalled();
  });

  it("strips non-serializable fields (commandTransform) before saving", async () => {
    const transform = (s: string) => s;
    mockDetectAgents.mockReturnValue([
      {
        name: "cursor",
        detected: true,
        skillsDir: "x",
        commandTransform: transform,
      },
    ]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);

    await initForce();
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0];
    for (const agent of saved.agents) {
      expect(agent.commandTransform).toBeUndefined();
    }
  });

  it("strips commandTransform from ALL agents including mixed detected/undetected", async () => {
    mockDetectAgents.mockReturnValue([
      { name: "cursor", detected: true, skillsDir: "x", commandTransform: (s: string) => s },
      { name: "windsurf", detected: true, skillsDir: "y", commandTransform: (s: string) => s },
      { name: "gemini-cli", detected: false, skillsDir: "z", commandTransform: (s: string) => s },
      { name: "claude-code", detected: true, skillsDir: "w" },
    ]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);

    await initForce();
    const saved = mockSaveState.mock.calls[0][0];
    expect(saved.agents).toHaveLength(4);
    for (const agent of saved.agents) {
      expect(agent.commandTransform).toBeUndefined();
      expect(agent.name).toBeDefined();
      expect(agent.skillsDir).toBeDefined();
    }
  });

  it("preserves all other agent fields when stripping commandTransform", async () => {
    mockDetectAgents.mockReturnValue([
      {
        name: "cursor",
        detected: true,
        skillsDir: "~/.cursor/skills",
        mcpConfig: "~/.cursor/mcp.json",
        rulesDir: "~/.cursor/rules",
        commandsDir: "~/.cursor/commands",
        agentsDir: "~/.cursor/agents",
        commandTransform: (s: string) => s,
        commandFileExt: ".md",
        readsFrom: ["claude-code"],
      },
    ]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);

    await initForce();
    const saved = mockSaveState.mock.calls[0][0];
    const agent = saved.agents[0];
    expect(agent.commandTransform).toBeUndefined();
    expect(agent.name).toBe("cursor");
    expect(agent.skillsDir).toBe("~/.cursor/skills");
    expect(agent.mcpConfig).toBe("~/.cursor/mcp.json");
    expect(agent.rulesDir).toBe("~/.cursor/rules");
    expect(agent.commandsDir).toBe("~/.cursor/commands");
    expect(agent.agentsDir).toBe("~/.cursor/agents");
    expect(agent.commandFileExt).toBe(".md");
    expect(agent.readsFrom).toEqual(["claude-code"]);
  });

  it("init (not force) also strips commandTransform", async () => {
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([
      { name: "cursor", detected: true, skillsDir: "x", commandTransform: () => "fn" },
    ]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);

    await init();
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0];
    for (const agent of saved.agents) {
      expect(agent.commandTransform).toBeUndefined();
    }
  });

  it("installs auto-sync backend on force re-init", async () => {
    mockDetectAgents.mockReturnValue([{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "y" }]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);
    mockIsAutoSyncInstalled.mockReturnValue(false);

    await initForce();
    expect(mockInstallAutoSync).toHaveBeenCalled();
  });

  it("shows summary after force re-init", async () => {
    mockDetectAgents.mockReturnValue([{ name: "cursor", detected: true, skillsDir: "x" }]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);

    await initForce();
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("Summary");
  });

  it("preserves existing MCP servers, sources, and skillSourceDirs on force re-init", async () => {
    const existingState = {
      agents: [{ name: "old-agent", detected: false, skillsDir: "old" }],
      sources: [
        {
          url: "https://github.com/org/skills",
          type: "github" as const,
          skillsInstalled: ["my-skill"],
          availableItems: [],
          addedAt: "2026-01-01",
        },
      ],
      mcpServers: [
        { name: "custom-server", command: "npx", args: ["-y", "custom-mcp"], env: {}, source: "user" as const },
      ],
      skillSourceDirs: [{ label: "my-skills", path: "/path/to/skills" }],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(existingState);

    // detectAndSave will discover new agents and MCP servers
    mockDetectAgents.mockReturnValue([{ name: "cursor", detected: true, skillsDir: "x", mcpConfig: "y" }]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([
      { name: "discovered-server", command: "npx", args: ["-y", "disc-mcp"], env: {}, source: "discovered" as const },
    ]);

    await initForce();

    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0];

    // Should have newly detected agents (not old agents)
    expect(saved.agents).toHaveLength(1);
    expect(saved.agents[0].name).toBe("cursor");

    // Should preserve existing sources
    expect(saved.sources).toHaveLength(1);
    expect(saved.sources![0].url).toBe("https://github.com/org/skills");

    // Should merge MCP servers — keep existing + add newly discovered
    expect(saved.mcpServers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "custom-server" }),
        expect.objectContaining({ name: "discovered-server" }),
      ]),
    );

    // Should preserve skillSourceDirs
    expect(saved.skillSourceDirs!).toHaveLength(1);
    expect(saved.skillSourceDirs![0].label).toBe("my-skills");
  });
});

describe("init — git missing", () => {
  it("does not persist state when git is unavailable", async () => {
    process.exitCode = undefined;
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "y" }]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);
    mockCheckGitAvailable.mockReturnValue(false);

    await init();

    expect(mockSaveState).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("allows re-init after git becomes available", async () => {
    process.exitCode = undefined;
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "y" }]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);

    // First attempt: git missing → no state saved
    mockCheckGitAvailable.mockReturnValue(false);
    await init();
    expect(mockSaveState).not.toHaveBeenCalled();

    // Second attempt: git available → state is saved
    vi.clearAllMocks();
    mockLoadState.mockReturnValue(undefined);
    mockDetectAgents.mockReturnValue([{ name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "y" }]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);
    mockDefaultState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockCheckGitAvailable.mockReturnValue(true);
    await init();
    expect(mockSaveState).toHaveBeenCalled();
    process.exitCode = undefined;
  });

  it("does not persist state on initForce when git is unavailable", async () => {
    process.exitCode = undefined;
    mockDetectAgents.mockReturnValue([{ name: "cursor", detected: true, skillsDir: "x" }]);
    mockDiscoverAllSkills.mockReturnValue(new Map());
    mockDiscoverMcpServers.mockReturnValue([]);
    mockCheckGitAvailable.mockReturnValue(false);

    await initForce();

    expect(mockSaveState).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
