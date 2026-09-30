import { execFile } from "node:child_process";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { runWithScenarioSandbox } from "../../src/real-e2e/scenario-fixture.js";

const execFileAsync = promisify(execFile);

async function runCli(
  repoRoot: string,
  homeDir: string,
  args: string[],
  shellPath: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("npx", ["--yes", "--prefix", repoRoot, "tsx", join(repoRoot, "src", "cli.ts"), ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      SHELL: shellPath,
    },
  });
}

describe("us21 shell hooks", () => {
  it("installs shell hooks and zsh completions into the expected home-directory files", async () => {
    await runWithScenarioSandbox("us21-shell-hooks", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const homeDir = join(rootDir, "home");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });

      const completionsResult = await runCli(repoRoot, homeDir, ["completions", "install", "zsh"], "/bin/zsh");
      expect(completionsResult.stdout).toContain("Zsh completion installed");

      const completionFile = join(homeDir, ".local", "share", "zsh", "site-functions", "_agentbrew");
      expect(existsSync(completionFile)).toBe(true);
      expect(readFileSync(completionFile, "utf-8")).toContain("#compdef agentbrew");

      const hookResult = await runCli(repoRoot, homeDir, ["hook", "install", "--shell"], "/bin/zsh");
      expect(hookResult.stdout).toContain("Shell hook written");
      expect(hookResult.stdout).toContain("Added to ~/.zshrc");

      const hookFile = join(homeDir, ".config", "agentbrew", "shell-hook.sh");
      expect(existsSync(hookFile)).toBe(true);
      expect(readFileSync(hookFile, "utf-8")).toContain("_agentbrew_detect");

      const zshrcPath = join(homeDir, ".zshrc");
      const zshrcContent = readFileSync(zshrcPath, "utf-8");
      expect(zshrcContent).toContain("agentbrew completions");
      expect(zshrcContent).toContain("# agentbrew shell hook");
      expect(zshrcContent).toContain("shell-hook.sh");

      await runCli(repoRoot, homeDir, ["hook", "remove", "--shell"], "/bin/zsh");
      await runCli(repoRoot, homeDir, ["completions", "uninstall", "zsh"], "/bin/zsh");

      expect(existsSync(hookFile)).toBe(false);
      expect(existsSync(completionFile)).toBe(false);
    });
  }, 120_000);

  it("installs fish shell hooks and completions into the expected home-directory files", async () => {
    await runWithScenarioSandbox("us21-shell-hooks", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const homeDir = join(rootDir, "home");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });

      const completionsResult = await runCli(
        repoRoot,
        homeDir,
        ["completions", "install", "fish"],
        "/opt/homebrew/bin/fish",
      );
      expect(completionsResult.stdout).toContain("Fish completion installed");

      const completionFile = join(homeDir, ".config", "fish", "completions", "agentbrew.fish");
      expect(existsSync(completionFile)).toBe(true);
      expect(readFileSync(completionFile, "utf-8")).toContain("complete -c agentbrew -f");

      const hookResult = await runCli(repoRoot, homeDir, ["hook", "install", "--shell"], "/opt/homebrew/bin/fish");
      expect(hookResult.stdout).toContain("Fish hook written");
      expect(hookResult.stdout).toContain("Added to ~/.config/fish/config.fish");

      const shellHookFile = join(homeDir, ".config", "agentbrew", "shell-hook.fish");
      expect(existsSync(shellHookFile)).toBe(true);
      expect(readFileSync(shellHookFile, "utf-8")).toContain("function _agentbrew_detect --on-variable PWD");

      const fishConfigPath = join(homeDir, ".config", "fish", "config.fish");
      const fishConfigContent = readFileSync(fishConfigPath, "utf-8");
      expect(fishConfigContent).toContain("# agentbrew shell hook");
      expect(fishConfigContent).toContain('source "');
      expect(fishConfigContent).toContain("shell-hook.fish");

      await runCli(repoRoot, homeDir, ["hook", "remove", "--shell"], "/opt/homebrew/bin/fish");
      await runCli(repoRoot, homeDir, ["completions", "uninstall", "fish"], "/opt/homebrew/bin/fish");

      expect(existsSync(shellHookFile)).toBe(false);
      expect(existsSync(completionFile)).toBe(false);
    });
  }, 120_000);
});
