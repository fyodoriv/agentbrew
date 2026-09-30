import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./cli-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cli-helpers.js")>();
  return {
    ...actual,
    filterSyncModules: vi.fn((modules: unknown) => modules),
    shouldInstallAgentfileItems: vi.fn(() => true),
  };
});

vi.mock("./commands/cli-catalog.js", () => ({ registerCatalogCommands: vi.fn() }));
vi.mock("./commands/cli-classify.js", () => ({ registerClassifyCommand: vi.fn() }));
vi.mock("./commands/cli-completions.js", () => ({ registerCompletionCommands: vi.fn() }));
vi.mock("./commands/cli-core.js", () => ({ registerCoreCommands: vi.fn() }));
vi.mock("./commands/cli-env.js", () => ({ registerEnvCommands: vi.fn() }));
vi.mock("./commands/cli-infra.js", () => ({ registerInfraCommands: vi.fn() }));
vi.mock("./commands/cli-install.js", () => ({
  applyAgentfileAndInstall: vi.fn(),
  registerDefaultAction: vi.fn(),
  registerInstallCommand: vi.fn(),
}));
vi.mock("./team/commands/cli-team.js", () => ({ registerTeamCommands: vi.fn() }));
vi.mock("./commands/cli-lock.js", () => ({ registerLockCommands: vi.fn() }));
vi.mock("./commands/cli-mcp.js", () => ({ registerMcpCommands: vi.fn() }));
vi.mock("./commands/cli-ops.js", () => ({ registerOpsCommands: vi.fn() }));
vi.mock("./commands/cli-sync-subcommands.js", () => ({ registerSyncSubcommands: vi.fn() }));
vi.mock("./motd.js", () => ({ printMotd: vi.fn() }));
vi.mock("./sync-runner.js", () => ({
  autoSync: vi.fn(),
  buildSyncModules: vi.fn(() => [{ name: "mcp", fn: vi.fn() }]),
  runSyncParallel: vi.fn(),
  runSyncWithErrorCollection: vi.fn(),
}));
vi.mock("./update.js", () => ({ update: vi.fn() }));

import { buildProgram } from "./cli.js";
import { shouldInstallAgentfileItems } from "./cli-helpers.js";
import { applyAgentfileAndInstall } from "./commands/cli-install.js";
import { runSyncParallel } from "./sync-runner.js";

const mockApplyAgentfileAndInstall = vi.mocked(applyAgentfileAndInstall);
const mockRunSyncParallel = vi.mocked(runSyncParallel);
const mockShouldInstallAgentfileItems = vi.mocked(shouldInstallAgentfileItems);

function buildSilentProgram() {
  const program = buildProgram();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});

describe("sync --dry-run --agentfile", () => {
  it("previews the explicit Agentfile and runner without installing or mutating state", async () => {
    const program = buildSilentProgram();

    await program.parseAsync(["node", "test", "sync", "--dry-run", "--agentfile", "./Agentfile.yaml"]);

    expect(mockApplyAgentfileAndInstall).toHaveBeenCalledWith("./Agentfile.yaml", {
      installRequestedItems: true,
      dryRun: true,
    });
    expect(mockRunSyncParallel).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        agentfilePath: "./Agentfile.yaml",
        skipGlobalAgentfile: true,
        installAgentfileItems: true,
        dryRun: true,
      }),
    );
  });

  it("keeps --only install gating during an explicit Agentfile dry-run", async () => {
    mockShouldInstallAgentfileItems.mockReturnValueOnce(false);
    const program = buildSilentProgram();

    await program.parseAsync(["node", "test", "sync", "--dry-run", "--only", "mcp", "--agentfile", "./Agentfile.yaml"]);

    expect(mockApplyAgentfileAndInstall).toHaveBeenCalledWith("./Agentfile.yaml", {
      installRequestedItems: false,
      dryRun: true,
    });
    expect(mockRunSyncParallel).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        agentfilePath: "./Agentfile.yaml",
        installAgentfileItems: false,
        dryRun: true,
      }),
    );
  });
});
