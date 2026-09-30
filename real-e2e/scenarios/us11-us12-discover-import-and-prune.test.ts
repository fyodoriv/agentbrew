import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { runScenarioCli, runScenarioEval, runWithScenarioSandbox } from "../../src/real-e2e/scenario-fixture.js";

async function saveSandboxState(repoRoot: string, homeDir: string, statements: string[]): Promise<void> {
  await runScenarioEval({ repoRoot, homeDir, args: [], statements });
}

describe("us11/us12 discover, import, and prune", () => {
  it("imports user-added MCP servers, then prunes only the managed entry on a later sync", async () => {
    await runWithScenarioSandbox("us11-us12-discover-import-and-prune", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const homeDir = join(rootDir, "home");
      const agentsModule = pathToFileURL(join(repoRoot, "src", "agents.ts")).href;
      const stateModule = pathToFileURL(join(repoRoot, "src", "state.ts")).href;
      // Post-slice-4a (PR #845): cursor is intersection-delegated and
      // its config file isn't read by native discover/import/prune.
      // The discover/import/prune feature is exercised via a carve-out
      // client (`kiro`) — the fixture's user-manual entry was moved to
      // `.kiro/settings/mcp.json` so the same flow runs end-to-end.
      const kiroMcpPath = join(homeDir, ".kiro", "settings", "mcp.json");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });

      await saveSandboxState(repoRoot, homeDir, [
        `import { detectAgents } from ${JSON.stringify(agentsModule)};`,
        `import { defaultState, saveState } from ${JSON.stringify(stateModule)};`,
        "const agents = detectAgents().map(({ commandTransform, ...rest }) => rest);",
        "saveState({ ...defaultState(), agents, mcpServers: [] });",
      ]);

      // PR #874 (compact output mode) silences the per-server discovery hint
      // ("found user-manual, run `agentbrew import` to track it") in default
      // sync output. `--verbose` opts back into the detailed summary the
      // discover/import/prune flow needs to surface to users.
      const syncResult = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["sync", "--no-recommended", "--verbose"],
      });
      expect(syncResult.stdout).toContain("user-manual");
      expect(syncResult.stdout).toContain("agentbrew import");

      // PR #874 (compact output mode) silences `log.log()` calls including
      // the discover details line. `--verbose` opts back into the detailed
      // per-server listing the user explicitly asked for via `--discover`.
      const discoverResult = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["sync", "--no-recommended", "--discover", "--verbose"],
      });
      expect(discoverResult.stdout).toContain("Discovered 1 server(s) not in agentbrew");
      expect(discoverResult.stdout).toContain("+ user-manual (found in kiro)");

      const importResult = await runScenarioCli({ repoRoot, homeDir, args: ["import", "--from", "kiro"] });
      expect(importResult.stdout).toContain("+ user-manual");
      expect(importResult.stdout).toContain("1 imported");

      const importedState = readFileSync(join(homeDir, ".config", "agentbrew", "state.yaml"), "utf-8");
      expect(importedState).toContain("name: user-manual");
      expect(readFileSync(kiroMcpPath, "utf-8")).toContain('"user-manual"');

      const kiroMcpWithExtra = JSON.parse(readFileSync(kiroMcpPath, "utf-8")) as {
        mcpServers?: Record<string, { command?: string; args?: string[] }>;
        theme?: string;
      };
      kiroMcpWithExtra.mcpServers = {
        ...kiroMcpWithExtra.mcpServers,
        "user-extra": {
          command: "node",
          args: ["extra-server.js"],
        },
      };
      writeFileSync(kiroMcpPath, `${JSON.stringify(kiroMcpWithExtra, null, 2)}\n`, "utf-8");

      await saveSandboxState(repoRoot, homeDir, [
        `import { loadState, saveState } from ${JSON.stringify(stateModule)};`,
        "const state = loadState();",
        "saveState({ ...state, mcpServers: [] });",
      ]);

      // Compact mode silences the per-server prune log; verbose surfaces it.
      const pruneResult = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["sync", "--no-recommended", "--verbose"],
      });
      expect(pruneResult.stdout).toContain("pruned");
      expect(pruneResult.stdout).toContain("user-extra");

      const kiroMcpAfterPrune = readFileSync(kiroMcpPath, "utf-8");
      expect(kiroMcpAfterPrune).not.toContain('"user-manual"');
      expect(kiroMcpAfterPrune).toContain('"user-extra"');
    });
  }, 120_000);
});
