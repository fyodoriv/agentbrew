import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  copyFixtureDirectories,
  runScenarioCli,
  runWithScenarioSandbox,
  seedScenarioState,
} from "../../src/real-e2e/scenario-fixture.js";

/**
 * us10 — personal data survives an authoritative `agentbrew sync --agentfile <path>`
 * and the agent files can be rolled back.
 *
 * The original us09-us10 scenario combined two invariants ("team config applies"
 * + "personal data survives"). The dedicated `agentbrew team` command family was
 * removed (CHANGELOG 2026-04-24); the surviving invariant — that an authoritative
 * Agentfile sync layers on top of personal config without clobbering it — is
 * exercised here by pointing `--agentfile` at a checked-in shared file (the same
 * shape a teammate would clone).
 */
describe("us10 data safety — authoritative agentfile sync preserves personal config", () => {
  it("applies an authoritative Agentfile without clobbering personal config and can roll back agent files", async () => {
    await runWithScenarioSandbox("us10-data-safety-with-shared-agentfile", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const homeDir = join(rootDir, "home");
      const sharedAgentfilePath = join(rootDir, "shared-agentfile", "Agentfile.yaml");
      const augmentRulesPath = join(homeDir, ".augment", "guidelines.md");
      // Post-slice-4a (PR #845): cursor is intersection-delegated, so
      // the data-safety invariant (Agentfile-driven MCP add doesn't
      // clobber personal config) is exercised against the carve-out
      // client `kiro` whose `~/.kiro/settings/mcp.json` still flows
      // through native sync.
      const kiroMcpPath = join(homeDir, ".kiro", "settings", "mcp.json");
      const backupDir = join(homeDir, ".config", "agentbrew", "backups");

      copyFixtureDirectories(fixtureDir, [{ from: "home", to: homeDir }]);

      mkdirSync(join(homeDir, ".augment"), { recursive: true });
      writeFileSync(augmentRulesPath, "# Personal Notes\nKeep my local workflow.\n", "utf-8");
      await seedScenarioState(homeDir, repoRoot);

      // Stand up the shared Agentfile that a teammate would normally clone — same
      // shape, just kept as a plain file on disk for the test sandbox.
      mkdirSync(join(rootDir, "shared-agentfile"), { recursive: true });
      writeFileSync(
        sharedAgentfilePath,
        [
          "mcp:",
          "  - name: team-docs",
          "    command: npx",
          "    args:",
          "      - -y",
          "      - '@acme/docs-mcp'",
          "rules: |",
          "  ## Team Rules",
          "  - Run tests before committing",
          "  - Never overwrite personal notes",
        ].join("\n"),
        "utf-8",
      );

      const deployResult = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["sync", "--sequential", "--only", "mcp,rules", "--agentfile", sharedAgentfilePath],
      });
      // PR #874 (compact output mode) replaced per-module headers with the unified
      // `Syncing: <surfaces>` line plus a single `✓ Synced` summary.
      expect(deployResult.stdout).toContain("Syncing: mcp, rules");

      const kiroMcp = JSON.parse(readFileSync(kiroMcpPath, "utf-8")) as {
        mcpServers?: Record<string, { command?: string; args?: string[] }>;
      };
      expect(kiroMcp.mcpServers?.["personal-notes"]).toEqual({
        command: "node",
        args: ["personal-notes.js"],
      });
      expect(kiroMcp.mcpServers?.["team-docs"]).toEqual({
        command: "npx",
        args: ["-y", "@acme/docs-mcp"],
      });

      const augmentRules = readFileSync(augmentRulesPath, "utf-8");
      expect(augmentRules).toContain("# Personal Notes");
      expect(augmentRules).toContain("Keep my local workflow.");
      expect(augmentRules).toContain("## Team Rules");
      expect(augmentRules).toContain("Run tests before committing");
      expect(existsSync(backupDir)).toBe(true);

      writeFileSync(kiroMcpPath, '{"mcpServers":{"corrupted":{}}}\n', "utf-8");
      writeFileSync(augmentRulesPath, "# Broken\n", "utf-8");

      const rollbackResult = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["sync", "--rollback"],
      });
      expect(rollbackResult.stdout).toContain("Restored");

      expect(readFileSync(kiroMcpPath, "utf-8")).toContain("personal-notes");
      expect(readFileSync(kiroMcpPath, "utf-8")).not.toContain("team-docs");
      expect(readFileSync(augmentRulesPath, "utf-8")).toContain("# Personal Notes");
      expect(readFileSync(augmentRulesPath, "utf-8")).not.toContain("## Team Rules");
    });
  }, 120_000);
});
