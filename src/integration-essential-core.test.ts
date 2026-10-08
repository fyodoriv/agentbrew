import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Essential-core regression net (parent task: harden-essential-core-integration-tests).
 *
 * VISION.md § "The essential core" enumerates 8 non-negotiable capabilities.
 * A simplification PR that breaks any of them is wrong by definition. This
 * file holds one named `describe("essential core: <cap> (<US>)", ...)` block
 * per capability. The file grows by 2 blocks per sub-task PR (per AGENTS.md
 * "decompose into 2-4 sub-tasks"); when all 4 sub-tasks land, the file has
 * 8 named describe blocks (one per capability).
 *
 * Layered against the per-file carve-out lock-down (mcp-sync / skills-sync /
 * rules-sync) that fires on adapter-shape regressions: this file fires when
 * the END-TO-END user-story flow regresses.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks that must be hoisted ──────────────────────────────────────────────

const ctx = vi.hoisted(() => ({
  home: `/tmp/agentbrew-essential-core-${Date.now()}-${Math.random().toString(36).slice(2)}`,
}));
const TEST_HOME = ctx.home;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => ctx.home, tmpdir: actual.tmpdir };
});

// Block npx + claude subprocess calls so detection / sync don't try to
// reach upstream tooling that the test environment doesn't have.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn((cmd: string, ...rest: unknown[]) => {
      if (cmd === "claude" || cmd === "npx" || cmd === "mcpm") {
        return {
          status: 0,
          stdout: Buffer.from(""),
          stderr: Buffer.from(""),
          error: null,
          pid: 0,
          signal: null,
          output: [],
        };
      }
      return actual.spawnSync(cmd, ...(rest as [object]));
    }),
    execFileSync: vi.fn((cmd: string, ...rest: unknown[]) => {
      if (cmd === "npx") {
        const error = new Error("npx not available in test") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return actual.execFileSync(cmd, ...(rest as [object]));
    }),
  };
});

// Prevent the catalog → mcpm bridge from reaching real subprocesses.
vi.mock("./sync/mcp-delegate.js", () => ({
  delegateMcpInstall: vi.fn(() => ({ ok: false, carveOuts: [] })),
  delegateMcpClientEdit: vi.fn(() => ({ ok: false, carveOuts: [], perClient: [] })),
  delegateMcpUninstall: vi.fn(() => ({
    ok: false,
    carveOuts: [],
    perClient: [],
    globalUninstall: { ok: false },
  })),
  delegateMcpNew: vi.fn(() => ({ ok: false })),
  readMcpmServer: vi.fn(() => undefined),
  listMcpmServerNames: vi.fn(() => new Set<string>()),
  mcpServerConfigEquals: vi.fn(() => true),
}));

// Block the rules ai-rules delegation so syncRules exercises the native
// shared-rules path the carve-outs rely on.
vi.mock("./sync/rules-delegate.js", () => ({
  delegateRulesGenerate: vi.fn(() => new Map()),
}));

// Prevent network calls for source fetching.
vi.mock("./fetch-sources.js", () => ({
  fetchSources: vi.fn(async () => []),
  isCacheFresh: vi.fn(() => true),
}));

vi.mock("./catalog/index-source.js", () => ({
  indexSource: vi.fn(() => []),
  indexAllSources: vi.fn(async () => {}),
  getSourceCachePath: vi.fn(() => undefined),
  isSourceFailed: vi.fn(() => false),
  classifyGitError: vi.fn(() => ""),
  formatItemCounts: vi.fn(() => ""),
  resetSessionCache: vi.fn(),
}));

vi.mock("./core/env-sanitize.js", () => ({
  checkEnvHygiene: vi.fn(() => []),
}));

