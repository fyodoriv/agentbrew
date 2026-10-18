import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  copyFixtureDirectories,
  runScenarioCli,
  runWithScenarioSandbox,
  seedScenarioState,
} from "../../src/real-e2e/scenario-fixture.js";

// US26: `agentbrew sync --rollback` restores agent configs from the snapshot
// that the last sync took before it wrote anything.

describe("us26 rollback", () => {
  it("says there is no snapshot before the first sync", async () => {
    await runWithScenarioSandbox("us26-rollback", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      copyFixtureDirectories(fixtureDir, [{ from: "home", to: homeDir }]);
      await seedScenarioState(homeDir, repoRoot);

      const result = await runScenarioCli({ repoRoot, homeDir, args: ["sync", "--rollback"] });
      expect(result.stderr).toContain("No config snapshots found");
    });
  }, 60_000);

  it("restores the config as it was before the last sync", async () => {
    await runWithScenarioSandbox("us26-rollback", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const projectDir = join(rootDir, "project");
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      copyFixtureDirectories(fixtureDir, [
        { from: "home", to: homeDir },
        { from: "project", to: projectDir },
      ]);
      await seedScenarioState(homeDir, repoRoot);

      const kiroConfig = join(homeDir, ".kiro", "settings", "mcp.json");
      const before = '{"mcpServers":{"hand-made":{"command":"node","args":["mine.js"]}}}\n';
      writeFileSync(kiroConfig, before, "utf-8");

      await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["sync", "--only", "mcp", "--sequential", "--agentfile", join(projectDir, "Agentfile.yaml")],
      });
      expect(readFileSync(kiroConfig, "utf-8")).toContain("team-api");

      const result = await runScenarioCli({ repoRoot, homeDir, args: ["sync", "--rollback"] });
      expect(result.stdout).toContain("Restored");
      expect(readFileSync(kiroConfig, "utf-8")).toBe(before);
    });
  }, 60_000);
});
