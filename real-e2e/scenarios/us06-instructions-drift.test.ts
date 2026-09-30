import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { runScenarioCli, runWithScenarioSandbox, seedScenarioState } from "../../src/real-e2e/scenario-fixture.js";

const INSTRUCTIONS_START = "<!-- agentbrew:instructions:start -->";
const INSTRUCTIONS_END = "<!-- agentbrew:instructions:end -->";

function stripInstructionsBlock(content: string): string {
  const start = content.indexOf(INSTRUCTIONS_START);
  const end = content.indexOf(INSTRUCTIONS_END);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return `${content.slice(0, start)}${content.slice(end + INSTRUCTIONS_END.length).trimStart()}`;
}

describe("us06 instructions drift", () => {
  it("syncs instructions, repairs managed drift, and preserves user-owned prose", async () => {
    await runWithScenarioSandbox("us06-instructions-drift", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const homeDir = join(rootDir, "home");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });
      await seedScenarioState(homeDir, repoRoot);

      const initialSync = await runScenarioCli({
        args: ["sync", "--only", "instructions", "--sequential"],
        cwd: rootDir,
        homeDir,
        repoRoot,
      });
      expect(initialSync.stdout).toContain("Syncing: instructions");

      const augmentInstructions = join(homeDir, ".augment", "guidelines.md");
      const syncedContent = readFileSync(augmentInstructions, "utf-8");
      expect(syncedContent).toContain(INSTRUCTIONS_START);
      expect(syncedContent).toContain("# Global Agent Context");
      expect(syncedContent).toContain(INSTRUCTIONS_END);
      expect(syncedContent).toContain("Keep this Augment-only note.");

      writeFileSync(augmentInstructions, stripInstructionsBlock(syncedContent), "utf-8");

      const repairResult = await runScenarioCli({
        args: ["status", "--fix"],
        cwd: rootDir,
        homeDir,
        repoRoot,
      });
      expect(repairResult.stdout).toContain("auto-repairing");
      expect(repairResult.stderr).toContain("augment [instructions] — instructions out of date");
      expect(repairResult.stdout).toContain("All drift resolved");

      const repairedContent = readFileSync(augmentInstructions, "utf-8");
      expect(repairedContent).toContain(INSTRUCTIONS_START);
      expect(repairedContent).toContain("# Global Agent Context");
      expect(repairedContent).toContain(INSTRUCTIONS_END);
      expect(repairedContent).toContain("Keep this Augment-only note.");
    });
  }, 120_000);
});
