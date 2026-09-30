import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { runScenarioCli, runWithScenarioSandbox, seedScenarioState } from "../../src/real-e2e/scenario-fixture.js";

const RULES_START = "<!-- agentbrew:start -->";
const RULES_END = "<!-- agentbrew:end -->";

function stripRulesBlock(content: string): string {
  const start = content.indexOf(RULES_START);
  const end = content.indexOf(RULES_END);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return `${content.slice(0, start)}${content.slice(end + RULES_END.length).trimStart()}`;
}

describe("us04/us06 rules drift", () => {
  it("syncs rules, repairs managed drift, and preserves user-owned rules files", async () => {
    await runWithScenarioSandbox("us04-us06-rules-drift", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const homeDir = join(rootDir, "home");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });
      await seedScenarioState(homeDir, repoRoot);

      await runScenarioCli({
        args: ["sync", "--only", "instructions", "--sequential"],
        cwd: rootDir,
        homeDir,
        repoRoot,
      });

      const initialSync = await runScenarioCli({
        args: ["sync", "--only", "rules", "--sequential"],
        cwd: rootDir,
        homeDir,
        repoRoot,
      });
      expect(initialSync.stdout).toContain("Syncing: rules");

      const augmentRules = join(homeDir, ".augment", "guidelines.md");
      const syncedContent = readFileSync(augmentRules, "utf-8");
      expect(syncedContent).toContain(RULES_START);
      expect(syncedContent).toContain("# Shared Team Rules");
      expect(syncedContent).toContain("- Always explain why a command is risky.");
      expect(syncedContent).toContain(RULES_END);
      expect(syncedContent).toContain("Keep this Augment rule note.");

      const windsurfManagedRule = join(homeDir, ".windsurf", "rules", "review-check.mdc");
      const windsurfUserRule = join(homeDir, ".windsurf", "rules", "local-only.mdc");
      expect(readFileSync(windsurfManagedRule, "utf-8")).toContain("Flag missing verification evidence.");
      expect(readFileSync(windsurfUserRule, "utf-8")).toContain("Keep this local-only rulesDir file.");

      writeFileSync(augmentRules, stripRulesBlock(syncedContent), "utf-8");

      const repairResult = await runScenarioCli({
        args: ["status", "--fix"],
        cwd: rootDir,
        homeDir,
        repoRoot,
      });
      expect(repairResult.stdout).toContain("auto-repairing");
      expect(repairResult.stderr).toContain("augment [rules] — no managed section");
      expect(repairResult.stdout).toContain("All drift resolved");

      const repairedContent = readFileSync(augmentRules, "utf-8");
      expect(repairedContent).toContain(RULES_START);
      expect(repairedContent).toContain("- Always explain why a command is risky.");
      expect(repairedContent).toContain(RULES_END);
      expect(repairedContent).toContain("Keep this Augment rule note.");
      expect(readFileSync(windsurfUserRule, "utf-8")).toContain("Keep this local-only rulesDir file.");
    });
  }, 120_000);
});
