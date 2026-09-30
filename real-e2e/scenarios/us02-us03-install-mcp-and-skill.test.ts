import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { runScenarioCli, runScenarioEval, runWithScenarioSandbox } from "../../src/real-e2e/scenario-fixture.js";

const execFileAsync = promisify(execFile);

describe("us02/us03 install mcp and skill", () => {
  it("installs one shipped skill and one shipped MCP server through the real CLI", async () => {
    await runWithScenarioSandbox("us02-us03-install-mcp-and-skill", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const agentsModule = pathToFileURL(join(repoRoot, "src", "agents.ts")).href;
      const stateModule = pathToFileURL(join(repoRoot, "src", "state.ts")).href;
      const extraEnv = { AGENTBREW_MCPM_BIN: join(rootDir, "missing-mcpm") };
      const sourceCacheDir = join(homeDir, ".cache", "agentbrew", "sources", "obra_superpowers");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });
      mkdirSync(join(homeDir, ".claude", "skills"), { recursive: true });
      mkdirSync(join(homeDir, ".cursor", "skills"), { recursive: true });
      mkdirSync(join(sourceCacheDir, "verification-before-completion"), { recursive: true });

      await execFileAsync("git", ["init"], { cwd: sourceCacheDir });
      writeFileSync(
        join(sourceCacheDir, "verification-before-completion", "SKILL.md"),
        "# Verification Before Completion\n\nAlways verify before claiming done.\n",
        "utf-8",
      );

      await execFileAsync("git", ["config", "hooks.skipBranchCheck", "true"], { cwd: sourceCacheDir });
      await execFileAsync("git", ["add", "."], { cwd: sourceCacheDir });
      await execFileAsync(
        "git",
        [
          "-c",
          "user.name=AgentBrew Real E2E",
          "-c",
          "user.email=agentbrew-real-e2e@example.com",
          "commit",
          "-m",
          "chore: seed fixture cache",
        ],
        { cwd: sourceCacheDir },
      );

      await runScenarioEval({
        repoRoot,
        homeDir,
        args: [],
        statements: [
          `import { detectAgents } from ${JSON.stringify(agentsModule)};`,
          `import { defaultState, saveState } from ${JSON.stringify(stateModule)};`,
          "const agents = detectAgents().map(({ commandTransform, ...rest }) => rest);",
          "saveState({ ...defaultState(), agents });",
        ],
      });

      const skillInstall = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["install", "verification-before-completion"],
        extraEnv,
      });

      const mcpInstall = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["install", "context7"],
        extraEnv,
      });

      expect(skillInstall.stdout).toContain("Installing skill: verification-before-completion");
      expect(mcpInstall.stdout).toContain("Installing MCP server: context7");

      expect(
        existsSync(join(homeDir, ".config", "agentbrew", "installed-skills", "verification-before-completion")),
      ).toBe(true);
      expect(existsSync(join(homeDir, ".claude", "skills", "verification-before-completion"))).toBe(true);
      expect(existsSync(join(homeDir, ".cursor", "skills", "verification-before-completion"))).toBe(true);

      const stateYaml = readFileSync(join(homeDir, ".config", "agentbrew", "state.yaml"), "utf-8");
      expect(stateYaml).toContain("verification-before-completion");
      expect(stateYaml).toContain("context7");
      expect(stateYaml).toContain("label: installed-skills");

      // Post-slice-4a (PR #845) of `delegate-mcp-to-mcpm`: cursor and
      // claude-code are in the 9-agent mcpm intersection, so native
      // sync NO LONGER writes their MCP config files —
      // `mcpm client edit <client>` (slice 3b) is the path now. This
      // test points AGENTBREW_MCPM_BIN at a missing binary, so the subprocess
      // call soft-skips and `.cursor/mcp.json` / `.claude.json` stay
      // unwritten. Carve-out clients (kiro, amp, devin, etc.) would
      // still get native writes — those are exercised by the unit
      // tests in `src/sync/mcp-sync.test.ts § slice 4a`.
      //
      // What this test still verifies end-to-end: catalog install
      // resolves the entry, agentbrew state.yaml records both the
      // skill and the MCP server, and skill symlinks land in the
      // expected per-agent directories. The MCP-write side became a
      // unit-test concern after slice 4a flipped the cutover.
    });
  }, 60_000);
});
