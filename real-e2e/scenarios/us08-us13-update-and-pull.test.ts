import { cpSync, existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { runScenarioCli, runWithScenarioSandbox } from "../../src/real-e2e/scenario-fixture.js";

describe("us08/us13 update and pull", () => {
  it("refreshes local source content via sync --pull without removing manual config", async () => {
    await runWithScenarioSandbox("us08-us13-update-and-pull", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const homeDir = join(rootDir, "home");
      const sourceDir = join(rootDir, "source-repo");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });
      cpSync(join(fixtureDir, "source-repo"), sourceDir, { recursive: true });

      const initResult = await runScenarioCli({ repoRoot, homeDir, args: ["init", "--skip-install", "--skip-sync"] });
      expect(initResult.stdout).toContain("State saved");

      const installResult = await runScenarioCli({ repoRoot, homeDir, args: ["install", sourceDir, "--yes"] });
      expect(installResult.stdout).toContain("Source registered");

      const skillInstallResult = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["install", "source-debug-skill", "--from", sourceDir],
      });
      expect(skillInstallResult.stdout).toContain("source-debug-skill");

      const syncedSkillDir = join(homeDir, ".claude", "skills", "source-debug-skill");
      expect(existsSync(syncedSkillDir)).toBe(true);
      expect(lstatSync(syncedSkillDir).isSymbolicLink()).toBe(true);
      expect(readFileSync(join(syncedSkillDir, "SKILL.md"), "utf-8")).toContain("Source Debug Skill v1");

      writeFileSync(
        join(sourceDir, "source-debug-skill", "SKILL.md"),
        "# Source Debug Skill v2\n\nUpdated after source pull.\n",
        "utf-8",
      );

      const pullResult = await runScenarioCli({ repoRoot, homeDir, args: ["sync", "--pull"] });
      expect(pullResult.stdout).toContain("Checking for updates");
      expect(pullResult.stdout).toContain("Update complete");

      expect(readFileSync(join(syncedSkillDir, "SKILL.md"), "utf-8")).toContain("Source Debug Skill v2");
      expect(readFileSync(join(homeDir, ".cursor", "mcp.json"), "utf-8")).toContain('"user-postgres"');

      const manualSkillDir = join(homeDir, ".claude", "skills", "manual-review");
      expect(existsSync(manualSkillDir)).toBe(true);
      expect(lstatSync(manualSkillDir).isDirectory()).toBe(true);
      expect(readFileSync(join(manualSkillDir, "SKILL.md"), "utf-8")).toContain("manual review skill");
    });
  }, 120_000);
});
