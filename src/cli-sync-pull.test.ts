import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// state.ts resolves its path from HOME at import time, so HOME must point at a
// tmpdir before any module loads. The real ~/.config/agentbrew is never touched.
const { home, previousHome } = vi.hoisted(() => {
  const { mkdtempSync: mk } = require("node:fs") as typeof import("node:fs");
  const { tmpdir: td } = require("node:os") as typeof import("node:os");
  const { join: j } = require("node:path") as typeof import("node:path");
  const previous = process.env.HOME;
  const dir = mk(j(td(), "sync-pull-home-"));
  process.env.HOME = dir;
  return { home: dir, previousHome: previous };
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
vi.mock("./update.js", () => ({ update: vi.fn() }));
vi.mock("./catalog/install.js", () => ({ install: vi.fn() }));

import { install as catalogInstall } from "./catalog/install.js";
import { buildProgram } from "./cli.js";
import { invalidateState, loadState } from "./state.js";
import type { Source } from "./types.js";
import { update } from "./update.js";

const mockUpdate = vi.mocked(update);
const mockCatalogInstall = vi.mocked(catalogInstall);

const STALE_URL = "your-org/example-repo";
const FIXED_URL = "git@github.example.com:your-org/example-repo.git";

function seedHome(): void {
  const configDir = join(home, ".config", "agentbrew");
  mkdirSync(configDir, { recursive: true });
  const stale: Source = {
    url: STALE_URL,
    type: "github",
    skillsInstalled: [],
    availableItems: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    origin: "agentfile",
  };
  writeFileSync(join(configDir, "state.yaml"), yaml.dump({ agents: [], mcpServers: [], sources: [stale] }));
  writeFileSync(join(configDir, "Agentfile.yaml"), yaml.dump({ sources: [FIXED_URL] }));
}

/** Fixture URLs in state right now. State load may add unrelated default sources. */
function seenFixtureUrls(): string[] {
  const fixtureUrls = new Set([STALE_URL, FIXED_URL]);
  return (loadState()?.sources ?? []).map((s) => s.url).filter((url) => fixtureUrls.has(url));
}

function runSync(...flags: string[]): Promise<unknown> {
  const program = buildProgram();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  return program.parseAsync(["node", "test", "sync", ...flags]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  rmSync(join(home, ".config"), { recursive: true, force: true });
  invalidateState();
  seedHome();
});

afterAll(() => {
  process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("sync --pull applies the global Agentfile before pulling", () => {
  it("pulls from the corrected source URL and prunes the stale entry in one run", async () => {
    let urlsSeenByPull: string[] = [];
    mockUpdate.mockImplementation(async () => {
      invalidateState();
      urlsSeenByPull = seenFixtureUrls();
    });

    await runSync("--pull");

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(urlsSeenByPull).toEqual([FIXED_URL]);
  });

  it("keeps the stale entry but still adds the corrected one with --no-prune", async () => {
    let urlsSeenByPull: string[] = [];
    mockUpdate.mockImplementation(async () => {
      invalidateState();
      urlsSeenByPull = seenFixtureUrls();
    });

    await runSync("--pull", "--no-prune");

    expect(urlsSeenByPull).toEqual([STALE_URL, FIXED_URL]);
  });

  it("does not write state when --dry-run is set", async () => {
    let urlsSeenByPull: string[] = [];
    mockUpdate.mockImplementation(async () => {
      invalidateState();
      urlsSeenByPull = seenFixtureUrls();
    });

    await runSync("--pull", "--dry-run");

    expect(urlsSeenByPull).toEqual([STALE_URL]);
  });
});

describe("sync --pull dry-run", () => {
  it("tells update() to dry-run so nothing is fetched or written", async () => {
    await runSync("--pull", "--dry-run");

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ dryRun: true });
  });

  it("does not pass dry-run to update() on a real pull", async () => {
    await runSync("--pull");

    expect(mockUpdate).toHaveBeenCalledWith({ dryRun: false });
  });
});

describe("sync --pull installs Agentfile-requested skills in the same run", () => {
  function writeAgentfile(content: object): void {
    writeFileSync(join(home, ".config", "agentbrew", "Agentfile.yaml"), yaml.dump(content));
  }

  it("installs requested skills before the pull deploys, so their pruned sources return", async () => {
    writeAgentfile({ sources: [FIXED_URL], skills: ["task-command-center"] });
    const order: string[] = [];
    mockUpdate.mockImplementation(async () => {
      order.push("pull");
    });
    mockCatalogInstall.mockImplementation(async () => {
      order.push("install");
    });

    await runSync("--pull");

    expect(order).toEqual(["install", "pull"]);
    expect(mockCatalogInstall).toHaveBeenCalledWith("task-command-center", { skillOnly: true });
  });

  it("re-adds a catalog skill source the Agentfile sources list omits (regression: pull removed skills)", async () => {
    writeAgentfile({ sources: [FIXED_URL], skills: ["task-command-center"] });
    const catalogUrl = "fyodoriv/agentbrew";
    mockCatalogInstall.mockImplementation(async () => {
      const { saveState } = await import("./state.js");
      const state = loadState();
      if (state) {
        state.sources = [
          ...(state.sources ?? []),
          {
            url: catalogUrl,
            type: "github",
            skillsInstalled: ["task-command-center"],
            availableItems: [],
            addedAt: "2026-01-01T00:00:00.000Z",
            origin: "user",
          },
        ];
        saveState(state);
        invalidateState();
      }
    });
    let sourcesAtPull: string[] = [];
    mockUpdate.mockImplementation(async () => {
      invalidateState();
      sourcesAtPull = (loadState()?.sources ?? []).map((s) => s.url);
    });

    await runSync("--pull");

    expect(sourcesAtPull).toContain(catalogUrl);
  });

  it("installs nothing with --dry-run", async () => {
    writeAgentfile({ sources: [FIXED_URL], skills: ["task-command-center"] });

    await runSync("--pull", "--dry-run");

    expect(mockCatalogInstall).not.toHaveBeenCalled();
  });
});
