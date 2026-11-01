import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("./agentfile.js", async (original) => ({
  ...(await original<typeof import("./agentfile.js")>()),
  applyAgentfile: vi.fn(),
}));
vi.mock("./catalog/install.js", () => ({ install: vi.fn() }));

import { applyAgentfile } from "./agentfile.js";
import { install } from "./catalog/install.js";
import { buildProgram } from "./cli.js";
import { shouldInstallAgentfileItems } from "./cli-helpers.js";
import { applyAgentfileAndInstall } from "./commands/cli-install.js";
import { runSyncParallel } from "./sync-runner.js";
import { update } from "./update.js";

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
afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("sync --dry-run --agentfile", () => {
  it("previews the explicit Agentfile and runner without installing or mutating state", async () => {
    const program = buildSilentProgram();

    await program.parseAsync(["node", "test", "sync", "--dry-run", "--agentfile", "./Agentfile.yaml"]);

    expect(mockApplyAgentfileAndInstall).toHaveBeenCalledWith("./Agentfile.yaml", {
      installRequestedItems: true,
      dryRun: true,
      authoritative: true,
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
      authoritative: true,
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

describe("sync --no-prune --agentfile", () => {
  it("applies the explicit Agentfile additively and tells the runner not to prune", async () => {
    const program = buildSilentProgram();

    await program.parseAsync(["node", "test", "sync", "--no-prune", "--agentfile", "./Agentfile.yaml"]);

    expect(mockApplyAgentfileAndInstall).toHaveBeenCalledWith(
      "./Agentfile.yaml",
      expect.objectContaining({ authoritative: false }),
    );
    expect(mockRunSyncParallel).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ agentfilePath: "./Agentfile.yaml", authoritative: false }),
    );
  });
});

describe("sync --pull requested owner policy", () => {
  it("forwards requested skills even when additive application and installation have not recorded a selection", async () => {
    vi.mocked(applyAgentfile).mockReturnValue({
      skillsToInstall: ["skill-creator"],
      recommendedRequested: false,
    } as NonNullable<ReturnType<typeof applyAgentfile>>);
    await buildSilentProgram().parseAsync([
      "node",
      "test",
      "sync",
      "--pull",
      "--no-prune",
      "--agentfile",
      "./Agentfile.yaml",
    ]);
    expect(install).toHaveBeenCalledWith("skill-creator", { skillOnly: true });
    expect(update).toHaveBeenCalledWith({ dryRun: false, requestedSkills: ["skill-creator"] });
  });
  it.each(["throw", "empty"])("aborts when present Agentfile application fails with %s", async (failure) => {
    const path = join(mkdtempSync(join(homedir(), "present-policy-")), "Agentfile.yaml");
    writeFileSync(path, "skills: [skill-creator]\n");
    if (failure === "throw") {
      vi.mocked(applyAgentfile).mockImplementationOnce(() => {
        throw new Error("SYNTHETIC_APPLY_PRIVATE_FIXTURE");
      });
    } else vi.mocked(applyAgentfile).mockReturnValueOnce(undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      buildSilentProgram().parseAsync(["node", "test", "sync", "--pull", "--agentfile", path]),
    ).rejects.toThrow(/Agentfile.*aborted/);
    expect(update).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(warning.mock.calls.flat().join("\n")).not.toContain("SYNTHETIC_APPLY_PRIVATE_FIXTURE");
  });
});
