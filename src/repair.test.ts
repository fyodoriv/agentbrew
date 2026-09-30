import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  lstatSync: vi.fn(),
  readlinkSync: vi.fn(),
  readFileSync: vi.fn(() => ""),
}));

vi.mock("./state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState };
});

vi.mock("./sync/mcp-sync.js", () => ({
  syncMcpServers: vi.fn(),
}));

vi.mock("./sync/rules-sync.js", () => ({
  dedupeSharedRulesFile: vi.fn(),
  syncRules: vi.fn(),
}));

vi.mock("./sync/command-sync.js", () => ({
  syncCommands: vi.fn(),
}));

vi.mock("./sync/agents-sync.js", () => ({
  syncAgentDefs: vi.fn(),
}));

vi.mock("./sync/skills-sync.js", () => ({
  syncSkills: vi.fn(),
  getSkillSources: vi.fn(() => []),
  cleanBrokenSymlinksGlobally: vi.fn(() => 0),
}));

vi.mock("./sync/hooks-sync.js", () => ({
  syncHooks: vi.fn(),
}));

vi.mock("./sync/launchagent.js", () => ({
  installLaunchAgent: vi.fn(),
  repairAgentbrewLaunchAgentPaths: vi.fn(),
}));

vi.mock("./sync/instructions-sync.js", () => ({
  syncInstructions: vi.fn(),
  loadInstructions: vi.fn(() => undefined),
  isInstructionsUpToDate: (deployed: string, instructionsContent: string) =>
    deployed === instructionsContent || deployed.startsWith(instructionsContent.trimEnd()),
}));

vi.mock("./sync/auto-sync.js", () => ({
  getLogDir: vi.fn(() => "/tmp/agentbrew-logs"),
  trimLogIfNeeded: vi.fn(),
}));

vi.mock("./mcp/mcp-setup.js", () => ({
  validateMcpEnvVars: vi.fn(() => []),
}));

vi.mock("./skills/validate.js", () => ({
  validateAllSkills: vi.fn(() => ({ total: 0, valid: 0, withErrors: 0, withWarnings: 0, results: [] })),
}));

vi.mock("./drift-checks/launchagent-path.js", () => ({
  checkLaunchAgentPathDrift: vi.fn(() => []),
}));

vi.mock("./drift.js", () => ({
  checkMcpDrift: vi.fn(() => []),
  checkBarePlaceholdersDrift: vi.fn(() => []),
  checkRulesDrift: vi.fn(() => []),
  checkSkillsDrift: vi.fn(() => []),
  checkBrokenSymlinks: vi.fn(() => []),
  checkCommandsDrift: vi.fn(() => []),
  checkInstructionsDrift: vi.fn(() => []),
  checkDevinPermissionDrift: vi.fn(() => []),
  checkMcpPermissionDrift: vi.fn(() => []),
  checkHooksDrift: vi.fn(() => []),
  checkAgentDefsDrift: vi.fn(() => []),
  checkSkillsValidity: vi.fn(() => []),
  checkMcpEnvVarsDrift: vi.fn(() => []),
  collectDrift: vi.fn(() => []),
  formatDriftSummary: vi.fn(() => "(summary)"),
}));

vi.mock("./ops.js", () => ({
  snapshotAgentConfigs: vi.fn(),
}));

vi.mock("./repair-log.js", () => ({
  saveRepairLog: vi.fn(),
}));

import {
  checkAgentDefsDrift,
  checkBrokenSymlinks,
  checkCommandsDrift,
  checkHooksDrift,
  checkInstructionsDrift,
  checkMcpDrift,
  checkMcpPermissionDrift,
  checkRulesDrift,
  checkSkillsDrift,
  collectDrift,
} from "./drift.js";
import { snapshotAgentConfigs } from "./ops.js";
import { fix } from "./repair.js";
import { saveRepairLog } from "./repair-log.js";
import { loadState } from "./state.js";
import { syncAgentDefs } from "./sync/agents-sync.js";
import { getLogDir, trimLogIfNeeded } from "./sync/auto-sync.js";
import { syncCommands } from "./sync/command-sync.js";
import { syncHooks } from "./sync/hooks-sync.js";
import { syncInstructions } from "./sync/instructions-sync.js";
import { syncMcpServers } from "./sync/mcp-sync.js";
import { dedupeSharedRulesFile, syncRules } from "./sync/rules-sync.js";
import { syncSkills } from "./sync/skills-sync.js";

