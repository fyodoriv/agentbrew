import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The vendor-neutral skills dir must be a real absolute path in tmpdir so the
// sync code's `symlinkSync(..., expandHome(VENDOR_NEUTRAL_SKILLS_DIR))` calls
// land in a safe location. Using the literal string `~/.agents/skills` (combined
// with the identity `expandHome` mock below) makes the OS resolve the relative
// path against cwd and pollute the repo with a `./~/.agents/skills/` directory.
// `vi.hoisted` ensures the constant is defined before `vi.mock` runs.
const MOCKED_VENDOR_NEUTRAL_SKILLS_DIR = vi.hoisted(() => {
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  return path.join(os.tmpdir(), "agentbrew-unit-test-vendor-neutral");
});

// Mock types and expandHome before importing module
vi.mock("../types.js", () => ({
  AGENT_DEFINITIONS: [
    { name: "claude-code", skillsDir: "PLACEHOLDER_CLAUDE" },
    { name: "cursor", skillsDir: "PLACEHOLDER_CURSOR" },
  ],
  VENDOR_NEUTRAL_SKILLS_DIR: MOCKED_VENDOR_NEUTRAL_SKILLS_DIR,
  DEFAULT_SUPPORTED_SKILL_FEATURES: ["allowed-tools"] as const,
}));

vi.mock("../utils.js", () => ({
  expandHome: (path: string) => path,
}));