vi.mock("./mcp/heal-cycle.js", () => ({
  runMcpHealCycle: vi.fn(async () => ({ initial: [], final: [], attempts: [] })),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import { addSource } from "./add-source.js";
import { applyAgentfile } from "./agentfile.js";
import { detectAgents } from "./agents.js";
import { indexSource } from "./catalog/index-source.js";
import { loadCatalog } from "./catalog/types.js";
import { resetStateManager } from "./core/state-manager.js";
import { collectDrift } from "./drift.js";
import { healthCheck } from "./health.js";
import { readMcpJson } from "./mcp/mcp.js";
import { rollbackAgentConfigs, snapshotAgentConfigs } from "./ops.js";
import { fix as fixDrift } from "./repair.js";
import { defaultState, getStatePath, loadState, saveState } from "./state.js";
import { addMcpServer, syncMcpServers } from "./sync/mcp-sync.js";
import { loadSharedRules, saveSharedRules, syncRules } from "./sync/rules-sync.js";

// ── Setup / teardown ────────────────────────────────────────────────────────

/** Agent parent dirs we create in TEST_HOME so detectAgents() picks them up.
 *  kiro is the canonical MCP carve-out — its mcp config is exercised by the
 *  cross-agent sync block. cursor + augment are kept so detection asserts
 *  multi-agent presence (cursor is intersection-skip for MCP but still detected). */
const AGENT_DIRS = [".cursor", ".augment", ".kiro"];

const MCP_CONFIGS: Record<string, string> = {
  ".kiro/settings/mcp.json": JSON.stringify({ mcpServers: {} }, null, 2),
};

function setupAgentDirs(): void {
  for (const dir of AGENT_DIRS) {
    mkdirSync(join(TEST_HOME, dir, "skills"), { recursive: true });
  }
  for (const [path, content] of Object.entries(MCP_CONFIGS)) {
    const full = join(TEST_HOME, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  // Seed shared rules so syncRules has content to deploy.
  mkdirSync(join(TEST_HOME, ".config", "agentbrew"), { recursive: true });
  saveSharedRules("# Essential core test rules\nUse conventional commits.\n");
}

function cleanState(): void {
  resetStateManager();
  const stateFile = getStatePath();
  if (existsSync(stateFile)) rmSync(stateFile);
  rmSync(join(TEST_HOME, ".claude"), { recursive: true, force: true });
  rmSync(join(TEST_HOME, ".augment", "guidelines.md"), { force: true });
  // Reset MCP configs to empty between tests.
  for (const [path, content] of Object.entries(MCP_CONFIGS)) {
    writeFileSync(join(TEST_HOME, path), content);
  }
}

function makeStateWithDetectedAgents() {
  const agents = detectAgents().map(({ commandTransform: _ct, ...rest }) => rest);
  return {
    ...defaultState(),
    agents,
  };
}

beforeEach(() => {
  setupAgentDirs();
  cleanState();
  process.env.AGENTBREW_DIR = TEST_HOME;
});

afterAll(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

// ── Capability 1: agent detection (US 01, US 15) ────────────────────────────

describe("essential core: agent detection (US 01, US 15)", () => {
  // VISION.md "Agent detection — walk the machine, find every installed AI
  // coding agent and where each stores config." This block fires when that
  // walk regresses (e.g. parent-dir check is inverted, AGENT_DEFINITIONS is
  // pruned past the documented set, or the detected boolean stops updating).
  it("detects agents whose parent skill directory exists in $HOME", () => {
    const agents = detectAgents();
    const detected = agents.filter((a) => a.detected).map((a) => a.name);

    // We created .cursor, .augment, .kiro parent dirs.
    expect(detected).toContain("cursor");
    expect(detected).toContain("augment");
    expect(detected).toContain("kiro");
  });

  it("returns detected: false for agents whose parent dir is absent", () => {
    const agents = detectAgents();
    // We did NOT create ~/.claude (claude-code's parent), so it must report
    // detected: false. Negative invariant — protects against detection logic
    // flipping to "always true" or "default to true".
    const claudeCode = agents.find((a) => a.name === "claude-code");
    expect(claudeCode?.detected).toBe(false);
  });

  it("preserves the documented agent identity (name + skillsDir + mcpConfig) on every detection", () => {
    // Pin the carve-out's identity per src/core/agents.yaml so a future
    // refactor can't silently rewire kiro's skillsDir or drop its mcpConfig
    // without breaking this assertion. Detection is the foundation every
    // other essential capability sits on top of.
    const agents = detectAgents();
    const kiro = agents.find((a) => a.name === "kiro");
    expect(kiro).toBeDefined();
    expect(kiro?.skillsDir).toContain(".kiro/skills");
    expect(kiro?.mcpConfig).toContain(".kiro/settings/mcp.json");
  });
});

// ── Capability 2: cross-agent sync (US 02–06, US 20) ────────────────────────

describe("essential core: cross-agent sync (US 02–06, US 20)", () => {
  // VISION.md "Cross-agent sync — one source of truth translated into every
  // agent's native format (JSON / TOML / YAML / symlinks / markdown-with-
  // transforms)." This block fires when adding to state stops propagating
  // to agent config files end-to-end.
  it("addMcpServer + syncMcpServers writes the server entry into the carve-out's mcp config", async () => {
    saveState(makeStateWithDetectedAgents());

    // Add via the public addMcpServer API — same path the user hits via
    // `agentbrew install <name>` for stdio MCP servers.
    await addMcpServer("essential-test", "npx", ["-y", "@test/essential"], { TOKEN: "abc" });

    // syncMcpServers is called transitively by addMcpServer; re-run for
    // belt-and-suspenders idempotency. The kiro carve-out gets the server.
    await syncMcpServers();

    const kiroConfig = readMcpJson(join(TEST_HOME, ".kiro", "settings", "mcp.json"));
    const servers = kiroConfig.mcpServers as Record<string, unknown> | undefined;
    expect(servers?.["essential-test"]).toBeDefined();
  });

  it("syncRules deploys the shared rules content to a carve-out's rulesFile", async () => {
    // Seed augment's parent dir so detection picks it up + write a managed
    // section placeholder so syncRules treats it as an existing target.
    mkdirSync(join(TEST_HOME, ".augment"), { recursive: true });
    writeFileSync(
      join(TEST_HOME, ".augment", "guidelines.md"),
      "<!-- agentbrew:start -->\nold\n<!-- agentbrew:end -->\n",
    );

    saveState(makeStateWithDetectedAgents());

    await syncRules();

    // Read the augment file and confirm the managed section now contains the
    // shared-rules content (carve-out invariant: native shared-rules path
    // is exercised; delegated agents would pick up `delegateRulesGenerate`
    // payload but the mock returns an empty Map here).
    const augmentRules = (await import("node:fs")).readFileSync(join(TEST_HOME, ".augment", "guidelines.md"), "utf-8");
    expect(augmentRules).toContain("Use conventional commits");
    expect(augmentRules).not.toContain("\nold\n");
  });
});

// ── Capability 3: declarative Agentfile (US 16, US 23) ──────────────────────

describe("essential core: declarative Agentfile (US 16, US 23)", () => {
  // VISION.md "Declarative Agentfile — one declarative manifest per project,
  // one apply step." This block fires when applyAgentfile stops translating
  // the on-disk YAML into state mutations end-to-end.
  it("applyAgentfile with mcp + rules merges them into state and writes shared-rules.md", () => {
    saveState(makeStateWithDetectedAgents());
    const projectDir = join(TEST_HOME, "essential-core-project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "Agentfile.yaml"),
      [
        "mcp:",
        "  - name: project-srv",
        "    command: node",
        "    args: ['srv.js']",
        "rules: |",
        "  ## Essential core rules",
        "  - Apply Agentfile is the one apply step.",
      ].join("\n"),
    );

    const result = applyAgentfile(projectDir, { quiet: true });

    expect(result).toBeDefined();
    expect(result?.serversAdded).toContain("project-srv");
    expect(result?.rulesUpdated).toBe(true);

    // State now carries the project server alongside any pre-existing
    // user servers — additive merge per US 16 contract.
    const state = loadState();
    const names = (state?.mcpServers ?? []).map((s) => s.name);
    expect(names).toContain("project-srv");

    // Shared-rules.md picked up the rules block — downstream syncRules
    // would fan this out to every carve-out's rulesFile.
    const rules = loadSharedRules();
    expect(rules).toContain("Essential core rules");
    expect(rules).toContain("Apply Agentfile is the one apply step.");
  });

  it("applyAgentfile is idempotent — second apply produces no duplicates", () => {
    saveState(makeStateWithDetectedAgents());
    const projectDir = join(TEST_HOME, "essential-core-project-idempotent");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "Agentfile.yaml"),
      ["mcp:", "  - name: idempotent-srv", "    command: node", "    args: ['srv.js']"].join("\n"),
    );

    applyAgentfile(projectDir, { quiet: true });
    const result2 = applyAgentfile(projectDir, { quiet: true });

    // Second apply: server is already in state → not re-added.
    expect(result2?.serversAdded).not.toContain("idempotent-srv");

    const state = loadState();
    const matches = (state?.mcpServers ?? []).filter((s) => s.name === "idempotent-srv");
    expect(matches).toHaveLength(1);
  });
});

// ── Capability 4: install from anywhere (US 02, US 03, US 07) ───────────────

describe("essential core: install from anywhere (US 02, US 03, US 07)", () => {
  // VISION.md "Install from anywhere — local path, GitHub URL, or a curated
  // catalog entry; one CLI verb works for all three." This block fires when
  // any of the three input shapes stops registering as a source.
  it("addSource with a local skill directory registers it in state.sources", async () => {
    saveState(makeStateWithDetectedAgents());

    const localSkillDir = join(TEST_HOME, "local-skill-source");
    mkdirSync(join(localSkillDir, "demo-skill"), { recursive: true });
    writeFileSync(
      join(localSkillDir, "demo-skill", "SKILL.md"),
      "---\nname: demo-skill\ndescription: Demo skill\n---\n# Demo\n",
    );

    vi.mocked(indexSource).mockReturnValueOnce([{ name: "demo-skill", description: "Demo skill", type: "skill" }]);

    await addSource(localSkillDir, {});

    const state = loadState();
    const registered = (state?.sources ?? []).find((s) => s.url === localSkillDir);
    expect(registered).toBeDefined();
    expect(registered?.type).toBe("local");
  });

  it("addSource with a GitHub-style repo path indexes the skills/ subdirectory", async () => {
    saveState(makeStateWithDetectedAgents());

    const ghStyleDir = join(TEST_HOME, "gh-style-essential-source");
    mkdirSync(join(ghStyleDir, "skills", "github-skill"), { recursive: true });
    writeFileSync(
      join(ghStyleDir, "skills", "github-skill", "SKILL.md"),
      "---\nname: github-skill\ndescription: GitHub-style skill\n---\n# GH\n",
    );

    vi.mocked(indexSource).mockReturnValueOnce([
      { name: "github-skill", description: "GitHub-style skill", type: "skill" },
    ]);

    await addSource(ghStyleDir, {});

    const state = loadState();
    const src = (state?.sources ?? []).find((s) => s.url === ghStyleDir);
    expect(src).toBeDefined();
    expect(src?.availableItems).toHaveLength(1);
    expect(src?.availableItems[0].name).toBe("github-skill");
  });
});

// ── Capability 5: curated catalog (US 24, US 14) ────────────────────────────

describe("essential core: curated catalog (US 24, US 14)", () => {
  // VISION.md "Curated catalog — agentbrew ships with a recommended set so a
  // fresh laptop bootstraps with one command (`agentbrew install --recommended`)
  // and the catalog stays curated, not exhaustive." This block fires when the
  // `recommended: true` filter regresses (e.g. catalog.yaml entries lose the
  // flag, the loader stops parsing it, or the install path stops honoring it).
  it("loadCatalog returns a non-empty recommended subset across each item kind", () => {
    const catalog = loadCatalog();

    // Recommended set is the discovery surface for the "fresh laptop" flow.
    // We don't pin to an exact count — that churns when the curator adds
    // items — but the bottom-line invariant is that every kind has at least
    // one recommended entry. If the count goes to zero on any kind, the
    // curator either dropped the kind on purpose (update this test) or the
    // catalog parser dropped the recommended flag silently (the bug we're
    // catching).
    const recommendedSkills = catalog.skills.filter((s) => s.recommended);
    const recommendedMcp = catalog.mcp_servers.filter((m) => m.recommended);
    expect(recommendedSkills.length, "expected at least 1 recommended skill in catalog.yaml").toBeGreaterThanOrEqual(1);
    expect(recommendedMcp.length, "expected at least 1 recommended MCP server in catalog.yaml").toBeGreaterThanOrEqual(
      1,
    );

    // The recommended set as a whole is non-trivial — guards against a
    // future regression that flips one or two flags but leaves the rest
    // un-flagged. Today catalog.yaml has 39 items with `recommended: true`;
    // 5 is a generous floor that survives modest curation.
    const total =
      recommendedSkills.length +
      recommendedMcp.length +
      catalog.rules.filter((r) => r.recommended).length +
      (catalog.cli_tools ?? []).filter((t) => t.recommended).length;
    expect(total).toBeGreaterThanOrEqual(5);
  });

  it("every recommended item carries a non-empty name and description", () => {
    // Pin the discoverability invariant: a recommended skill that surfaces
    // in `agentbrew catalog --search` with empty fields silently degrades
    // user trust. The catalog loader's job is to refuse those.
    const catalog = loadCatalog();
    const allRecommended = [
      ...catalog.skills.filter((s) => s.recommended),
      ...catalog.mcp_servers.filter((m) => m.recommended),
      ...catalog.rules.filter((r) => r.recommended),
      ...(catalog.cli_tools ?? []).filter((t) => t.recommended),
    ];
    for (const item of allRecommended) {
      expect(item.name, `recommended item missing name`).toBeTruthy();
      expect(item.description, `recommended item ${item.name} missing description`).toBeTruthy();
    }
  });

  it("storybook-screenshot catalog entry has a source command file", () => {
    const catalog = loadCatalog();
    const tool = (catalog.cli_tools ?? []).find((entry) => entry.name === "storybook-screenshot");

    expect(tool, "storybook-screenshot missing from cli_tools catalog").toBeDefined();
    expect(tool?.commands).toEqual(["storybook-screenshot"]);
    expect(
      readFileSync(join(import.meta.dirname, "cli-commands/storybook-screenshot/storybook-screenshot.md"), "utf-8"),
    ).toContain("storybook-screenshot --all --out-dir .tmp/screenshots");
  });
});

// ── Capability 6: drift detection + auto-repair (US 06) ─────────────────────

describe("essential core: drift detection + auto-repair (US 06)", () => {
  // VISION.md "Drift detection + auto-repair — the moat. A 30-min background
  // scheduler re-runs sync; manual edits or agent updates that break a
  // deployed config get auto-repaired without the user noticing." This block
  // fires when collectDrift() stops noticing a regression OR when fix()
  // stops closing the gap end-to-end.
  it("collectDrift reports drift when a deployed agent config is mutated out from under sync", async () => {
    saveState(makeStateWithDetectedAgents());

    // Plant a server in state and sync it — the kiro carve-out is now in
    // a known-clean state with `drift-test` deployed.
    await addMcpServer("drift-test", "node", ["srv.js"], {});
    await syncMcpServers();

    const driftBefore = collectDrift();

    // Simulate the failure mode VISION.md calls out: a manual edit (or an
    // agent update) wipes the deployed entry. The deployed config is now
    // an empty mcpServers map even though state still tracks `drift-test`.
    const kiroPath = join(TEST_HOME, ".kiro", "settings", "mcp.json");
    writeFileSync(kiroPath, JSON.stringify({ mcpServers: {} }, null, 2));

    const driftAfter = collectDrift();

    // The mutation introduced a fresh drift item — the assertion isn't on
    // the absolute count (other carve-outs may report unrelated drift in
    // the test environment) but on the delta. If the delta is zero, the
    // detector failed to notice the file change.
    expect(driftAfter.length, "collectDrift should report new drift after the mutation").toBeGreaterThan(
      driftBefore.length,
    );
  });

  it("fix() restores the deployed config to match state — drift count drops back to baseline", async () => {
    saveState(makeStateWithDetectedAgents());

    await addMcpServer("repair-test", "node", ["srv.js"], {});
    await syncMcpServers();
    const driftClean = collectDrift();

    // Mutate again — this is the exact scenario the 30-min scheduler is
    // designed to catch and silently repair.
    const kiroPath = join(TEST_HOME, ".kiro", "settings", "mcp.json");
    writeFileSync(kiroPath, JSON.stringify({ mcpServers: {} }, null, 2));
    expect(collectDrift().length).toBeGreaterThan(driftClean.length);

    // Run the auto-repair path. After this, the deployed config should
    // again carry `repair-test` and the drift count should fall back to
    // the pre-mutation baseline.
    await fixDrift();

    const driftFinal = collectDrift();
    expect(driftFinal.length, "fix() should drive drift back to the pre-mutation baseline").toBeLessThanOrEqual(
      driftClean.length,
    );

    // Belt-and-suspenders: confirm the config file actually contains the
    // repaired server. If `fix()` exits 0 but doesn't write, the drift
    // count assertion alone could be satisfied by an empty drift checker.
    const repaired = readMcpJson(kiroPath);
    const servers = repaired.mcpServers as Record<string, unknown> | undefined;
    expect(servers?.["repair-test"], "fix() should redeploy the server entry to the carve-out config").toBeDefined();
  }, 15_000);
});

// ── Capability 7: never destroy user data (US 10, US 12, US 26) ─────────────

describe("essential core: never destroy user data (US 10, US 12, US 26)", () => {
  // VISION.md "Never destroy user data — manual edits, user-added MCP servers,
  // and custom rules survive every sync, update, and auto-repair." This block
  // fires when the boundary between user-added and agentbrew-managed entries
  // erodes (server origin tag drifts, prune logic widens its blast radius,
  // or rollback stops finding the snapshot it just wrote).
  it("addMcpServer marks new entries with source: 'user' so prune logic can preserve them", async () => {
    saveState(makeStateWithDetectedAgents());

    await addMcpServer("personal-srv", "node", ["srv.js"], {});

    const state = loadState();
    const personal = state?.mcpServers?.find((s) => s.name === "personal-srv");
    expect(personal, "addMcpServer should write a state entry").toBeDefined();
    // Pin the contract: anything `agentbrew install` adds carries
    // source: "user" so the prune codepath (and downstream `--discover` UX)
    // can tell user-added apart from catalog/agentfile-deployed.
    expect(personal?.source).toBe("user");
  });

  it("syncMcpServers preserves user-added entries written directly to a deployed config", async () => {
    saveState(makeStateWithDetectedAgents());

    // Plant + sync the agentbrew-managed entry first so the manifest knows
    // about it. Without this, prune logic would treat every entry it finds
    // as orphaned.
    await addMcpServer("agentbrew-managed", "node", ["managed.js"], {});
    await syncMcpServers();

    // Now plant a user-authored entry directly in the kiro carve-out config
    // — same shape as a manual edit a user would make in their editor.
    const kiroPath = join(TEST_HOME, ".kiro", "settings", "mcp.json");
    const before = readMcpJson(kiroPath);
    const beforeServers = (before.mcpServers ?? {}) as Record<string, unknown>;
    writeFileSync(
      kiroPath,
      JSON.stringify(
        {
          mcpServers: {
            ...beforeServers,
            "user-authored": { command: "node", args: ["user.js"] },
          },
        },
        null,
        2,
      ),
    );

    // Default sync (prune behavior is the documented default; we do NOT
    // pass dryRun so the state→config translation actually runs).
    await syncMcpServers();

    const after = readMcpJson(kiroPath);
    const afterServers = (after.mcpServers ?? {}) as Record<string, unknown>;
    expect(afterServers["user-authored"], "user-authored entry must survive sync").toBeDefined();
    expect(afterServers["agentbrew-managed"], "managed entry must remain after sync").toBeDefined();
  });

  it("snapshotAgentConfigs + rollbackAgentConfigs round-trip restores a deployed config from snapshot", async () => {
    saveState(makeStateWithDetectedAgents());

    // Plant + sync a known-clean state so the snapshot has content to back
    // up. This mirrors the real-world flow: snapshot is taken just before
    // sync mutates anything.
    await addMcpServer("rollback-target", "node", ["target.js"], {});
    await syncMcpServers();

    const snapshotDir = snapshotAgentConfigs();
    expect(snapshotDir, "snapshotAgentConfigs should write at least one carve-out config").toBeDefined();

    // Mutate the deployed config out from under the snapshot — the rollback
    // contract says we should be able to put this back.
    const kiroPath = join(TEST_HOME, ".kiro", "settings", "mcp.json");
    writeFileSync(kiroPath, JSON.stringify({ mcpServers: { "manually-added": { command: "rogue" } } }, null, 2));

    // Roll back.
    await rollbackAgentConfigs();

    const restored = readMcpJson(kiroPath);
    const restoredServers = (restored.mcpServers ?? {}) as Record<string, unknown>;
    expect(restoredServers["rollback-target"], "rollback should restore the pre-mutation entry").toBeDefined();
    expect(restoredServers["manually-added"], "rollback should clear the mid-flight rogue mutation").toBeUndefined();
  });
});

// ── Capability 8: honest status (US 25, US 18) ──────────────────────────────

describe("essential core: honest status (US 25, US 18)", () => {
  // VISION.md "Honest status — counts are truthful; CI mode exits non-zero
  // when drift exists so a `agentbrew status --ci` step in a workflow halts
  // a deploy instead of green-lighting a drifted machine." This block fires
  // when healthCheck stops setting `process.exitCode` correctly.
  beforeEach(() => {
    process.exitCode = 0;
  });

  it("healthCheck({ ci: true }) leaves exitCode at 0 when state matches deployed configs", async () => {
    saveState(makeStateWithDetectedAgents());

    await addMcpServer("ci-clean", "node", ["clean.js"], {});
    await syncMcpServers();

    // State and config are aligned — no drift expected. Capture the console
    // output so the CI line ("drift=0 status=clean") doesn't pollute the
    // test report.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await healthCheck({ ci: true });
      expect(process.exitCode, "clean state should leave exitCode unchanged").toBe(0);
    } finally {
      log.mockRestore();
    }
  });

  it("healthCheck({ ci: true }) sets exitCode=1 when a deployed config no longer matches state", async () => {
    saveState(makeStateWithDetectedAgents());

    await addMcpServer("ci-dirty", "node", ["dirty.js"], {});
    await syncMcpServers();

    // Mutate the deployed config so collectDrift surfaces a real delta. A
    // truthful CI mode must signal exit=1 here so a `agentbrew status --ci`
    // step in a deploy pipeline halts.
    const kiroPath = join(TEST_HOME, ".kiro", "settings", "mcp.json");
    writeFileSync(kiroPath, JSON.stringify({ mcpServers: {} }, null, 2));

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await healthCheck({ ci: true });
      expect(process.exitCode, "drift in CI mode must exit non-zero").toBe(1);
    } finally {
      log.mockRestore();
    }
  });
});
