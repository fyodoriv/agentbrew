import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./cli-build-health.js", () => ({ checkCliBuildDrift: vi.fn() }));
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

import { buildProgram } from "./cli.js";
import { checkCliBuildDrift } from "./cli-build-health.js";
import { prepareWorkspaceAgentfile } from "./core/workspaces.js";
import { rollbackAgentConfigs } from "./ops.js";
import { runSyncParallel } from "./sync-runner.js";
import { update } from "./update.js";

const health = vi.mocked(checkCliBuildDrift);

beforeEach(() => {
  vi.clearAllMocks();
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
