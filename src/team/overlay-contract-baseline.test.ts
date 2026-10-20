/**
 * Baseline for the overlay plugin contract (issue #208, step 1 of 12).
 *
 * These tests pin how `team set`, the overlay catalog merge, and the lock
 * behave. The S1, S2 and S9 tests were expected-fail in step 1; step 2
 * closed those gaps and flipped them. The stale-state cases from Problem 2
 * are covered by the v2 plugin path (step 6, "one refresh path").
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
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
import { pluginCommandDirs, pluginRulesFor, pluginSkillDirs } from "../plugins/contributions.js";
import { addPlugin, pluginDir, removePlugin } from "../plugins/store.js";
import { invalidateState, loadState } from "../state.js";
import { computeRulesDiff } from "../sync/rules-sync.js";
import { getSkillSources } from "../sync/skills-sync.js";
import { runSyncParallel } from "../sync-runner.js";
import { fixtureKey, type PluginFixture, pluginFixture } from "../test-utils/plugin-fixture.js";
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

  // S1: step 2 records the overlay commit in the lock.
  it("S1: records the overlay commit in agentbrew.lock", async () => {
    const repo = makeOverlayRepo({ name: "acme" });
    cloneOrUpdateRepo.mockReturnValue(repo.dir);

    await teamSet(OVERLAY_URL);

    const lock = readLock() as { team?: { url: string; sha: string } };
    expect(lock.team).toMatchObject({ url: OVERLAY_URL, sha: repo.head });
    expect(loadState()?.team).toMatchObject({ path: repo.dir, commitSha: repo.head });
  });

  it("S1: sync refuses to deploy when the overlay checkout moved off its pin", async () => {
    const repo = makeOverlayRepo({ name: "acme" });
    cloneOrUpdateRepo.mockReturnValue(repo.dir);
    await teamSet(OVERLAY_URL);
    git(repo.dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "moved", "--allow-empty");

    await runSync("--no-recommended");

    expect(runSyncParallel).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("team unset drops the overlay pin", async () => {
    const repo = makeOverlayRepo({ name: "acme" });
    cloneOrUpdateRepo.mockReturnValue(repo.dir);
    await teamSet(OVERLAY_URL);
    const program = new Command().exitOverride();
    registerTeamCommands(program);
    await program.parseAsync(["node", "test", "team", "unset"]);

    expect(readLock().team).toBeUndefined();
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

  // S9: a broken overlay fails closed (step 2).
  it("S9: an unparseable overlay catalog is an error, not a silent skip", () => {
    setOverlayCatalog("rules: [unclosed");
    expect(() => loadCatalog()).toThrow(/overlay catalog/i);
  });

  it("S9: a missing overlay catalog file is an error, not a silent skip", () => {
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

  it("sync deploys when every locked source matches", async () => {
    seedDrift();
    const state = loadState() as AgentBrewState;
    (state.sources ?? [])[0]!.commitSha = "a".repeat(40);
    writeFileSync(join(CONFIG_DIR, "state.yaml"), yaml.dump(state));
    invalidateState();
    await runSync("--no-recommended");
    expect(runSyncParallel).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  // S2: sync runs verifyLock and fails closed (step 2).
  it("S2: sync refuses to deploy when a locked source drifted", async () => {
    seedDrift();
    await runSync("--no-recommended");
    expect(runSyncParallel).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("stale overlay state (Problem 2) — one refresh path from the locked plugin tree (step 6)", () => {
  const MANIFEST = {
    schema: 1,
    name: "acme",
    version: "1.0.0",
    capabilities: { agents: ["claude"], repos: { include: ["git.acme.example/**"] } },
    contributes: { rules: "rules/", skills: "skills/", commands: "commands/" },
  };
  const REPO = "git.acme.example/team/app";
  const KEY = fixtureKey();
  let fixture: PluginFixture;

  beforeEach(() => {
    rmSync(join(home, ".local"), { recursive: true, force: true });
    fixture = pluginFixture(MANIFEST, KEY);
    fixture.release("v1", {
      "rules/style.md": "Use short sentences.",
      "skills/greet/SKILL.md": "---\nname: greet\ndescription: greet\n---\nhi",
      "commands/hello.md": "say hello",
    });
    addPlugin(`${fixture.dir}@v1`, { yes: true, signer: KEY.pub });
  });

  /** Re-pin to a new signed tag (`plugin update` arrives in step 11). */
  function repin(tag: string, files: Record<string, string>): void {
    fixture.release(tag, files);
    removePlugin("acme");
    addPlugin(`${fixture.dir}@${tag}`, { yes: true });
  }

  it("a new overlay release reaches agents on the next sync, with no cache merge step", () => {
    repin("v2", { "rules/style.md": "Use active voice." });
    expect(pluginRulesFor("claude-code", REPO)).toContain("Use active voice.");
  });

  it("an edited rule reaches agents on sync without `install --refresh-rules`, and is never copied into shared-rules.md", () => {
    expect(pluginRulesFor("claude-code", REPO)).toContain("Use short sentences.");
    repin("v2", { "rules/style.md": "Edited rule text." });
    expect(pluginRulesFor("claude-code", REPO)).toContain("Edited rule text.");
    expect(pluginRulesFor("claude-code", REPO)).not.toContain("Use short sentences.");
    expect(existsSync(join(CONFIG_DIR, "shared-rules.md"))).toBe(false);
  });

  it("a rule the overlay adds later reaches agents with no recommended gate", () => {
    repin("v2", { "rules/new.md": "Brand new rule." });
    expect(pluginRulesFor("claude-code", REPO)).toContain("Brand new rule.");
  });

  it("the team rules block does not depend on the directory sync runs in", () => {
    const before = pluginRulesFor("claude-code", REPO);
    const cwd = process.cwd();
    try {
      process.chdir(mkdtempSync(join(tmpdir(), "elsewhere-")));
      expect(pluginRulesFor("claude-code", REPO)).toBe(before);
    } finally {
      process.chdir(cwd);
    }
  });

  it("skill dirs come from the lock, so removing the plugin leaves no orphan skill source", () => {
    expect(pluginSkillDirs().map((d) => d.path)).toEqual([join(pluginDir("acme"), "skills")]);
    removePlugin("acme");
    expect(pluginSkillDirs()).toEqual([]);
    expect(loadState()?.skillSourceDirs ?? []).toEqual([]);
  });

  it("plugin commands are linked by agentbrew and vanish with the plugin", () => {
    expect(pluginCommandDirs()).toEqual([join(pluginDir("acme"), "commands")]);
    removePlugin("acme");
    expect(pluginCommandDirs()).toEqual([]);
  });

  it("a drifted plugin contributes nothing", () => {
    writeFileSync(join(pluginDir("acme"), "rules", "style.md"), "tampered");
    expect(pluginRulesFor("claude-code", REPO)).toBe("");
    expect(pluginSkillDirs()).toEqual([]);
  });

  it("sync wiring: skills sync scans plugin skills; global rules files never get plugin rules", () => {
    expect(getSkillSources().map((src) => src.path)).toContain(join(pluginDir("acme"), "skills"));
    const [claude] = computeRulesDiff(
      "shared",
      [{ agentName: "claude-code", existingContent: "" }],
      new Map([["claude-code", "delegated"]]),
    );
    expect(claude?.newContent ?? "").not.toContain("Use short sentences.");
  });

  it("rules apply only in included repos; public hosts and unknown repos get nothing", () => {
    expect(pluginRulesFor("claude-code", "git.acme.example/team/app")).toContain("Use short sentences.");
    for (const repo of ["github.com/acme/app", "gitlab.com/acme/app", "other.example/x", undefined]) {
      expect(pluginRulesFor("claude-code", repo)).toBe("");
    }
  });

  it("rules reach only declared agents", () => {
    expect(pluginRulesFor("codex", REPO)).toBe("");
  });
});
