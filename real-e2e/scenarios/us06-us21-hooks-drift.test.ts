import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { runScenarioCli, runWithScenarioSandbox, seedScenarioState } from "../../src/real-e2e/scenario-fixture.js";

interface ClaudeHookGroup {
  matcher?: string;
  hooks: Array<Record<string, unknown>>;
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookGroup[]>;
  permissions?: { defaultMode?: string };
  skipAutoPermissionPrompt?: boolean;
  theme?: string;
}

function readClaudeSettings(settingsPath: string): ClaudeSettings {
  return JSON.parse(readFileSync(settingsPath, "utf-8")) as ClaudeSettings;
}

describe("us06/us21 hooks drift", () => {
  it("syncs hooks, repairs missing managed hooks, and preserves user hooks", async () => {
    await runWithScenarioSandbox("us06-us21-hooks-drift", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const homeDir = join(rootDir, "home");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });
      await seedScenarioState(homeDir, repoRoot);

      await runScenarioCli({
        args: ["sync", "--only", "instructions", "--sequential"],
        cwd: rootDir,
        homeDir,
        repoRoot,
      });

      const initialSync = await runScenarioCli({
        args: ["sync", "--only", "hooks", "--sequential"],
        cwd: rootDir,
        homeDir,
        repoRoot,
      });
      expect(initialSync.stdout).toContain("Syncing: hooks");

      const settingsPath = join(homeDir, ".claude", "settings.json");
      const hookScriptPath = join(homeDir, ".claude", "codeassist", "hooks-scripts", "code-no-timestamps.sh");
      let settings = readClaudeSettings(settingsPath);
      expect(settings.theme).toBe("dark");
      expect(settings.permissions?.defaultMode).toBe("bypassPermissions");
      expect(settings.skipAutoPermissionPrompt).toBe(true);
      expect(settings.hooks?.Notification?.some((group) => group.matcher === "local-only")).toBe(true);
      expect(settings.hooks?.PreToolUse?.some((group) => group.matcher === "Write|Edit")).toBe(true);
      expect(existsSync(hookScriptPath)).toBe(true);

      settings.hooks = {
        ...settings.hooks,
        PreToolUse: settings.hooks?.PreToolUse?.filter((group) => group.matcher !== "Write|Edit") ?? [],
      };
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");

      const repairResult = await runScenarioCli({
        args: ["status", "--fix"],
        cwd: rootDir,
        homeDir,
        repoRoot,
      });
      expect(repairResult.stdout).toContain("auto-repairing");
      expect(repairResult.stderr).toContain("claude-code [hooks] — missing hook(s): PreToolUse:Write|Edit");
      expect(repairResult.stdout).toContain("All drift resolved");

      settings = readClaudeSettings(settingsPath);
      expect(settings.hooks?.PreToolUse?.some((group) => group.matcher === "Write|Edit")).toBe(true);
      expect(settings.hooks?.Notification?.some((group) => group.matcher === "local-only")).toBe(true);
      expect(settings.theme).toBe("dark");
    });
  }, 120_000);
});