vi.mock("../state.js", () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

import { loadState } from "../state.js";
import { AGENT_DEFINITIONS } from "../types.js";
import {
  collectSkills,
  computeSkillsDiff,
  extractFrontmatterFeatures,
  getSkillSources,
  missingAgentFeatures,
  type SkillsSyncResult,
  syncSkills,
} from "./skills-sync.js";

const mockLoadState = vi.mocked(loadState);

afterAll(() => {
  rmSync(MOCKED_VENDOR_NEUTRAL_SKILLS_DIR, { recursive: true, force: true });
});

let testDir: string;
let claudeSkillsDir: string;
let cursorSkillsDir: string;
let tasksmdDir: string;
let _agentBrewSkillsDir: string;
let minskySkillsDir: string;
let _vendorNeutralDir: string;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  // Create a unique temp directory for each test
  testDir = join(tmpdir(), `skills-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  claudeSkillsDir = join(testDir, "claude", "skills");
  cursorSkillsDir = join(testDir, "cursor", "skills");
  _vendorNeutralDir = join(testDir, ".agents", "skills");
  tasksmdDir = join(testDir, "tasks-md");
  _agentBrewSkillsDir = join(testDir, "agentbrew-skills");
  minskySkillsDir = join(testDir, "minsky", "skills");

  // Create agent parent dirs (so agents are "detected")
  mkdirSync(join(testDir, "claude"), { recursive: true });
  mkdirSync(join(testDir, "cursor"), { recursive: true });

  // Update AGENT_DEFINITIONS to point to test dirs
  const defs = AGENT_DEFINITIONS as Array<{ name: string; skillsDir: string }>;
  defs[0].skillsDir = claudeSkillsDir;
  defs[1].skillsDir = cursorSkillsDir;

  // Set agentbrew dir for built-in source
  process.env.AGENTBREW_DIR = join(testDir, "agentbrew-repo");
  delete process.env.AGENTBREW_VENDOR_NEUTRAL;

  // Configure skill source dirs via state
  mockLoadState.mockReturnValue({
    agents: [],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
    skillSourceDirs: [
      { label: "tasks.md", path: join(tasksmdDir, "commands"), format: "tasks-md" as const },
      { label: "minsky", path: minskySkillsDir },
    ],
  });
});

function createSkill(baseDir: string, name: string): void {
  const skillDir = join(baseDir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `# ${name}`);
}

function createSkillWithFrontmatter(baseDir: string, name: string, frontmatter: string): void {
  const skillDir = join(baseDir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# ${name}\n`);
}

function createTasksMdSkill(name: string): void {
  const skillDir = join(tasksmdDir, "commands", "claude", "skills", name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `# ${name}`);
}

describe("syncSkills", () => {
  it("deploys skills from all sources to all agents", async () => {
    createSkill(minskySkillsDir, "debug");
    createSkill(minskySkillsDir, "commit");

    const result = await syncSkills({ quiet: true });

    expect(result.agentCount).toBe(2);
    expect(result.skillCount).toBe(2);
    expect(result.bySource.minsky).toBe(2);
    expect(result.vendorNeutral).toBe(true);

    // Verify symlinks exist in agent dirs
    expect(existsSync(join(claudeSkillsDir, "debug"))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "commit"))).toBe(true);
    expect(existsSync(join(cursorSkillsDir, "debug"))).toBe(true);
    expect(existsSync(join(cursorSkillsDir, "commit"))).toBe(true);

    // Verify they are symlinks
    expect(lstatSync(join(claudeSkillsDir, "debug")).isSymbolicLink()).toBe(true);
  });

  it("deploys only selected skills from tracked sources", async () => {
    const sourceDir = join(testDir, "source", "skills");
    createSkill(sourceDir, "installed-skill");
    createSkill(sourceDir, "available-only");
    createSkill(minskySkillsDir, "legacy-skill");
    mkdirSync(claudeSkillsDir, { recursive: true });
    symlinkSync(join(sourceDir, "available-only"), join(claudeSkillsDir, "available-only"));

    mockLoadState.mockReturnValue({
      agents: [],
      sources: [
        {
          url: sourceDir,
          type: "local",
          skillsInstalled: ["installed-skill"],
          availableItems: [
            { name: "installed-skill", description: "", type: "skill" },
            { name: "available-only", description: "", type: "skill" },
          ],
          addedAt: new Date().toISOString(),
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
      skillSourceDirs: [
        { label: "source-skills", path: sourceDir },
        { label: "minsky", path: minskySkillsDir },
      ],
    });

    const result = await syncSkills({ quiet: true });

    expect(result.skillCount).toBe(2);
    expect(result.bySource.skills).toBe(1);
    expect(result.bySource.minsky).toBe(1);
    expect(existsSync(join(claudeSkillsDir, "installed-skill"))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "available-only"))).toBe(false);
    expect(existsSync(join(claudeSkillsDir, "legacy-skill"))).toBe(true);
  });

  it("respects source priority (tasks.md > agentbrew > minsky)", async () => {
    // Same skill name in all 3 sources
    createTasksMdSkill("debug");
    createSkill(join(testDir, "agentbrew-skill-plugins-dev"), "debug");
    createSkill(minskySkillsDir, "debug");

    // Override agentbrew source dir via import.meta.dirname workaround
    // The getSkillSources uses agentBrewDir from import.meta — tested via env instead
    // Just test tasks.md > minsky priority
    const result = await syncSkills({ quiet: true });

    expect(result.skillCount).toBe(1);
    // tasks.md should win
    expect(result.bySource["tasks.md"]).toBe(1);
    expect(result.bySource.minsky).toBeUndefined();
  });

  it("cleans stale symlinks before deploying", async () => {
    // Create an initial skill
    createSkill(minskySkillsDir, "old-skill");
    await syncSkills({ quiet: true });
    expect(existsSync(join(claudeSkillsDir, "old-skill"))).toBe(true);

    // Remove the source skill and add a new one
    const { rmSync } = await import("node:fs");
    rmSync(join(minskySkillsDir, "old-skill"), { recursive: true });
    createSkill(minskySkillsDir, "new-skill");

    await syncSkills({ quiet: true });

    // Old symlink should be gone, new one present
    expect(existsSync(join(claudeSkillsDir, "old-skill"))).toBe(false);
    expect(existsSync(join(claudeSkillsDir, "new-skill"))).toBe(true);
  });

  it("returns zero counts when no agents detected", async () => {
    // Make agent dirs non-existent
    const defs = AGENT_DEFINITIONS as Array<{ name: string; skillsDir: string }>;
    defs[0].skillsDir = join(testDir, "nonexistent", "claude", "skills");
    defs[1].skillsDir = join(testDir, "nonexistent", "cursor", "skills");

    const result = await syncSkills({ quiet: true });

    expect(result.agentCount).toBe(0);
    expect(result.skillCount).toBe(0);
    expect(result.vendorNeutral).toBe(false);
  });

  it("returns zero skills when no sources have skills", async () => {
    const result = await syncSkills({ quiet: true });

    expect(result.skillCount).toBe(0);
    expect(result.agentCount).toBe(2);
  });

  it("deploys skills from skills/ subdirectory of a local source", async () => {
    // Create a local source with skills nested in skills/ subdir (standard GitHub layout)
    const localSourceDir = join(testDir, "my-local-source");
    mkdirSync(join(localSourceDir, "skills"), { recursive: true });
    createSkill(join(localSourceDir, "skills"), "review");
    createSkill(join(localSourceDir, "skills"), "debug");

    mockLoadState.mockReturnValue({
      agents: [],
      sources: [
        {
          url: localSourceDir,
          type: "local" as const,
          skillsInstalled: ["review", "debug"],
          availableItems: [],
          addedAt: "",
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
      skillSourceDirs: [],
    });

    const result = await syncSkills({ quiet: true });

    expect(result.skillCount).toBe(2);
    expect(existsSync(join(claudeSkillsDir, "review"))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "debug"))).toBe(true);
  });

  it("follows symlinked skill entries in a source dir (trailofbits-style layout)", async () => {
    // Mirrors the trailofbits/skills repo layout:
    //   plugins/<plugin>/skills/<skill>/SKILL.md            ← real skill dirs
    //   .codex/skills/<skill> → ../../plugins/<plugin>/skills/<skill>   ← symlinks
    // The skill source points at `.codex/skills/`. Without symlink-following,
    // lstatSync(.isDirectory()) returns false for the symlink and the skill
    // is silently dropped. https://github.com/trailofbits/skills uses this
    // layout to deduplicate skills across plugin packages.
    const tobRoot = join(testDir, "tob");
    const realCodeql = join(tobRoot, "plugins", "static-analysis", "skills", "codeql");
    const realSemgrep = join(tobRoot, "plugins", "static-analysis", "skills", "semgrep");
    mkdirSync(realCodeql, { recursive: true });
    mkdirSync(realSemgrep, { recursive: true });
    writeFileSync(join(realCodeql, "SKILL.md"), "# codeql");
    writeFileSync(join(realSemgrep, "SKILL.md"), "# semgrep");

    const codexSkills = join(tobRoot, ".codex", "skills");
    mkdirSync(codexSkills, { recursive: true });
    // Relative symlinks — exactly how the trailofbits repo ships them
    symlinkSync("../../plugins/static-analysis/skills/codeql", join(codexSkills, "codeql"));
    symlinkSync("../../plugins/static-analysis/skills/semgrep", join(codexSkills, "semgrep"));
    // A real skill dir alongside the symlinks (some plugins live directly in .codex/skills/)
    createSkill(codexSkills, "gh-cli");

    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
      skillSourceDirs: [{ label: "tob", path: codexSkills }],
    });

    const result = await syncSkills({ quiet: true });

    expect(result.skillCount).toBe(3);
    expect(result.bySource.tob).toBe(3);
    expect(existsSync(join(claudeSkillsDir, "codeql"))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "semgrep"))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "gh-cli"))).toBe(true);
    // Each deployed entry should be a symlink (the deployment mechanism is unchanged).
    expect(lstatSync(join(claudeSkillsDir, "codeql")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(claudeSkillsDir, "semgrep")).isSymbolicLink()).toBe(true);
    // And it should still resolve to a real SKILL.md (the symlink chain works).
    expect(existsSync(join(claudeSkillsDir, "codeql", "SKILL.md"))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "semgrep", "SKILL.md"))).toBe(true);
  });

  it("deep-scans nested skill layouts like team-skills (teams/<team>/<skill>/SKILL.md)", async () => {
    // Mirrors the team-skills repo layout:
    //   teams/<team>/<skill>/SKILL.md       ← team-tier skills
    //   templates/<skill>/SKILL.md          ← validated-tier skills
    // The skill source points at the repo root. Without the deep-scan
    // fallback, scanSkillDirs only looks at <root> and <root>/skills,
    // returning an empty skill list for team-skills (regression
    // `unify-skill-scanner-paths` filed 2026-05-25, partially fixed in
    // this commit). The catalog code path (`scanDirectoryForSkills`)
    // already had this fallback; this unifies the two paths.
    const repoRoot = join(testDir, "team-skills-like");
    mkdirSync(repoRoot, { recursive: true });
    // Two team-tier skills
    mkdirSync(join(repoRoot, "teams", "platform"), { recursive: true });
    createSkill(join(repoRoot, "teams", "platform"), "platform-logs");
    createSkill(join(repoRoot, "teams", "platform"), "analytics-queries");
    // One validated-tier skill
    mkdirSync(join(repoRoot, "templates"), { recursive: true });
    createSkill(join(repoRoot, "templates"), "organization-webapp");

    mockLoadState.mockReturnValue({
      agents: [],
      sources: [
        {
          url: repoRoot,
          type: "local" as const,
          skillsInstalled: ["platform-logs", "analytics-queries", "organization-webapp"],
          availableItems: [],
          addedAt: "",
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
      skillSourceDirs: [],
    });

    const result = await syncSkills({ quiet: true });

    expect(result.skillCount).toBe(3);
    expect(existsSync(join(claudeSkillsDir, "platform-logs"))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "analytics-queries"))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "organization-webapp"))).toBe(true);
  });

  it("does not double-discover when root and skills/ already yield skills", async () => {
    // Regression guard: the deep-scan fallback must only fire when standard
    // locations find nothing. Otherwise sources with both root/skills/ AND
    // nested layouts (e.g. a repo with `skills/foo` AND `templates/foo`)
    // would surface duplicates. The dedup is on name within `seen`; the
    // fallback is on the early return when `results.length > 0`.
    const repoRoot = join(testDir, "mixed-layout");
    mkdirSync(join(repoRoot, "skills"), { recursive: true });
    createSkill(join(repoRoot, "skills"), "review");
    // Buried duplicate that would surface only on deep-scan
    mkdirSync(join(repoRoot, "deep", "nested"), { recursive: true });
    createSkill(join(repoRoot, "deep", "nested"), "should-not-surface");

    mockLoadState.mockReturnValue({
      agents: [],
      sources: [
        {
          url: repoRoot,
          type: "local" as const,
          skillsInstalled: ["review"],
          availableItems: [],
          addedAt: "",
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
      skillSourceDirs: [],
    });

    const result = await syncSkills({ quiet: true });

    // Only the standard-layout `review` skill — the deep-buried one stays buried.
    expect(result.skillCount).toBe(1);
    expect(existsSync(join(claudeSkillsDir, "review"))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "should-not-surface"))).toBe(false);
  });

  it("prefers root-level skills over skills/ subdir when names collide", async () => {
    const localSourceDir = join(testDir, "my-source-collision");
    // Skill at root level
    createSkill(localSourceDir, "debug");
    // Same skill name in skills/ subdir
    mkdirSync(join(localSourceDir, "skills"), { recursive: true });
    createSkill(join(localSourceDir, "skills"), "debug");

    mockLoadState.mockReturnValue({
      agents: [],
      sources: [
        {
          url: localSourceDir,
          type: "local" as const,
          skillsInstalled: ["debug"],
          availableItems: [],
          addedAt: "",
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
      skillSourceDirs: [],
    });

    const result = await syncSkills({ quiet: true });

    // Should only deploy once (root takes precedence)
    expect(result.skillCount).toBe(1);
    // The symlink should point to the root-level skill
    const target = readlinkSync(join(claudeSkillsDir, "debug"));
    expect(target).toContain(localSourceDir);
    expect(target).not.toContain("skills/debug");
  });

  it("does not modify filesystem in dry-run mode", async () => {
    createSkill(minskySkillsDir, "debug");

    const result = await syncSkills({ dryRun: true, quiet: true });

    expect(result.skillCount).toBe(1);
    // Skills dir should NOT have been created
    expect(existsSync(claudeSkillsDir)).toBe(false);
  });

  it("logs output when not quiet", async () => {
    createSkill(minskySkillsDir, "debug");

    await syncSkills();

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("Skills sync");
    expect(calls).toContain("claude-code");
    expect(calls).toContain("Deployed");
  });

  it("handles tasks.md command structure", async () => {
    createTasksMdSkill("next-task");
    createTasksMdSkill("plan");

    const result = await syncSkills({ quiet: true });

    expect(result.skillCount).toBe(2);
    expect(result.bySource["tasks.md"]).toBe(2);
    expect(existsSync(join(claudeSkillsDir, "next-task"))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "plan"))).toBe(true);
  });

  it("skips user-created directory at destination instead of replacing it (lines 273-280)", async () => {
    createSkill(minskySkillsDir, "debug");

    // Pre-create a real (non-symlink) directory at the destination — simulates user
    // manually copying a skill to their agent's skills directory
    mkdirSync(claudeSkillsDir, { recursive: true });
    const userDir = join(claudeSkillsDir, "debug");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "some-other-file.txt"), "user content");

    // Confirm destination is a real directory (not symlink)
    expect(lstatSync(userDir).isDirectory()).toBe(true);
    expect(lstatSync(userDir).isSymbolicLink()).toBe(false);

    const _result = await syncSkills({ quiet: false });

    // The user dir should be preserved — NOT replaced with a symlink
    expect(existsSync(join(claudeSkillsDir, "debug"))).toBe(true);
    expect(lstatSync(join(claudeSkillsDir, "debug")).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(claudeSkillsDir, "debug")).isDirectory()).toBe(true);
    // User's file should still be there
    expect(readFileSync(join(userDir, "some-other-file.txt"), "utf-8")).toBe("user content");
  });

  it("recovers when cleanSymlinks target dir is unreadable (line 334)", async () => {
    createSkill(minskySkillsDir, "commit");

    // Create the skills dir with a stale symlink, then make it unreadable
    mkdirSync(claudeSkillsDir, { recursive: true });
    // A broken symlink in the dir (it should be cleaned but won't be if dir unreadable)
    symlinkSync("/nonexistent-target", join(claudeSkillsDir, "stale-link"));
    chmodSync(claudeSkillsDir, 0o000);

    let result: SkillsSyncResult | undefined;
    try {
      // syncSkills should not throw even when cleanSymlinks can't read the dir
      result = await syncSkills({ quiet: true });
    } finally {
      chmodSync(claudeSkillsDir, 0o755);
    }

    // skillCount still reflects source, even if deploy silently failed
    expect(result?.skillCount).toBe(1);
  });

  it("prunes broken symlinks pointing to deleted targets during sync", async () => {
    createSkill(minskySkillsDir, "debug");
    mkdirSync(claudeSkillsDir, { recursive: true });

    // Create a broken symlink (target doesn't exist)
    symlinkSync("/tmp/nonexistent-deleted-skill-target", join(claudeSkillsDir, "deleted-skill"));
    expect(lstatSync(join(claudeSkillsDir, "deleted-skill")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "deleted-skill"))).toBe(false); // broken

    await syncSkills({ quiet: true });

    // Broken symlink should be removed
    expect(existsSync(join(claudeSkillsDir, "deleted-skill"))).toBe(false);
    // Verify it's actually gone, not just unresolvable
    const entries = readdirSync(claudeSkillsDir);
    expect(entries).not.toContain("deleted-skill");
    // Real skill should be deployed
    expect(entries).toContain("debug");
  });

  it("skips skills whose source disappeared between scan and deploy", async () => {
    createSkill(minskySkillsDir, "good-skill");
    createSkill(minskySkillsDir, "vanishing-skill");

    // Sync once so both skills are deployed
    await syncSkills({ quiet: true });
    expect(existsSync(join(claudeSkillsDir, "good-skill"))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "vanishing-skill"))).toBe(true);

    // Simulate a git branch switch that removes the skill source
    rmSync(join(minskySkillsDir, "vanishing-skill"), { recursive: true });

    // Re-sync: vanishing-skill source is gone, should not create a dangling symlink
    await syncSkills({ quiet: true });
    expect(existsSync(join(claudeSkillsDir, "good-skill"))).toBe(true);
    // The broken symlink from the first sync should be cleaned,
    // and no new dangling symlink should be created
    const entries = readdirSync(claudeSkillsDir);
    expect(entries).not.toContain("vanishing-skill");
  });

  it("logs a warning when symlinkSync fails for a specific skill (lines 236-251)", async () => {
    createSkill(minskySkillsDir, "debug");
    mkdirSync(claudeSkillsDir, { recursive: true });

    // Make the destination dir unwritable so symlinkSync throws EACCES
    chmodSync(claudeSkillsDir, 0o444);

    const logCalls: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logCalls.push(args.join(" "));
    };

    let result: SkillsSyncResult | undefined;
    try {
      result = await syncSkills({ quiet: false });
    } finally {
      chmodSync(claudeSkillsDir, 0o755);
      console.log = origLog;
    }

    // Skill is still counted in source but a warning should have been emitted
    expect(result?.skillCount).toBe(1);
    expect(logCalls.some((msg) => msg.includes("debug"))).toBe(true);
  });

  it("skips hooks-using skills on agents that don't support hooks (integration)", async () => {
    // AGENT_DEFINITIONS mock has claude-code (supports hooks) and cursor (no hooks).
    const defs = AGENT_DEFINITIONS as Array<{ name: string; skillsDir: string; supportedSkillFeatures?: string[] }>;
    defs[0].supportedSkillFeatures = ["allowed-tools", "context-fork", "hooks"];
    defs[1].supportedSkillFeatures = ["allowed-tools"];

    // Basic skill (no features)
    createSkill(minskySkillsDir, "debug");
    // Hooks-using skill — should skip cursor
    createSkillWithFrontmatter(
      minskySkillsDir,
      "stop-guard",
      ["name: stop-guard", "description: stop guard hooks", "hooks:", "  Stop: echo done"].join("\n"),
    );

    const result = await syncSkills({ quiet: true });

    expect(result.skillCount).toBe(2);
    // claude-code gets both
    expect(existsSync(join(claudeSkillsDir, "debug"))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "stop-guard"))).toBe(true);
    // cursor gets only the basic skill
    expect(existsSync(join(cursorSkillsDir, "debug"))).toBe(true);
    expect(existsSync(join(cursorSkillsDir, "stop-guard"))).toBe(false);
    // Skipped report names cursor with the stop-guard entry
    expect(result.skipped.cursor).toBeDefined();
    expect(result.skipped.cursor?.[0].name).toBe("stop-guard");
    expect(result.skipped.cursor?.[0].missingFeatures).toEqual(["hooks"]);
    // claude-code has no skipped entries
    expect(result.skipped["claude-code"]).toBeUndefined();

    // Clean up for other tests in this describe (AGENT_DEFINITIONS is mutable here).
    delete defs[0].supportedSkillFeatures;
    delete defs[1].supportedSkillFeatures;
  });
});

