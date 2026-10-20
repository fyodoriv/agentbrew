/**
 * Baseline for the overlay plugin contract (issue #208, step 1 of 12).
 *
 * These tests pin how `team set`, the overlay catalog merge, and the lock
 * behave today. Tests marked `it.fails` prove an open security gap (S1, S2,
 * S9). They pass while the gap exists. Step 2 closes the gaps and flips them
 * to plain `it`. The `it.todo` entries name the stale-state cases from
 * Problem 2; step 6 ("one refresh path") turns them into real tests.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import yaml from "js-yaml";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// state.ts and lock.ts resolve their paths from HOME at import time.
const { home, previousHome } = vi.hoisted(() => {
  const { mkdtempSync: mk } = require("node:fs") as typeof import("node:fs");
  const { tmpdir: td } = require("node:os") as typeof import("node:os");
  const { join: j } = require("node:path") as typeof import("node:path");
  const previous = process.env.HOME;
  const dir = mk(j(td(), "overlay-baseline-home-"));
  process.env.HOME = dir;
  return { home: dir, previousHome: previous };
});

const { cloneOrUpdateRepo } = vi.hoisted(() => ({ cloneOrUpdateRepo: vi.fn() }));
vi.mock("../mcp/mcp-git.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mcp/mcp-git.js")>()),
  cloneOrUpdateRepo,
}));
vi.mock("../sync-runner.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync-runner.js")>()),
  buildSyncModules: vi.fn(() => []),
  runSyncParallel: vi.fn(async () => {}),
  runSyncWithErrorCollection: vi.fn(async () => {}),
}));
vi.mock("../sync-recommended.js", () => ({ shouldInstallRecommendedOnSync: () => false }));

import { loadCatalog } from "../catalog/types.js";
import { buildProgram } from "../cli.js";
import { readLock, writeLock } from "../lock.js";
import { invalidateState, loadState } from "../state.js";
import { runSyncParallel } from "../sync-runner.js";
import type { AgentBrewState } from "../types.js";
import { mergeTeamAgentfile, registerTeamCommands } from "./commands/cli-team.js";

const CONFIG_DIR = join(home, ".config", "agentbrew");
const OVERLAY_URL = "git@github.example.com:acme/agentbrew-acme.git";
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf-8", stdio: "pipe" }).trim();
}

/** A committed overlay checkout that `cloneOrUpdateRepo` returns. */
function makeOverlayRepo(agentfile: Record<string, unknown>): { dir: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), "overlay-baseline-repo-"));
  writeFileSync(join(dir, "Agentfile.yaml"), yaml.dump(agentfile));
  git(dir, "init", "-q");
  git(dir, "add", ".");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init");
  return { dir, head: git(dir, "rev-parse", "HEAD") };
}

function seedState(extra: Partial<AgentBrewState> = {}): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const state: AgentBrewState = {
    agents: [{ name: "claude", configDir: join(home, ".claude"), skillsDir: join(home, ".claude", "skills") }],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
    ...extra,
  } as AgentBrewState;
  writeFileSync(join(CONFIG_DIR, "state.yaml"), yaml.dump(state));
  invalidateState();
}

async function teamSet(url: string): Promise<void> {
  const program = new Command().exitOverride();
  registerTeamCommands(program);
  await program.parseAsync(["node", "test", "team", "set", url]);
}

async function runSync(...flags: string[]): Promise<void> {
  const program = buildProgram();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  await program.parseAsync(["node", "test", "sync", ...flags]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  rmSync(join(home, ".config"), { recursive: true, force: true });
  process.exitCode = undefined;
  seedState();
});

