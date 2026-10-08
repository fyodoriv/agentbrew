import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./core/errors.js", () => ({
  clearSyncErrors: vi.fn(),
  errorMessage: vi.fn((error: unknown) => (error instanceof Error ? error.message : String(error))),
  saveSyncErrors: vi.fn(),
  SyncError: class SyncError extends Error {
    constructor(
      public module: string,
      message: string,
    ) {
      super(message);
    }
  },
  SyncErrorCollector: class SyncErrorCollector {
    errors: unknown[] = [];
    add(error: unknown) {
      this.errors.push(error);
    }
    get hasErrors() {
      return this.errors.length > 0;
    }
    get count() {
      return this.errors.length;
    }
    summary() {
      return this.errors.map((e) => `  • ${(e as Error).message}`).join("\n");
    }
  },
}));

vi.mock("./agentfile.js", () => ({ applyAgentfile: vi.fn() }));
vi.mock("./drift.js", () => ({ collectDrift: vi.fn(() => []), formatDriftSummary: vi.fn(() => "") }));
vi.mock("./manifest.js", () => ({ loadManifest: vi.fn(() => ({})), saveManifest: vi.fn() }));
vi.mock("./ops.js", () => ({ snapshotAgentConfigs: vi.fn() }));
vi.mock("./catalog/install.js", () => ({
  install: vi.fn(),
  flushInstallSummary: vi.fn(),
  installSkills: vi.fn(),
}));
const stateMock = vi.hoisted(() => ({
  activeState: undefined as
    | {
        schemaVersion: number;
        agents: Array<{ name: string; detected: boolean }>;
        catalogVersion: string;
        mcpServers?: Array<{ name: string; command: string; args: string[]; env: Record<string, string> }>;
      }
    | undefined,
  defaultState: {
    schemaVersion: 1,
    agents: [
      { name: "claude-code", detected: true },
      { name: "cursor", detected: true },
      { name: "kiro", detected: false },
    ],
    catalogVersion: "0.1.0",
    mcpServers: [],
  },
}));
vi.mock("./state.js", () => ({
  loadState: vi.fn(() => stateMock.activeState ?? stateMock.defaultState),
  withStateOverride: vi.fn(async (state: typeof stateMock.activeState, fn: () => Promise<unknown>) => {
    const previous = stateMock.activeState;
    stateMock.activeState = state;
    try {
      return await fn();
    } finally {
      stateMock.activeState = previous;
    }
  }),
}));

vi.mock("./sync/agents-sync.js", () => ({ syncAgentDefs: vi.fn() }));
vi.mock("./sync/command-sync.js", () => ({ syncCommands: vi.fn() }));
vi.mock("./sync/instructions-sync.js", () => ({ syncInstructions: vi.fn() }));
vi.mock("./sync/mcp-sync.js", () => ({ syncMcpServers: vi.fn() }));
vi.mock("./sync/rules-sync.js", () => ({ syncRules: vi.fn() }));
vi.mock("./sync/skills-sync.js", () => ({ syncSkills: vi.fn() }));
vi.mock("./sync/hooks-sync.js", () => ({ syncHooks: vi.fn() }));
vi.mock("./sync/model-sync.js", () => ({ syncModels: vi.fn() }));

import { applyAgentfile } from "./agentfile.js";
import { flushInstallSummary, install, installSkills } from "./catalog/install.js";
import { clearSyncErrors, saveSyncErrors } from "./core/errors.js";
import { collectDrift, formatDriftSummary } from "./drift.js";
import { snapshotAgentConfigs } from "./ops.js";
import { loadState, withStateOverride } from "./state.js";
import { syncAgentDefs } from "./sync/agents-sync.js";
import { syncCommands } from "./sync/command-sync.js";
import { syncHooks } from "./sync/hooks-sync.js";
import { syncInstructions } from "./sync/instructions-sync.js";
import { syncMcpServers } from "./sync/mcp-sync.js";
import { syncModels } from "./sync/model-sync.js";
import { syncRules } from "./sync/rules-sync.js";
import { syncSkills } from "./sync/skills-sync.js";
import type { SyncModule } from "./sync-runner.js";
import { autoSync, buildSyncModules, runSyncParallel, runSyncWithErrorCollection } from "./sync-runner.js";

