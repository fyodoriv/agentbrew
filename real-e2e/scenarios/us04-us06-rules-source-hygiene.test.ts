import { cpSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_SANITIZE_VARS } from "../../src/core/env-sanitize.js";
import { runScenarioCli, runWithScenarioSandbox, seedScenarioState } from "../../src/real-e2e/scenario-fixture.js";

const OLD_WORDING = "Old delivery wording that a second rules source repeated.";
const NEW_WORDING = "Current delivery wording that every agent must receive.";

// The host agent's session vars (for example CLAUDECODE) would fail the clean status run.
const CLEAN_ENV = Object.fromEntries(DEFAULT_SANITIZE_VARS.map((name) => [name, ""]));

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("us04/us06 rules source hygiene", () => {
  it("status --fix dedupes shared-rules.md and redeploys the cleaned rules", async () => {
    await runWithScenarioSandbox("us04-us06-rules-source-hygiene", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const homeDir = join(rootDir, "home");
      const sharedRules = join(homeDir, ".config", "agentbrew", "shared-rules.md");
      const codexRules = join(homeDir, ".codex", "AGENTS.md");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });
      await seedScenarioState(homeDir, repoRoot);

      const repair = await runScenarioCli({
        args: ["status", "--fix"],
        cwd: rootDir,
        homeDir,
        repoRoot,
        extraEnv: CLEAN_ENV,
      });
      const repairOutput = `${repair.stdout}${repair.stderr}`;
      expect(repairOutput).toContain("auto-repairing");
      expect(repairOutput).toContain("[rules-source] — 1 duplicate block(s) in shared-rules.md");

      const cleaned = readFileSync(sharedRules, "utf-8");
      expect(count(cleaned, "── Delivery mandate")).toBe(1);
      expect(cleaned).not.toContain(OLD_WORDING);
      expect(cleaned).toContain(NEW_WORDING);
      expect(cleaned).toContain("Flag missing verification evidence.");

      const deployed = readFileSync(codexRules, "utf-8");
      expect(deployed).toContain("Keep this codex note.");
      expect(deployed).toContain(NEW_WORDING);
      expect(deployed).not.toContain(OLD_WORDING);

      const second = await runScenarioCli({
        args: ["status", "--fix"],
        cwd: rootDir,
        homeDir,
        repoRoot,
        extraEnv: CLEAN_ENV,
      });
      const secondOutput = `${second.stdout}${second.stderr}`;
      expect(secondOutput).not.toContain("[rules-source]");
      expect(secondOutput).not.toContain("[rules]");
      expect(secondOutput).toContain("Drift: clean");
    });
  }, 120_000);
});
