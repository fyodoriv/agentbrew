import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./cli-build-health.js", () => ({ checkCliBuildDrift: vi.fn() }));
vi.mock("./agentfile.js", async (original) => ({
  ...(await original<typeof import("./agentfile.js")>()),
  getConfigServers: vi.fn(() => []),
}));
vi.mock("./core/errors.js", async (original) => ({
  ...(await original<typeof import("./core/errors.js")>()),
  loadSyncErrors: vi.fn(() => undefined),
}));
vi.mock("./repair-log.js", async (original) => ({
  ...(await original<typeof import("./repair-log.js")>()),
  getRepairSummary: vi.fn(() => "synthetic repairs"),
  clearRepairLog: vi.fn(),
  touchLastSeen: vi.fn(),
}));
vi.mock("./auto-upgrade.js", async (original) => ({
  ...(await original<typeof import("./auto-upgrade.js")>()),
  checkForAutoUpgrade: vi.fn(),
}));
vi.mock("./core/events.js", () => ({ recordEvent: vi.fn(), storyForCommand: vi.fn() }));
vi.mock("./core/telemetry.js", () => ({ sendDaily: vi.fn() }));
vi.mock("./core/workspaces.js", () => ({ prepareWorkspaceAgentfile: vi.fn() }));
vi.mock("./state.js", async (original) => ({
  ...(await original<typeof import("./state.js")>()),
  loadState: vi.fn(() => null),
}));
vi.mock("./plugins/claude-native.js", () => ({ emitClaudeNative: vi.fn() }));
vi.mock("./plugins/leak-audit.js", () => ({ writeRedactPatterns: vi.fn() }));
vi.mock("./sync-runner.js", () => ({
  autoSync: vi.fn(),
  buildSyncModules: vi.fn(() => [{ name: "mcp", fn: vi.fn() }]),
  runSyncParallel: vi.fn(),
  runSyncWithErrorCollection: vi.fn(),
}));
vi.mock("./update-skill-policy.js", () => ({
  readUpdateSkillRequests: vi.fn(() => true),
  resolveUpdatePolicyPath: vi.fn(() => undefined),
}));
vi.mock("./update.js", () => ({ update: vi.fn() }));
vi.mock("./ops.js", () => ({ rollbackAgentConfigs: vi.fn() }));

import { checkForAutoUpgrade } from "./auto-upgrade.js";
import { buildProgram } from "./cli.js";
import { checkCliBuildDrift } from "./cli-build-health.js";
import { recordEvent } from "./core/events.js";
import { prepareWorkspaceAgentfile } from "./core/workspaces.js";
import { rollbackAgentConfigs } from "./ops.js";
import { clearRepairLog, touchLastSeen } from "./repair-log.js";
import { loadState } from "./state.js";
import { runSyncParallel } from "./sync-runner.js";
import { update } from "./update.js";

