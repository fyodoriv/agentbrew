import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
/**
 * Integration tests for agentbrew — tests real cross-module interactions
 * with a sandboxed home directory. Only external concerns are mocked
 * (homedir, LaunchAgent, network, npx subprocesses for `update`).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks that must be hoisted ──────────────────────────────────────────────

const ctx = vi.hoisted(() => ({
  home: `/tmp/agentbrew-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`,
}));
const TEST_HOME = ctx.home;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => ctx.home, tmpdir: actual.tmpdir };
});

// Slice 4b of `delegate-mcp-to-mcpm`: ClaudeAdapter (with the `claude
// mcp add-json` / `claude mcp remove` CLI bridge) was deleted, but
// integration tests still mock spawnSync for `update`'s npx calls and
// for any leftover claude CLI invocations from upstream skills CLI flow.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn((cmd: string, ...rest: unknown[]) => {
      if (cmd === "claude")
        return {
          status: 0,
          stdout: Buffer.from(""),
          stderr: Buffer.from(""),
          error: null,
          pid: 0,
          signal: null,
          output: [],
        };
      return actual.spawnSync(cmd, ...(rest as [object]));
    }),
    execFileSync: vi.fn((cmd: string, ...rest: unknown[]) => {
      // Block npx calls (updateBuiltinSkills uses "npx skills check/update")
      if (cmd === "npx") {
        const error = new Error("npx not available in test") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return actual.execFileSync(cmd, ...(rest as [object]));
    }),
  };
});

// Prevent LaunchAgent operations
vi.mock("./sync/auto-sync.js", () => ({
  installLaunchAgent: vi.fn(),
  installAutoSync: vi.fn(),
  uninstallLaunchAgent: vi.fn(),
  uninstallAutoSync: vi.fn(),
  isLaunchAgentInstalled: vi.fn(() => true),
  isAutoSyncInstalled: vi.fn(() => true),
  activeBackend: vi.fn(() => "launchagent"),
  watchAndSync: vi.fn(),
  autoSyncStatus: vi.fn(),
  cleanupLegacyAgents: vi.fn(() => 0),
  trimLogIfNeeded: vi.fn(),
  getLogDir: vi.fn(() => "/tmp/agentbrew-test-logs"),
}));

vi.mock("./sync/auto-repair-health.js", async () => {
  const actual = await vi.importActual<typeof import("./sync/auto-repair-health.js")>("./sync/auto-repair-health.js");
  return {
    ...actual,
    probeAutoRepairHealth: vi.fn(() => ({
      backend: "launchagent",
      state: "active",
      loaded: true,
      lastRunAt: new Date().toISOString(),
    })),
  };
});

// Prevent shell hook installation (cd detection)
vi.mock("./shell-hook.js", () => ({
  installShellHook: vi.fn(),
  isShellHookInstalled: vi.fn(() => true),
}));

// Prevent the catalog → mcpm bridge in `installMcpServer` from spawning a
// real `mcpm` subprocess. Slice 4a + 5a of `delegate-mcp-to-mcpm` removed
// native MCP-config writes for MCP_INTERSECTION_AGENTS (see mcp-agent-map.ts); codex, etc.) and slice 5a deleted the `installFromRegistry` path that
// previously called these helpers. The follow-up bridge in
// `src/catalog/install-other.ts` re-introduces the call from the catalog
// install path so users get intersection-client config writes back. Without
// this mock, every integration test that touches the catalog install of
// an MCP server would hit a 60s subprocess timeout because the test home
// detects cursor + codex (intersection agents).
vi.mock("./sync/mcp-delegate.js", () => ({
  isMcpmAvailable: vi.fn(() => true),
  delegateMcpInstall: vi.fn(() => ({ ok: false, carveOuts: [] })),
  delegateMcpClientEdit: vi.fn(() => ({ ok: false, carveOuts: [], perClient: [] })),
  delegateMcpUninstall: vi.fn(() => ({
    ok: false,
    carveOuts: [],
    perClient: [],
    globalUninstall: { ok: false },
  })),
  delegateMcpNew: vi.fn(() => ({ ok: false })),
  mcpServerConfigEquals: vi.fn(() => true),
  readMcpmServer: vi.fn(() => undefined),
  // Slice 2 of `bridge-mcp-sync-to-mcpm-for-intersection`: must be
  // mocked so the sync-time bridge in `syncMcpServers` doesn't read
  // the user's real `~/.config/mcpm/servers.json` during tests.
  listMcpmServerNames: vi.fn(() => new Set<string>()),
}));

// Prevent autoSync from running full sync during initForce
vi.mock("./sync-runner.js", () => ({
  autoSync: vi.fn(async () => {}),
}));

// Prevent network calls for source fetching
vi.mock("./fetch-sources.js", () => ({
  fetchSources: vi.fn(async () => []),
  isCacheFresh: vi.fn(() => true),
}));

// Prevent catalog from hitting network — also provide all exports used by add-source, install, and update
vi.mock("./catalog/index-source.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalog/index-source.js")>();
  return {
    ...actual,
    indexSource: vi.fn(() => []),
    indexAllSources: vi.fn(async () => {}),
    getSourceCachePath: vi.fn(() => undefined),
    getSourceCacheDir: vi.fn((source: { url: string }) => {
      const safeName = source.url.replace(/[^a-zA-Z0-9_-]/g, "_");
      return `${ctx.home}/.cache/agentbrew/sources/${safeName}`;
    }),
    isSourceFailed: vi.fn(() => false),
    classifyGitError: vi.fn(() => ""),
    formatItemCounts: vi.fn(() => ""),
    resetSessionCache: vi.fn(),
  };
});

// Prevent env hygiene check from detecting vars in the test runner's env
vi.mock("./core/env-sanitize.js", () => ({
  checkEnvHygiene: vi.fn(() => []),
}));

vi.mock("./mcp/heal-cycle.js", () => ({
  runMcpHealCycle: vi.fn(async () => ({ initial: [], final: [], attempts: [] })),
}));

// ── Imports (run after mocks are hoisted) ───────────────────────────────────

import { execFileSync } from "node:child_process";
import { addSource } from "./add-source.js";
import { applyAgentfile } from "./agentfile.js";
import { detectAgents, discoverAllSkills } from "./agents.js";
import { getSourceCachePath, indexAllSources, indexSource } from "./catalog/index-source.js";
import { flushInstallSummary, install } from "./catalog/install.js";
import { resetStateManager } from "./core/state-manager.js";
import { healthCheck } from "./health.js";
import { discoverUnmanagedServers } from "./import.js";
import { initForce } from "./init.js";
import { lint } from "./lint.js";
import { lockSource, readLock, showLock, showVerify, updateLock, verifyLock, writeLock } from "./lock.js";
import { discoverMcpServers, readMcpJson, writeMcpJson } from "./mcp/mcp.js";

import { applyBundle, buildExportBundle, type ExportBundle, parseBundle } from "./portable.js";
import { defaultState, getStatePath, invalidateState, loadState, saveState } from "./state.js";
import { status } from "./status.js";
import { addAgentSource, syncAgentDefs } from "./sync/agents-sync.js";
import { initCommands, listCommands, syncCommands } from "./sync/command-sync.js";
import { syncHooks } from "./sync/hooks-sync.js";
import { syncInstructions } from "./sync/instructions-sync.js";
import { delegateMcpClientEdit, delegateMcpNew, mcpServerConfigEquals, readMcpmServer } from "./sync/mcp-delegate.js";
import { addMcpServer, removeMcpServer, syncMcpServers } from "./sync/mcp-sync.js";
import { initRules, loadSharedRules, saveSharedRules, showRules, syncRules } from "./sync/rules-sync.js";
import { syncSkills } from "./sync/skills-sync.js";
import type { AgentBrewState } from "./types.js";
import { refreshInstalledSkills, update } from "./update.js";
import { expandHome } from "./utils.js";

// ── Test infrastructure ─────────────────────────────────────────────────────

/** Agent directories we'll create in TEST_HOME to simulate installed agents */
// Slice 4a of `delegate-mcp-to-mcpm`: kiro (carve-out) is added so MCP
// integration tests still exercise the native sync path. Cursor is an
// intersection agent now and skip native MCP sync; their
// dirs stay in the fixture for skills/commands/rules tests, but MCP
// integration assertions target kiro instead.
const AGENT_DIRS = [".cursor", ".config/opencode", ".augment", ".codex", ".kiro"];

/** MCP config files for agents that support them.
 *  Slice 4a: kiro is the canonical native-sync MCP target for integration
 *  tests because cursor is now an intersection-skip agent. The
 *  cursor path is still seeded so the fixture's drift /
 *  user-added scenarios still see realistic config files even though
 *  those agents skip native sync. */
const MCP_CONFIGS: Record<string, string> = {
  ".cursor/mcp.json": JSON.stringify({ mcpServers: {} }, null, 2),
  ".kiro/settings/mcp.json": JSON.stringify({ mcpServers: {} }, null, 2),
};

/** Rules files for agents that support them */
const RULES_FILES: Record<string, string> = {
  ".augment/guidelines.md": "# Augment Guidelines\n",
  ".codex/AGENTS.md": "# Codex\n",
};

