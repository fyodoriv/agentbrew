import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const observed = vi.hoisted(() => ({ calls: [] as string[], denied: 0 }));

function record(name: string) {
  observed.calls.push(name);
}

function blocked() {
  observed.denied++;
  throw new Error("sync selection fixture blocked external action");
}

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  exec: blocked,
  execFile: blocked,
  execSync: blocked,
  execFileSync: blocked,
  fork: blocked,
  spawn: blocked,
  spawnSync: blocked,
}));
vi.mock("node:net", async (original) => ({
  ...(await original<typeof import("node:net")>()),
  connect: blocked,
  createConnection: blocked,
}));
vi.mock("node:http", async (original) => ({
  ...(await original<typeof import("node:http")>()),
  get: blocked,
  request: blocked,
}));
vi.mock("node:https", async (original) => ({
  ...(await original<typeof import("node:https")>()),
  get: blocked,
  request: blocked,
}));

vi.mock("./state.js", async (original) => {
  const fixture = {
    schemaVersion: 1,
    agents: [{ name: "codex", detected: true }],
    catalogVersion: "fixture",
    sources: [],
    mcpServers: [],
  };
  return {
    ...(await original<typeof import("./state.js")>()),
    loadState: () => fixture,
    requireState: () => fixture,
    saveState: () => record("state-save"),
  };
});
vi.mock("./core/workspaces.js", async (original) => ({
  ...(await original<typeof import("./core/workspaces.js")>()),
  prepareWorkspaceAgentfile: () => record("workspace-prepare"),
}));
vi.mock("./update-skill-policy.js", () => ({
  readUpdateSkillRequests: () => [],
  resolveUpdatePolicyPath: () => "fixture/Agentfile.yaml",
}));
vi.mock("./agentfile.js", async (original) => ({
  ...(await original<typeof import("./agentfile.js")>()),
  applyAgentfile: () => {
    record("agentfile-apply");
    return { skillsToInstall: ["fixture-skill"], recommendedRequested: false };
  },
}));
vi.mock("./catalog/install.js", async (original) => ({
  ...(await original<typeof import("./catalog/install.js")>()),
  install: async () => record("install"),
}));
vi.mock("./commands/cli-install.js", async (original) => ({
  ...(await original<typeof import("./commands/cli-install.js")>()),
  applyAgentfileAndInstall: async () => record("agentfile-install"),
}));
vi.mock("./plugins/claude-native.js", () => ({ emitClaudeNative: () => record("native-publish") }));
vi.mock("./plugins/leak-audit.js", async (original) => ({
  ...(await original<typeof import("./plugins/leak-audit.js")>()),
  writeRedactPatterns: () => record("redaction-write"),
}));
vi.mock("./core/events.js", async (original) => ({
  ...(await original<typeof import("./core/events.js")>()),
  recordEvent: () => record("event-write"),
}));
vi.mock("./manifest.js", () => ({ loadManifest: () => ({}), saveManifest: () => record("manifest-save") }));
vi.mock("./lock.js", async (original) => ({
  ...(await original<typeof import("./lock.js")>()),
  readLock: () => ({ locked: [] }),
  refuseLockDrift: () => false,
}));
vi.mock("./catalog/install-other.js", async (original) => ({
  ...(await original<typeof import("./catalog/install-other.js")>()),
  refreshRecommendedCatalogRules: () => ({ refreshed: [], unchanged: 0 }),
}));
vi.mock("./sync-recommended.js", () => ({ shouldInstallRecommendedOnSync: () => false }));
vi.mock("./sync/pull-source-caches.js", () => ({
  pullReadCheckouts: async () => ({ skipped: 0, failed: false }),
}));

vi.mock("./sync/mcp-sync.js", () => ({ syncMcpServers: () => record("mcp") }));
vi.mock("./sync/rules-sync.js", () => ({ syncRules: () => record("rules") }));
vi.mock("./sync/command-sync.js", () => ({ syncCommands: () => record("commands") }));
vi.mock("./sync/agents-sync.js", () => ({ syncAgentDefs: () => record("agents") }));
vi.mock("./sync/skills-sync.js", () => ({ syncSkills: () => record("skills") }));
vi.mock("./sync/hooks-sync.js", () => ({ syncHooks: () => record("hooks") }));
vi.mock("./sync/model-sync.js", () => ({ syncModels: () => record("models") }));
vi.mock("./sync/instructions-sync.js", () => ({ syncInstructions: () => record("instructions") }));
vi.mock("./sync-runner.js", async (original) => {
  const actual = await original<typeof import("./sync-runner.js")>();
  const observeModules = async (modules: ReturnType<typeof actual.buildSyncModules>) => {
    for (const module of modules) {
      await module.fn();
    }
  };
  return { ...actual, runSyncParallel: observeModules, runSyncWithErrorCollection: observeModules };
});

import { buildProgram } from "./cli.js";
import { buildSyncModules } from "./sync-runner.js";
import { update } from "./update.js";

const captureEnabled = process.env.SYNC_SELECTION_OBSERVATION_CAPTURE === "1";

type Case = "emptyAPI" | "emptyPull" | "unknownPlain" | "selectedPlain";

beforeEach(() => {
  observed.calls.length = 0;
  observed.denied = 0;
  process.exitCode = undefined;
  vi.stubGlobal("fetch", blocked);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function receipt(id: Case | "calibration", completed: boolean) {
  return {
    id,
    outcome: completed ? "returned" : "inconclusive",
    exit: typeof process.exitCode === "number" ? process.exitCode : 0,
    calls: [...observed.calls],
    denied: observed.denied,
  };
}

it("observer calibration measures one real module binding", async () => {
  const hooks = buildSyncModules({ dryRun: true }).find((module) => module.name === "hooks");
  expect(hooks).toBeDefined();
  await hooks?.fn();
  expect(receipt("calibration", true)).toEqual({
    id: "calibration",
    outcome: "returned",
    exit: 0,
    calls: ["hooks"],
    denied: 0,
  });
});

it("observer calibration refuses child and fetch canaries", () => {
  expect(() => spawnSync("synthetic-canary")).toThrow("blocked external action");
  expect(() => fetch("http://127.0.0.1:9/")).toThrow("blocked external action");
  expect(receipt("calibration", false).denied).toBe(2);
});

it("observer calibration preserves an incomplete exit", () => {
  process.exitCode = 2;
  process.stdout.write(`SYNC_SELECTION_CAPTURE_ENABLED ${captureEnabled}\n`);
  expect(receipt("calibration", false)).toMatchObject({ outcome: "inconclusive", exit: 2, calls: [] });
});

const cases: Array<{ id: Case; cli?: string[] }> = [
  { id: "emptyAPI" },
  { id: "emptyPull", cli: ["--pull", "--only", ""] },
  { id: "unknownPlain", cli: ["--only", "fixture-invalid"] },
  { id: "selectedPlain", cli: ["--only", "hooks"] },
];

for (const { id, cli } of cases) {
  it.skipIf(!captureEnabled)(`sealed observation ${id}`, async () => {
    let completed = false;
    try {
      if (cli) {
        const program = buildProgram();
        program.exitOverride();
        program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
        await program.parseAsync(["node", "fixture", "sync", ...cli]);
      } else {
        await update({ only: "" });
      }
      completed = true;
    } finally {
      const result = receipt(id, completed);
      process.stdout.write(`SYNC_SELECTION_OBSERVATION ${JSON.stringify(result)}\n`);
    }
    expect(observed.denied).toBe(0);
  });
}