const mockSaveSyncErrors = vi.mocked(saveSyncErrors);
const mockClearSyncErrors = vi.mocked(clearSyncErrors);
const mockSyncMcpServers = vi.mocked(syncMcpServers);
const mockSyncRules = vi.mocked(syncRules);
const mockSyncCommands = vi.mocked(syncCommands);
const mockSyncAgentDefs = vi.mocked(syncAgentDefs);
const mockSyncSkills = vi.mocked(syncSkills);
const mockSyncHooks = vi.mocked(syncHooks);
const mockSyncModels = vi.mocked(syncModels);
const mockSyncInstructions = vi.mocked(syncInstructions);
const mockApplyAgentfile = vi.mocked(applyAgentfile);
const mockCollectDrift = vi.mocked(collectDrift);
const mockFormatDriftSummary = vi.mocked(formatDriftSummary);
const mockInstall = vi.mocked(install);
const mockInstallSkills = vi.mocked(installSkills);
const mockFlushInstallSummary = vi.mocked(flushInstallSummary);
const mockSnapshotAgentConfigs = vi.mocked(snapshotAgentConfigs);
const mockWithStateOverride = vi.mocked(withStateOverride);

beforeEach(() => {
  vi.clearAllMocks();
  stateMock.activeState = undefined;
  stateMock.defaultState.mcpServers = [];
});