const mockLoadState = vi.mocked(loadState);
const mockTrimLogIfNeeded = vi.mocked(trimLogIfNeeded);
const mockGetLogDir = vi.mocked(getLogDir);
const mockSyncMcpServers = vi.mocked(syncMcpServers);
const mockSyncInstructions = vi.mocked(syncInstructions);
const mockSyncRules = vi.mocked(syncRules);
const mockDedupeSharedRulesFile = vi.mocked(dedupeSharedRulesFile);
const mockSyncCommands = vi.mocked(syncCommands);
const mockSyncSkills = vi.mocked(syncSkills);
const mockSyncAgentDefs = vi.mocked(syncAgentDefs);
const mockSyncHooks = vi.mocked(syncHooks);
const mockCheckMcpDrift = vi.mocked(checkMcpDrift);
const mockCheckRulesDrift = vi.mocked(checkRulesDrift);
const mockCheckSkillsDrift = vi.mocked(checkSkillsDrift);
const mockCheckBrokenSymlinks = vi.mocked(checkBrokenSymlinks);
const mockCheckCommandsDrift = vi.mocked(checkCommandsDrift);
const mockCheckInstructionsDrift = vi.mocked(checkInstructionsDrift);
const mockCheckMcpPermissionDrift = vi.mocked(checkMcpPermissionDrift);
const mockCheckHooksDrift = vi.mocked(checkHooksDrift);
const mockCheckAgentDefsDrift = vi.mocked(checkAgentDefsDrift);
const mockCollectDrift = vi.mocked(collectDrift);
const mockSaveRepairLog = vi.mocked(saveRepairLog);
const mockSnapshotAgentConfigs = vi.mocked(snapshotAgentConfigs);

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    agents: [],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetLogDir.mockReturnValue("/tmp/agentbrew-logs");
  mockDedupeSharedRulesFile.mockReturnValue({ content: "# Rules\n", removedCount: 0, removed: [] });
});

