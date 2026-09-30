import { execFile } from "node:child_process";
import { cpSync, existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { runWithScenarioSandbox } from "../../src/real-e2e/scenario-fixture.js";

const execFileAsync = promisify(execFile);

async function runCli(repoRoot: string, homeDir: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, ["--import", "tsx", join(repoRoot, "src", "cli.ts"), ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
    },
  });
}

describe("us07/us17 source and existing setup", () => {
  it("adds a source on top of an existing setup without losing manual config", async () => {
    await runWithScenarioSandbox("us07-us17-source-and-existing-setup", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const homeDir = join(rootDir, "home");
      const sourceDir = join(rootDir, "source-repo");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });
      cpSync(join(fixtureDir, "source-repo"), sourceDir, { recursive: true });

      const initResult = await runCli(repoRoot, homeDir, ["init", "--skip-install", "--skip-sync"]);
      expect(initResult.stdout).toContain("Discovering existing config");
      expect(initResult.stdout).toContain("MCP servers:");

      const addSourceResult = await runCli(repoRoot, homeDir, ["install", sourceDir, "--yes"]);
      expect(addSourceResult.stdout).toContain("Source registered");

      const catalogResult = await runCli(repoRoot, homeDir, ["catalog", "--search", "source-debug-skill"]);
      expect(catalogResult.stdout).toContain("source-debug-skill");
      expect(catalogResult.stdout).toContain(sourceDir);

      const stateYaml = readFileSync(join(homeDir, ".config", "agentbrew", "state.yaml"), "utf-8");
      expect(stateYaml).toContain("user-postgres");
      expect(stateYaml).toContain(sourceDir);
      expect(stateYaml).toContain("source-debug-skill");

      const cursorMcp = readFileSync(join(homeDir, ".cursor", "mcp.json"), "utf-8");
      expect(cursorMcp).toContain('"user-postgres"');

      const manualSkillDir = join(homeDir, ".claude", "skills", "manual-review");
      expect(existsSync(manualSkillDir)).toBe(true);
      expect(lstatSync(manualSkillDir).isDirectory()).toBe(true);
      expect(existsSync(join(manualSkillDir, "SKILL.md"))).toBe(true);
    });
  }, 120_000);
});
