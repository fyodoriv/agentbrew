import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { runScenarioCli, runWithScenarioSandbox, seedScenarioState } from "../../src/real-e2e/scenario-fixture.js";

// US01: one command starts agentbrew. Bare `agentbrew` is the only command
// the user types; it prints the state, what needs them, and the exact next
// command, and it writes nothing. `config set` round-trips one setting.

describe("us01 one command start", () => {
  it("bare agentbrew shows the next command on a fresh and on a set-up machine, and config set round-trips", async () => {
    await runWithScenarioSandbox("us01-get-started", async ({ rootDir }) => {
      const homeDir = join(rootDir, "home");
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      mkdirSync(join(homeDir, ".claude"), { recursive: true });
      const agentbrewDir = join(homeDir, ".config", "agentbrew");

      // Fresh machine: one command, a short screen with the exact next command, no writes.
      const fresh = await runScenarioCli({ repoRoot, homeDir, args: [] });
      expect(fresh.stdout).toContain("not initialized");
      expect(fresh.stdout).toMatch(/Next: agentbrew init/);
      expect(existsSync(agentbrewDir)).toBe(false);

      // Set-up machine: state, then a Next line with the exact command.
      await seedScenarioState(homeDir, repoRoot);
      const before = readdirSync(agentbrewDir).sort();
      const dashboard = await runScenarioCli({ repoRoot, homeDir, args: [] });
      expect(dashboard.stdout).toContain("agentbrew status");
      expect(dashboard.stdout).toMatch(/Next: agentbrew \S+/);
      expect(dashboard.stdout).toContain("agentbrew config set <key> <value>");
      expect(readdirSync(agentbrewDir).sort()).toEqual(before);

      // Happy path: config set saves one value; config shows it with its source.
      await runScenarioCli({ repoRoot, homeDir, args: ["config", "set", "claudePermissions", "keep"] });
      const shown = await runScenarioCli({ repoRoot, homeDir, args: ["config", "--json"] });
      const { settings } = JSON.parse(shown.stdout) as {
        settings: Array<{ key: string; value: string; source: string }>;
      };
      expect(settings.find((s) => s.key === "claudePermissions")).toEqual(
        expect.objectContaining({ value: "keep", source: "state.yaml" }),
      );

      // Error path: a value outside the allowed list fails and names the allowed values.
      const failed = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["config", "set", "claudePermissions", "off"],
      }).then(
        () => undefined,
        (error: { code?: number; stdout?: string; stderr?: string }) => error,
      );
      expect(failed?.code).toBe(1);
      expect(failed?.stderr).toContain("Invalid value for claudePermissions: off");
      expect(failed?.stdout).toContain("Allowed values: manage, keep");
    });
  }, 120_000);
});