describe("fix", () => {
  it("returns early when state is missing", async () => {
    mockLoadState.mockReturnValue(undefined);

    await fix();

    expect(mockSyncMcpServers).not.toHaveBeenCalled();
    expect(mockSyncInstructions).not.toHaveBeenCalled();
    expect(mockSyncRules).not.toHaveBeenCalled();
  });

  it("trims all three log files before syncing", async () => {
    mockLoadState.mockReturnValue(makeState());

    const syncCallTimes: number[] = [];
    mockSyncMcpServers.mockImplementation(async () => {
      syncCallTimes.push(mockTrimLogIfNeeded.mock.calls.length);
    });

    await fix();

    expect(mockTrimLogIfNeeded).toHaveBeenCalledTimes(3);
    expect(mockTrimLogIfNeeded).toHaveBeenCalledWith("/tmp/agentbrew-logs/cron.log");
    expect(mockTrimLogIfNeeded).toHaveBeenCalledWith("/tmp/agentbrew-logs/launchagent.log");
    expect(mockTrimLogIfNeeded).toHaveBeenCalledWith("/tmp/agentbrew-logs/launchagent.err");
    // All three trims happen before any sync call
    expect(syncCallTimes[0]).toBe(3);
  });

  it("calls syncInstructions before syncRules to preserve the managed section", async () => {
    mockLoadState.mockReturnValue(makeState());

    const callOrder: string[] = [];
    mockSyncInstructions.mockImplementation(async () => {
      callOrder.push("syncInstructions");
      return { agentsUpdated: 0, contextFilesGenerated: 0 };
    });
    mockSyncRules.mockImplementation(async () => {
      callOrder.push("syncRules");
    });

    await fix();

    const instructionsIndex = callOrder.indexOf("syncInstructions");
    const rulesIndex = callOrder.indexOf("syncRules");
    expect(instructionsIndex).toBeGreaterThanOrEqual(0);
    expect(rulesIndex).toBeGreaterThanOrEqual(0);
    expect(instructionsIndex).toBeLessThan(rulesIndex);
  });

  it("dedupes shared-rules.md before syncing rules", async () => {
    mockLoadState.mockReturnValue(makeState());

    const callOrder: string[] = [];
    mockDedupeSharedRulesFile.mockImplementation(() => {
      callOrder.push("dedupeSharedRulesFile");
      return { content: "# Rules\n", removedCount: 1, removed: ["repeat"] };
    });
    mockSyncRules.mockImplementation(async () => {
      callOrder.push("syncRules");
    });

    await fix();

    expect(callOrder).toEqual(expect.arrayContaining(["dedupeSharedRulesFile", "syncRules"]));
    expect(callOrder.indexOf("dedupeSharedRulesFile")).toBeLessThan(callOrder.indexOf("syncRules"));
  });

  it("calls every sync function once (mcp, instructions, rules, commands, skills, agents, hooks)", async () => {
    mockLoadState.mockReturnValue(makeState());

    await fix();

    expect(mockSyncMcpServers).toHaveBeenCalledOnce();
    expect(mockSyncInstructions).toHaveBeenCalledOnce();
    expect(mockSyncRules).toHaveBeenCalledOnce();
    expect(mockSyncCommands).toHaveBeenCalledOnce();
    expect(mockSyncSkills).toHaveBeenCalledOnce();
    expect(mockSyncAgentDefs).toHaveBeenCalledOnce();
    // syncHooks must run during fix() — without it, hooks drift items would be
    // present in driftBefore but never cleared, falsely classified as "fixed"
    // by the diff. Same root-cause class as the original mcp-permissions bug.
    expect(mockSyncHooks).toHaveBeenCalledOnce();
  });

  it("reports all drift resolved when re-check finds zero issues", async () => {
    mockLoadState.mockReturnValue(makeState());

    await fix();

    const logOutput = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logOutput).toContain("All drift resolved");
  });

  it("reports remaining issue count when re-check still finds drift", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockCheckMcpDrift.mockReturnValue([{ agent: "cursor", type: "mcp", detail: "missing server: foo" }]);
    mockCheckRulesDrift.mockReturnValue([{ agent: "claude-code", type: "rules", detail: "missing managed section" }]);

    await fix();

    const logOutput = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logOutput).toContain("2 issue(s) remain after fix");
  });

  it("lists each remaining drift item in output", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockCheckSkillsDrift.mockReturnValue([{ agent: "cursor", type: "skills", detail: "missing skill: my-skill" }]);

    await fix();

    const logOutput = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logOutput).toContain("cursor");
    expect(logOutput).toContain("skills");
    expect(logOutput).toContain("missing skill: my-skill");
  });

  it("aggregates drift from all registered drift check functions for the remaining count", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockCheckMcpDrift.mockReturnValue([{ agent: "a", type: "mcp", detail: "x" }]);
    mockCheckRulesDrift.mockReturnValue([{ agent: "b", type: "rules", detail: "x" }]);
    mockCheckSkillsDrift.mockReturnValue([{ agent: "c", type: "skills", detail: "x" }]);
    mockCheckBrokenSymlinks.mockReturnValue([{ agent: "d", type: "skills", detail: "x" }]);
    mockCheckCommandsDrift.mockReturnValue([{ agent: "e", type: "commands", detail: "x" }]);
    mockCheckInstructionsDrift.mockReturnValue([{ agent: "f", type: "instructions", detail: "x" }]);

    await fix();

    const logOutput = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logOutput).toContain("6 issue(s) remain after fix");
  });

  it("logs repaired drift when some issues are fixed", async () => {
    mockLoadState.mockReturnValue(makeState());
    // Before: 2 issues. After: 1 remains. So 1 was repaired.
    mockCollectDrift.mockReturnValue([
      { agent: "cursor", type: "mcp", detail: "missing server: foo" },
      { agent: "claude-code", type: "rules", detail: "stale section" },
    ]);
    mockCheckRulesDrift.mockReturnValue([{ agent: "claude-code", type: "rules", detail: "stale section" }]);

    await fix();

    expect(mockSaveRepairLog).toHaveBeenCalledWith([{ type: "mcp", agent: "cursor", detail: "missing server: foo" }]);
    const logOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logOutput).toContain("Fixed 1 issue(s)");
  });

  it("does NOT claim to have fixed user-added skills, commands, or MCP servers", async () => {
    // Regression guard for user-additions-not-drift: fix() must never credit
    // itself for removing user-created items. These live in their own section
    // and survive every repair loop. See the User additions display path in
    // health.ts and AUTO_FIXABLE_TYPES in repair.ts.
    mockLoadState.mockReturnValue(makeState());
    mockCollectDrift.mockReturnValue([
      { agent: "claude-code", type: "skills-user-added", detail: "user-created skill: my-custom" },
      { agent: "cursor", type: "commands-user-added", detail: "user-created command: my-cmd.md" },
      { agent: "warp", type: "mcp-user-added", detail: "user-added server: my-proxy" },
      { agent: "cursor", type: "skill-validity", detail: "bad frontmatter" },
      { agent: "organization-overlay", type: "organization-overlay", detail: "signals mismatch" },
    ]);
    // No auto-fixable drift — nothing for fix() to legitimately address.

    await fix();

    // The repair log should be empty because no auto-fixable drift existed.
    expect(mockSaveRepairLog).toHaveBeenCalledWith([]);

    const logOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    // No "Fixed N issue(s)" claim because nothing was actually fixed
    expect(logOutput).not.toContain("Fixed 5 issue(s)");
    expect(logOutput).not.toContain("skills-user-added");
    expect(logOutput).not.toContain("commands-user-added");
    expect(logOutput).not.toContain("mcp-user-added");
    expect(logOutput).not.toContain("skill-validity");
    expect(logOutput).not.toContain("organization-overlay");
  });

  it("only auto-fixable drift types count toward the Fixed N issue(s) line", async () => {
    mockLoadState.mockReturnValue(makeState());
    // Before: 1 real drift + 2 user-added items = 3 total collected
    mockCollectDrift.mockReturnValue([
      { agent: "cursor", type: "mcp", detail: "missing server: foo" },
      { agent: "claude-code", type: "skills-user-added", detail: "user-created skill: my-skill" },
      { agent: "cursor", type: "commands-user-added", detail: "user-created command: my.md" },
    ]);
    // After: nothing remains. But the only thing fix() actually fixed was the mcp drift.

    await fix();

    // Only the mcp drift should show up in the repair log — not the user-added items.
    expect(mockSaveRepairLog).toHaveBeenCalledWith([{ type: "mcp", agent: "cursor", detail: "missing server: foo" }]);
    const logOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logOutput).toContain("Fixed 1 issue(s)");
    expect(logOutput).not.toContain("Fixed 3 issue(s)");
  });

  it("snapshots agent configs before repair (non-fatal on failure)", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockSnapshotAgentConfigs.mockImplementation(() => {
      throw new Error("disk full");
    });

    await fix(); // should not throw

    expect(mockSnapshotAgentConfigs).toHaveBeenCalledOnce();
    expect(mockSyncMcpServers).toHaveBeenCalledOnce(); // repair continues
  });

  // Regression suite for sync-idempotent-and-complete issue 4: every drift type
  // in `AUTO_FIXABLE_TYPES` must round-trip through the post-fix re-check.
  // If a check function isn't called in `repair.ts` after sync, persistent
  // items leak from `driftBefore` into `repairedDrift` (instead of
  // `remainingItems`) and `agentbrew status --fix` reports "Fixed N issue(s)"
  // forever. This is the root-cause class — pin every type here so a future
  // type addition that forgets to wire the re-check trips the test.
  const persistentDriftCases = [
    {
      name: "mcp-permissions",
      detail: 'missing permission for "organization-developer-portal" — Run: agentbrew sync',
      mockFn: () => mockCheckMcpPermissionDrift,
    },
    {
      name: "hooks",
      detail: "hooks file missing: ~/.claude/settings.json — Run: agentbrew sync",
      mockFn: () => mockCheckHooksDrift,
    },
    {
      name: "agents",
      detail: "missing agent def: helper.md — Run: agentbrew sync",
      mockFn: () => mockCheckAgentDefsDrift,
    },
  ] as const;

  for (const testCase of persistentDriftCases) {
    it(`does NOT claim to fix ${testCase.name} drift that persists after sync`, async () => {
      mockLoadState.mockReturnValue(makeState());
      // Other tests in this file leave `mockReturnValue` queued on the per-check
      // mocks; reset them to empty so this test only sees the targeted item.
      mockCheckMcpDrift.mockReturnValue([]);
      mockCheckRulesDrift.mockReturnValue([]);
      mockCheckSkillsDrift.mockReturnValue([]);
      mockCheckBrokenSymlinks.mockReturnValue([]);
      mockCheckCommandsDrift.mockReturnValue([]);
      mockCheckInstructionsDrift.mockReturnValue([]);
      mockCheckMcpPermissionDrift.mockReturnValue([]);
      mockCheckHooksDrift.mockReturnValue([]);
      mockCheckAgentDefsDrift.mockReturnValue([]);
      const persistentItem = {
        agent: "devin",
        type: testCase.name as never,
        detail: testCase.detail,
      };
      mockCollectDrift.mockReturnValue([persistentItem]);
      testCase.mockFn().mockReturnValue([persistentItem]);

      await fix();

      // The repair log should be empty because the drift persisted.
      expect(mockSaveRepairLog).toHaveBeenCalledWith([]);
      const logOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
      expect(logOutput).not.toContain("Fixed 1 issue(s)");
      expect(logOutput).toContain("1 issue(s) remain after fix");
    });
  }

  it("reports next-step suggestions for each remaining drift type", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockCheckMcpDrift.mockReturnValue([{ agent: "a", type: "mcp", detail: "x" }]);
    mockCheckCommandsDrift.mockReturnValue([{ agent: "b", type: "commands", detail: "x" }]);
    mockCheckInstructionsDrift.mockReturnValue([{ agent: "c", type: "instructions", detail: "x" }]);

    await fix();

    const logOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logOutput).toContain("agentbrew setup");
    expect(logOutput).toContain("commands");
    expect(logOutput).toContain("instructions");
  });
});