describe("getSkillSources", () => {
  it("returns user sources + built-in agentbrew source", () => {
    const sources = getSkillSources();
    expect(sources).toHaveLength(3);
    expect(sources[0].label).toBe("tasks.md");
    expect(sources[1].label).toBe("minsky");
    expect(sources[2].label).toBe("agentbrew");
  });

  it("returns only built-in when no skillSourceDirs configured", () => {
    mockLoadState.mockReturnValue(undefined);
    const sources = getSkillSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].label).toBe("agentbrew");
  });
});

describe("vendor-neutral .agents/ path", () => {
  it("deploys to ~/.agents/skills/ by default", async () => {
    createSkill(minskySkillsDir, "debug");

    await syncSkills({ quiet: true });

    // expandHome mock returns path as-is, so vendor-neutral dir is the literal string
    // But since the mock returns the path unchanged, it creates "~/.agents/skills" literally
    // We verify via the result flag
    const result = await syncSkills({ quiet: true });
    expect(result.vendorNeutral).toBe(true);
  });

  it("skips vendor-neutral when AGENTBREW_VENDOR_NEUTRAL=0", async () => {
    process.env.AGENTBREW_VENDOR_NEUTRAL = "0";
    createSkill(minskySkillsDir, "debug");

    const result = await syncSkills({ quiet: true });

    expect(result.vendorNeutral).toBe(false);
    // Agent dirs still get skills
    expect(existsSync(join(claudeSkillsDir, "debug"))).toBe(true);
  });

  it("logs .agents target in non-quiet mode", async () => {
    createSkill(minskySkillsDir, "debug");

    await syncSkills({ verbose: true });

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain(".agents");
  });
});

