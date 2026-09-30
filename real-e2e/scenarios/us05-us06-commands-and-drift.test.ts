import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { runScenarioCli, runWithScenarioSandbox, seedScenarioState } from "../../src/real-e2e/scenario-fixture.js";

describe("us05/us06 commands and drift", () => {
  it("syncs commands, repairs managed drift, and preserves user-owned command files", async () => {
    await runWithScenarioSandbox("us05-us06-commands-and-drift", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const tasksFile = join(repoRoot, "TASKS.md");
      const tasksBefore = readFileSync(tasksFile, "utf-8");
      const homeDir = join(rootDir, "home");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });
      await seedScenarioState(homeDir, repoRoot);

      const initialSync = await runScenarioCli({
        args: ["sync", "--only", "commands", "--sequential"],
        homeDir,
        repoRoot,
      });
      // PR #874 (compact output mode) changed `Syncing 1 commands` → `Syncing: commands`.
      expect(initialSync.stdout).toContain("Syncing: commands");

      const claudeManagedCommand = join(homeDir, ".claude", "commands", "deploy.md");
      const cursorManagedCommand = join(homeDir, ".cursor", "commands", "deploy.md");
      const cursorUserCommand = join(homeDir, ".cursor", "commands", "local-only.md");

      expect(readFileSync(claudeManagedCommand, "utf-8")).toContain("description: Deploy the current repo");
      expect(readFileSync(cursorManagedCommand, "utf-8")).toContain("# Deploy");
      expect(readFileSync(cursorManagedCommand, "utf-8")).not.toContain("description: Deploy the current repo");
      expect(readFileSync(cursorUserCommand, "utf-8")).toContain("Keep my local workflow");
      expect(readFileSync(tasksFile, "utf-8")).toBe(tasksBefore);

      rmSync(cursorManagedCommand);
      expect(existsSync(cursorManagedCommand)).toBe(false);

      const repairResult = await runScenarioCli({
        args: ["status", "--fix"],
        homeDir,
        repoRoot,
      });
      expect(repairResult.stdout).toContain("auto-repairing");
      expect(repairResult.stdout).toContain("cursor [commands] — missing command: deploy.md");
      expect(repairResult.stdout).toContain("All drift resolved");

      expect(readFileSync(cursorManagedCommand, "utf-8")).toContain("# Deploy");
      expect(readFileSync(cursorManagedCommand, "utf-8")).not.toContain("description: Deploy the current repo");
      expect(readFileSync(cursorUserCommand, "utf-8")).toContain("Keep my local workflow");
    });
  }, 120_000);
});