const health = vi.mocked(checkCliBuildDrift);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadState).mockReturnValue(undefined);
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("sync build health", () => {
  it.each([
    ["normal", ["--only", "mcp", "--no-recommended"], runSyncParallel],
    ["dry-run", ["--dry-run", "--only", "mcp", "--no-recommended"], runSyncParallel],
    ["pull", ["--pull", "--dry-run"], update],
    ["rollback", ["--rollback", "--dry-run"], rollbackAgentConfigs],
  ])("warns before %s sync work and still runs it", async (_name, args, operation) => {
    health.mockReturnValue([{ agent: "agentbrew", type: "cli-build", detail: "stale fixture — run `npm run build`" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await buildProgram().parseAsync(["node", "test", "sync", ...args]);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("stale fixture — run `npm run build`"));
    expect(vi.mocked(operation)).toHaveBeenCalledOnce();
    expect(warn.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(operation).mock.invocationCallOrder[0]);
    if (args.includes("--rollback") === false) {
      expect(warn.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(prepareWorkspaceAgentfile).mock.invocationCallOrder[0],
      );
    }
  });

  it("does not warn for a current build and still syncs", async () => {
    health.mockReturnValue([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await buildProgram().parseAsync(["node", "test", "sync", "--dry-run", "--only", "mcp", "--no-recommended"]);

    expect(warn).not.toHaveBeenCalled();
    expect(runSyncParallel).toHaveBeenCalledOnce();
  });
});

describe("initialized sync root-hook ordering", () => {
  beforeEach(() => {
    vi.mocked(loadState).mockReturnValue({ agents: [], mcpServers: [], sources: [], catalogVersion: "synthetic" });
  });

  it.each([
    ["normal", ["--only", "mcp", "--no-recommended"], runSyncParallel],
    ["dry-run", ["--dry-run", "--only", "mcp", "--no-recommended"], runSyncParallel],
    ["pull", ["--pull", "--dry-run"], update],
    ["rollback", ["--rollback", "--dry-run"], rollbackAgentConfigs],
  ])("initialized %s warns before root-hook output and writes", async (_name, args, operation) => {
    health.mockReturnValue([{ agent: "agentbrew", type: "cli-build", detail: "stale synthetic build" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await buildProgram().parseAsync(["node", "test", "sync", ...args]);

    expect(warn).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalled();
    expect(clearRepairLog).toHaveBeenCalledOnce();
    expect(touchLastSeen).toHaveBeenCalledOnce();
    expect(vi.mocked(operation)).toHaveBeenCalledOnce();
    for (const sideEffect of [log, vi.mocked(clearRepairLog), vi.mocked(touchLastSeen)]) {
      expect(warn.mock.invocationCallOrder[0], "warning came after hook side effects").toBeLessThan(
        sideEffect.mock.invocationCallOrder[0],
      );
    }
  });

  it("keeps an initialized current build quiet and runs sync", async () => {
    health.mockReturnValue([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await buildProgram().parseAsync(["node", "test", "sync", "--dry-run", "--only", "mcp", "--no-recommended"]);
    expect(warn).not.toHaveBeenCalled();
    expect(touchLastSeen).toHaveBeenCalledOnce();
    expect(runSyncParallel).toHaveBeenCalledOnce();
  });

  it("does not check build health for another command", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const program = buildProgram();
    const action = vi.fn();
    program.command("synthetic-non-sync").action(action);
    await program.parseAsync(["node", "test", "synthetic-non-sync"]);
    expect(action).toHaveBeenCalledOnce();
    expect(health).not.toHaveBeenCalled();
  });

  it.each([
    ["help", ["--help"]],
    ["invalid option", ["--not-a-valid-sync-option"]],
  ])("sync %s skips build health and status hook", async (_name, args) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const program = buildProgram()
      .exitOverride()
      .configureOutput({ writeOut: () => {}, writeErr: () => {} });
    await expect(program.parseAsync(["node", "test", "sync", ...args])).rejects.toThrow();
    expect(touchLastSeen, "sync help ran status hook").not.toHaveBeenCalled();
    expect(clearRepairLog).not.toHaveBeenCalled();
    expect(health).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("sync command timing excludes status hook", async () => {
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(checkForAutoUpgrade).mockImplementationOnce(() => {
      clock += 1000;
    });
    vi.mocked(runSyncParallel).mockImplementationOnce(async () => {
      clock += 20;
    });
    health.mockReturnValue([]);
    await buildProgram().parseAsync(["node", "test", "sync", "--dry-run", "--only", "mcp", "--no-recommended"]);
    const commandEvents = vi
      .mocked(recordEvent)
      .mock.calls.map(([event]) => event)
      .filter((event) => event.event === "command");
    expect(commandEvents).toHaveLength(1);
    expect(commandEvents[0].ms, "sync command timing included status hook").toBe(20);
    // Every command records its name, also one that serves no user story.
    expect(commandEvents[0]).toMatchObject({ command: "sync", ok: true });
    expect(commandEvents[0].story).toBeUndefined();
  });
});