// ── Pure function tests (no mocking needed) ─────────────────────────────────

describe("collectSkills", () => {
  it("returns empty when no sources", () => {
    const { skills, bySource } = collectSkills([]);
    expect(skills.size).toBe(0);
    expect(Object.keys(bySource)).toHaveLength(0);
  });

  it("collects skills from a single source", () => {
    const { skills, bySource } = collectSkills([{ label: "dev", skillPaths: ["/skills/commit", "/skills/review"] }]);
    expect(skills.size).toBe(2);
    expect(skills.get("commit")?.sourceLabel).toBe("dev");
    expect(skills.get("review")?.sourcePath).toBe("/skills/review");
    expect(bySource.dev).toBe(2);
  });

  it("deduplicates by name — first source wins", () => {
    const { skills, bySource } = collectSkills([
      { label: "user", skillPaths: ["/user/commit"] },
      { label: "builtin", skillPaths: ["/builtin/commit", "/builtin/debug"] },
    ]);
    expect(skills.size).toBe(2);
    expect(skills.get("commit")?.sourceLabel).toBe("user");
    expect(skills.get("commit")?.sourcePath).toBe("/user/commit");
    expect(skills.get("debug")?.sourceLabel).toBe("builtin");
    expect(bySource.user).toBe(1);
    expect(bySource.builtin).toBe(1);
  });

  it("handles multiple sources with no overlap", () => {
    const { skills } = collectSkills([
      { label: "a", skillPaths: ["/a/skill-1"] },
      { label: "b", skillPaths: ["/b/skill-2"] },
    ]);
    expect(skills.size).toBe(2);
  });
});