describe("runSyncWithErrorCollection", () => {
  it("calls every module in order", async () => {
    const order: string[] = [];
    const modules: SyncModule[] = [
      { name: "a", fn: async () => order.push("a") },
      { name: "b", fn: async () => order.push("b") },
      { name: "c", fn: async () => order.push("c") },
    ];
    await runSyncWithErrorCollection(modules);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("continues running remaining modules when one fails", async () => {
    const ran: string[] = [];
    const modules: SyncModule[] = [
      { name: "ok-first", fn: async () => ran.push("ok-first") },
      {
        name: "bad",
        fn: async () => {
          throw new Error("boom");
        },
      },
      { name: "ok-last", fn: async () => ran.push("ok-last") },
    ];
    await runSyncWithErrorCollection(modules);
    expect(ran).toEqual(["ok-first", "ok-last"]);
  });

  it("calls saveSyncErrors once after all modules run", async () => {
    const modules: SyncModule[] = [{ name: "x", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules);
    expect(mockSaveSyncErrors).toHaveBeenCalledOnce();
  });

  it("calls saveSyncErrors even when a module throws", async () => {
    const modules: SyncModule[] = [
      {
        name: "bad",
        fn: async () => {
          throw new Error("oops");
        },
      },
    ];
    await runSyncWithErrorCollection(modules);
    expect(mockSaveSyncErrors).toHaveBeenCalledOnce();
  });

  it("handles an empty module list without throwing", async () => {
    await expect(runSyncWithErrorCollection([])).resolves.toBeUndefined();
    expect(mockSaveSyncErrors).toHaveBeenCalledOnce();
  });

  it("sets process.exitCode on sync module failure", async () => {
    process.exitCode = undefined;
    const modules: SyncModule[] = [
      {
        name: "bad",
        fn: async () => {
          throw new Error("boom");
        },
      },
    ];
    await runSyncWithErrorCollection(modules);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("does not set process.exitCode when all modules succeed", async () => {
    process.exitCode = undefined;
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules);
    expect(process.exitCode).toBeUndefined();
  });
});

describe("runSyncParallel", () => {
  it("runs all modules concurrently via Promise.allSettled", async () => {
    const ran: string[] = [];
    const modules: SyncModule[] = [
      { name: "p", fn: async () => ran.push("p") },
      { name: "q", fn: async () => ran.push("q") },
    ];
    await runSyncParallel(modules);
    expect(ran).toHaveLength(2);
    expect(ran).toContain("p");
    expect(ran).toContain("q");
  });

  it("calls saveSyncErrors after all modules settle", async () => {
    const modules: SyncModule[] = [{ name: "x", fn: async () => undefined }];
    await runSyncParallel(modules);
    expect(mockSaveSyncErrors).toHaveBeenCalledOnce();
  });

  it("calls clearSyncErrors when all modules succeed", async () => {
    const modules: SyncModule[] = [{ name: "good", fn: async () => undefined }];
    await runSyncParallel(modules);
    expect(mockClearSyncErrors).toHaveBeenCalledOnce();
  });

  it("does not call clearSyncErrors when any module fails", async () => {
    const modules: SyncModule[] = [
      {
        name: "bad",
        fn: async () => {
          throw new Error("fail");
        },
      },
    ];
    await runSyncParallel(modules);
    expect(mockClearSyncErrors).not.toHaveBeenCalled();
  });

  it("sets process.exitCode on parallel sync module failure", async () => {
    process.exitCode = undefined;
    const modules: SyncModule[] = [
      {
        name: "bad",
        fn: async () => {
          throw new Error("fail");
        },
      },
    ];
    await runSyncParallel(modules);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("does not set process.exitCode when all modules succeed", async () => {
    process.exitCode = undefined;
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncParallel(modules);
    expect(process.exitCode).toBeUndefined();
  });

  it("continues running all modules even when one rejects", async () => {
    const ran: string[] = [];
    const modules: SyncModule[] = [
      {
        name: "fail",
        fn: async () => {
          throw new Error("fail");
        },
      },
      { name: "ok", fn: async () => ran.push("ok") },
    ];
    await runSyncParallel(modules);
    expect(ran).toContain("ok");
  });

  it("handles an empty module list without throwing", async () => {
    await expect(runSyncParallel([])).resolves.toBeUndefined();
    expect(mockClearSyncErrors).toHaveBeenCalledOnce();
  });
});

describe("buildSyncModules", () => {
  it("returns buildSyncModules names in canonical order", () => {
    const modules = buildSyncModules({});
    expect(modules.map((m) => m.name)).toEqual([
      "mcp",
      "rules",
      "commands",
      "agents",
      "skills",
      "hooks",
      "models",
      "instructions",
    ]);
  });

  it("each module fn calls the corresponding sync function with the supplied options", async () => {
    const options = { dryRun: true, prune: false, quiet: true };
    const modules = buildSyncModules(options);
    for (const module of modules) {
      await module.fn();
    }
    expect(mockSyncMcpServers).toHaveBeenCalledWith(options, undefined);
    expect(mockSyncRules).toHaveBeenCalledWith(options, undefined);
    expect(mockSyncCommands).toHaveBeenCalledWith(options, undefined);
    expect(mockSyncAgentDefs).toHaveBeenCalledWith(options, undefined);
    expect(mockSyncSkills).toHaveBeenCalledWith(options, undefined);
    expect(mockSyncModels).toHaveBeenCalledWith(options, undefined);
    expect(mockSyncInstructions).toHaveBeenCalledWith(options, undefined);
  });

  it("passes an empty options object through to each sync function", async () => {
    const modules = buildSyncModules({});
    for (const module of modules) {
      await module.fn();
    }
    expect(mockSyncMcpServers).toHaveBeenCalledWith({}, undefined);
    expect(mockSyncRules).toHaveBeenCalledWith({}, undefined);
  });

  // Locks the `--only` help text to buildSyncModules() output so the help
  // string can never drift out of sync with reality. Previously the help
  // string omitted hooks while buildSyncModules already included it — users typing
  // `agentbrew sync --only hooks` hit an "Unknown module" error. The
  // `project-mcp` module shipped alongside hooks but was removed when
  // `delete-legacy-project-format` shipped (.agentbrew.yaml is gone).
  // See TASKS.md `sync-only-help-text-complete`.
  it("every module name appears in the sync --only help text", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const cliSource = readFileSync(join(here, "cli.ts"), "utf-8");

    const moduleNames = buildSyncModules({}).map((m) => m.name);
    expect(moduleNames.length).toBeGreaterThanOrEqual(7);

    // The `--only` description must enumerate every module so users can discover them.
    for (const name of moduleNames) {
      expect(
        cliSource,
        `--only help text in src/cli.ts is missing module name "${name}"; buildSyncModules() returns it`,
      ).toContain(name);
    }
  });
});

describe("autoSync", () => {
  it("invokes every buildSyncModules fn via runSyncWithErrorCollection", async () => {
    await autoSync();
    // Each underlying sync function from buildSyncModules should have been called once.
    expect(mockSyncMcpServers).toHaveBeenCalledOnce();
    expect(mockSyncRules).toHaveBeenCalledOnce();
    expect(mockSyncCommands).toHaveBeenCalledOnce();
    expect(mockSyncAgentDefs).toHaveBeenCalledOnce();
    expect(mockSyncSkills).toHaveBeenCalledOnce();
    expect(mockSyncHooks).toHaveBeenCalledOnce();
    expect(mockSyncInstructions).toHaveBeenCalledOnce();
  });

  it("passes quiet:true to every sync module", async () => {
    await autoSync();
    expect(mockSyncMcpServers).toHaveBeenCalledWith({ quiet: true }, undefined);
    expect(mockSyncSkills).toHaveBeenCalledWith({ quiet: true }, undefined);
  });

  it("persists errors via saveSyncErrors", async () => {
    await autoSync();
    expect(mockSaveSyncErrors).toHaveBeenCalledOnce();
  });
});

describe("reportPostSyncDrift", () => {
  it("reports drift issues when they exist after a successful sync", async () => {
    mockCollectDrift.mockReturnValueOnce([{ type: "missing-skill", agent: "cursor", detail: "foo" }] as never);
    mockFormatDriftSummary.mockReturnValueOnce("(1 skill)" as never);
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules);
    expect(mockCollectDrift).toHaveBeenCalled();
    expect(mockFormatDriftSummary).toHaveBeenCalled();
  });

  it("skips drift report when collector has errors", async () => {
    const modules: SyncModule[] = [
      {
        name: "bad",
        fn: async () => {
          throw new Error("boom");
        },
      },
    ];
    await runSyncWithErrorCollection(modules);
    expect(mockCollectDrift).not.toHaveBeenCalled();
  });

  it("reports drift in runSyncParallel when sync succeeds", async () => {
    mockCollectDrift.mockReturnValueOnce([{ type: "missing-rule", agent: "claude", detail: "bar" }] as never);
    mockFormatDriftSummary.mockReturnValueOnce("(1 rule)" as never);
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncParallel(modules);
    expect(mockCollectDrift).toHaveBeenCalled();
  });

  it("tolerates collectDrift throwing without crashing", async () => {
    mockCollectDrift.mockImplementationOnce(() => {
      throw new Error("drift check failed");
    });
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await expect(runSyncWithErrorCollection(modules)).resolves.toBeUndefined();
  });

  it("does NOT report user-added items (skills-user-added, commands-user-added, mcp-user-added) as drift", async () => {
    // Regression guard for sync-idempotent-and-complete issue 4 + criterion (c):
    // user-added items are informational (`User additions` section in `agentbrew status`),
    // never auto-fixable, and must NOT trigger the post-sync "Run agentbrew status --fix"
    // footer. Before the fix, large user-added skill/command totals duplicated the
    // would see "43 drift issue(s) remain after sync" on every clean sync, even though
    // those items are tracked under the User Additions section, not Drift.
    mockCollectDrift.mockReturnValueOnce([
      { type: "skills-user-added", agent: "warp", detail: "user-created skill: agent-browser" },
      { type: "skills-user-added", agent: "warp", detail: "user-created skill: capability-plugin-creator" },
      { type: "commands-user-added", agent: "claude-code", detail: "user-created command: minsky-clean.md" },
      { type: "mcp-user-added", agent: "codex", detail: "user-added server: organization-developer-portal" },
    ] as never);
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules);

    const logOutput = consoleLogSpy.mock.calls.flat().join(" ");
    consoleLogSpy.mockRestore();
    expect(logOutput).not.toContain("drift issue(s) remain after sync");
    expect(logOutput).not.toContain("agentbrew status --fix");
  });

  it("still reports real drift types (mcp, rules, skills, commands, hooks, instructions, agents, mcp-permissions)", async () => {
    // The filter must NOT swallow real drift. Real drift types still trigger
    // the post-sync "drift issue(s) remain" line so the user can act on it.
    mockCollectDrift.mockReturnValueOnce([
      { type: "mcp", agent: "kiro", detail: "missing server: foo" },
      { type: "skills-user-added", agent: "warp", detail: "user-created skill: bar" },
    ] as never);
    mockFormatDriftSummary.mockReturnValueOnce("(1 mcp)" as never);
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules);

    const logOutput = consoleLogSpy.mock.calls.flat().join(" ");
    consoleLogSpy.mockRestore();
    expect(logOutput).toContain("1 drift issue(s) remain after sync");
    // Filter only excluded the user-added entry; the real mcp drift survived.
  });
});

describe("compact mode — no-op output (UX line budget)", () => {
  // Compact-mode acceptance: on a fully-converged no-op sync, total output
  // must be ≤5 lines. Modules run with compact=true (silent for
  // log/info/success — warnings still surface), and the runner
  // emits a single consolidated summary line at the end.
  it("emits a single ✓ Synced summary line in compact mode", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules, { compact: true });
    const lines = consoleLogSpy.mock.calls.flat().map(String);
    consoleLogSpy.mockRestore();
    const synced = lines.filter((l) => l.includes("✓ Synced") && l.includes("agents"));
    expect(synced.length).toBe(1);
    // Counts only detected agents — `kiro: detected=false` is not
    // included in the agent count of the consolidated summary line.
    expect(synced[0]).toContain("2 agents");
  });

  it("does NOT emit the consolidated summary line when compact is false", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules); // no compact option
    const lines = consoleLogSpy.mock.calls.flat().map(String);
    consoleLogSpy.mockRestore();
    expect(lines.some((l) => l.includes("✓ Synced") && l.includes("agents"))).toBe(false);
  });

  it("emits compact summary in runSyncParallel when compact: true", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncParallel(modules, { compact: true });
    const lines = consoleLogSpy.mock.calls.flat().map(String);
    consoleLogSpy.mockRestore();
    const synced = lines.filter((l) => l.includes("✓ Synced") && l.includes("agents"));
    expect(synced.length).toBe(1);
  });

  it("skips compact summary on errors so the user sees the error path, not a misleading success", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const modules: SyncModule[] = [
      {
        name: "bad",
        fn: async () => {
          throw new Error("boom");
        },
      },
    ];
    await runSyncWithErrorCollection(modules, { compact: true });
    const lines = consoleLogSpy.mock.calls.flat().map(String);
    consoleLogSpy.mockRestore();
    expect(lines.some((l) => l.includes("✓ Synced") && l.includes("agents"))).toBe(false);
    process.exitCode = undefined;
  });

  it("compact + drift on a fully-converged-but-with-drift run still keeps total output ≤5 lines", async () => {
    // Acceptance: even WITH a drift report, total output stays ≤5 lines —
    // because each line in the drift report is counted (not just the compact
    // summary). On a truly fully-converged system, drift is empty and we hit
    // 1-2 lines.
    mockCollectDrift.mockReturnValueOnce([{ type: "mcp", agent: "kiro", detail: "missing server: foo" }] as never);
    mockFormatDriftSummary.mockReturnValueOnce("(1 mcp)" as never);
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules, { compact: true });
    const lines = consoleLogSpy.mock.calls.flat().map(String);
    consoleLogSpy.mockRestore();
    // Compact summary + drift report (two output lines) + optional blank splitter stays within ≤5 lines UX budget.
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it("compact happy path emits no 'Next steps' footer when drift is empty", async () => {
    // Pins the user-facing contract: on a fully-converged system, the
    // post-sync drift footer ("⚠ N drift issue(s) remain — Run agentbrew
    // status --fix") is silent. The footer must only appear when
    // `collectDrift()` returns at least one non-user-added item.
    //
    // Default mockCollectDrift returns [] (file-level mock setup at
    // line 33), so this test exercises the no-drift branch of
    // reportPostSyncDrift without explicit per-test setup.
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules, { compact: true });
    const lines = consoleLogSpy.mock.calls.flat().map(String);
    consoleLogSpy.mockRestore();
    expect(lines.some((l) => l.includes("drift issue(s) remain after sync"))).toBe(false);
    expect(lines.some((l) => l.includes("agentbrew status --fix"))).toBe(false);
  });
});

