import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  copyFixtureDirectories,
  runScenarioCli,
  runWithScenarioSandbox,
  seedScenarioState,
} from "../../src/real-e2e/scenario-fixture.js";

describe("us16 agentfile project config", () => {
  it("runs the real CLI with an Agentfile and deploys both MCP servers and rules", async () => {
    await runWithScenarioSandbox("us16-agentfile-project-config", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const projectDir = join(rootDir, "project");
      const repoRoot = resolve(import.meta.dirname, "..", "..");

      copyFixtureDirectories(fixtureDir, [
        { from: "home", to: homeDir },
        { from: "project", to: projectDir },
      ]);

      await seedScenarioState(homeDir, repoRoot);

      const result = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["sync", "--only", "mcp,rules", "--sequential", "--agentfile", join(projectDir, "Agentfile.yaml")],
      });

      expect(result.stdout).toContain("Agentfile applied");
      expect(result.stdout).toContain("2 MCP server(s) added");
      expect(result.stdout).toContain("rules updated");

      // Post-slice-4a (PR #845): cursor is intersection-delegated, so
      // assert the Agentfile-driven MCP servers landed in a carve-out
      // client's config (kiro). See us02-us03 / us23 for the precedent.
      const kiroMcp = JSON.parse(readFileSync(join(homeDir, ".kiro", "settings", "mcp.json"), "utf-8")) as {
        mcpServers?: Record<string, { command?: string; args?: string[] }>;
      };

      expect(kiroMcp.mcpServers?.["project-db"]).toEqual({
        command: "npx",
        args: ["-y", "@team/db-mcp"],
      });
      expect(kiroMcp.mcpServers?.["project-docs"]).toEqual({
        command: "node",
        args: ["docs-server.js"],
      });

      const augmentRules = readFileSync(join(homeDir, ".augment", "guidelines.md"), "utf-8");
      expect(augmentRules).toContain("# Existing augment notes");
      expect(augmentRules).toContain("## Project Rules");
      expect(augmentRules).toContain("Always use TypeScript strict mode");
      expect(augmentRules).toContain("Prefer composition over inheritance");
      expect(augmentRules).not.toContain("stale managed rules");
    });
  }, 30_000);
});