describe("computeSkillsDiff", () => {
  it("returns empty symlinks for empty skill set", () => {
    const diffs = computeSkillsDiff(new Map(), [{ label: "claude-code", skillsDir: "/claude/skills" }]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].symlinks).toHaveLength(0);
  });

  it("creates symlinks for each skill in each target", () => {
    const skills = new Map([
      ["commit", { name: "commit", sourcePath: "/src/commit", sourceLabel: "dev", features: [] }],
      ["review", { name: "review", sourcePath: "/src/review", sourceLabel: "dev", features: [] }],
    ]);
    const diffs = computeSkillsDiff(skills, [
      { label: "claude-code", skillsDir: "/claude/skills" },
      { label: "cursor", skillsDir: "/cursor/skills" },
    ]);
    expect(diffs).toHaveLength(2);
    expect(diffs[0].symlinks).toHaveLength(2);
    expect(diffs[1].symlinks).toHaveLength(2);
    expect(diffs[0].symlinks[0]).toEqual({ name: "commit", sourcePath: "/src/commit" });
    expect(diffs[0].skipped).toHaveLength(0);
  });

  it("preserves target metadata", () => {
    const skills = new Map([["s1", { name: "s1", sourcePath: "/p", sourceLabel: "l", features: [] }]]);
    const diffs = computeSkillsDiff(skills, [{ label: "my-agent", skillsDir: "/my/dir" }]);
    expect(diffs[0].label).toBe("my-agent");
    expect(diffs[0].skillsDir).toBe("/my/dir");
  });

  it("skips hooks-using skill on agents that don't support hooks", () => {
    const skills = new Map([
      ["basic", { name: "basic", sourcePath: "/src/basic", sourceLabel: "dev", features: [] }],
      [
        "hooked",
        {
          name: "hooked",
          sourcePath: "/src/hooked",
          sourceLabel: "dev",
          features: ["hooks" as const],
        },
      ],
    ]);
    const diffs = computeSkillsDiff(skills, [
      {
        label: "claude-code",
        skillsDir: "/claude/skills",
        supportedSkillFeatures: ["allowed-tools", "context-fork", "hooks"],
      },
      { label: "cursor", skillsDir: "/cursor/skills", supportedSkillFeatures: ["allowed-tools"] },
    ]);
    const claude = diffs.find((d) => d.label === "claude-code");
    const cursor = diffs.find((d) => d.label === "cursor");
    expect(claude?.symlinks.map((s) => s.name).sort()).toEqual(["basic", "hooked"]);
    expect(claude?.skipped).toHaveLength(0);
    expect(cursor?.symlinks.map((s) => s.name)).toEqual(["basic"]);
    expect(cursor?.skipped).toHaveLength(1);
    expect(cursor?.skipped[0].name).toBe("hooked");
    expect(cursor?.skipped[0].missingFeatures).toEqual(["hooks"]);
    expect(cursor?.skipped[0].reason).toContain("unsupported feature: hooks");
  });

  it("skips allowed-tools skill on agents with empty supportedSkillFeatures (Zencoder)", () => {
    const skills = new Map([
      [
        "tool-using",
        {
          name: "tool-using",
          sourcePath: "/src/tool-using",
          sourceLabel: "dev",
          features: ["allowed-tools" as const],
        },
      ],
    ]);
    const diffs = computeSkillsDiff(skills, [
      { label: "zencoder", skillsDir: "/zencoder/skills", supportedSkillFeatures: [] },
    ]);
    expect(diffs[0].symlinks).toHaveLength(0);
    expect(diffs[0].skipped).toHaveLength(1);
    expect(diffs[0].skipped[0].missingFeatures).toEqual(["allowed-tools"]);
  });

  it("reports multiple missing features in plural", () => {
    const skills = new Map([
      [
        "complex",
        {
          name: "complex",
          sourcePath: "/src/complex",
          sourceLabel: "dev",
          features: ["hooks" as const, "context-fork" as const],
        },
      ],
    ]);
    const diffs = computeSkillsDiff(skills, [
      { label: "cursor", skillsDir: "/cursor/skills", supportedSkillFeatures: ["allowed-tools"] },
    ]);
    expect(diffs[0].skipped[0].reason).toContain("unsupported features:");
    expect(diffs[0].skipped[0].missingFeatures).toEqual(["hooks", "context-fork"]);
  });

  it("defaults to [allowed-tools] support when supportedSkillFeatures is undefined", () => {
    const skills = new Map([
      [
        "hooked",
        {
          name: "hooked",
          sourcePath: "/src/hooked",
          sourceLabel: "dev",
          features: ["hooks" as const],
        },
      ],
      [
        "tool-using",
        {
          name: "tool-using",
          sourcePath: "/src/tool-using",
          sourceLabel: "dev",
          features: ["allowed-tools" as const],
        },
      ],
    ]);
    const diffs = computeSkillsDiff(skills, [{ label: "default", skillsDir: "/default/skills" }]);
    const deployed = new Set(diffs[0].symlinks.map((s) => s.name));
    expect(deployed.has("tool-using")).toBe(true);
    expect(deployed.has("hooked")).toBe(false);
    expect(diffs[0].skipped[0].name).toBe("hooked");
  });
});

