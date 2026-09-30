import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { runWithScenarioSandbox } from "../../src/real-e2e/scenario-fixture.js";

const execFileAsync = promisify(execFile);

describe("us01 get started", () => {
  it("runs the real init flow in a sandboxed home directory", async () => {
    await runWithScenarioSandbox("us01-get-started", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const repoRoot = resolve(import.meta.dirname, "..", "..");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });
      mkdirSync(join(homeDir, ".claude", "skills"), { recursive: true });
      mkdirSync(join(homeDir, ".codex"), { recursive: true });

      const result = await execFileAsync(
        process.execPath,
        ["--import", "tsx", join(repoRoot, "src", "cli.ts"), "init", "--skip-install", "--skip-sync"],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: homeDir,
            SHELL: "/bin/zsh",
          },
        },
      );

      expect(result.stdout).toContain("Detecting agents");
      expect(result.stdout).toContain("State saved");

      const statePath = join(homeDir, ".config", "agentbrew", "state.yaml");
      const shellHookPath = join(homeDir, ".config", "agentbrew", "shell-hook.sh");
      const zshrcPath = join(homeDir, ".zshrc");
      const launchAgentPath = join(homeDir, "Library", "LaunchAgents", "com.agentbrew.check.plist");

      expect(existsSync(statePath)).toBe(true);
      expect(readFileSync(statePath, "utf-8")).toContain("name: claude-code");
      expect(readFileSync(statePath, "utf-8")).toContain("name: codex");

      expect(existsSync(shellHookPath)).toBe(true);
      expect(readFileSync(shellHookPath, "utf-8")).toContain("# agentbrew shell hook");

      expect(readFileSync(zshrcPath, "utf-8")).toContain("agentbrew shell hook");
      expect(existsSync(launchAgentPath)).toBe(true);
    });
  }, 120_000);
});