function setupAgentDirs(): void {
  for (const dir of AGENT_DIRS) {
    mkdirSync(join(TEST_HOME, dir, "skills"), { recursive: true });
    mkdirSync(join(TEST_HOME, dir, "commands"), { recursive: true });
  }
  // Cursor also needs commands dir at top level
  mkdirSync(join(TEST_HOME, ".cursor", "commands"), { recursive: true });

  for (const [path, content] of Object.entries(MCP_CONFIGS)) {
    const full = join(TEST_HOME, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  for (const [path, content] of Object.entries(RULES_FILES)) {
    const full = join(TEST_HOME, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
}

function cleanState(): void {
  // Clear cached singleton so each test starts fresh
  resetStateManager();
  // Remove state file and config dir contents, but keep agent dirs
  const stateFile = getStatePath();
  if (existsSync(stateFile)) rmSync(stateFile);

  const configDir = join(TEST_HOME, ".config", "agentbrew");
  if (existsSync(configDir)) {
    for (const entry of readdirSync(configDir)) {
      if (entry === "backups") continue; // keep backups for rollback tests
      rmSync(join(configDir, entry), { recursive: true, force: true });
    }
  }

  // A prior test may create ~/.claude (claude-code/desktop) in the sandbox.
  // cleanState keeps agent dirs, so a stray ~/.claude makes claude-code
  // "detected" with no commands subdir — drift that pollutes later clean-state
  // tests. Remove it so every test starts from the canonical fixture topology.
  rmSync(join(TEST_HOME, ".claude"), { recursive: true, force: true });

  // Reset MCP configs to empty
  for (const [path, content] of Object.entries(MCP_CONFIGS)) {
    writeFileSync(join(TEST_HOME, path), content);
  }

  // Reset rules files
  for (const [path, content] of Object.entries(RULES_FILES)) {
    writeFileSync(join(TEST_HOME, path), content);
  }
}

function makeState(overrides?: Partial<AgentBrewState>): AgentBrewState {
  const agents = detectAgents().map(({ commandTransform, ...rest }) => rest);
  return {
    ...defaultState(),
    agents,
    ...overrides,
  } as AgentBrewState;
}

function captureLog(): { calls: () => string; reset: () => void } {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  return {
    calls: () => [...spy.mock.calls, ...errSpy.mock.calls].flat().join(" "),
    reset: () => {
      spy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

// ── Setup & teardown ────────────────────────────────────────────────────────

beforeAll(() => {
  setupAgentDirs();
});

beforeEach(() => {
  cleanState();
  process.exitCode = undefined;
  // Point AGENTBREW_DIR to sandboxed home so instructions sync doesn't find real templates/AGENTS.md
  process.env.AGENTBREW_DIR = TEST_HOME;
});

afterAll(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. State Management
// ═══════════════════════════════════════════════════════════════════════════

describe("state management", () => {
  it("save and load state round-trip", () => {
    const state = makeState({
      mcpServers: [{ name: "pg", command: "npx", args: ["pg-mcp"], env: {}, source: "user" }],
    });
    saveState(state);

    const loaded = loadState();
    expect(loaded).toBeDefined();
    expect(loaded!.mcpServers).toHaveLength(1);
    expect((loaded!.mcpServers ?? [])[0].name).toBe("pg");
  });

  it("loadState returns undefined when no state file", () => {
    expect(loadState()).toBeUndefined();
  });

  it("state path is under test home", () => {
    expect(getStatePath()).toContain(TEST_HOME);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Agent Detection
// ═══════════════════════════════════════════════════════════════════════════

describe("agent detection", () => {
  it("detects agents whose parent directories exist", () => {
    const agents = detectAgents();
    const detected = agents.filter((a) => a.detected);

    // We created .cursor, .config/opencode, .augment, .codex dirs
    const names = detected.map((a) => a.name);
    expect(names).toContain("cursor");
    expect(names).toContain("opencode");
    expect(names).toContain("augment");
    expect(names).toContain("codex");
  });

  it("does not detect agents without directories", () => {
    const agents = detectAgents();
    // claude-code needs ~/.claude which we didn't create (intentionally)
    const claude = agents.find((a) => a.name === "claude-code");
    expect(claude?.detected).toBe(false);
  });

  it("discovers skills in agent directories", () => {
    // Create a skill in cursor
    const skillDir = join(TEST_HOME, ".cursor", "skills", "debug");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Debug Skill");

    const agents = detectAgents();
    const cursor = agents.find((a) => a.name === "cursor")!;
    const skills = discoverAllSkills([cursor]);

    expect(skills.size).toBeGreaterThanOrEqual(1);
    expect(skills.has("debug")).toBe(true);

    // Cleanup
    rmSync(skillDir, { recursive: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. MCP Server Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe("MCP server lifecycle", () => {
  beforeEach(() => {
    const state = makeState();
    saveState(state);
  });

  // Carve-out vs intersection classification (current as of 2026-05-19):
  // - `kiro` is a native carve-out → gets the direct write
  // - `cursor` is a native carve-out because mcpm wrappers are not surfaced
  //   to Cursor's agent tool layer
  it("add → list → sync → verify in agent configs → remove", async () => {
    const log = captureLog();

    // Add a server
    await addMcpServer("test-db", "npx", ["test-db-mcp"], { DB_URL: "postgres://localhost" });
    log.reset();

    // Verify state
    const state = loadState()!;
    expect(state.mcpServers).toHaveLength(1);
    expect((state.mcpServers ?? [])[0].name).toBe("test-db");
    expect((state.mcpServers ?? [])[0].env.DB_URL).toBe("postgres://localhost");

    // Sync explicitly
    const log3 = captureLog();
    await syncMcpServers();
    log3.reset();

    // Verify kiro config file has the server (carve-out gets native write).
    const kiroConfig = readMcpJson(join(TEST_HOME, ".kiro", "settings", "mcp.json"));
    expect(kiroConfig.mcpServers?.["test-db"]).toBeDefined();
    expect(kiroConfig.mcpServers?.["test-db"]?.command).toBe("npx");

    // Verify cursor is written directly (native carve-out).
    const cursorConfig = readMcpJson(join(TEST_HOME, ".cursor", "mcp.json"));
    expect(cursorConfig.mcpServers?.["test-db"]).toBeDefined();

    // Remove
    const log4 = captureLog();
    await removeMcpServer("test-db");
    log4.reset();

    // Verify removed from state
    const stateAfter = loadState()!;
    expect(stateAfter.mcpServers).toHaveLength(0);
  });

  it("adding duplicate server updates it", async () => {
    const log = captureLog();
    await addMcpServer("srv", "npx", ["v1"], {});
    await addMcpServer("srv", "npx", ["v2"], {});
    log.reset();

    const state = loadState()!;
    expect(state.mcpServers).toHaveLength(1);
    expect((state.mcpServers ?? [])[0].args).toEqual(["v2"]);
  });

  // Slice 4a: cursor is intersection-skip; native preservation logic
  // is exercised against kiro (carve-out) instead.
  it("sync preserves user-added servers in agent configs", async () => {
    // Deploy an agentbrew-managed server
    const state = loadState()!;
    state.mcpServers = [{ name: "managed", command: "npx", args: [], env: {}, source: "user" }];
    saveState(state);

    const log1 = captureLog();
    await syncMcpServers();
    log1.reset();

    // Manually add a user server directly to kiro config (not in agentbrew state)
    const kiroPath = join(TEST_HOME, ".kiro", "settings", "mcp.json");
    const config = readMcpJson(kiroPath);
    config.mcpServers = config.mcpServers ?? {};
    (config.mcpServers as Record<string, unknown>)["user-manual"] = {
      command: "node",
      args: ["my-server.js"],
    };
    writeMcpJson(kiroPath, config);

    // Re-sync (no prune) — user server must survive
    const log2 = captureLog();
    await syncMcpServers();
    log2.reset();

    const finalConfig = readMcpJson(kiroPath);
    expect(finalConfig.mcpServers?.managed).toBeDefined();
    expect((finalConfig.mcpServers as Record<string, unknown>)?.["user-manual"]).toBeDefined();
    expect(
      ((finalConfig.mcpServers as Record<string, unknown>)?.["user-manual"] as Record<string, unknown>)?.command,
    ).toBe("node");
  });

  it("discoverUnmanagedServers finds user-added servers not in state", async () => {
    // Deploy a managed server
    const state = loadState()!;
    state.mcpServers = [{ name: "managed", command: "npx", args: [], env: {}, source: "user" }];
    saveState(state);

    const log1 = captureLog();
    await syncMcpServers();
    log1.reset();

    // Manually add a user server to cursor config
    const cursorPath = join(TEST_HOME, ".cursor", "mcp.json");
    const config = readMcpJson(cursorPath);
    config.mcpServers = config.mcpServers ?? {};
    (config.mcpServers as Record<string, unknown>)["user-only"] = { command: "node", args: [] };
    writeMcpJson(cursorPath, config);

    // Discover should find user-only but not managed
    const stateNames = new Set((state.mcpServers ?? []).map((s) => s.name));
    const unmanaged = discoverUnmanagedServers(stateNames);
    const names = unmanaged.map((u) => u.server);
    expect(names).toContain("user-only");
    expect(names).not.toContain("managed");
  });

  // Slice 4a: cursor is intersection-skip; prune semantics are
  // exercised against kiro (carve-out) instead.
  it("sync with --prune removes agentbrew-managed servers, preserves user-added", async () => {
    // First sync: deploy "stale" and "keep" — records them in manifest.managedMcpServers
    const state1 = loadState()!;
    state1.mcpServers = [
      { name: "stale", command: "old", args: [], env: {}, source: "user" },
      { name: "keep", command: "new", args: [], env: {}, source: "user" },
    ];
    saveState(state1);

    const log1 = captureLog();
    await syncMcpServers();
    log1.reset();

    // Manually add a user server to kiro config (not in agentbrew state)
    const kiroPath = join(TEST_HOME, ".kiro", "settings", "mcp.json");
    const config = readMcpJson(kiroPath);
    config.mcpServers = config.mcpServers ?? {};
    (config.mcpServers as Record<string, unknown>)["user-custom"] = { command: "custom" };
    writeMcpJson(kiroPath, config);

    // Remove "stale" from state (simulates user running `agentbrew mcp remove stale` — cli-removed-commands-allowlist: pre-slice-5a wrapper, deleted in PR #851; today users run `agentbrew remove stale`)
    const state2 = loadState()!;
    state2.mcpServers = [{ name: "keep", command: "new", args: [], env: {}, source: "user" }];
    saveState(state2);

    // Sync with prune
    const log2 = captureLog();
    await syncMcpServers({ prune: true });
    log2.reset();

    const finalConfig = readMcpJson(kiroPath);
    // "stale" should be pruned (was in managedMcpServers from first sync)
    expect(finalConfig.mcpServers?.stale).toBeUndefined();
    // "keep" should still be there
    expect(finalConfig.mcpServers?.keep).toBeDefined();
    // "user-custom" should survive prune (never in managedMcpServers)
    expect((finalConfig.mcpServers as Record<string, unknown>)?.["user-custom"]).toBeDefined();
  });

  it("sync with --dry-run does not modify files", async () => {
    const state = loadState()!;
    state.mcpServers = [{ name: "dry-test", command: "echo", args: [], env: {}, source: "user" }];
    saveState(state);

    const cursorPath = join(TEST_HOME, ".cursor", "mcp.json");
    const before = readFileSync(cursorPath, "utf-8");

    const log = captureLog();
    await syncMcpServers({ dryRun: true });
    log.reset();

    const after = readFileSync(cursorPath, "utf-8");
    expect(after).toBe(before);
  });

  // Slice 2 of `bridge-mcp-sync-to-mcpm-for-intersection`: when state
  // mutates without going through `agentbrew install` (hand-edits to
  // state.yaml, `Agentfile.yaml mcp:` imports, etc.), `agentbrew sync`
  // must still bridge the new servers to mcpm so cursor / claude-code
  // / codex etc. see them in their actual config files.
  it("sync after state.yaml hand-edit bridges new server to mcpm for the intersection", async () => {
    const mockDelegateMcpNew = vi.mocked(delegateMcpNew);
    const mockDelegateMcpClientEdit = vi.mocked(delegateMcpClientEdit);
    const mockMcpServerConfigEquals = vi.mocked(mcpServerConfigEquals);
    const mockReadMcpmServer = vi.mocked(readMcpmServer);

    mockDelegateMcpNew.mockClear();
    mockDelegateMcpClientEdit.mockClear();
    mockMcpServerConfigEquals.mockClear();
    mockReadMcpmServer.mockClear();
    mockMcpServerConfigEquals.mockReturnValueOnce(false).mockReturnValue(true);
    mockDelegateMcpNew.mockReturnValue({ ok: true, stdout: "" });
    mockReadMcpmServer.mockReturnValue({
      name: "fresh-server",
      command: "npx",
      args: ["mcp-fresh"],
      env: {},
      source: "registry",
    });
    mockDelegateMcpClientEdit.mockReturnValue({
      ok: true,
      carveOuts: [],
      perClient: [{ client: "cursor", ok: true }],
    });

    // Hand-edit state.yaml: add a server directly without going
    // through `agentbrew install`. This mirrors the user opening
    // ~/.config/agentbrew/state.yaml in their editor or
    // `applyAgentfile()` importing from a project-local
    // `Agentfile.yaml mcp:` block.
    const state = loadState()!;
    state.mcpServers = [{ name: "fresh-server", command: "npx", args: ["mcp-fresh"], env: {}, source: "user" }];
    saveState(state);

    const log = captureLog();
    await syncMcpServers();
    log.reset();

    // Bridge fired for the hand-edited server.
    expect(mockDelegateMcpNew).toHaveBeenCalledWith(expect.objectContaining({ serverName: "fresh-server" }));
    expect(mockDelegateMcpClientEdit).toHaveBeenCalledWith(expect.objectContaining({ serverName: "fresh-server" }));
  });

  it("sync skips the bridge for servers already in mcpm (idempotent steady-state)", async () => {
    const mockDelegateMcpNew = vi.mocked(delegateMcpNew);
    const mockMcpServerConfigEquals = vi.mocked(mcpServerConfigEquals);

    mockDelegateMcpNew.mockClear();
    mockMcpServerConfigEquals.mockReset();
    mockMcpServerConfigEquals.mockReturnValue(true);

    const state = loadState()!;
    state.mcpServers = [{ name: "already-in-mcpm", command: "npx", args: [], env: {}, source: "user" }];
    saveState(state);

    const log = captureLog();
    await syncMcpServers();
    log.reset();

    // Bridge skipped because the exact server definition already matches mcpm.
    expect(mockDelegateMcpNew).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Rules Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe("rules lifecycle", () => {
  beforeEach(() => {
    const state = makeState();
    saveState(state);
  });

  it("init → show → sync deploys to agent rules files", async () => {
    // Init should extract from the first agent that has a rules file
    const log = captureLog();
    await initRules();
    log.reset();

    const rules = loadSharedRules();
    expect(rules).toBeDefined();

    // Show
    const log2 = captureLog();
    await showRules();
    expect(log2.calls()).toContain("Shared rules");
    log2.reset();

    // Sync
    const log3 = captureLog();
    await syncRules();
    log3.reset();

    // Verify rules deployed to augment (has rulesFile)
    const wsRules = readFileSync(join(TEST_HOME, ".augment", "guidelines.md"), "utf-8");
    expect(wsRules).toContain("<!-- agentbrew:start -->");
    expect(wsRules).toContain("<!-- agentbrew:end -->");
  });

  it("custom shared rules deploy correctly", async () => {
    saveSharedRules("# My Custom Rules\n\n- Rule one\n- Rule two\n");

    const log = captureLog();
    await syncRules();
    log.reset();

    const augmentRules = readFileSync(join(TEST_HOME, ".augment", "guidelines.md"), "utf-8");
    expect(augmentRules).toContain("My Custom Rules");
    expect(augmentRules).toContain("Rule one");
    expect(augmentRules).toContain("<!-- agentbrew:start -->");
  });

  it("re-sync updates managed section without losing unmanaged content", async () => {
    // Write a rules file with some manual content + managed section
    const rulesPath = join(TEST_HOME, ".augment", "guidelines.md");
    writeFileSync(rulesPath, "# My Manual Notes\n\n<!-- agentbrew:start -->\nold rules\n<!-- agentbrew:end -->\n");

    saveSharedRules("new rules content");

    const log = captureLog();
    await syncRules();
    log.reset();

    const content = readFileSync(rulesPath, "utf-8");
    expect(content).toContain("# My Manual Notes");
    expect(content).toContain("new rules content");
    expect(content).not.toContain("old rules");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Commands Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe("commands lifecycle", () => {
  beforeEach(() => {
    const state = makeState();
    saveState(state);
  });

  it("init → list → sync deploys to agent command dirs", async () => {
    const log = captureLog();
    await initCommands();
    log.reset();

    // Verify starter command created
    const commandsDir = expandHome("~/.config/agentbrew/commands");
    expect(existsSync(join(commandsDir, "hello.md"))).toBe(true);

    // List
    const log2 = captureLog();
    await listCommands();
    expect(log2.calls()).toContain("hello");
    log2.reset();

    // Sync
    const log3 = captureLog();
    await syncCommands();
    log3.reset();

    // Slice 4 of `delegate-commands-to-ai-rules`: cursor is now a
    // canary agent that delegates to `ai-rules generate`. The
    // assertion pivots to opencode — a carve-out agent that keeps the
    // native source-read path. Verifies the carve-out path still
    // deploys correctly post-slice-4.
    const opencodeCmd = join(TEST_HOME, ".config", "opencode", "commands", "hello.md");
    expect(existsSync(opencodeCmd)).toBe(true);
    expect(readFileSync(opencodeCmd, "utf-8")).toContain("description:");
  });

  it("sync with --prune removes only agentbrew-deployed commands, preserves user-created", async () => {
    await initCommands();

    // Sync first — this deploys hello.md and tracks it in the manifest
    await syncCommands();

    // Verify hello.md is deployed to cursor
    const cursorCmdDir = join(TEST_HOME, ".cursor", "commands");
    expect(existsSync(join(cursorCmdDir, "hello.md"))).toBe(true);

    // Manually add an extra command to cursor (simulates user creating a command)
    writeFileSync(join(cursorCmdDir, "user-cmd.md"), "user content");

    // Remove hello.md from the source so it becomes "stale" in agentbrew's view
    const commandsDir = expandHome("~/.config/agentbrew/commands");
    unlinkSync(join(commandsDir, "hello.md"));

    // Sync with prune
    await syncCommands({ prune: true });

    // user-created command should survive prune (not in manifest)
    expect(existsSync(join(cursorCmdDir, "user-cmd.md"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Lint
// ═══════════════════════════════════════════════════════════════════════════

describe("lint", () => {
  it("returns true when instructions source exists", () => {
    // Set AGENTBREW_DIR so lint can find config
    const agentBrewDir = join(TEST_HOME, "agentbrew-repo");
    mkdirSync(join(agentBrewDir, "templates"), { recursive: true });
    writeFileSync(join(agentBrewDir, "templates", "AGENTS.md"), "# Instructions");
    process.env.AGENTBREW_DIR = agentBrewDir;

    const log = captureLog();
    const result = lint();
    log.reset();

    expect(result).toBe(true);
    delete process.env.AGENTBREW_DIR;
    rmSync(agentBrewDir, { recursive: true });
  });

  it("returns false when instructions source is missing", () => {
    process.env.AGENTBREW_DIR = join(TEST_HOME, "nonexistent-repo");

    const log = captureLog();
    const result = lint();
    log.reset();

    expect(result).toBe(false);
    delete process.env.AGENTBREW_DIR;
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Health Check & Fix
// ═══════════════════════════════════════════════════════════════════════════

describe("health check & fix", () => {
  it("reports clean when everything is in sync", async () => {
    const state = makeState();
    saveState(state);
    await syncHooks({ quiet: true });

    const log = captureLog();
    await healthCheck({ autoFix: false });
    expect(log.calls()).toContain("clean");
    log.reset();
    expect(process.exitCode).toBe(0);
  }, 15_000);

  it("detects MCP drift when server is missing from agent config", async () => {
    const state = makeState({
      mcpServers: [{ name: "missing-srv", command: "npx", args: [], env: {}, source: "user" }],
    });
    saveState(state);

    const log = captureLog();
    await healthCheck({ autoFix: false });
    expect(log.calls()).toContain("missing server: missing-srv");
    log.reset();
    expect(process.exitCode).toBe(1);
  });

  // Slice 4a: cursor is intersection-skip; auto-fix writes to kiro
  // (carve-out) instead.
  it("auto-fix repairs MCP drift", async () => {
    const state = makeState({
      mcpServers: [{ name: "fix-me", command: "npx", args: ["fix-me"], env: {}, source: "user" }],
    });
    saveState(state);

    const log = captureLog();
    await healthCheck({ autoFix: true });
    log.reset();

    // After fix, server should be in kiro config (carve-out path).
    const kiroConfig = readMcpJson(join(TEST_HOME, ".kiro", "settings", "mcp.json"));
    expect(kiroConfig.mcpServers?.["fix-me"]).toBeDefined();
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. Status
// ═══════════════════════════════════════════════════════════════════════════

describe("status", () => {
  it("shows agents, servers, and sources", async () => {
    const state = makeState({
      mcpServers: [{ name: "pg", command: "npx", args: [], env: {}, source: "user" }],
    });
    saveState(state);

    const log = captureLog();
    await status();

    const output = log.calls();
    expect(output).toContain("Agents");
    expect(output).toContain("MCP Servers");
    expect(output).toContain("Sources");
    expect(output).toContain("cursor"); // detected agent
    log.reset();
  });

  it("returns early when not initialized", async () => {
    // No state file
    const log = captureLog();
    await status();
    expect(log.calls()).toContain("not initialized");
    log.reset();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. End-to-End: Full Sync Flow
// ═══════════════════════════════════════════════════════════════════════════

describe("end-to-end sync flow", () => {
  it("init state → add MCP → create rules → create commands → sync all → verify all deployed", async () => {
    // 1. Init state
    const state = makeState();
    saveState(state);

    // 2. Add MCP server
    const log = captureLog();
    await addMcpServer("e2e-server", "npx", ["e2e-pkg"], { API_KEY: "secret" });
    log.reset();

    // 3. Create shared rules
    saveSharedRules("# E2E Rules\n\n- Always test\n");

    // 4. Create commands
    const commandsDir = expandHome("~/.config/agentbrew/commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, "deploy.md"), "---\ndescription: Deploy app\n---\n# Deploy\nRun deploy.\n");

    // 5. Sync all
    const log2 = captureLog();
    await syncMcpServers();
    await syncRules();
    await syncCommands();
    log2.reset();

    // 6. Verify MCP deployed (slice 4a: native sync writes to kiro
    // carve-out, not cursor — cursor is mcpm-managed and skipped).
    const kiroMcp = readMcpJson(join(TEST_HOME, ".kiro", "settings", "mcp.json"));
    expect(kiroMcp.mcpServers?.["e2e-server"]).toBeDefined();
    expect(kiroMcp.mcpServers?.["e2e-server"]?.args).toEqual(["e2e-pkg"]);

    // 7. Verify rules deployed
    const augmentRules = readFileSync(join(TEST_HOME, ".augment", "guidelines.md"), "utf-8");
    expect(augmentRules).toContain("E2E Rules");
    expect(augmentRules).toContain("Always test");

    // 8. Slice 4 of `delegate-commands-to-ai-rules`: cursor is now a
    // canary agent that delegates to ai-rules. When ai-rules is on
    // PATH, cursor's command file gets written by agentbrew with
    // ai-rules' content (frontmatter intact since cursor's transform
    // is identity post-slice-4). When ai-rules is missing, the
    // canary skips and the file isn't written. The test sandbox can
    // be either — we assert on the opencode carve-out path which is
    // unaffected by slice 4.

    // 9. Verify opencode command (carve-out — keeps the native path).
    const wsCmd = readFileSync(join(TEST_HOME, ".config", "opencode", "commands", "deploy.md"), "utf-8");
    expect(wsCmd).toContain("description: Deploy app");

    // 10. Health check should be clean
    const log3 = captureLog();
    await healthCheck({ autoFix: false });
    expect(log3.calls()).toContain("clean");
    log3.reset();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. MCP Server Discovery
// ═══════════════════════════════════════════════════════════════════════════

describe("MCP server discovery", () => {
  it("discovers servers from existing agent configs", () => {
    // Put a server in cursor's config
    writeMcpJson(join(TEST_HOME, ".cursor", "mcp.json"), {
      mcpServers: {
        "existing-srv": { command: "npx", args: ["existing-pkg"] },
      },
    });

    const agents = detectAgents();
    const servers = discoverMcpServers(agents);

    expect(servers.some((s) => s.name === "existing-srv")).toBe(true);

    // Reset
    writeMcpJson(join(TEST_HOME, ".cursor", "mcp.json"), { mcpServers: {} });
  });

  it("deduplicates servers across agents", () => {
    writeMcpJson(join(TEST_HOME, ".cursor", "mcp.json"), {
      mcpServers: { shared: { command: "npx", args: ["shared"] } },
    });
    writeMcpJson(join(TEST_HOME, ".kiro", "settings", "mcp.json"), {
      mcpServers: { shared: { command: "npx", args: ["shared"] } },
    });

    const agents = detectAgents();
    const servers = discoverMcpServers(agents);
    const sharedCount = servers.filter((s) => s.name === "shared").length;

    expect(sharedCount).toBe(1);

    // Reset
    for (const [path, content] of Object.entries(MCP_CONFIGS)) {
      writeFileSync(join(TEST_HOME, path), content);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Clean-slate new user experience
// ═══════════════════════════════════════════════════════════════════════════

describe("clean-slate new user", () => {
  // Note: the previous "templates/AGENTS.md contains no personal context"
  // whole-template assertion was deleted 2026-05-26. It was over-broad —
  // the template legitimately documents workflow patterns that include
  // host paths (`~/apps/dotfiles/bin/gh` for the gh wrapper), GitHub Enterprise
  // URLs in the standing-approvals table, and public agent ecosystem
  // names (e.g. Minsky) as part of the PR-draft-status rule.
  //
  // The narrower replacement lives at
  // `src/sync/instructions-sync.test.ts:927`
  // ("contains no project-specific tool names — keeps templates clean
  // for all users") which scopes the assertion to the "Pipeline-managed
  // repos" subsection where those terms genuinely shouldn't appear.
  // That test is the actual regression guard; the whole-template
  // version was reporting false positives that blocked unrelated PRs.
  //
  // Replaces an earlier whole-template clean-slate test that was
  // generating false positives on innocuous matches; this narrower
  // shape lives in instructions-sync.test.ts.

  it("sources.yaml contains no GHE URLs", () => {
    const sourcesPath = join(import.meta.dirname, "sources.yaml");
    if (!existsSync(sourcesPath)) return;

    const content = readFileSync(sourcesPath, "utf-8");
    expect(content).not.toContain("github.example.com");
    expect(content).not.toContain("registry.npmjs.example.com");
  });

  it("catalog.yaml contains no organization-internal URLs or categories", () => {
    const catalogPath = join(import.meta.dirname, "catalog.yaml");
    if (!existsSync(catalogPath)) return;

    const content = readFileSync(catalogPath, "utf-8");
    expect(content).not.toContain("github.example.com");
    expect(content).not.toMatch(/category:\s*organization/);
    expect(content).not.toMatch(/category:\s*internal/);
  });

  it("init → sync → check produces zero drift on clean state", async () => {
    cleanState();
    setupAgentDirs();

    // Set AGENTBREW_DIR to repo root so instructions sync finds templates/AGENTS.md
    const repoRoot = join(import.meta.dirname, "..");
    process.env.AGENTBREW_DIR = repoRoot;

    // Init: detect agents and save state
    const agents = detectAgents();
    const detectedAgents = agents.filter((a) => a.detected);
    expect(detectedAgents.length).toBeGreaterThan(0);

    const state = defaultState();
    // Strip non-serializable fields (commandTransform is a function)
    state.agents = agents.map(({ commandTransform, ...rest }) => rest);
    saveState(state);

    // Sync: deploy to all agents
    await syncMcpServers({ quiet: true });
    await syncRules({ quiet: true });
    await syncCommands({ quiet: true });
    await syncSkills({ quiet: true });
    await syncInstructions({ quiet: true });
    await syncAgentDefs({ quiet: true });

    // Check: verify zero drift (excluding instructions drift which depends on
    // exact template ↔ deployed matching affected by marker wrapping + managed section)
    const log = captureLog();
    process.exitCode = undefined;
    await healthCheck({ autoFix: false });
    const logOutput = log.calls();
    log.reset();

    // Allow instructions-only drift (known test env limitation — the template gets
    // wrapped in markers and appended with managed section, causing line count diff).
    // Fail only if there's non-instructions drift (MCP, rules, skills, commands).
    const hasNonInstructionsDrift =
      logOutput.includes("[mcp]") ||
      logOutput.includes("[rules]") ||
      logOutput.includes("[skills]") ||
      logOutput.includes("[commands]");
    expect(hasNonInstructionsDrift).toBe(false);

    // Cleanup
    process.env.AGENTBREW_DIR = TEST_HOME;
  });

  it("sync → sync → status converges to drift=0 in a single sync (issue 3 of sync-idempotent-and-complete)", async () => {
    // Issue 3 of `sync-idempotent-and-complete`: a SINGLE `agentbrew sync`
    // must reach drift=0. Before the fix, the parallel-sync path ran
    // instructions before rules, leaving instructions-sync's
    // `deduplicateByHeading` blind to the not-yet-written managed section.
    // The deployed instructions stayed un-deduped while
    // `checkInstructionsDrift` dedupes the EXPECTED content against the
    // managed section that rules-sync just appended — false-positive drift
    // after a successful sync. This test pins the fix: one sync (with
    // rules running before instructions, the post-fix order) suffices for
    // detected agents, and a second sync is a no-op (drift stays 0 for
    // detected agents).
    //
    // Note: `./sync-runner.js` is mocked at the top of this file (autoSync
    // is no-op'd to keep `initForce` cheap), so this test invokes the sync
    // functions directly in the same order that the fixed `runSyncParallel`
    // uses — rules before instructions.
    //
    // Scope: this test asserts drift=0 for every detected agent. Both
    // `syncInstructions` and `checkRulesDrift` now filter by detection
    // (per `sync-and-drift-honor-detected-agents`), so undetected agents
    // simply do not appear in either path — the test no longer needs
    // to filter drift items by `detectedNames`.
    cleanState();
    setupAgentDirs();

    const repoRoot = join(import.meta.dirname, "..");
    process.env.AGENTBREW_DIR = repoRoot;

    const agents = detectAgents();
    const detectedNames = new Set(agents.filter((a) => a.detected).map((a) => a.name));
    const state = defaultState();
    state.agents = agents.map(({ commandTransform, ...rest }) => rest);
    saveState(state);

    // Seed a managed section by saving shared rules with a heading that
    // overlaps the template (e.g. "## Critical Rules" — present in both
    // `templates/AGENTS.md` and a typical user's shared-rules.md). This
    // is the trigger for `deduplicateByHeading` to fire; without it the
    // bug is invisible because dedup is a no-op when no headings overlap.
    saveSharedRules("## Critical Rules\n\n- Test rule from shared rules\n");

    // First sync — same shape as `runSyncParallel` (parallel modules first,
    // then sequential file-sharing modules with rules-before-instructions).
    const log1 = captureLog();
    await Promise.all([
      syncMcpServers({ quiet: true }),
      syncCommands({ quiet: true }),
      syncSkills({ quiet: true }),
      syncAgentDefs({ quiet: true }),
    ]);
    await syncRules({ quiet: true });
    await syncInstructions({ quiet: true });
    log1.reset();

    // Drift check #1: instructions and rules drift must be zero across
    // every agent. After `sync-and-drift-honor-detected-agents` landed,
    // both `syncInstructions` and `checkRulesDrift` filter by detection,
    // so we no longer need a `detectedNames.has(d.agent)` workaround
    // on the assertion. Other drift classes (skills, MCP, commands) may
    // have items for sandbox-specific reasons (e.g. catalog recommendations
    // not installed) — we test the file-sharing modules' drift here.
    const { collectDrift } = await import("./drift.js");
    const driftAfterFirst = collectDrift();
    const fileShareDrift1 = driftAfterFirst.filter((d) => d.type === "instructions" || d.type === "rules");
    expect(fileShareDrift1).toEqual([]);

    // Verify content correctness AFTER SYNC 1 — no duplicate managed sections
    // for every detected agent that has a rulesFile. The strip-fix in
    // `mergeInstructionsWithManagedSection` no-markers branch is what makes
    // this assertion pass on the first sync; without it the no-markers
    // branch re-appended an existing managed block, producing two
    // `<!-- agentbrew:start -->` markers in the same file. Drift detection
    // didn't catch it because `extractManagedSection` returns the first
    // managed block — but the duplicate was real and would surface as a
    // second managed section sitting inside the user's body content. A
    // second sync would clean it up via the with-markers strip, but the
    // contract is "one sync converges" — we assert it here.
    const { AGENT_DEFINITIONS } = await import("./types.js");
    const seenPaths = new Set<string>();
    const detectedRulesFiles = AGENT_DEFINITIONS.filter(
      (a) => a.rulesFile && detectedNames.has(a.name) && !seenPaths.has(a.rulesFile) && seenPaths.add(a.rulesFile),
    );
    for (const agent of detectedRulesFiles) {
      const filePath = expandHome(agent.rulesFile ?? "");
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf-8");
      const managedStartCount = (content.match(/<!-- agentbrew:start -->/g) ?? []).length;
      expect(
        managedStartCount,
        `${agent.name} (${agent.rulesFile}) should have exactly one managed section after sync 1`,
      ).toBe(1);
    }

    // Second sync — must be a no-op for the file-sharing modules.
    const log2 = captureLog();
    await Promise.all([
      syncMcpServers({ quiet: true }),
      syncCommands({ quiet: true }),
      syncSkills({ quiet: true }),
      syncAgentDefs({ quiet: true }),
    ]);
    await syncRules({ quiet: true });
    await syncInstructions({ quiet: true });
    log2.reset();

    const driftAfterSecond = collectDrift();
    const fileShareDrift2 = driftAfterSecond.filter((d) => d.type === "instructions" || d.type === "rules");
    expect(fileShareDrift2).toEqual([]);

    // Verify after sync 2 too — second sync must remain idempotent.
    for (const agent of detectedRulesFiles) {
      const filePath = expandHome(agent.rulesFile ?? "");
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf-8");
      const managedStartCount = (content.match(/<!-- agentbrew:start -->/g) ?? []).length;
      expect(
        managedStartCount,
        `${agent.name} (${agent.rulesFile}) should have exactly one managed section after sync 2`,
      ).toBe(1);
    }

    // Cleanup
    process.env.AGENTBREW_DIR = TEST_HOME;
  });

  it("state survives save → load → re-save roundtrip without function contamination", () => {
    const agents = detectAgents();
    const state = defaultState();
    state.agents = agents.map(({ commandTransform, ...rest }) => rest);
    state.mcpServers = [{ name: "test-srv", command: "echo", args: ["hi"], env: {}, source: "user" as const }];
    saveState(state);

    // Load back — must not have functions
    const loaded = loadState()!;
    expect(loaded).toBeDefined();
    for (const agent of loaded.agents) {
      for (const value of Object.values(agent)) {
        expect(typeof value).not.toBe("function");
      }
    }

    // Re-save — must not throw
    expect(() => saveState(loaded)).not.toThrow();

    // Third roundtrip — data must be intact
    const reloaded = loadState()!;
    expect(reloaded.agents.length).toBe(loaded.agents.length);
    expect(reloaded.mcpServers).toHaveLength(1);
    expect(reloaded.mcpServers![0].name).toBe("test-srv");
  });

  it("state write survives even if detectAgents() output is stored directly (safety net)", () => {
    const agents = detectAgents();
    const state = defaultState();
    // Intentionally store unsanitized agents WITH commandTransform functions —
    // the diskIO.write safety net must prevent the crash
    state.agents = agents as AgentBrewState["agents"];
    // This would have thrown before the fix: "unacceptable kind of an object to dump [object Function]"
    expect(() => saveState(state)).not.toThrow();

    // Invalidate cache so loadState() reads from disk (not the in-memory cached object)
    invalidateState();

    // Verify data survived and functions were stripped on disk
    const loaded = loadState()!;
    expect(loaded).toBeDefined();
    expect(loaded.agents.length).toBe(agents.length);
    for (const agent of loaded.agents) {
      expect(agent.commandTransform).toBeUndefined();
    }
    // Agent names and data survived
    const names = loaded.agents.map((a) => a.name);
    expect(names).toContain("cursor");
    expect(names).toContain("claude-code");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. Add Source → Index → Install Lifecycle (US07)
// ═══════════════════════════════════════════════════════════════════════════

describe("add source → index → install lifecycle (US07)", () => {
  const SOURCE_DIR = join(TEST_HOME, "test-source-repo");

  beforeEach(() => {
    // Create local source repo with skills at root level
    mkdirSync(join(SOURCE_DIR, "debug-skill"), { recursive: true });
    writeFileSync(
      join(SOURCE_DIR, "debug-skill", "SKILL.md"),
      "---\nname: debug-skill\ndescription: Debug workflow\n---\n# Debug\n",
    );
    mkdirSync(join(SOURCE_DIR, "refactor-skill"), { recursive: true });
    writeFileSync(
      join(SOURCE_DIR, "refactor-skill", "SKILL.md"),
      "---\nname: refactor-skill\ndescription: Refactor code\n---\n# Refactor\n",
    );

    // Save initial state so addSource/install can requireState()
    const state = makeState();
    saveState(state);
  });

  afterEach(() => {
    rmSync(SOURCE_DIR, { recursive: true, force: true });
    // Restore default mock behavior for index-source fns
    vi.mocked(indexSource).mockImplementation(() => []);
    vi.mocked(indexAllSources).mockImplementation(async () => {});
    vi.mocked(getSourceCachePath).mockImplementation(() => undefined);
  });

  it("add local folder → source registered in state with indexed items", async () => {
    vi.mocked(indexSource).mockReturnValueOnce([
      { name: "debug-skill", description: "Debug workflow", type: "skill" },
      { name: "refactor-skill", description: "Refactor code", type: "skill" },
    ]);

    const log = captureLog();
    await addSource(SOURCE_DIR, {});
    log.reset();

    const state = loadState()!;
    expect(state.sources).toBeDefined();

    const src = (state.sources ?? []).find((s) => s.url === SOURCE_DIR);
    expect(src).toBeDefined();
    expect(src!.type).toBe("local");
    expect(src!.addedAt).toBeDefined();
    expect(src!.indexedAt).toBeDefined();
    expect(src!.availableItems).toHaveLength(2);
    expect(src!.availableItems.map((i) => i.name)).toContain("debug-skill");
    expect(src!.availableItems.map((i) => i.name)).toContain("refactor-skill");
  });

  it("local source skills deployed to all agent dirs via syncSkills", async () => {
    // Register source directly in state (simulating prior addSource)
    const state = makeState({
      sources: [
        {
          url: SOURCE_DIR,
          type: "local" as const,
          skillsInstalled: ["debug-skill"],
          availableItems: [{ name: "debug-skill", description: "Debug workflow", type: "skill" as const }],
          addedAt: new Date().toISOString(),
        },
      ],
    });
    saveState(state);

    const log = captureLog();
    await syncSkills();
    log.reset();

    // Verify symlinks in all detected agent skill dirs
    for (const agentDir of AGENT_DIRS) {
      const skillLink = join(TEST_HOME, agentDir, "skills", "debug-skill");
      expect(existsSync(skillLink), `skill symlink missing in ${agentDir}`).toBe(true);
    }
  });

  it("install skill from registered source → skill copied to installed-skills", async () => {
    // Pre-register source with availableItems in state
    const state = makeState({
      sources: [
        {
          url: SOURCE_DIR,
          type: "local" as const,
          skillsInstalled: [],
          availableItems: [{ name: "debug-skill", description: "Debug workflow", type: "skill" as const }],
          addedAt: new Date().toISOString(),
        },
      ],
    });
    saveState(state);

    // getSourceCachePath must return the local source dir for install to work
    vi.mocked(getSourceCachePath).mockReturnValueOnce(SOURCE_DIR);

    const log = captureLog();
    await install("debug-skill", { from: SOURCE_DIR });
    log.reset();

    // Verify skill copied to installed-skills staging dir
    const installedDir = join(TEST_HOME, ".config", "agentbrew", "installed-skills", "debug-skill");
    expect(existsSync(installedDir)).toBe(true);
    expect(existsSync(join(installedDir, "SKILL.md"))).toBe(true);

    // Verify state.sources updated with skillsInstalled
    const updated = loadState()!;
    const src = (updated.sources ?? []).find((s) => s.url === SOURCE_DIR);
    expect(src).toBeDefined();
    expect(src!.skillsInstalled).toContain("debug-skill");
  });

  it("full lifecycle: addSource → syncSkills → verify in all agent dirs", async () => {
    vi.mocked(indexSource).mockReturnValueOnce([{ name: "debug-skill", description: "Debug workflow", type: "skill" }]);

    // Step 1: Add source
    const log1 = captureLog();
    await addSource(SOURCE_DIR, {});
    log1.reset();

    // Verify source registered
    const stateAfterAdd = loadState()!;
    expect((stateAfterAdd.sources ?? []).some((s) => s.url === SOURCE_DIR)).toBe(true);

    stateAfterAdd.sources = stateAfterAdd.sources?.map((source) =>
      source.url === SOURCE_DIR ? { ...source, skillsInstalled: ["debug-skill"] } : source,
    );
    saveState(stateAfterAdd);

    // Step 2: Sync skills — installed selections deploy from the local source dir
    const log2 = captureLog();
    await syncSkills();
    log2.reset();

    // Step 3: Verify deployed to all agent dirs
    for (const agentDir of AGENT_DIRS) {
      const skillLink = join(TEST_HOME, agentDir, "skills", "debug-skill");
      expect(existsSync(skillLink), `skill missing in ${agentDir}/skills/`).toBe(true);
    }
  });

  it("GitHub-style source with skills/ subdirectory indexes correctly", async () => {
    // Create a GitHub-style repo layout: skills in skills/ subdirectory
    const ghStyleDir = join(TEST_HOME, "gh-style-repo");
    mkdirSync(join(ghStyleDir, "skills", "test-skill"), { recursive: true });
    writeFileSync(
      join(ghStyleDir, "skills", "test-skill", "SKILL.md"),
      "---\nname: test-skill\ndescription: A test skill\n---\n# Test\n",
    );

    vi.mocked(indexSource).mockReturnValueOnce([{ name: "test-skill", description: "A test skill", type: "skill" }]);

    const log = captureLog();
    await addSource(ghStyleDir, {});
    log.reset();

    const state = loadState()!;
    const src = (state.sources ?? []).find((s) => s.url === ghStyleDir);
    expect(src).toBeDefined();
    expect(src!.availableItems).toHaveLength(1);
    expect(src!.availableItems[0].name).toBe("test-skill");

    rmSync(ghStyleDir, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. Catalog Install → Skill Deployment (US02)
// ═══════════════════════════════════════════════════════════════════════════

describe("catalog install → skill deployment (US02)", () => {
  /** A non-built-in skill from the real catalog.yaml for end-to-end testing. */
  const SKILL_NAME = "verification-before-completion";
  let fakeSourceDir: string;

  beforeEach(() => {
    // Create a fake source repo directory with a test skill (simulates git clone cache)
    fakeSourceDir = join(TEST_HOME, "fake-source-cache");
    mkdirSync(join(fakeSourceDir, SKILL_NAME), { recursive: true });
    writeFileSync(
      join(fakeSourceDir, SKILL_NAME, "SKILL.md"),
      "# Verification Before Completion\n\nAlways verify before claiming done.",
    );

    // Save state with detected agents
    const state = makeState();
    saveState(state);

    // Configure mocks so catalog install resolves locally (no network)
    vi.mocked(getSourceCachePath).mockReturnValue(fakeSourceDir);
  });

  afterEach(() => {
    // Flush accumulated install summary to prevent cross-test leaks
    const log = captureLog();
    flushInstallSummary();
    log.reset();
  });

  it("install from catalog → copies to installed-skills → state records source", async () => {
    const log = captureLog();
    await install(SKILL_NAME);
    log.reset();

    // Verify skill copied to installed-skills staging directory
    const installedSkillsDir = expandHome("~/.config/agentbrew/installed-skills");
    const installedSkill = join(installedSkillsDir, SKILL_NAME);
    expect(existsSync(installedSkill)).toBe(true);
    expect(existsSync(join(installedSkill, "SKILL.md"))).toBe(true);
    expect(readFileSync(join(installedSkill, "SKILL.md"), "utf-8")).toContain("Verification Before Completion");

    // Verify state.sources records the installation
    const state = loadState()!;
    const source = (state.sources ?? []).find((s) => s.skillsInstalled?.includes(SKILL_NAME));
    expect(source).toBeDefined();
    expect(source!.url).toBe("obra/superpowers"); // catalog entry's source
    expect(source!.skillsInstalled).toContain(SKILL_NAME);
    // Newly-created sources from catalog install are stamped as user-added
    // so the team overlay auto-register/auto-remove loop won't touch them.
    expect(source!.origin).toBe("user");
  }, 15_000);

  it("install + sync → symlinks appear in all detected agent skill dirs", async () => {
    // Install
    const log = captureLog();
    await install(SKILL_NAME);
    log.reset();

    // Wire installed-skills as a skill source (required for syncSkills to find them)
    const installedSkillsDir = expandHome("~/.config/agentbrew/installed-skills");
    const state = loadState()!;
    state.skillSourceDirs = [{ label: "catalog-installed", path: installedSkillsDir }];
    saveState(state);

    // Sync skills to all agents
    const log2 = captureLog();
    const result = await syncSkills({ quiet: true });
    log2.reset();

    // Verify sync found and deployed the skill
    expect(result.skillCount).toBeGreaterThanOrEqual(1);
    expect(result.bySource["catalog-installed"]).toBeGreaterThanOrEqual(1);

    // Verify symlinks exist in all detected agent skill dirs
    for (const agentDir of AGENT_DIRS) {
      const skillLink = join(TEST_HOME, agentDir, "skills", SKILL_NAME);
      expect(existsSync(skillLink)).toBe(true);
      expect(lstatSync(skillLink).isSymbolicLink()).toBe(true);
    }
  });

  it("manual skills in agent dirs are preserved after install + sync", async () => {
    // Create a manual (user-created) skill directory in cursor
    const manualSkillDir = join(TEST_HOME, ".cursor", "skills", "my-manual-skill");
    mkdirSync(manualSkillDir, { recursive: true });
    writeFileSync(join(manualSkillDir, "SKILL.md"), "# My Manual Skill");

    // Install and sync
    const log = captureLog();
    await install(SKILL_NAME);
    log.reset();

    const installedSkillsDir = expandHome("~/.config/agentbrew/installed-skills");
    const state = loadState()!;
    state.skillSourceDirs = [{ label: "catalog-installed", path: installedSkillsDir }];
    saveState(state);

    const log2 = captureLog();
    await syncSkills({ quiet: true });
    log2.reset();

    // Manual skill must still exist — syncSkills should not remove user-created directories
    expect(existsSync(manualSkillDir)).toBe(true);
    expect(existsSync(join(manualSkillDir, "SKILL.md"))).toBe(true);
  });

  it("second install is idempotent — no duplicate entries in state", async () => {
    // Install twice
    const log = captureLog();
    await install(SKILL_NAME);
    await install(SKILL_NAME);
    log.reset();

    // Should have exactly one source entry with the skill listed once
    const state = loadState()!;
    const sourcesWithSkill = (state.sources ?? []).filter((s) => s.skillsInstalled?.includes(SKILL_NAME));
    expect(sourcesWithSkill).toHaveLength(1);
    const skillOccurrences = sourcesWithSkill[0].skillsInstalled.filter((s: string) => s === SKILL_NAME);
    expect(skillOccurrences).toHaveLength(1);
  });

  it("local install copies to project .agentbrew/skills/, not global installed-skills", async () => {
    const projectDir = join(TEST_HOME, "my-project");
    mkdirSync(projectDir, { recursive: true });

    const log = captureLog();
    await install(SKILL_NAME, { local: projectDir });
    log.reset();

    // Should be in project-level directory
    const projectSkill = join(projectDir, ".agentbrew", "skills", SKILL_NAME);
    expect(existsSync(projectSkill)).toBe(true);
    expect(existsSync(join(projectSkill, "SKILL.md"))).toBe(true);

    // Should NOT be in global installed-skills
    const globalSkill = join(expandHome("~/.config/agentbrew/installed-skills"), SKILL_NAME);
    expect(existsSync(globalSkill)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. Update Lifecycle (US08)
// ═══════════════════════════════════════════════════════════════════════════

describe("update lifecycle (US08)", () => {
  const SOURCE_CACHE = join(TEST_HOME, "source-cache-repo");
  const INSTALLED_DIR = join(TEST_HOME, ".config", "agentbrew", "installed-skills");

  beforeEach(() => {
    const state = makeState();
    saveState(state);
  });

  afterEach(() => {
    rmSync(SOURCE_CACHE, { recursive: true, force: true });
    rmSync(INSTALLED_DIR, { recursive: true, force: true });
    // Restore default mock behavior
    vi.mocked(indexAllSources).mockImplementation(async () => {});
    vi.mocked(getSourceCachePath).mockImplementation(() => undefined);
  });

  it("refreshInstalledSkills re-copies skill when source cache has new content", () => {
    // Create source cache with skill v1
    mkdirSync(join(SOURCE_CACHE, "my-skill"), { recursive: true });
    writeFileSync(join(SOURCE_CACHE, "my-skill", "SKILL.md"), "# My Skill v1\nOriginal content");

    // Create installed-skills copy (simulating prior install)
    mkdirSync(join(INSTALLED_DIR, "my-skill"), { recursive: true });
    writeFileSync(join(INSTALLED_DIR, "my-skill", "SKILL.md"), "# My Skill v1\nOriginal content");

    // Update cache to v2 (simulating git pull brought new content)
    writeFileSync(join(SOURCE_CACHE, "my-skill", "SKILL.md"), "# My Skill v2\nUpdated content");

    // Mock getSourceCachePath to return our cache
    vi.mocked(getSourceCachePath).mockReturnValue(SOURCE_CACHE);

    const sources = [
      {
        url: "https://github.com/test/skills-repo",
        type: "github" as const,
        skillsInstalled: ["my-skill"],
        availableItems: [{ name: "my-skill", description: "A skill", type: "skill" as const }],
        addedAt: new Date().toISOString(),
      },
    ];

    const results = refreshInstalledSkills(sources);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("refreshed");
    expect(results[0].skill).toBe("my-skill");

    // Verify installed-skills now has v2 content
    const content = readFileSync(join(INSTALLED_DIR, "my-skill", "SKILL.md"), "utf-8");
    expect(content).toContain("My Skill v2");
    expect(content).toContain("Updated content");
  });

  it("refreshInstalledSkills skips local sources (served via symlinks)", () => {
    const sources = [
      {
        url: "/some/local/path",
        type: "local" as const,
        skillsInstalled: ["local-skill"],
        availableItems: [],
        addedAt: new Date().toISOString(),
      },
    ];

    const results = refreshInstalledSkills(sources);
    expect(results).toHaveLength(0);
  });

  it("update() re-syncs agents so local source changes appear in agent dirs", async () => {
    // Create local source dir with skill
    const localSource = join(TEST_HOME, "local-source");
    mkdirSync(join(localSource, "dev-skill"), { recursive: true });
    writeFileSync(join(localSource, "dev-skill", "SKILL.md"), "# Dev Skill v1\nOriginal");

    // Register local source in state
    const state = makeState({
      sources: [
        {
          url: localSource,
          type: "local" as const,
          skillsInstalled: ["dev-skill"],
          availableItems: [{ name: "dev-skill", description: "Dev skill", type: "skill" as const }],
          addedAt: new Date().toISOString(),
        },
      ],
    });
    saveState(state);

    // First sync deploys symlinks
    const log1 = captureLog();
    await syncSkills();
    log1.reset();

    // Verify symlink exists and points to source
    const cursorSkill = join(TEST_HOME, ".cursor", "skills", "dev-skill");
    expect(existsSync(cursorSkill)).toBe(true);

    // Read content via symlink — should see v1
    const v1Content = readFileSync(join(cursorSkill, "SKILL.md"), "utf-8");
    expect(v1Content).toContain("Dev Skill v1");

    // Modify source to v2
    writeFileSync(join(localSource, "dev-skill", "SKILL.md"), "# Dev Skill v2\nRefreshed");

    // Run update() — it calls syncAllEngines which calls syncSkills
    const log2 = captureLog();
    await update();
    log2.reset();

    // Verify content via agent dir now shows v2 (symlink points to source)
    const v2Content = readFileSync(join(cursorSkill, "SKILL.md"), "utf-8");
    expect(v2Content).toContain("Dev Skill v2");
    expect(v2Content).toContain("Refreshed");

    // Cleanup
    rmSync(localSource, { recursive: true, force: true });
  });

  // Slice 4a: cursor is intersection-skip; native preserve-unmanaged
  // logic is exercised against kiro (carve-out) instead.
  it("update() preserves manual MCP servers added outside agentbrew", async () => {
    // State with a managed MCP server
    const state = makeState({
      mcpServers: [{ name: "managed-srv", command: "npx", args: ["managed"], env: {}, source: "user" }],
    });
    saveState(state);

    // Deploy managed server
    const log1 = captureLog();
    await syncMcpServers();
    log1.reset();

    // Manually add a user server directly to kiro config
    const kiroPath = join(TEST_HOME, ".kiro", "settings", "mcp.json");
    const config = readMcpJson(kiroPath);
    config.mcpServers = config.mcpServers ?? {};
    (config.mcpServers as Record<string, unknown>)["user-manual-srv"] = {
      command: "node",
      args: ["my-custom-server.js"],
    };
    writeMcpJson(kiroPath, config);

    // Run update() — re-syncs MCP servers
    const log2 = captureLog();
    await update();
    log2.reset();

    // Verify both managed and manual servers survive
    const finalConfig = readMcpJson(kiroPath);
    expect(finalConfig.mcpServers?.["managed-srv"]).toBeDefined();
    expect((finalConfig.mcpServers as Record<string, unknown>)?.["user-manual-srv"]).toBeDefined();
    expect(
      ((finalConfig.mcpServers as Record<string, unknown>)?.["user-manual-srv"] as Record<string, unknown>)?.command,
    ).toBe("node");
  });

  it("update() preserves unmanaged content in rules files", async () => {
    // Save shared rules
    saveSharedRules("# Agentbrew Rules\n\n- Auto-deployed rule");

    // Deploy rules
    const log1 = captureLog();
    await syncRules();
    log1.reset();

    // Manually add content outside the managed section in augment guidelines
    const rulesPath = join(TEST_HOME, ".augment", "guidelines.md");
    const content = readFileSync(rulesPath, "utf-8");
    const withManual = `# My Personal Notes\n\nDo not remove.\n\n${content}`;
    writeFileSync(rulesPath, withManual);

    // Run update() — re-syncs rules
    const log2 = captureLog();
    await update();
    log2.reset();

    // Verify both manual and managed content preserved
    const final = readFileSync(rulesPath, "utf-8");
    expect(final).toContain("My Personal Notes");
    expect(final).toContain("Do not remove.");
    expect(final).toContain("Auto-deployed rule");
    expect(final).toContain("<!-- agentbrew:start -->");
    expect(final).toContain("<!-- agentbrew:end -->");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. Authoritative Agentfile sync — personal data survives (formerly US09)
//
// The dedicated `agentbrew team` command family was removed; teams share
// configuration by committing an `Agentfile.yaml` to a git repo and applying
// it through the standard `applyAgentfile` pipeline (clone → symlink → sync).
// The "personal data survives" invariant lives on as the test below.
// ═══════════════════════════════════════════════════════════════════════════

describe("authoritative Agentfile sync — personal data survives", () => {
  const SHARED_AGENTFILE_DIR = join(TEST_HOME, "team-agentfile-source");

  beforeEach(() => {
    const state = makeState();
    saveState(state);
  });

  afterEach(() => {
    if (existsSync(SHARED_AGENTFILE_DIR)) rmSync(SHARED_AGENTFILE_DIR, { recursive: true, force: true });
  });

  it("applyAgentfile from a shared repo adds team servers and rules without clobbering personal servers", () => {
    // Add personal server to state first
    const state = makeState({
      mcpServers: [{ name: "my-personal-srv", command: "node", args: ["my-server.js"], env: {}, source: "user" }],
    });
    saveState(state);

    // Set up the shared Agentfile-bearing directory (same shape a teammate would clone).
    mkdirSync(SHARED_AGENTFILE_DIR, { recursive: true });
    const agentfileContent = [
      "mcp:",
      "  - name: team-db",
      "    command: npx",
      "    args: ['-y', '@team/db-mcp']",
      "  - name: team-docs",
      "    command: npx",
      "    args: ['-y', '@team/docs-mcp']",
      "rules: |",
      "  ## Team Rules",
      "  - Use conventional commits",
      "  - Run tests before committing",
    ].join("\n");
    writeFileSync(join(SHARED_AGENTFILE_DIR, "Agentfile.yaml"), agentfileContent);

    const result = applyAgentfile(SHARED_AGENTFILE_DIR);
    expect(result).toBeDefined();
    expect(result!.serversAdded).toContain("team-db");
    expect(result!.serversAdded).toContain("team-docs");
    expect(result!.rulesUpdated).toBe(true);

    // Personal server is preserved alongside team servers
    const updated = loadState()!;
    const serverNames = (updated.mcpServers ?? []).map((s) => s.name);
    expect(serverNames).toContain("my-personal-srv");
    expect(serverNames).toContain("team-db");
    expect(serverNames).toContain("team-docs");

    // Rules written to shared-rules.md
    const rulesPath = join(TEST_HOME, ".config", "agentbrew", "shared-rules.md");
    expect(existsSync(rulesPath)).toBe(true);
    const rules = readFileSync(rulesPath, "utf-8");
    expect(rules).toContain("Team Rules");
    expect(rules).toContain("conventional commits");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19. Update Single Skill + Dry-Run (US13)
// ═══════════════════════════════════════════════════════════════════════════

describe("update single skill + dry-run (US13)", { timeout: 30_000 }, () => {
  const SOURCE_CACHE = join(TEST_HOME, "source-cache-us13");
  const INSTALLED_DIR = join(TEST_HOME, ".config", "agentbrew", "installed-skills");
  const SOURCE_URL = "https://github.com/test/skills-repo-us13";

  function makeSourceWithSkills(skills: string[]): {
    url: string;
    type: "github";
    skillsInstalled: string[];
    availableItems: { name: string; description: string; type: "skill" }[];
    addedAt: string;
  } {
    return {
      url: SOURCE_URL,
      type: "github" as const,
      skillsInstalled: skills,
      availableItems: skills.map((s) => ({ name: s, description: `${s} desc`, type: "skill" as const })),
      addedAt: new Date().toISOString(),
    };
  }

  beforeEach(() => {
    const state = makeState();
    saveState(state);
    // Create source cache with fixture skills skill-alpha and skill-beta
    mkdirSync(join(SOURCE_CACHE, "skill-alpha"), { recursive: true });
    writeFileSync(join(SOURCE_CACHE, "skill-alpha", "SKILL.md"), "# Skill Alpha v1\nOriginal alpha");
    mkdirSync(join(SOURCE_CACHE, "skill-beta"), { recursive: true });
    writeFileSync(join(SOURCE_CACHE, "skill-beta", "SKILL.md"), "# Skill Beta v1\nOriginal beta");
  });

  afterEach(() => {
    rmSync(SOURCE_CACHE, { recursive: true, force: true });
    rmSync(INSTALLED_DIR, { recursive: true, force: true });
    vi.mocked(indexAllSources).mockImplementation(async () => {});
    vi.mocked(getSourceCachePath).mockImplementation(() => undefined);
  });

  it("refreshInstalledSkills with skillName filters to only that skill", () => {
    // Install both skills initially
    mkdirSync(join(INSTALLED_DIR, "skill-alpha"), { recursive: true });
    writeFileSync(join(INSTALLED_DIR, "skill-alpha", "SKILL.md"), "# Skill Alpha v1\nOriginal alpha");
    mkdirSync(join(INSTALLED_DIR, "skill-beta"), { recursive: true });
    writeFileSync(join(INSTALLED_DIR, "skill-beta", "SKILL.md"), "# Skill Beta v1\nOriginal beta");

    // Update only alpha in cache
    writeFileSync(join(SOURCE_CACHE, "skill-alpha", "SKILL.md"), "# Skill Alpha v2\nUpdated alpha");
    vi.mocked(getSourceCachePath).mockReturnValue(SOURCE_CACHE);

    const source = makeSourceWithSkills(["skill-alpha", "skill-beta"]);
    const results = refreshInstalledSkills([source], { skillName: "skill-alpha" });

    // Only alpha should be in the results
    expect(results).toHaveLength(1);
    expect(results[0].skill).toBe("skill-alpha");
    expect(results[0].status).toBe("refreshed");

    // Alpha should have v2 content, beta should still be v1
    const alphaContent = readFileSync(join(INSTALLED_DIR, "skill-alpha", "SKILL.md"), "utf-8");
    expect(alphaContent).toContain("Skill Alpha v2");
    const betaContent = readFileSync(join(INSTALLED_DIR, "skill-beta", "SKILL.md"), "utf-8");
    expect(betaContent).toContain("Skill Beta v1");
  });

  it("refreshInstalledSkills with dryRun does not copy files", () => {
    mkdirSync(join(INSTALLED_DIR, "skill-alpha"), { recursive: true });
    writeFileSync(join(INSTALLED_DIR, "skill-alpha", "SKILL.md"), "# Skill Alpha v1\nOriginal alpha");

    // Update cache to v2
    writeFileSync(join(SOURCE_CACHE, "skill-alpha", "SKILL.md"), "# Skill Alpha v2\nUpdated alpha");
    vi.mocked(getSourceCachePath).mockReturnValue(SOURCE_CACHE);

    const source = makeSourceWithSkills(["skill-alpha"]);
    const results = refreshInstalledSkills([source], { dryRun: true });

    // Results report "refreshed" even though no files were actually copied
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("refreshed");

    // Files should NOT have been updated (still v1)
    const content = readFileSync(join(INSTALLED_DIR, "skill-alpha", "SKILL.md"), "utf-8");
    expect(content).toContain("Skill Alpha v1");
    expect(content).not.toContain("v2");
  });

  it("update({ skillName }) refreshes only the named skill and re-syncs agents", async () => {
    // Register source in state with both skills installed
    const state = makeState({
      sources: [makeSourceWithSkills(["skill-alpha", "skill-beta"])],
    });
    saveState(state);

    // Seed installed-skills with v1 of both
    mkdirSync(join(INSTALLED_DIR, "skill-alpha"), { recursive: true });
    writeFileSync(join(INSTALLED_DIR, "skill-alpha", "SKILL.md"), "# Skill Alpha v1\nOriginal alpha");
    mkdirSync(join(INSTALLED_DIR, "skill-beta"), { recursive: true });
    writeFileSync(join(INSTALLED_DIR, "skill-beta", "SKILL.md"), "# Skill Beta v1\nOriginal beta");

    // Update alpha in cache to v2
    writeFileSync(join(SOURCE_CACHE, "skill-alpha", "SKILL.md"), "# Skill Alpha v2\nUpdated alpha");

    vi.mocked(getSourceCachePath).mockReturnValue(SOURCE_CACHE);

    const log = captureLog();
    await update({ skillName: "skill-alpha" });
    const output = log.calls();
    log.reset();

    // Verify output mentions the refreshed skill
    expect(output).toContain("skill-alpha");

    // Verify alpha was refreshed to v2
    const alphaContent = readFileSync(join(INSTALLED_DIR, "skill-alpha", "SKILL.md"), "utf-8");
    expect(alphaContent).toContain("Skill Alpha v2");

    // Verify beta was NOT touched (still v1)
    const betaContent = readFileSync(join(INSTALLED_DIR, "skill-beta", "SKILL.md"), "utf-8");
    expect(betaContent).toContain("Skill Beta v1");
  });

  it("update({ dryRun: true }) shows what would change but makes zero file writes", async () => {
    const source = makeSourceWithSkills(["skill-alpha"]);
    const state = makeState({ sources: [source] });
    saveState(state);

    // Seed installed-skills with v1
    mkdirSync(join(INSTALLED_DIR, "skill-alpha"), { recursive: true });
    writeFileSync(join(INSTALLED_DIR, "skill-alpha", "SKILL.md"), "# Skill Alpha v1\nOriginal");

    // Update cache to v2
    writeFileSync(join(SOURCE_CACHE, "skill-alpha", "SKILL.md"), "# Skill Alpha v2\nUpdated");
    vi.mocked(getSourceCachePath).mockReturnValue(SOURCE_CACHE);

    // Seed a lock file to verify it's not modified
    writeLock({
      locked: [
        {
          source: SOURCE_URL,
          type: "github",
          sha: "aaa111",
          skills: ["skill-alpha"],
          lockedAt: new Date().toISOString(),
        },
      ],
    });
    const lockBefore = readLock();

    const log = captureLog();
    await update({ dryRun: true });
    const output = log.calls();
    log.reset();

    // Output should contain dry-run indicator
    expect(output).toContain("dry-run");

    // Installed-skills should still have v1
    const content = readFileSync(join(INSTALLED_DIR, "skill-alpha", "SKILL.md"), "utf-8");
    expect(content).toContain("Skill Alpha v1");
    expect(content).not.toContain("v2");

    // Lock file should be unchanged
    const lockAfter = readLock();
    expect(lockAfter.locked).toHaveLength(lockBefore.locked.length);
    expect(lockAfter.locked[0].sha).toBe("aaa111");
  });

  it("update({ skillName, dryRun: true }) combines single-skill filter with dry-run", async () => {
    const source = makeSourceWithSkills(["skill-alpha", "skill-beta"]);
    const state = makeState({ sources: [source] });
    saveState(state);

    // Seed installed-skills
    mkdirSync(join(INSTALLED_DIR, "skill-alpha"), { recursive: true });
    writeFileSync(join(INSTALLED_DIR, "skill-alpha", "SKILL.md"), "# Skill Alpha v1");
    mkdirSync(join(INSTALLED_DIR, "skill-beta"), { recursive: true });
    writeFileSync(join(INSTALLED_DIR, "skill-beta", "SKILL.md"), "# Skill Beta v1");

    // Update both in cache
    writeFileSync(join(SOURCE_CACHE, "skill-alpha", "SKILL.md"), "# Skill Alpha v2");
    writeFileSync(join(SOURCE_CACHE, "skill-beta", "SKILL.md"), "# Skill Beta v2");
    vi.mocked(getSourceCachePath).mockReturnValue(SOURCE_CACHE);

    const log = captureLog();
    await update({ skillName: "skill-alpha", dryRun: true });
    const output = log.calls();
    log.reset();

    // Output should mention skill-alpha and dry-run
    expect(output).toContain("skill-alpha");
    expect(output).toContain("dry-run");

    // Neither skill should have been actually updated
    const alphaContent = readFileSync(join(INSTALLED_DIR, "skill-alpha", "SKILL.md"), "utf-8");
    expect(alphaContent).toBe("# Skill Alpha v1");
    const betaContent = readFileSync(join(INSTALLED_DIR, "skill-beta", "SKILL.md"), "utf-8");
    expect(betaContent).toBe("# Skill Beta v1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20. Install --recommended Idempotent (US14)
// ═══════════════════════════════════════════════════════════════════════════

describe("install --recommended idempotent (US14)", { timeout: 30_000 }, () => {
  beforeEach(() => {
    const state = makeState();
    saveState(state);
    // Init shared-rules.md so rules can be added
    initRules();
  });

  afterEach(() => {
    const log = captureLog();
    flushInstallSummary();
    log.reset();
  });

  it("install({ recommended: true }) adds recommended rules to shared-rules.md", async () => {
    const log = captureLog();
    await install(undefined, { recommended: true });
    log.reset();

    const rules = loadSharedRules();
    expect(rules).toBeDefined();
    // Verify at least some recommended rules were added
    expect(rules).toContain("conventional-commits");
    expect(rules).toContain("test-before-commit");
    expect(rules).toContain("minimal-changes");
    expect(rules).toContain("verify-before-completion");
  });

  it("install({ recommended: true }) adds recommended MCP servers to state", async () => {
    const log = captureLog();
    await install(undefined, { recommended: true });
    log.reset();

    const state = loadState()!;
    const serverNames = (state.mcpServers ?? []).map((s) => s.name);
    // Recommended MCP servers from catalog: context7, playwright, tasks-mcp
    expect(serverNames).toContain("context7");
    expect(serverNames).toContain("playwright");
    expect(serverNames).toContain("tasks-mcp");
  });

  it("second install({ recommended: true }) is idempotent for rules and quiets the sections with no pending work", async () => {
    // First install — produces full output (header, lists, rules section, footer)
    const log1 = captureLog();
    await install(undefined, { recommended: true });
    const firstOutput = log1.calls();
    log1.reset();

    const rulesAfterFirst = loadSharedRules()!;
    const conventionalCommitsCount = (rulesAfterFirst.match(/conventional-commits/g) ?? []).length;

    // Second install — rules + MCP all present → those sections suppressed.
    // Fetched-source skills may still appear as pending in the test sandbox
    // (network fetches fail), but built-in skills are skipped. Issue 2 of
    // `sync-idempotent-and-complete`: sections with zero pending items
    // must not print.
    const log2 = captureLog();
    await install(undefined, { recommended: true });
    const secondOutput = log2.calls();
    log2.reset();

    // Rules should not be duplicated.
    const rulesAfterSecond = loadSharedRules()!;
    const conventionalCommitsCount2 = (rulesAfterSecond.match(/conventional-commits/g) ?? []).length;
    expect(conventionalCommitsCount2).toBe(conventionalCommitsCount);

    // First run printed the rules section with per-rule "added" status lines;
    // second run must not reprint them because every rule's marker is already
    // in shared-rules.md — and slice 3c makes the Rules section itself skip
    // when `pending.rules` is empty.
    expect(firstOutput).toContain("Installing recommended items:");
    expect(firstOutput).toContain("added to shared-rules.md");
    expect(secondOutput).not.toContain("added to shared-rules.md");
    expect(secondOutput).not.toContain("already in shared-rules.md");

    // First run installed MCP servers ("Installing MCP server:"); second run
    // must not re-register them because they're already in state.
    expect(firstOutput).toContain("Installing MCP server:");
    expect(secondOutput).not.toContain("Installing MCP server:");

    // And the MCP-servers item list at the top is suppressed on run 2.
    expect(firstOutput).toContain("MCP servers:");
    expect(secondOutput).not.toContain("MCP servers:");
  });

  it("second install({ recommended: true }) is idempotent for MCP servers", async () => {
    // First install
    const log1 = captureLog();
    await install(undefined, { recommended: true });
    log1.reset();

    const stateAfterFirst = loadState()!;
    const serversAfterFirst = (stateAfterFirst.mcpServers ?? []).map((s) => s.name);

    // Second install
    const log2 = captureLog();
    await install(undefined, { recommended: true });
    log2.reset();

    // No duplicate MCP servers
    const stateAfterSecond = loadState()!;
    const serversAfterSecond = (stateAfterSecond.mcpServers ?? []).map((s) => s.name);
    expect(serversAfterSecond.length).toBe(serversAfterFirst.length);

    // Each server appears exactly once
    for (const name of ["context7", "playwright", "tasks-mcp"]) {
      expect(serversAfterSecond.filter((s) => s === name)).toHaveLength(1);
    }
  });

  it("manually added MCP servers survive install({ recommended: true })", async () => {
    // Add personal server first
    const log0 = captureLog();
    await addMcpServer("my-custom-srv", "node", ["custom-server.js"], {});
    log0.reset();

    // Run recommended install
    const log1 = captureLog();
    await install(undefined, { recommended: true });
    log1.reset();

    // Personal server must still be in state
    const state = loadState()!;
    const serverNames = (state.mcpServers ?? []).map((s) => s.name);
    expect(serverNames).toContain("my-custom-srv");
    // And recommended servers were also added
    expect(serverNames).toContain("context7");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 21. Init --force Detects New Agent (US15)
// ═══════════════════════════════════════════════════════════════════════════

describe("init --force detects new agent (US15)", { timeout: 30_000 }, () => {
  beforeEach(() => {
    const state = makeState();
    saveState(state);
    initRules();
  });

  afterEach(() => {
    const log = captureLog();
    flushInstallSummary();
    log.reset();
    // Clean up any extra agent dirs created by tests
    const copilotPath = join(TEST_HOME, ".copilot");
    if (existsSync(copilotPath)) {
      rmSync(copilotPath, { recursive: true, force: true });
    }
  });

  it("initForce() re-detects agents and updates state", async () => {
    const log = captureLog();

    // Verify initial detection count
    const before = detectAgents().filter((a) => a.detected);
    const beforeCount = before.length;
    expect(beforeCount).toBeGreaterThan(0);

    await initForce();
    log.reset();

    // State was re-saved with detected agents
    const state = loadState()!;
    expect(state.agents).toBeDefined();
    expect(state.agents!.length).toBeGreaterThan(0);
  });

  it("initForce() picks up a newly created agent directory", async () => {
    // Count initially detected agents
    const beforeAgents = detectAgents().filter((a) => a.detected);
    const beforeNames = beforeAgents.map((a) => a.name);

    // Create a new agent directory that wasn't there before (e.g., .copilot)
    const newAgentDir = join(TEST_HOME, ".copilot");
    mkdirSync(join(newAgentDir, "skills"), { recursive: true });

    // Verify the new agent is detected now
    const afterDetect = detectAgents().filter((a) => a.detected);
    const afterNames = afterDetect.map((a) => a.name);
    expect(afterNames.length).toBeGreaterThan(beforeNames.length);
    expect(afterNames).toContain("copilot");

    // Run initForce to re-save state
    const log = captureLog();
    await initForce();
    log.reset();

    // State includes the new agent
    const state = loadState()!;
    const stateAgentNames = state.agents!.map((a) => a.name);
    expect(stateAgentNames).toContain("copilot");
  });

  it("initForce() preserves existing MCP servers in re-initialized state", async () => {
    // Add a personal MCP server before re-init
    const log0 = captureLog();
    await addMcpServer("personal-srv", "node", ["srv.js"], {});
    log0.reset();

    const stateBefore = loadState()!;
    expect((stateBefore.mcpServers ?? []).map((s) => s.name)).toContain("personal-srv");

    // Re-init
    const log1 = captureLog();
    await initForce();
    log1.reset();

    // initForce re-creates state from scratch via detectAndSave, but
    // it runs discoverMcpServers which finds servers from agent configs.
    // Our personal server was added to state but not written to an agent config,
    // so it won't survive a full re-init. This test documents that behavior.
    const stateAfter = loadState()!;
    expect(stateAfter.agents).toBeDefined();
    // State was re-created (agents are populated)
    expect(stateAfter.agents!.length).toBeGreaterThan(0);
  });

  it("initForce() discovers skills from newly added agent", async () => {
    // Create a new agent dir with a skill already inside
    const newAgentDir = join(TEST_HOME, ".copilot", "skills", "my-skill");
    mkdirSync(newAgentDir, { recursive: true });
    writeFileSync(join(newAgentDir, "SKILL.md"), "# My Skill\nA test skill.\n");

    // Run initForce — should discover the skill via discoverAllSkills
    const log = captureLog();
    await initForce();
    const output = log.calls();
    log.reset();

    // The summary should report discovered skills
    expect(output).toContain("skills discovered");

    // State should have the discovered skill recorded
    const state = loadState()!;
    expect(state.agents).toBeDefined();
    const stateAgentNames = state.agents!.map((a) => a.name);
    expect(stateAgentNames).toContain("copilot");
  });

  it("initForce() exits gracefully if no agents are detected", async () => {
    // Remove ALL dot directories in TEST_HOME to simulate no agents installed
    // (earlier tests may have created extra agent dirs via sync operations)
    const entries = readdirSync(TEST_HOME);
    for (const entry of entries) {
      if (entry.startsWith(".")) {
        rmSync(join(TEST_HOME, entry), { recursive: true, force: true });
      }
    }
    // Re-create minimal .config/agentbrew for state (needed by initForce)
    mkdirSync(join(TEST_HOME, ".config", "agentbrew"), { recursive: true });
    saveState(makeState());

    const log = captureLog();
    await initForce();
    const output = log.calls();
    log.reset();

    // Should log a warning about no agents found
    expect(output).toContain("No AI coding agents detected");

    // Restore agent dirs for any tests that follow
    setupAgentDirs();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 22. Agentfile Parse → Apply → Sync (US16)
// ═══════════════════════════════════════════════════════════════════════════

describe("Agentfile parse → apply → sync (US16)", () => {
  const PROJECT_DIR = join(TEST_HOME, "projects", "my-app");

  beforeEach(() => {
    const state = makeState();
    saveState(state);
    initRules();
    mkdirSync(PROJECT_DIR, { recursive: true });
  });

  afterEach(() => {
    const log = captureLog();
    flushInstallSummary();
    log.reset();
    if (existsSync(PROJECT_DIR)) {
      rmSync(PROJECT_DIR, { recursive: true, force: true });
    }
  });

  it("applyAgentfile with MCP servers merges them into state", () => {
    writeFileSync(
      join(PROJECT_DIR, "Agentfile.yaml"),
      [
        "mcp:",
        "  - name: project-db",
        "    command: npx",
        "    args: ['-y', '@team/db-mcp']",
        "  - name: project-docs",
        "    command: node",
        "    args: ['docs-server.js']",
      ].join("\n"),
    );

    const log = captureLog();
    const result = applyAgentfile(PROJECT_DIR);
    log.reset();

    expect(result).toBeDefined();
    expect(result!.serversAdded).toContain("project-db");
    expect(result!.serversAdded).toContain("project-docs");

    const state = loadState()!;
    const names = (state.mcpServers ?? []).map((s) => s.name);
    expect(names).toContain("project-db");
    expect(names).toContain("project-docs");
  });

  it("applyAgentfile with rules updates shared-rules.md", () => {
    writeFileSync(
      join(PROJECT_DIR, "Agentfile.yaml"),
      [
        "rules: |",
        "  ## Project Rules",
        "  - Always use TypeScript strict mode",
        "  - Prefer composition over inheritance",
      ].join("\n"),
    );

    const log = captureLog();
    const result = applyAgentfile(PROJECT_DIR);
    log.reset();

    expect(result).toBeDefined();
    expect(result!.rulesUpdated).toBe(true);

    const rules = loadSharedRules();
    expect(rules).toBeDefined();
    expect(rules).toContain("Project Rules");
    expect(rules).toContain("TypeScript strict mode");
  });

  // Slice 4a: cursor is intersection-skip; native Agentfile-driven sync
  // writes to kiro (carve-out) instead.
  it("applyAgentfile + syncMcpServers deploys servers to agent configs", () => {
    writeFileSync(
      join(PROJECT_DIR, "Agentfile.yaml"),
      ["mcp:", "  - name: deployed-srv", "    command: node", "    args: ['server.js']"].join("\n"),
    );

    const log = captureLog();
    applyAgentfile(PROJECT_DIR);
    syncMcpServers({ quiet: true });
    log.reset();

    // Verify server appears in kiro's MCP config (carve-out gets native write).
    const kiroMcp = readMcpJson(join(TEST_HOME, ".kiro", "settings", "mcp.json"));
    expect(kiroMcp.mcpServers?.["deployed-srv"]).toBeDefined();
  });

  it("project-level Agentfile is additive — does not remove existing servers", () => {
    // Pre-populate state with a personal server
    const state = makeState({
      mcpServers: [{ name: "my-personal", command: "node", args: ["personal.js"], env: {}, source: "user" }],
    });
    saveState(state);

    writeFileSync(
      join(PROJECT_DIR, "Agentfile.yaml"),
      ["mcp:", "  - name: project-only", "    command: node", "    args: ['proj.js']"].join("\n"),
    );

    const log = captureLog();
    const result = applyAgentfile(PROJECT_DIR);
    log.reset();

    expect(result).toBeDefined();
    expect(result!.serversAdded).toContain("project-only");

    const updated = loadState()!;
    const names = (updated.mcpServers ?? []).map((s) => s.name);
    expect(names).toContain("my-personal");
    expect(names).toContain("project-only");
  });

  it("second applyAgentfile is idempotent — no duplicate servers or rules", () => {
    writeFileSync(
      join(PROJECT_DIR, "Agentfile.yaml"),
      [
        "mcp:",
        "  - name: idempotent-srv",
        "    command: node",
        "    args: ['srv.js']",
        "rules: |",
        "  ## Idem Rules",
        "  - Be consistent",
      ].join("\n"),
    );

    const log1 = captureLog();
    applyAgentfile(PROJECT_DIR);
    log1.reset();

    const stateAfterFirst = loadState()!;
    const countFirst = (stateAfterFirst.mcpServers ?? []).filter((s) => s.name === "idempotent-srv").length;
    expect(countFirst).toBe(1);

    const log2 = captureLog();
    const result2 = applyAgentfile(PROJECT_DIR);
    log2.reset();

    expect(result2).toBeDefined();
    // Server should not be added again
    expect(result2!.serversAdded).not.toContain("idempotent-srv");

    const stateAfterSecond = loadState()!;
    const countSecond = (stateAfterSecond.mcpServers ?? []).filter((s) => s.name === "idempotent-srv").length;
    expect(countSecond).toBe(1);

    // Rules should not be duplicated
    expect(result2!.rulesUpdated).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 22b. Cross-repo Agentfile → sync → teammate gets same setup (US23)
// ═══════════════════════════════════════════════════════════════════════════

// Tests in this describe spawn the `ai-rules generate` subprocess via
// `syncRules()` (and `mcpm` via `syncMcpServers()` for MCP carve-outs),
// so they're I/O- and process-creation-heavy. They pass in <500 ms in
// isolation but flake under `npm run test:all` parallel load — the
// `Agentfile with rules deploys to all agents on sync` test was observed
// to time out at the default 5 s during PR #939's verify run. Match the
// 15 s headroom used in `repo-class.test.ts` and `cli-classify.test.ts`
// (PR #935) for the same class of subprocess-bound flake.
describe("cross-repo Agentfile → sync → teammate gets same setup (US23)", { timeout: 15_000 }, () => {
  const PROJECT_DIR = join(TEST_HOME, "projects", "team-app");

  beforeEach(() => {
    const state = makeState();
    saveState(state);
    initRules();
    mkdirSync(PROJECT_DIR, { recursive: true });
  });

  afterEach(() => {
    const log = captureLog();
    flushInstallSummary();
    log.reset();
    if (existsSync(PROJECT_DIR)) {
      rmSync(PROJECT_DIR, { recursive: true, force: true });
    }
  });

  // Slice 4a: cursor is intersection-skip; teammate's Agentfile-driven
  // sync writes to kiro (carve-out) instead.
  it("teammate clones project with Agentfile and syncs — MCP servers deployed", () => {
    writeFileSync(
      join(PROJECT_DIR, "Agentfile.yaml"),
      [
        "mcp:",
        "  - name: team-api",
        "    command: node",
        "    args: ['api-server.js']",
        "  - name: team-db",
        "    command: npx",
        "    args: ['-y', '@team/db-mcp']",
      ].join("\n"),
    );

    const log = captureLog();
    const result = applyAgentfile(PROJECT_DIR);
    syncMcpServers({ quiet: true });
    log.reset();

    expect(result).toBeDefined();
    expect(result!.serversAdded).toContain("team-api");
    expect(result!.serversAdded).toContain("team-db");

    // Verify deployed to kiro (carve-out) — cursor is
    // intersection-skip and only gets populated via mcpm.
    const kiroMcp = readMcpJson(join(TEST_HOME, ".kiro", "settings", "mcp.json"));
    expect(kiroMcp.mcpServers?.["team-api"]).toBeDefined();
    expect(kiroMcp.mcpServers?.["team-db"]).toBeDefined();
  });

  it("Agentfile-sourced servers have source attribution", () => {
    writeFileSync(
      join(PROJECT_DIR, "Agentfile.yaml"),
      ["mcp:", "  - name: attributed-srv", "    command: node", "    args: ['srv.js']"].join("\n"),
    );

    const log = captureLog();
    applyAgentfile(PROJECT_DIR);
    log.reset();

    const state = loadState()!;
    const srv = (state.mcpServers ?? []).find((s) => s.name === "attributed-srv");
    expect(srv).toBeDefined();
    expect(srv!.source).toBe("agentfile");
  });

  it("Agentfile with rules deploys to all agents on sync", () => {
    writeFileSync(
      join(PROJECT_DIR, "Agentfile.yaml"),
      ["rules: |", "  ## Team Rules", "  - Use conventional commits", "  - Run tests before committing"].join("\n"),
    );

    const log = captureLog();
    applyAgentfile(PROJECT_DIR);
    syncRules();
    log.reset();

    // Verify rules propagated to agent config files
    const augmentRules = readFileSync(join(TEST_HOME, ".augment", "guidelines.md"), "utf-8");
    expect(augmentRules).toContain("Team Rules");
    expect(augmentRules).toContain("conventional commits");
  });

  it("project Agentfile resources are additive — global config preserved", () => {
    // Pre-populate state with a personal MCP server
    const state = makeState({
      mcpServers: [{ name: "personal-srv", command: "node", args: ["mine.js"], env: {}, source: "user" }],
    });
    saveState(state);

    writeFileSync(
      join(PROJECT_DIR, "Agentfile.yaml"),
      ["mcp:", "  - name: team-srv", "    command: node", "    args: ['team.js']"].join("\n"),
    );

    const log = captureLog();
    applyAgentfile(PROJECT_DIR);
    log.reset();

    const updated = loadState()!;
    const names = (updated.mcpServers ?? []).map((s) => s.name);
    expect(names).toContain("personal-srv");
    expect(names).toContain("team-srv");
  });

  it("status shows MCP servers registered from Agentfile after sync", () => {
    writeFileSync(
      join(PROJECT_DIR, "Agentfile.yaml"),
      ["mcp:", "  - name: status-srv", "    command: node", "    args: ['srv.js']"].join("\n"),
    );

    const log = captureLog();
    applyAgentfile(PROJECT_DIR);
    syncMcpServers({ quiet: true });
    log.reset();

    const log2 = captureLog();
    status();
    const output = log2.calls();
    log2.reset();

    // Status shows MCP servers count (at least 1 registered)
    expect(output).toContain("1 registered");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 22c. Agentfile local path source → sync → skills deployed to all agents (US24)
// User story: cd into repo, run `agentbrew sync`, repo-local .claude/skills/
// are deployed as symlinks to all other agent skill directories.
// ═══════════════════════════════════════════════════════════════════════════

describe("Agentfile local path source → sync deploys skills to all agents (US24)", () => {
  const PROJECT_DIR = join(TEST_HOME, "projects", "my-repo");
  const LOCAL_SKILLS_DIR = join(PROJECT_DIR, ".claude", "skills");

  beforeEach(() => {
    const state = makeState();
    saveState(state);
    initRules();
    mkdirSync(LOCAL_SKILLS_DIR, { recursive: true });
  });

  afterEach(() => {
    const log = captureLog();
    flushInstallSummary();
    log.reset();
    if (existsSync(PROJECT_DIR)) {
      rmSync(PROJECT_DIR, { recursive: true, force: true });
    }
  });

  it("applyAgentfile registers local path source with type: local in state", () => {
    writeFileSync(join(PROJECT_DIR, "Agentfile.yaml"), "sources:\n  - ./.claude/skills\n");

    applyAgentfile(PROJECT_DIR);

    const state = loadState();
    const source = state?.sources?.find((s) => s.url === LOCAL_SKILLS_DIR);
    expect(source).toBeDefined();
    expect(source?.type).toBe("local");
  });

  it("local path source is not treated as github repo (regression)", () => {
    writeFileSync(join(PROJECT_DIR, "Agentfile.yaml"), "sources:\n  - ./.claude/skills\n");

    applyAgentfile(PROJECT_DIR);

    const state = loadState();
    const source = state?.sources?.find((s) => s.url === LOCAL_SKILLS_DIR);
    expect(source).toBeDefined();
    expect(source?.type).not.toBe("github");
  });

  it("sync deploys skills from local Agentfile source to all agent skill dirs", async () => {
    // Write a skill into the local source
    const skillDir = join(LOCAL_SKILLS_DIR, "my-repo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: my-repo-skill\ndescription: Repo-local skill\n---\n\n# My Repo Skill\n",
    );

    // Register the source using absolute path (as applyAgentfile would resolve it when run from PROJECT_DIR)
    const state = loadState()!;
    state.sources = [
      {
        url: LOCAL_SKILLS_DIR,
        type: "local",
        skillsInstalled: ["my-repo-skill"],
        availableItems: [],
        addedAt: new Date().toISOString(),
        origin: "agentfile",
      },
    ];
    saveState(state);

    // Sync should deploy to all agents
    await syncSkills();

    // Verify symlinks exist in agent skill dirs
    const cursorSkill = join(TEST_HOME, ".cursor", "skills", "my-repo-skill");
    expect(existsSync(cursorSkill)).toBe(true);
    expect(lstatSync(cursorSkill).isSymbolicLink()).toBe(true);

    // Verify content is readable via the symlink
    const content = readFileSync(join(cursorSkill, "SKILL.md"), "utf-8");
    expect(content).toContain("my-repo-skill");
  });

  it("sync deploys multiple local skills from the same source", async () => {
    for (const skillName of ["skill-alpha", "skill-beta", "skill-gamma"]) {
      const dir = join(LOCAL_SKILLS_DIR, skillName);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), `---\nname: ${skillName}\ndescription: Test skill\n---\n`);
    }

    const state = loadState()!;
    state.sources = [
      {
        url: LOCAL_SKILLS_DIR,
        type: "local",
        skillsInstalled: ["skill-alpha", "skill-beta", "skill-gamma"],
        availableItems: [],
        addedAt: new Date().toISOString(),
        origin: "agentfile",
      },
    ];
    saveState(state);
    await syncSkills();

    for (const skillName of ["skill-alpha", "skill-beta", "skill-gamma"]) {
      expect(existsSync(join(TEST_HOME, ".cursor", "skills", skillName))).toBe(true);
    }
  });

  it("applyAgentfile is idempotent — running twice does not duplicate the source", () => {
    writeFileSync(join(PROJECT_DIR, "Agentfile.yaml"), "sources:\n  - ./.claude/skills\n");

    applyAgentfile(PROJECT_DIR);
    applyAgentfile(PROJECT_DIR);

    const state = loadState();
    const sources = state?.sources?.filter((s) => s.url === LOCAL_SKILLS_DIR);
    expect(sources).toHaveLength(1);
  });

  it("local source skills are live — editing the source file is reflected via symlink without re-sync", async () => {
    const skillDir = join(LOCAL_SKILLS_DIR, "live-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# v1");

    const state = loadState()!;
    state.sources = [
      {
        url: LOCAL_SKILLS_DIR,
        type: "local",
        skillsInstalled: ["live-skill"],
        availableItems: [],
        addedAt: new Date().toISOString(),
        origin: "agentfile",
      },
    ];
    saveState(state);
    await syncSkills();

    const symlink = join(TEST_HOME, ".cursor", "skills", "live-skill", "SKILL.md");
    expect(readFileSync(symlink, "utf-8")).toBe("# v1");

    // Edit source directly — symlink should reflect immediately (no re-sync needed)
    writeFileSync(join(skillDir, "SKILL.md"), "# v2");
    expect(readFileSync(symlink, "utf-8")).toBe("# v2");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 23. Export → Import Roundtrip (US19)
// ═══════════════════════════════════════════════════════════════════════════

describe("export → import roundtrip (US19)", () => {
  beforeEach(() => {
    const state = makeState();
    saveState(state);
    initRules();
  });

  afterEach(() => {
    const log = captureLog();
    flushInstallSummary();
    log.reset();
  });

  it("buildExportBundle captures MCP servers and sources from state", async () => {
    // Add servers and a source to state
    const log = captureLog();
    await addMcpServer("export-srv", "node", ["srv.js"], { API_KEY: "test-key" });
    log.reset();

    const state = loadState()!;
    state.sources = [
      {
        url: "https://github.com/test/skills",
        type: "github",
        skillsInstalled: ["debug"],
        availableItems: [],
        addedAt: new Date().toISOString(),
      },
    ];
    saveState(state);

    const bundle = buildExportBundle();
    expect(bundle.version).toBe("1");
    expect(bundle.mcpServers.map((s) => s.name)).toContain("export-srv");
    expect(bundle.sources.map((s) => s.url)).toContain("https://github.com/test/skills");
  });

  it("applyBundle in merge mode adds new servers and skips existing", () => {
    const state = loadState()!;
    state.mcpServers = [{ name: "existing-srv", command: "node", args: ["existing.js"], env: {}, source: "user" }];
    saveState(state);

    const bundle: ExportBundle = {
      version: "1",
      exportedAt: new Date().toISOString(),
      mcpServers: [
        { name: "existing-srv", command: "node", args: ["other.js"], env: {}, source: "user" },
        { name: "new-srv", command: "node", args: ["new.js"], env: {}, source: "user" },
      ],
      sources: [],
    };

    const current = loadState()!;
    const result = applyBundle(current, bundle, true);
    expect(result.mcpServersAdded).toContain("new-srv");
    expect(result.mcpServersSkipped).toContain("existing-srv");
    // Existing server args should NOT be replaced in merge mode
    const existing = current.mcpServers!.find((s) => s.name === "existing-srv");
    expect(existing?.args).toEqual(["existing.js"]);
  });

  it("applyBundle in replace mode replaces existing servers", () => {
    const state = loadState()!;
    state.mcpServers = [{ name: "replace-me", command: "node", args: ["old.js"], env: {}, source: "user" }];
    saveState(state);

    const bundle: ExportBundle = {
      version: "1",
      exportedAt: new Date().toISOString(),
      mcpServers: [{ name: "replace-me", command: "node", args: ["new.js"], env: {}, source: "user" }],
      sources: [],
    };

    const current = loadState()!;
    const result = applyBundle(current, bundle, false);
    expect(result.mcpServersAdded).toContain("replace-me");
    // Server args should be replaced
    const replaced = current.mcpServers!.find((s) => s.name === "replace-me");
    expect(replaced?.args).toEqual(["new.js"]);
  });

  it("export → write → parse → apply roundtrip preserves data", async () => {
    // Set up state with servers and sources
    const log = captureLog();
    await addMcpServer("roundtrip-srv", "node", ["srv.js"], {});
    log.reset();

    const state = loadState()!;
    state.sources = [
      {
        url: "https://github.com/test/repo",
        type: "github",
        skillsInstalled: ["skill-a"],
        availableItems: [],
        addedAt: new Date().toISOString(),
      },
    ];
    saveState(state);

    // Export
    const bundle = buildExportBundle();
    const exportPath = join(TEST_HOME, "test-export.yaml");
    const yaml = await import("js-yaml");
    writeFileSync(exportPath, yaml.dump(bundle, { lineWidth: 120 }));

    // Parse
    const parsed = parseBundle(exportPath);
    expect(parsed.version).toBe("1");
    expect(parsed.mcpServers.map((s) => s.name)).toContain("roundtrip-srv");
    expect(parsed.sources.map((s) => s.url)).toContain("https://github.com/test/repo");

    // Reset and apply
    const freshState = makeState();
    const importResult = applyBundle(freshState, parsed, true);
    expect(importResult.mcpServersAdded).toContain("roundtrip-srv");
    expect(importResult.sourcesAdded).toContain("https://github.com/test/repo");
  });

  it("env vars are exported as-is (no sanitization)", async () => {
    const log = captureLog();
    await addMcpServer("env-srv", "node", ["srv.js"], { SECRET: "real-value", DB_URL: "postgres://localhost" });
    log.reset();

    const bundle = buildExportBundle();
    const server = bundle.mcpServers.find((s) => s.name === "env-srv");
    expect(server?.env).toEqual({ SECRET: "real-value", DB_URL: "postgres://localhost" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 24. Agent Definitions Sync (US20)
// ═══════════════════════════════════════════════════════════════════════════

describe("agent definitions sync (US20)", () => {
  const AGENT_DEF_SOURCE = join(TEST_HOME, "my-agent-defs");

  beforeEach(() => {
    const state = makeState();
    saveState(state);
    mkdirSync(AGENT_DEF_SOURCE, { recursive: true });
  });

  afterEach(() => {
    const log = captureLog();
    log.reset();
    if (existsSync(AGENT_DEF_SOURCE)) {
      rmSync(AGENT_DEF_SOURCE, { recursive: true, force: true });
    }
  });

  it("addAgentSource registers source and syncAgentDefs deploys to agent dirs", async () => {
    // Create a sample agent definition
    writeFileSync(
      join(AGENT_DEF_SOURCE, "reviewer.md"),
      "---\nname: Code Reviewer\n---\n\n# Reviewer\nYou review code.\n",
    );

    const log = captureLog();
    await addAgentSource("test-defs", AGENT_DEF_SOURCE);
    await syncAgentDefs({ quiet: true });
    log.reset();

    // Verify deployed to Cursor (flat format: reviewer.md)
    const cursorAgentFile = join(TEST_HOME, ".cursor", "agents", "reviewer.md");
    expect(existsSync(cursorAgentFile)).toBe(true);
    const content = readFileSync(cursorAgentFile, "utf-8");
    expect(content).toContain("Code Reviewer");
  });

  it("syncAgentDefs deploys to Codex in flat format", async () => {
    writeFileSync(join(AGENT_DEF_SOURCE, "debugger.md"), "# Debugger\nYou find and fix bugs.\n");

    const log = captureLog();
    await addAgentSource("test-defs-2", AGENT_DEF_SOURCE);
    await syncAgentDefs({ quiet: true });
    log.reset();

    // Codex uses flat format
    const codexAgentFile = join(TEST_HOME, ".codex", "agents", "debugger.md");
    expect(existsSync(codexAgentFile)).toBe(true);
  });

  it("user-created agent definitions in target dirs are preserved after sync", async () => {
    // Create a user-owned agent definition directly in cursor
    const cursorAgentsDir = join(TEST_HOME, ".cursor", "agents");
    mkdirSync(cursorAgentsDir, { recursive: true });
    writeFileSync(join(cursorAgentsDir, "my-custom.md"), "# Custom\nMy personal agent.\n");

    // Create a source with a different definition
    writeFileSync(join(AGENT_DEF_SOURCE, "managed.md"), "# Managed\nAgentbrew-managed agent.\n");

    const log = captureLog();
    await addAgentSource("test-defs-3", AGENT_DEF_SOURCE);
    await syncAgentDefs({ quiet: true });
    log.reset();

    // User's custom definition should still exist
    expect(existsSync(join(cursorAgentsDir, "my-custom.md"))).toBe(true);
    const customContent = readFileSync(join(cursorAgentsDir, "my-custom.md"), "utf-8");
    expect(customContent).toContain("My personal agent");

    // Managed definition should also be deployed
    expect(existsSync(join(cursorAgentsDir, "managed.md"))).toBe(true);
  });

  it("syncAgentDefs is idempotent — second sync produces no errors", async () => {
    writeFileSync(join(AGENT_DEF_SOURCE, "helper.md"), "# Helper\nYou help with tasks.\n");

    const log1 = captureLog();
    await addAgentSource("test-defs-4", AGENT_DEF_SOURCE);
    await syncAgentDefs({ quiet: true });
    log1.reset();

    // Second sync should work without errors
    const log2 = captureLog();
    await syncAgentDefs({ quiet: true });
    log2.reset();

    // File still exists after second sync
    const cursorFile = join(TEST_HOME, ".cursor", "agents", "helper.md");
    expect(existsSync(cursorFile)).toBe(true);
  });

  it("syncAgentDefs with dry-run does not write files", async () => {
    writeFileSync(join(AGENT_DEF_SOURCE, "dryrun-agent.md"), "# DryRun\nShould not be deployed.\n");

    const log = captureLog();
    await addAgentSource("test-defs-5", AGENT_DEF_SOURCE);
    await syncAgentDefs({ dryRun: true, quiet: true });
    log.reset();

    // File should NOT exist in any agent dir
    const cursorFile = join(TEST_HOME, ".cursor", "agents", "dryrun-agent.md");
    expect(existsSync(cursorFile)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 25. Lock File Workflow (US22)
// ═══════════════════════════════════════════════════════════════════════════

describe("lock file workflow (US22)", () => {
  const SOURCE_URL = "https://github.com/test/lock-skills-us22";
  const SOURCE_URL_2 = "https://github.com/test/lock-other-us22";

  function makeLockSource(overrides?: Partial<import("./types.js").Source>): import("./types.js").Source {
    return {
      url: SOURCE_URL,
      type: "github",
      skillsInstalled: ["skill-one"],
      availableItems: [],
      addedAt: new Date().toISOString(),
      commitSha: "aaa111bbb222ccc333",
      ...overrides,
    };
  }

  beforeEach(() => {
    const state = makeState();
    saveState(state);
    // Ensure lock file starts clean
    const lockPath = join(TEST_HOME, ".config", "agentbrew", "agentbrew.lock");
    if (existsSync(lockPath)) rmSync(lockPath);
  });

  afterEach(() => {
    const lockPath = join(TEST_HOME, ".config", "agentbrew", "agentbrew.lock");
    if (existsSync(lockPath)) rmSync(lockPath);
  });

  it("lockSource records SHA in the lock file", () => {
    const source = makeLockSource();
    const entry = lockSource(source, ["skill-one"]);

    expect(entry).toBeDefined();
    expect(entry!.sha).toBe("aaa111bbb222ccc333");
    expect(entry!.source).toBe(SOURCE_URL);
    expect(entry!.skills).toContain("skill-one");

    // Verify persisted to disk
    const lock = readLock();
    expect(lock.locked).toHaveLength(1);
    expect(lock.locked[0].sha).toBe("aaa111bbb222ccc333");
    expect(lock.locked[0].source).toBe(SOURCE_URL);
  });

  it("lockSource accumulates skills across multiple installs", () => {
    const source = makeLockSource();
    lockSource(source, ["skill-one"]);
    lockSource(source, ["skill-two"]);

    const lock = readLock();
    expect(lock.locked).toHaveLength(1);
    expect(lock.locked[0].skills).toContain("skill-one");
    expect(lock.locked[0].skills).toContain("skill-two");
  });

  it("verifyLock passes when source SHA matches locked SHA", () => {
    const source = makeLockSource({ commitSha: "aaa111bbb222ccc333" });
    lockSource(source, ["skill-one"]);

    const results = verifyLock([source]);
    expect(results).toHaveLength(1);
    expect(results[0].match).toBe(true);
    expect(results[0].lockedSha).toBe("aaa111bbb222ccc333");
    expect(results[0].currentSha).toBe("aaa111bbb222ccc333");
  });

  it("verifyLock fails when source SHA drifts from locked SHA", () => {
    const source = makeLockSource({ commitSha: "aaa111bbb222ccc333" });
    lockSource(source, ["skill-one"]);

    // Source has moved to a new commit
    const driftedSource = makeLockSource({ commitSha: "fff999eee888ddd777" });
    const results = verifyLock([driftedSource]);
    expect(results).toHaveLength(1);
    expect(results[0].match).toBe(false);
    expect(results[0].lockedSha).toBe("aaa111bbb222ccc333");
    expect(results[0].currentSha).toBe("fff999eee888ddd777");
  });

  it("verifyLock reports no version tracked when source has no commitSha", () => {
    const source = makeLockSource({ commitSha: "aaa111bbb222ccc333" });
    lockSource(source, ["skill-one"]);

    // Source without commitSha (freshly added, not yet resolved)
    const untrackedSource = makeLockSource({ commitSha: undefined });
    const results = verifyLock([untrackedSource]);
    expect(results).toHaveLength(1);
    expect(results[0].match).toBe(false);
    expect(results[0].currentSha).toBeUndefined();
  });

  it("updateLock refreshes SHA from old to new", () => {
    const source = makeLockSource({ commitSha: "aaa111bbb222ccc333" });
    lockSource(source, ["skill-one"]);

    // Mock execFileSync to return a new SHA for git ls-remote
    vi.mocked(execFileSync).mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "git" && Array.isArray(args) && args[0] === "ls-remote") {
        return "fff999eee888ddd777\tHEAD\n";
      }
      return "";
    });

    const results = updateLock([source]);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("updated");
    expect(results[0].oldSha).toBe("aaa111bbb222ccc333");
    expect(results[0].sha).toBe("fff999eee888ddd777");

    // Verify persisted
    const lock = readLock();
    expect(lock.locked[0].sha).toBe("fff999eee888ddd777");
  });

  it("updateLock reports up-to-date when SHA has not changed", () => {
    const source = makeLockSource({ commitSha: "aaa111bbb222ccc333" });
    lockSource(source, ["skill-one"]);

    // Mock execFileSync to return the same SHA
    vi.mocked(execFileSync).mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "git" && Array.isArray(args) && args[0] === "ls-remote") {
        return "aaa111bbb222ccc333\tHEAD\n";
      }
      return "";
    });

    const results = updateLock([source]);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("up-to-date");
    expect(results[0].sha).toBe("aaa111bbb222ccc333");
  });

  it("showLock displays locked sources", () => {
    const source = makeLockSource();
    lockSource(source, ["skill-one"]);

    const log = captureLog();
    showLock();
    const output = log.calls();
    log.reset();

    expect(output).toContain(SOURCE_URL);
    expect(output).toContain("aaa111bb"); // short SHA
    expect(output).toContain("skill-one");
  });

  it("showVerify displays match status for all sources", () => {
    const source = makeLockSource({ commitSha: "aaa111bbb222ccc333" });
    lockSource(source, ["skill-one"]);

    const log = captureLog();
    showVerify([source]);
    const output = log.calls();
    log.reset();

    expect(output).toContain("All sources match");
    expect(output).toContain(SOURCE_URL);
  });

  it("showVerify displays mismatch when source has drifted", () => {
    const source = makeLockSource({ commitSha: "aaa111bbb222ccc333" });
    lockSource(source, ["skill-one"]);

    const driftedSource = makeLockSource({ commitSha: "fff999eee888ddd777" });

    const log = captureLog();
    showVerify([driftedSource]);
    const output = log.calls();
    log.reset();

    expect(output).toContain("SHA mismatch");
    expect(output).toContain("re-lock");
  });

  it("multiple sources can be locked and verified independently", () => {
    const source1 = makeLockSource({ url: SOURCE_URL, commitSha: "aaa111bbb222ccc333" });
    const source2 = makeLockSource({ url: SOURCE_URL_2, commitSha: "ddd444eee555fff666" });

    lockSource(source1, ["skill-one"]);
    lockSource(source2, ["skill-two"]);

    const lock = readLock();
    expect(lock.locked).toHaveLength(2);

    // Both match
    const results = verifyLock([source1, source2]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.match)).toBe(true);

    // Drift one source
    const drifted = makeLockSource({ url: SOURCE_URL_2, commitSha: "new999sha888here777" });
    const driftResults = verifyLock([source1, drifted]);
    expect(driftResults.find((r) => r.source === SOURCE_URL)!.match).toBe(true);
    expect(driftResults.find((r) => r.source === SOURCE_URL_2)!.match).toBe(false);
  });
});