describe("extractFrontmatterFeatures", () => {
  it("returns no features for null or empty frontmatter", () => {
    expect(extractFrontmatterFeatures(null)).toEqual([]);
    expect(extractFrontmatterFeatures(undefined)).toEqual([]);
    expect(extractFrontmatterFeatures({})).toEqual([]);
  });

  it("detects allowed-tools when the field is present", () => {
    expect(extractFrontmatterFeatures({ "allowed-tools": ["Read", "Write"] })).toEqual(["allowed-tools"]);
    // Even an empty array counts as a declaration.
    expect(extractFrontmatterFeatures({ "allowed-tools": [] })).toEqual(["allowed-tools"]);
  });

  it("detects context-fork from string or array shape", () => {
    expect(extractFrontmatterFeatures({ context: "fork" })).toEqual(["context-fork"]);
    expect(extractFrontmatterFeatures({ context: ["fork"] })).toEqual(["context-fork"]);
    expect(extractFrontmatterFeatures({ context: "other" })).toEqual([]);
  });

  it("detects hooks when the field is present (any truthy shape)", () => {
    expect(extractFrontmatterFeatures({ hooks: { PreToolUse: "cmd" } })).toEqual(["hooks"]);
  });

  it("combines multiple features in a stable order", () => {
    const features = extractFrontmatterFeatures({
      "allowed-tools": ["Read"],
      context: "fork",
      hooks: {},
    });
    expect(features).toEqual(["allowed-tools", "context-fork", "hooks"]);
  });
});

describe("missingAgentFeatures", () => {
  it("returns [] when agent supports all declared skill features", () => {
    expect(missingAgentFeatures(["allowed-tools", "hooks"], ["allowed-tools", "hooks", "context-fork"])).toEqual([]);
  });

  it("returns the unsupported subset", () => {
    expect(missingAgentFeatures(["allowed-tools", "hooks"], ["allowed-tools"])).toEqual(["hooks"]);
  });

  it("treats undefined agent support as the baseline [allowed-tools]", () => {
    expect(missingAgentFeatures(["hooks"], undefined)).toEqual(["hooks"]);
    expect(missingAgentFeatures(["allowed-tools"], undefined)).toEqual([]);
  });

  it("treats empty agent support as basic-only (no allowed-tools)", () => {
    expect(missingAgentFeatures(["allowed-tools"], [])).toEqual(["allowed-tools"]);
    expect(missingAgentFeatures([], [])).toEqual([]);
  });
});

