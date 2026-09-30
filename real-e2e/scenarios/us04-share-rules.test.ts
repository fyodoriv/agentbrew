import { execFile } from "node:child_process";
import { cpSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { runWithScenarioSandbox } from "../../src/real-e2e/scenario-fixture.js";

const execFileAsync = promisify(execFile);

describe("us04 share rules", () => {
  it("runs the real CLI and preserves unmanaged rules content around the managed section", async () => {
    await runWithScenarioSandbox("us04-share-rules", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const repoRoot = resolve(import.meta.dirname, "..", "..");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });

      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--eval",
          [
            'import { detectAgents } from "./src/agents.ts";',
            'import { defaultState, saveState } from "./src/state.ts";',
            "const agents = detectAgents().map(({ commandTransform, ...rest }) => rest);",
            "saveState({ ...defaultState(), agents });",
          ].join(" "),
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: homeDir,
          },
        },
      );

      const result = await execFileAsync(
        process.execPath,
        ["--import", "tsx", join(repoRoot, "src", "cli.ts"), "sync", "--only", "rules", "--sequential"],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: homeDir,
          },
        },
      );

      // PR #874 (compact output mode) changed `Syncing shared rules` → `Syncing: rules`.
      expect(result.stdout).toContain("Syncing: rules");

      const augmentRules = readFileSync(join(homeDir, ".augment", "guidelines.md"), "utf-8");
      expect(augmentRules).toContain("# Existing augment notes");
      expect(augmentRules).toContain("Keep this paragraph.");
      expect(augmentRules).toContain("# Shared Team Rules");
      expect(augmentRules).toContain("- Always explain why a command is risky.");
      expect(augmentRules).not.toContain("stale managed rules");

      const codexRules = readFileSync(join(homeDir, ".codex", "AGENTS.md"), "utf-8");
      expect(codexRules).toContain("# Local codex notes");
      expect(codexRules).toContain("# Shared Team Rules");
      expect(codexRules).not.toContain("old codex managed rules");
    });
  }, 30_000);
});