describe("runSyncParallel sequential module handling", () => {
  it("runs rules before instructions sequentially after parallel modules", async () => {
    const order: string[] = [];
    const modules: SyncModule[] = [
      { name: "mcp", fn: async () => order.push("mcp") },
      { name: "instructions", fn: async () => order.push("instructions") },
      { name: "rules", fn: async () => order.push("rules") },
      { name: "skills", fn: async () => order.push("skills") },
    ];
    await runSyncParallel(modules);
    // Issue 3 of `sync-idempotent-and-complete`: rules MUST run before
    // instructions so instructions-sync's `deduplicateByHeading` can fire
    // against the managed section rules-sync just wrote. Otherwise a
    // single sync leaves false-positive instructions drift.
    const instructionsIdx = order.indexOf("instructions");
    const rulesIdx = order.indexOf("rules");
    expect(rulesIdx).toBeLessThan(instructionsIdx);
    expect(order).toHaveLength(4);
  });

  it("collects errors from sequential modules", async () => {
    const modules: SyncModule[] = [
      {
        name: "instructions",
        fn: async () => {
          throw new Error("instructions failed");
        },
      },
      { name: "rules", fn: async () => undefined },
    ];
    process.exitCode = undefined;
    await runSyncParallel(modules);
    expect(process.exitCode).toBe(1);
    expect(mockSaveSyncErrors).toHaveBeenCalledOnce();
    process.exitCode = undefined;
  });

  it("collects errors from both parallel and sequential modules", async () => {
    const modules: SyncModule[] = [
      {
        name: "mcp",
        fn: async () => {
          throw new Error("mcp failed");
        },
      },
      {
        name: "instructions",
        fn: async () => {
          throw new Error("instructions failed");
        },
      },
      {
        name: "rules",
        fn: async () => {
          throw new Error("rules failed");
        },
      },
    ];
    process.exitCode = undefined;
    await runSyncParallel(modules);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});

describe("prepareSync and Agentfile handling", () => {
  it("applies global and project Agentfiles during sync", async () => {
    mockApplyAgentfile.mockReturnValue({ skillsToInstall: [], recommendedRequested: false } as never);
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules);
    // Should have been called for global and project Agentfiles
    expect(mockApplyAgentfile).toHaveBeenCalledTimes(2);
  });

  it("skips global Agentfile when skipGlobalAgentfile is true", async () => {
    mockApplyAgentfile.mockReturnValue({ skillsToInstall: [], recommendedRequested: false } as never);
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules, { skipGlobalAgentfile: true });
    // Should only be called for project Agentfile (1 time)
    expect(mockApplyAgentfile).toHaveBeenCalledTimes(1);
  });

  it("installs recommended when Agentfile requests it", async () => {
    mockApplyAgentfile.mockReturnValueOnce({ skillsToInstall: [], recommendedRequested: true } as never);
    mockApplyAgentfile.mockReturnValueOnce({ skillsToInstall: [], recommendedRequested: false } as never);
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules);
    expect(mockInstall).toHaveBeenCalledWith(undefined, { recommended: true });
    expect(mockFlushInstallSummary).toHaveBeenCalled();
  });

  it("installs individual skills from Agentfile skillsToInstall", async () => {
    mockApplyAgentfile.mockReturnValueOnce({
      skillsToInstall: ["debug", "plan"],
      recommendedRequested: false,
      excludedAgents: [],
    } as never);
    mockApplyAgentfile.mockReturnValueOnce({ skillsToInstall: [], recommendedRequested: false } as never);
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules);
    expect(mockInstallSkills).toHaveBeenCalledWith(["debug", "plan"]);
    expect(mockFlushInstallSummary).toHaveBeenCalled();
  });

  it("does not install Agentfile items when installAgentfileItems is false", async () => {
    mockApplyAgentfile.mockReturnValueOnce({
      skillsToInstall: ["debug"],
      recommendedRequested: true,
    } as never);
    mockApplyAgentfile.mockReturnValueOnce({ skillsToInstall: ["plan"], recommendedRequested: false } as never);
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await runSyncWithErrorCollection(modules, { installAgentfileItems: false });
    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockInstallSkills).not.toHaveBeenCalled();
    expect(mockApplyAgentfile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ includeSkillInstallReport: false }),
    );
  });

  it("dry-runs Agentfiles without installing requested items or snapshotting configs", async () => {
    mockApplyAgentfile.mockReturnValue({
      skillsToInstall: ["debug"],
      recommendedRequested: true,
    } as never);
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];

    await runSyncWithErrorCollection(modules, { dryRun: true });

    expect(mockApplyAgentfile).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ dryRun: true }));
    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockInstallSkills).not.toHaveBeenCalled();
    expect(mockSnapshotAgentConfigs).not.toHaveBeenCalled();
  });

  it("runs dry-run modules against the cwd Agentfile virtual state", async () => {
    mockApplyAgentfile.mockImplementation((directoryOrPath, options) => {
      const stateOverride = options?.stateOverride;
      if (directoryOrPath === process.cwd() && stateOverride) {
        stateOverride.mcpServers = [
          ...(stateOverride.mcpServers ?? []),
          { name: "cwd-only", command: "npx", args: ["cwd"], env: {}, source: "agentfile" },
        ];
      }
      return {
        serversAdded: directoryOrPath === process.cwd() ? ["cwd-only"] : [],
        serversUpdated: [],
        serversRemoved: [],
        sourcesAdded: [],
        commandDirsAdded: [],
        agentDirsAdded: [],
        skillsToInstall: [],
        rulesUpdated: false,
        hooksUpdated: false,
        recommendedRequested: false,
        excludedAgents: [],
        defaultModelUpdated: false,
      };
    });

    let moduleServerNames: string[] = [];
    const modules: SyncModule[] = [
      {
        name: "inspect",
        fn: async () => {
          moduleServerNames = loadState()?.mcpServers?.map((server) => server.name) ?? [];
        },
      },
    ];

    await runSyncWithErrorCollection(modules, { dryRun: true });

    expect(moduleServerNames).toContain("cwd-only");
    expect(stateMock.defaultState.mcpServers).toEqual([]);
    expect(mockWithStateOverride).toHaveBeenCalledWith(
      expect.objectContaining({ mcpServers: expect.any(Array) }),
      expect.any(Function),
    );
    expect(mockApplyAgentfile).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({ dryRun: true, stateOverride: expect.any(Object) }),
    );
  });

  it("runs dry-run modules against an explicit --agentfile virtual state", async () => {
    const explicitAgentfilePath = "/tmp/dotfiles/Agentfile.yaml";
    mockApplyAgentfile.mockImplementation((directoryOrPath, options) => {
      const stateOverride = options?.stateOverride;
      if (directoryOrPath === explicitAgentfilePath && stateOverride) {
        stateOverride.mcpServers = [
          ...(stateOverride.mcpServers ?? []),
          { name: "explicit-only", command: "npx", args: ["explicit"], env: {}, source: "agentfile" },
        ];
      }
      return {
        serversAdded: directoryOrPath === explicitAgentfilePath ? ["explicit-only"] : [],
        serversUpdated: [],
        serversRemoved: [],
        sourcesAdded: [],
        commandDirsAdded: [],
        agentDirsAdded: [],
        skillsToInstall: [],
        defaultModelUpdated: false,
        rulesUpdated: false,
        hooksUpdated: false,
        recommendedRequested: false,
        excludedAgents: [],
      };
    });

    let moduleServerNames: string[] = [];
    const modules: SyncModule[] = [
      {
        name: "inspect",
        fn: async () => {
          moduleServerNames = loadState()?.mcpServers?.map((server) => server.name) ?? [];
        },
      },
    ];

    await runSyncParallel(modules, {
      dryRun: true,
      skipGlobalAgentfile: true,
      agentfilePath: explicitAgentfilePath,
    });

    expect(moduleServerNames).toContain("explicit-only");
    expect(stateMock.defaultState.mcpServers).toEqual([]);
    expect(mockApplyAgentfile).toHaveBeenCalledWith(
      explicitAgentfilePath,
      expect.objectContaining({
        authoritative: true,
        dryRun: true,
        quiet: true,
        stateOverride: expect.any(Object),
      }),
    );
  });

  it("tolerates applyAgentfile throwing without crashing", async () => {
    mockApplyAgentfile.mockImplementation(() => {
      throw new Error("bad agentfile");
    });
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await expect(runSyncWithErrorCollection(modules)).resolves.toBeUndefined();
  });

  it("tolerates install throwing without crashing", async () => {
    mockApplyAgentfile.mockReturnValueOnce({ skillsToInstall: ["bad-skill"], recommendedRequested: false } as never);
    mockApplyAgentfile.mockReturnValueOnce({ skillsToInstall: [], recommendedRequested: false } as never);
    mockInstall.mockRejectedValueOnce(new Error("install failed"));
    const modules: SyncModule[] = [{ name: "ok", fn: async () => undefined }];
    await expect(runSyncWithErrorCollection(modules)).resolves.toBeUndefined();
  });
});