describe("catalog-installed skills (no tasks-md skillSourceDir)", () => {
  it("deploys catalog-installed skills from a plain skillSourceDir", async () => {
    // Simulates next-task installed into ~/.config/agentbrew/installed-skills/
    // without a tasks-md format entry — just a regular flat directory.
    const installedSkillsDir = join(testDir, "installed-skills");
    createSkill(installedSkillsDir, "next-task");

    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
      skillSourceDirs: [{ label: "catalog-installed", path: installedSkillsDir }],
    });

    const result = await syncSkills({ quiet: true });

    expect(result.skillCount).toBe(1);
    expect(result.bySource["catalog-installed"]).toBe(1);
    expect(existsSync(join(claudeSkillsDir, "next-task"))).toBe(true);
    expect(lstatSync(join(claudeSkillsDir, "next-task")).isSymbolicLink()).toBe(true);
  });

  it("catalog-installed takes priority over minsky when skill names collide", async () => {
    const installedSkillsDir = join(testDir, "installed-skills");
    createSkill(installedSkillsDir, "next-task");
    createSkill(minskySkillsDir, "next-task");

    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
      skillSourceDirs: [
        { label: "catalog-installed", path: installedSkillsDir },
        { label: "minsky", path: minskySkillsDir },
      ],
    });

    const result = await syncSkills({ quiet: true });

    expect(result.skillCount).toBe(1);
    expect(result.bySource["catalog-installed"]).toBe(1);
    expect(result.bySource.minsky).toBeUndefined();

    // Symlink should point to the catalog-installed copy
    const linkTarget = readlinkSync(join(claudeSkillsDir, "next-task"));
    expect(linkTarget).toContain("installed-skills");
  });

  it("works with no skillSourceDirs at all — falls back to agentbrew built-in", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
      skillSourceDirs: [],
    });

    // Only agentbrew dev skills (none in test env), so zero skills
    const result = await syncSkills({ quiet: true });

    expect(result.agentCount).toBe(2);
    expect(result.skillCount).toBe(0);
  });

  it("continues syncing other agents when one agent's skills dir cannot be created", async () => {
    // Create a skill source
    mkdirSync(minskySkillsDir, { recursive: true });
    const skillDir = join(minskySkillsDir, "test-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\ndescription: test\n---\n# Test\n");

    // Make claude's parent dir a file so mkdirSync fails on the skills subdir
    // Point claude to a path under a file (cannot create dir under a file)
    const defs = AGENT_DEFINITIONS as Array<{ name: string; skillsDir: string }>;
    const originalClaudeDir = defs[0].skillsDir;
    // Create a file where a directory is expected, causing ENOTDIR
    const blockingFile = join(testDir, "blocked-file");
    writeFileSync(blockingFile, "blocker");
    defs[0].skillsDir = join(blockingFile, "skills");

    const result = await syncSkills({ quiet: false });

    // Claude should fail, but cursor should still succeed
    expect(result.skillCount).toBe(1);
    expect(existsSync(join(cursorSkillsDir, "test-skill"))).toBe(true);

    // Restore
    defs[0].skillsDir = originalClaudeDir;
  });
});

describe("cleanBrokenSymlinksGlobally — issue 3/4 of sync-idempotent-and-complete", () => {
  it("removes broken symlinks from non-detected agent skill dirs", async () => {
    // Simulate a prior agentbrew install that left stale symlinks in
    // claude + cursor skills dirs. No live skill source — every symlink's
    // target is gone, so every symlink is broken.
    mkdirSync(claudeSkillsDir, { recursive: true });
    mkdirSync(cursorSkillsDir, { recursive: true });
    const deletedTarget = join(testDir, "deleted-source");
    symlinkSync(join(deletedTarget, "skill-a"), join(claudeSkillsDir, "skill-a"));
    symlinkSync(join(deletedTarget, "skill-b"), join(cursorSkillsDir, "skill-b"));

    // Sanity: broken symlinks exist pre-cleanup (lstat sees the link, existsSync
    // returns false because the target resolves to a non-existent path).
    expect(lstatSync(join(claudeSkillsDir, "skill-a")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "skill-a"))).toBe(false);

    const { cleanBrokenSymlinksGlobally } = await import("./skills-sync.js");
    const removed = cleanBrokenSymlinksGlobally();

    expect(removed).toBe(2);
    expect(existsSync(join(claudeSkillsDir, "skill-a"))).toBe(false);
    expect(existsSync(join(cursorSkillsDir, "skill-b"))).toBe(false);
    // lstat must now throw because the symlink is fully gone (not just broken).
    expect(() => lstatSync(join(claudeSkillsDir, "skill-a"))).toThrow();
  });

  it("preserves healthy symlinks and user-created files", async () => {
    // Mix: one broken symlink, one valid symlink to an existing file, and
    // one regular file the user authored. Only the broken link should go.
    mkdirSync(claudeSkillsDir, { recursive: true });
    const liveTarget = join(testDir, "live-skill");
    mkdirSync(liveTarget, { recursive: true });
    writeFileSync(join(liveTarget, "SKILL.md"), "# live");
    symlinkSync(liveTarget, join(claudeSkillsDir, "live"));
    symlinkSync(join(testDir, "gone"), join(claudeSkillsDir, "dead"));
    writeFileSync(join(claudeSkillsDir, "user-note.md"), "# user-owned");

    const { cleanBrokenSymlinksGlobally } = await import("./skills-sync.js");
    const removed = cleanBrokenSymlinksGlobally();

    expect(removed).toBe(1);
    expect(existsSync(join(claudeSkillsDir, "live"))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, "user-note.md"))).toBe(true);
    expect(() => lstatSync(join(claudeSkillsDir, "dead"))).toThrow();
  });

  it("silently no-ops when no agent skill dirs exist on disk", async () => {
    // Nothing under testDir besides the just-created claude/cursor parent
    // dirs from beforeEach — neither has a skills/ subdir. The helper must
    // return 0 without throwing.
    const { cleanBrokenSymlinksGlobally } = await import("./skills-sync.js");
    expect(cleanBrokenSymlinksGlobally()).toBe(0);
  });
});

