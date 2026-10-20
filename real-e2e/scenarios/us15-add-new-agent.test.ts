import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { runScenarioCli, runScenarioEval, runWithScenarioSandbox } from "../../src/real-e2e/scenario-fixture.js";

async function seedExistingSetup(homeDir: string, repoRoot: string, sharedSkillSourceDir: string): Promise<void> {
  const stateModule = pathToFileURL(join(repoRoot, "src", "state.ts")).href;
  await runScenarioEval({
    repoRoot,
    homeDir,
    args: [],
    statements: [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'import { dirname, join } from "node:path";',
      `import { defaultState, saveState } from ${JSON.stringify(stateModule)};`,
      "const state = defaultState();",
      'state.agents = [{ name: "claude-code", detected: true, skillsDir: "~/.claude/skills", mcpConfig: "~/.claude.json" }];',
      'state.mcpServers = [{ name: "team-memory", command: "node", args: ["server.js"], env: {}, source: "user" }];',
      `state.skillSourceDirs = [{ label: "team-skills", path: ${JSON.stringify(sharedSkillSourceDir)} }];`,
      "saveState(state);",
      'const claudeConfigPath = join(process.env.HOME ?? "", ".claude.json");',
      "mkdirSync(dirname(claudeConfigPath), { recursive: true });",
      'writeFileSync(claudeConfigPath, JSON.stringify({ mcpServers: { "team-memory": { command: "node", args: ["server.js"] } } }, null, 2));',
    ],
  });
}

describe("us15 add new agent", () => {
  it("re-detects a newly installed agent and syncs the existing setup to it", async () => {
    await runWithScenarioSandbox("us15-add-new-agent", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const homeDir = join(rootDir, "home");
      const sharedSkillSourceDir = join(rootDir, "shared-skills");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });
      cpSync(join(fixtureDir, "shared-skills"), sharedSkillSourceDir, { recursive: true });

      await seedExistingSetup(homeDir, repoRoot, sharedSkillSourceDir);

      mkdirSync(join(homeDir, ".kiro", "skills"), { recursive: true });

      const initResult = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["init", "--force", "--skip-install", "--skip-sync"],
      });
      expect(initResult.stdout).toContain("Re-initializing agentbrew");
      expect(initResult.stdout).toContain("kiro");

      const stateYaml = readFileSync(join(homeDir, ".config", "agentbrew", "state.yaml"), "utf-8");
      expect(stateYaml).toContain("name: claude-code");
      expect(stateYaml).toContain("name: kiro");
      expect(stateYaml).toContain("team-memory");

      const syncResult = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["sync", "--only", "skills", "--sequential"],
      });
      // PR #874 (compact output mode) replaced per-module headers with the unified
      // `Syncing: <surfaces>` line plus a single `✓ Synced` summary. Scoping the
      // sync to `--only skills` keeps the assertion deterministic — without
      // `--only` the compact summary skips the per-surface header line.
      expect(syncResult.stdout).toContain("Syncing: skills");
      expect(syncResult.stdout).toContain("✓ Synced");

      const kiroSkillPath = join(homeDir, ".kiro", "skills", "us15-shared-skill");
      expect(existsSync(kiroSkillPath)).toBe(true);
      expect(lstatSync(kiroSkillPath).isSymbolicLink()).toBe(true);

      // The kiro skill-symlink path (above) exercises the re-init flow's
      // primary user-visible signal: agentbrew detected the new agent and
      // synced existing skills to it.

      expect(existsSync(join(homeDir, ".kiro", "skills", "us15-shared-skill"))).toBe(true);
    });
  }, 120_000);
});
