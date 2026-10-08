import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { runScenarioCli, runWithScenarioSandbox, seedScenarioState } from "../../src/real-e2e/scenario-fixture.js";

describe("us06/us20 agents drift", () => {
  it("syncs agent definitions, repairs missing managed output, and preserves local agents", async () => {
    await runWithScenarioSandbox("us06-us20-agents-drift", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const homeDir = join(rootDir, "home");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });
      await seedScenarioState(homeDir, repoRoot);

      const claudeLocalAgent = join(homeDir, ".claude", "agents", "local-only.md");
      mkdirSync(dirname(claudeLocalAgent), { recursive: true });
      writeFileSync(claudeLocalAgent, "# Local only\n\nKeep this local agent.\n", "utf-8");

      const initialSync = await runScenarioCli({
        args: ["sync", "--only", "agents", "--sequential"],
        cwd: rootDir,
        homeDir,
        repoRoot,
      });
      expect(initialSync.stdout).toContain("Syncing: agents");

      const claudeManagedAgent = join(homeDir, ".claude", "agents", "reviewer.md");
      const cursorManagedAgent = join(homeDir, ".cursor", "agents", "reviewer.md");

      expect(readFileSync(claudeManagedAgent, "utf-8")).toContain("Check the diff");
      expect(readFileSync(cursorManagedAgent, "utf-8")).toContain("Check the diff");
      expect(readFileSync(claudeLocalAgent, "utf-8")).toContain("Keep this local agent.");

      rmSync(claudeManagedAgent);
      expect(existsSync(claudeManagedAgent)).toBe(false);

      const repairResult = await runScenarioCli({
        args: ["status", "--fix"],
        cwd: rootDir,
        homeDir,
        repoRoot,
      });
      expect(repairResult.stdout).toContain("auto-repairing");
      expect(repairResult.stderr).toContain("claude-code [agents] — missing agent def: reviewer");
      expect(repairResult.stdout).toContain("All drift resolved");

      expect(readFileSync(claudeManagedAgent, "utf-8")).toContain("Check the diff");
      expect(readFileSync(claudeLocalAgent, "utf-8")).toContain("Keep this local agent.");
    });
  }, 120_000);
});
