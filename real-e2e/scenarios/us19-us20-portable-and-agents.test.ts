import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { runWithScenarioSandbox } from "../../src/real-e2e/scenario-fixture.js";

const execFileAsync = promisify(execFile);

async function writeState(
  homeDir: string,
  repoRoot: string,
  options?: {
    agentSourceDir?: string;
    commandContent?: string;
    mcpServerName?: string;
    sharedRules?: string;
    sourceUrl?: string;
  },
): Promise<void> {
  const statements = [
    'import { mkdirSync, writeFileSync } from "node:fs";',
    'import { dirname, join } from "node:path";',
    'import { detectAgents } from "./src/agents.ts";',
    'import { defaultState, saveState } from "./src/state.ts";',
    'import { getCommandsDir } from "./src/sync/command-sync.ts";',
    'import { getSharedRulesPath } from "./src/sync/rules-sync.ts";',
    "const agents = detectAgents().map(({ commandTransform, ...rest }) => rest);",
    "const state = defaultState();",
    "state.agents = agents;",
  ];

  if (options?.mcpServerName) {
    statements.push(
      `state.mcpServers = [{ name: ${JSON.stringify(options.mcpServerName)}, command: "node", args: ["server.js"], env: {}, source: "user" }];`,
    );
  }

  if (options?.sourceUrl) {
    statements.push(
      `state.sources = [{ url: ${JSON.stringify(options.sourceUrl)}, type: "local", skillsInstalled: ["portable-helper"], availableItems: [], addedAt: "2026-04-12T00:00:00.000Z" }];`,
    );
  }

  if (options?.agentSourceDir) {
    statements.push(`state.agentSourceDirs = [{ label: "team", path: ${JSON.stringify(options.agentSourceDir)} }];`);
  }

  statements.push("saveState(state);");

  if (options?.sharedRules) {
    statements.push(
      "const sharedRulesPath = getSharedRulesPath();",
      "mkdirSync(dirname(sharedRulesPath), { recursive: true });",
      `writeFileSync(sharedRulesPath, ${JSON.stringify(options.sharedRules)}, "utf-8");`,
    );
  }

  if (options?.commandContent) {
    statements.push(
      "const commandsDir = getCommandsDir();",
      "mkdirSync(commandsDir, { recursive: true });",
      `writeFileSync(join(commandsDir, "portable-check.md"), ${JSON.stringify(options.commandContent)}, "utf-8");`,
    );
  }

  await execFileAsync(process.execPath, ["--import", "tsx", "--eval", statements.join(" ")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
    },
  });
}

async function runCli(repoRoot: string, homeDir: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("npx", ["--yes", "--prefix", repoRoot, "tsx", join(repoRoot, "src", "cli.ts"), ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
    },
  });
}

describe("us19 us20 portable and agents", () => {
  it("exports and imports a portable bundle, then syncs shared agent definitions in a real sandbox", async () => {
    await runWithScenarioSandbox("us19-us20-portable-and-agents", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const sourceHomeDir = join(rootDir, "source-home");
      const targetHomeDir = join(rootDir, "target-home");
      const bundlePath = join(rootDir, "portable-bundle.yaml");
      const agentSourceDir = join(rootDir, "shared-agents");
      const teamAgentSourceDir = join(fixtureDir, "shared-agents");

      mkdirSync(sourceHomeDir, { recursive: true });
      mkdirSync(targetHomeDir, { recursive: true });
      mkdirSync(agentSourceDir, { recursive: true });

      writeFileSync(
        join(agentSourceDir, "reviewer.md"),
        readFileSync(join(teamAgentSourceDir, "reviewer.md"), "utf-8"),
        "utf-8",
      );

      await writeState(sourceHomeDir, repoRoot, {
        commandContent: "# Portable check\n",
        mcpServerName: "portable-server",
        sharedRules: "# Shared Rules\nAlways verify portable imports.\n",
        sourceUrl: join(fixtureDir, "portable-source"),
      });
      await writeState(targetHomeDir, repoRoot, { agentSourceDir });

      const exportResult = await runCli(repoRoot, sourceHomeDir, ["export", "-o", bundlePath]);
      expect(exportResult.stdout).toContain("Exported to:");
      expect(existsSync(bundlePath)).toBe(true);

      const importResult = await runCli(repoRoot, targetHomeDir, ["import", "--bundle", bundlePath]);
      expect(importResult.stdout).toContain("Imported from:");
      expect(importResult.stdout).toContain("portable-server");

      const importedState = readFileSync(join(targetHomeDir, ".config", "agentbrew", "state.yaml"), "utf-8");
      expect(importedState).toContain("portable-server");
      expect(importedState).toContain(join(fixtureDir, "portable-source"));

      const importedRules = readFileSync(join(targetHomeDir, ".config", "agentbrew", "shared-rules.md"), "utf-8");
      expect(importedRules).toContain("Always verify portable imports.");

      const importedCommand = readFileSync(
        join(targetHomeDir, ".config", "agentbrew", "commands", "portable-check.md"),
        "utf-8",
      );
      expect(importedCommand).toContain("# Portable check");

      // The dedicated `agents sync` subcommand was removed in favor of
      // `agentbrew sync --only agents` (unified scoped-sync surface).
      // PR #874 (compact output mode) replaced `Syncing 1 agent definitions`
      // with `Syncing: agents` plus a single `✓ Synced` summary.
      const syncResult = await runCli(repoRoot, targetHomeDir, ["sync", "--only", "agents"]);
      expect(syncResult.stdout).toContain("Syncing: agents");

      expect(readFileSync(join(targetHomeDir, ".claude", "agents", "reviewer.md"), "utf-8")).toContain("reviewer");
      expect(readFileSync(join(targetHomeDir, ".cursor", "agents", "reviewer.md"), "utf-8")).toContain("reviewer");
      expect(readFileSync(join(targetHomeDir, ".codex", "agents", "reviewer.md"), "utf-8")).toContain("reviewer");
      expect(
        readFileSync(join(targetHomeDir, ".config", "devin", "agents", "reviewer", "AGENT.md"), "utf-8"),
      ).toContain("reviewer");
    });
  }, 120_000);
});
