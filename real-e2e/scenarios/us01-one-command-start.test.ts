import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { runScenarioCli, runWithScenarioSandbox, seedScenarioState } from "../../src/real-e2e/scenario-fixture.js";

// US01: one command starts agentbrew. Bare `agentbrew` is the only command
// the user types; it prints the state, what needs them, and the exact next
// command, and it writes nothing. `config set` round-trips one setting.

/** Every file under root with a hash of its content, so any write shows up. */
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (statSync(path).isFile())
        files[relative(root, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(root);
  return files;
}

describe("us01 one command start", () => {
  it("bare agentbrew shows the next command on a fresh and on a set-up machine, and config set round-trips", async () => {
    await runWithScenarioSandbox("us01-get-started", async ({ rootDir }) => {
      const homeDir = join(rootDir, "home");
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      mkdirSync(join(homeDir, ".claude"), { recursive: true });
      const agentbrewDir = join(homeDir, ".config", "agentbrew");

      // Fresh machine: one command, a short screen with the exact next command, no writes anywhere.
      const freshBefore = snapshot(rootDir);
      const fresh = await runScenarioCli({ repoRoot, homeDir, args: [] });
      expect(fresh.stdout).toContain("not initialized");
      expect(fresh.stdout).toMatch(/^ {2}Next: agentbrew init$/m);
      expect(existsSync(agentbrewDir)).toBe(false);
      expect(snapshot(rootDir)).toEqual(freshBefore);

      // Set-up machine with no skills and no repair job: state, the exact Next line, and no writes.
      await seedScenarioState(homeDir, repoRoot);
      const before = snapshot(rootDir);
      const dashboard = await runScenarioCli({ repoRoot, homeDir, args: [] });
      expect(dashboard.stdout).toContain("agentbrew status");
      expect(dashboard.stdout).toMatch(/^ {2}Next: agentbrew install --recommended$/m);
      expect(dashboard.stdout).toMatch(/^ {4}agentbrew auto-sync install +Start the drift-repair job/m);
      expect(dashboard.stdout).toContain("agentbrew config set <key> <value>");
      expect(snapshot(rootDir)).toEqual(before);

      // A saved no to the repair job: the next run no longer proposes it.
      await runScenarioCli({ repoRoot, homeDir, args: ["config", "set", "autoRepair", "off"] });
      const declined = await runScenarioCli({ repoRoot, homeDir, args: [] });
      expect(declined.stdout).not.toContain("agentbrew auto-sync install");
      expect(declined.stdout).toMatch(/Auto-repair: +off/);

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
