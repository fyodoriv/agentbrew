import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  copyFixtureDirectories,
  runScenarioCli,
  runWithScenarioSandbox,
  seedScenarioState,
} from "../../src/real-e2e/scenario-fixture.js";

describe("us23 cross-repo discovery", () => {
  it("runs the real CLI from a project checkout and deploys Agentfile MCP servers", async () => {
    await runWithScenarioSandbox("us23-cross-repo-discovery", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const projectDir = join(rootDir, "team-app");
      const repoRoot = resolve(import.meta.dirname, "..", "..");

      copyFixtureDirectories(fixtureDir, [
        { from: "home", to: homeDir },
        { from: "project", to: projectDir },
      ]);

      await seedScenarioState(homeDir, repoRoot);

      const result = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["sync", "--only", "mcp", "--sequential", "--agentfile", join(projectDir, "Agentfile.yaml")],
      });

      expect(result.stdout).toContain("Agentfile applied");
      // PR #874 (compact output mode) replaced `Syncing 2 MCP servers`
      // with `Syncing: mcp` plus a single `✓ Synced` summary.
      expect(result.stdout).toContain("Syncing: mcp");

      // Post-slice-4a (PR #845) of `delegate-mcp-to-mcpm`: cursor is in
      // the 9-agent mcpm intersection, so native sync no longer writes
      // `.cursor/mcp.json` — `mcpm client edit` is the path now. Assert
      // against the carve-out client `kiro` (`~/.kiro/settings/mcp.json`)
      // which still flows through the native sync path. The test's
      // intent (Agentfile-driven MCP servers reach a real client config)
      // is preserved by re-targeting to the carve-out.
      const kiroMcp = JSON.parse(readFileSync(join(homeDir, ".kiro", "settings", "mcp.json"), "utf-8")) as {
        mcpServers?: Record<string, { command?: string; args?: string[] }>;
      };

      expect(kiroMcp.mcpServers?.["team-api"]).toEqual({
        command: "node",
        args: ["api-server.js"],
      });
      expect(kiroMcp.mcpServers?.["team-db"]).toEqual({
        command: "npx",
        args: ["-y", "@team/db-mcp"],
      });
    });
  }, 30_000);
});