// ── Carve-out lock-down (sub-task simplify-skills-sync-lock-down-carveouts) ─
//
// Pins each native skills-sync carve-out's deploy path so the upcoming
// `simplify-skills-sync-annotate-functions` + `simplify-skills-sync-shrink-or-document`
// sub-tasks can delete branches without silently breaking the carve-out.
//
// AGENTBREW_ONLY skills carve-outs flow through native sync (per VISION.md "Curator, not host"):
//   - claude-desktop: ~/Library/Application Support/Claude/skills (desktop app
//     reads from a non-standard path, not a skills CLI target)
//   - overlay-desktop: ~/Library/Application Support/TeamDesktopApp/skills
//     (organization-internal app, permanent native carve-out)
//
// Per the sibling sub-task acceptance criterion (b): "every carve-out has at
// least one *.test.ts block whose description names it".

describe("syncSkills — claude-desktop carve-out", () => {
  let claudeDesktopSkillsDir: string;

  beforeEach(() => {
    claudeDesktopSkillsDir = join(testDir, "claude-desktop", "skills");
    mkdirSync(join(testDir, "claude-desktop"), { recursive: true });

    // Push claude-desktop into the mocked AGENT_DEFINITIONS so resolveDetectedAgents
    // returns it. The shared global beforeEach already mutated indices 0 and 1 for
    // claude-code + cursor; we append at index 2 and pop in afterEach.
    const defs = AGENT_DEFINITIONS as Array<{ name: string; skillsDir: string }>;
    defs.push({ name: "claude-desktop", skillsDir: claudeDesktopSkillsDir });

    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-desktop", detected: true } as never],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
      skillSourceDirs: [{ label: "minsky", path: minskySkillsDir }],
    });
  });

  afterEach(() => {
    const defs = AGENT_DEFINITIONS as Array<{ name: string; skillsDir: string }>;
    // Drop the entry we appended so other test files / suites don't see it.
    if (defs[defs.length - 1].name === "claude-desktop") defs.pop();
  });

  it("deploys skill symlinks to the carve-out's documented skillsDir", async () => {
    createSkill(minskySkillsDir, "review");
    const result = await syncSkills({ quiet: true });

    expect(result.agentCount).toBe(1);
    expect(result.skillCount).toBe(1);

    // Carve-out invariant: symlink lands at claude-desktop's skillsDir,
    // NOT at claude-code's path. A future deletion that flips the carve-out
    // boundary would break this assertion.
    expect(existsSync(join(claudeDesktopSkillsDir, "review"))).toBe(true);
    expect(lstatSync(join(claudeDesktopSkillsDir, "review")).isSymbolicLink()).toBe(true);

    // claude-code's skillsDir must NOT receive this skill (claude-code is not
    // detected in this state). Defends against accidental fan-out where a
    // delegated agent's path ends up populated by native sync.
    expect(existsSync(join(claudeSkillsDir, "review"))).toBe(false);
  });
});

describe("syncSkills — overlay-desktop carve-out", () => {
  let overlayDesktopSkillsDir: string;

  beforeEach(() => {
    overlayDesktopSkillsDir = join(testDir, "overlay-desktop", "skills");
    mkdirSync(join(testDir, "overlay-desktop"), { recursive: true });

    const defs = AGENT_DEFINITIONS as Array<{ name: string; skillsDir: string }>;
    defs.push({ name: "overlay-desktop", skillsDir: overlayDesktopSkillsDir });

    mockLoadState.mockReturnValue({
      agents: [{ name: "overlay-desktop", detected: true } as never],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
      skillSourceDirs: [{ label: "minsky", path: minskySkillsDir }],
    });
  });

  afterEach(() => {
    const defs = AGENT_DEFINITIONS as Array<{ name: string; skillsDir: string }>;
    if (defs[defs.length - 1].name === "overlay-desktop") defs.pop();
  });

  it("deploys skill symlinks to the carve-out's documented skillsDir", async () => {
    createSkill(minskySkillsDir, "team-runbook");
    const result = await syncSkills({ quiet: true });

    expect(result.agentCount).toBe(1);
    expect(result.skillCount).toBe(1);

    // Carve-out invariant: overlay-desktop is the canonical organization-internal
    // path. Permanent native carve-out — not in skills CLI's target list.
    expect(existsSync(join(overlayDesktopSkillsDir, "team-runbook"))).toBe(true);
    expect(lstatSync(join(overlayDesktopSkillsDir, "team-runbook")).isSymbolicLink()).toBe(true);

    // No fan-out into the delegated agents' paths.
    expect(existsSync(join(claudeSkillsDir, "team-runbook"))).toBe(false);
    expect(existsSync(join(cursorSkillsDir, "team-runbook"))).toBe(false);
  });
});