afterAll(() => {
  process.exitCode = undefined;
  process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("team set — today's behavior", () => {
  it("clones the overlay with no ref, so it tracks a floating branch", async () => {
    const repo = makeOverlayRepo({ name: "acme" });
    cloneOrUpdateRepo.mockReturnValue(repo.dir);

    await teamSet(OVERLAY_URL);

    expect(cloneOrUpdateRepo).toHaveBeenCalledWith(OVERLAY_URL, "agentbrew-acme");
    expect(loadState()?.team?.label).toBe("acme");
  });

  it("merges only `sources:`; rules, mcp, hooks and detect keys do not reach state", () => {
    const state: AgentBrewState = { agents: [], sources: [], catalogVersion: "0.1.0" };
    const before = JSON.stringify(state);
    mergeTeamAgentfile(
      state,
      { rules: ["acme-rule"], mcp: [{ name: "acme-jira" }], hooks: ["acme-hook"], detect: "./detect.sh" },
      "acme",
      "2026-10-20T00:00:00.000Z",
      "/teams/acme",
    );
    expect(JSON.stringify(state)).toBe(before);
  });

  // S1: no pin. Step 2 records the overlay commit in the lock.
  it.fails("S1: records the overlay commit in agentbrew.lock", async () => {
    const repo = makeOverlayRepo({ name: "acme" });
    cloneOrUpdateRepo.mockReturnValue(repo.dir);

    await teamSet(OVERLAY_URL);

    const lock = readLock() as { team?: { url: string; sha: string } };
    expect(lock.team).toMatchObject({ url: OVERLAY_URL, sha: repo.head });
  });
});

describe("overlay catalog merge — today's behavior", () => {
  function setOverlayCatalog(content: string | undefined): string {
    const path = join(home, "catalog-overlay.yaml");
    if (content !== undefined) writeFileSync(path, content);
    seedState({
      team: { label: "acme", url: OVERLAY_URL, cachedAt: "x", lastSyncedAt: "x", catalogOverlayPath: path },
    });
    return path;
  }

  it("overlay entries replace same-name base entries and append new ones", () => {
    const base = loadCatalog({ includeTeamOverlay: false });
    const first = base.rules[0];
    setOverlayCatalog(
      yaml.dump({
        rules: [
          { ...first, description: "overlay wins" },
          { name: "acme-only-rule", description: "added", source: "acme/rules" },
        ],
      }),
    );

    const merged = loadCatalog();

    expect(merged.rules.find((r) => r.name === first?.name)?.description).toBe("overlay wins");
    expect(merged.rules.some((r) => r.name === "acme-only-rule")).toBe(true);
    expect(merged.rules).toHaveLength(base.rules.length + 1);
  });

  // S9: a broken overlay looks like "no overlay". Step 2 fails closed.
  it.fails("S9: an unparseable overlay catalog is an error, not a silent skip", () => {
    setOverlayCatalog("rules: [unclosed");
    expect(() => loadCatalog()).toThrow(/overlay catalog/i);
  });

  it.fails("S9: a missing overlay catalog file is an error, not a silent skip", () => {
    setOverlayCatalog(undefined);
    expect(() => loadCatalog()).toThrow(/overlay catalog/i);
  });
});

describe("lock — today's behavior", () => {
  const SOURCE = "acme/skills";

  function seedDrift(): void {
    seedState({
      sources: [
        {
          url: SOURCE,
          type: "github",
          skillsInstalled: ["one"],
          availableItems: [],
          addedAt: "x",
          commitSha: "b".repeat(40),
        },
      ],
    });
    writeLock({ locked: [{ source: SOURCE, type: "github", sha: "a".repeat(40), skills: ["one"], lockedAt: "x" }] });
  }

  it("sync deploys even when a locked source drifted (the lock is advisory)", async () => {
    seedDrift();
    await runSync("--no-recommended");
    expect(runSyncParallel).toHaveBeenCalledTimes(1);
  });

  // S2: verifyLock never runs on sync. Step 2 makes sync fail closed.
  it.fails("S2: sync refuses to deploy when a locked source drifted", async () => {
    seedDrift();
    await runSync("--no-recommended");
    expect(runSyncParallel).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("stale overlay state (Problem 2) — fixed by step 6", () => {
  it.todo("overlay source cache left behind the overlay default branch after `sync --pull` is refreshed by sync");
  it.todo("an edited catalog rule in the overlay reaches agents on `sync` without `install --refresh-rules`");
  it.todo("a catalog rule the overlay adds later reaches agents under `sync --no-recommended`");
  it.todo("the team rules block does not depend on the directory `sync` runs in");
  it.todo("`skillSourceDirs` entries no tracked source owns are dropped on sync");
  it.todo("repo-owned commands are linked by agentbrew, not a separate tool");
  it("baseline: state is readable after seeding", () => {
    // Keeps the describe block executable while every case above is a todo.
    expect(loadState()?.agents).toHaveLength(1);
  });
});
