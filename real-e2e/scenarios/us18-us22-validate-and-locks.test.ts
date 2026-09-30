import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  copyFixtureDirectories,
  runScenarioCli,
  runWithScenarioSandbox,
  seedScenarioState,
} from "../../src/real-e2e/scenario-fixture.js";

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function createLocalSourceRepo(
  fixtureDir: string,
  rootDir: string,
): Promise<{ sourceDir: string; sourceSha: string }> {
  const sourceDir = join(rootDir, "fixture-source");
  copyFixtureDirectories(fixtureDir, [{ from: "source", to: sourceDir }]);

  await runGit(["init"], sourceDir);
  await runGit(["config", "user.name", "AgentBrew Tests"], sourceDir);
  await runGit(["config", "user.email", "agentbrew-tests@example.com"], sourceDir);
  await runGit(["add", "."], sourceDir);
  await runGit(["commit", "-m", "test: seed validate fixture"], sourceDir);

  const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: sourceDir });
  return { sourceDir, sourceSha: result.stdout.trim() };
}

async function runCli(
  repoRoot: string,
  homeDir: string,
  args: string[],
  cwd = repoRoot,
): Promise<{ stdout: string; stderr: string }> {
  return runScenarioCli({ repoRoot, homeDir, args, cwd });
}

describe("us18 us22 validate and locks", () => {
  it("validates config and verifies a locked local git source in a real sandbox", async () => {
    await runWithScenarioSandbox("us18-us22-validate-and-locks", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const projectDir = join(rootDir, "project");

      copyFixtureDirectories(fixtureDir, [
        { from: "home", to: homeDir },
        { from: "project", to: projectDir },
      ]);
      await seedScenarioState(homeDir, repoRoot);

      const { sourceDir, sourceSha } = await createLocalSourceRepo(fixtureDir, rootDir);
      // The legacy `add` alias was unified into `agentbrew install` (the
      // top-level dispatcher) before this session — local-folder paths
      // route through the same source-add code path.
      const addResult = await runCli(repoRoot, homeDir, ["install", sourceDir, "--yes"]);
      expect(addResult.stdout).toContain("Source registered");

      const lintResult = await execFileAsync(
        "npx",
        ["--yes", "--prefix", repoRoot, "tsx", join(repoRoot, "src", "cli.ts"), "lint"],
        {
          cwd: projectDir,
          env: {
            ...process.env,
            HOME: homeDir,
          },
        },
      );
      expect(lintResult.stdout).toContain("Agentfile.yaml");
      expect(lintResult.stdout).toContain("state.yaml");
      expect(lintResult.stdout).toContain("All config valid");

      const verifyResult = await runCli(repoRoot, homeDir, ["lock", "--verify"]);
      expect(verifyResult.stdout).toContain(sourceDir);
      expect(verifyResult.stdout).toContain("All sources match their locked versions");

      const lockPath = join(homeDir, ".config", "agentbrew", "agentbrew.lock");
      expect(existsSync(lockPath)).toBe(true);

      const lockContents = readFileSync(lockPath, "utf-8");
      expect(lockContents).toContain(sourceDir);
      expect(lockContents).toContain(sourceSha);
    });
  }, 120_000);
});
