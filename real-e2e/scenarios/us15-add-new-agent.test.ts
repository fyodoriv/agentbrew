import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

      mkdirSync(join(homeDir, ".cursor", "skills"), { recursive: true });
      writeFileSync(join(homeDir, ".cursor", "mcp.json"), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`, "utf-8");

      const initResult = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["init", "--force", "--skip-install", "--skip-sync"],
      });
      expect(initResult.stdout).toContain("Re-initializing agentbrew");
      expect(initResult.stdout).toContain("cursor");

      const stateYaml = readFileSync(join(homeDir, ".config", "agentbrew", "state.yaml"), "utf-8");
      expect(stateYaml).toContain("name: claude-code");
      expect(stateYaml).toContain("name: cursor");
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

      const cursorSkillPath = join(homeDir, ".cursor", "skills", "us15-shared-skill");
      expect(existsSync(cursorSkillPath)).toBe(true);
      expect(lstatSync(cursorSkillPath).isSymbolicLink()).toBe(true);

      // Post-slice-4a (PR #845): cursor is intersection-delegated, so
      // native sync no longer writes `.cursor/mcp.json`. The "team-memory"
      // server still lives in agentbrew state.yaml (asserted above) and
      // would propagate to cursor via `mcpm client edit` if mcpm were on
      // PATH. The cursor skill-symlink path (above) still exercises the
      // re-init flow's primary user-visible signal: agentbrew detected
      // the new agent and synced existing skills to it.

      expect(existsSync(join(homeDir, ".cursor", "skills", "us15-shared-skill"))).toBe(true);
    });
  }, 120_000);
});
