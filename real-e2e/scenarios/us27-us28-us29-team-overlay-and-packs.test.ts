import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  copyFixtureDirectories,
  runScenarioCli,
  runWithScenarioSandbox,
  seedScenarioState,
} from "../../src/real-e2e/scenario-fixture.js";

// US27: `agentbrew team set <url>` layers an overlay's skill sources and memory
// packs on top of the generic setup. US28: `team unset` reverses it exactly,
// the contract each overlay's own quickstart and uninstall scripts wrap.
// US29: overlay memory packs are discovered, and a missing pack fails clearly.

function initOverlayRepo(dir: string): void {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=e2e", "-c", "user.email=e2e@example.com", "commit", "-q", "-m", "overlay");
}

const listPacks = (output: string) => (JSON.parse(output) as { packs: { id: string }[] }).packs.map((p) => p.id);

describe("us27 us28 us29 team overlay and memory packs", () => {
  it("sets an overlay, finds its memory pack, and unsets it cleanly", async () => {
    await runWithScenarioSandbox("us27-us28-us29-team-overlay-and-packs", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const overlayDir = join(rootDir, "overlay");
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      copyFixtureDirectories(fixtureDir, [
        { from: "home", to: homeDir },
        { from: "overlay", to: overlayDir },
      ]);
      initOverlayRepo(overlayDir);
      await seedScenarioState(homeDir, repoRoot);
      const statePath = join(homeDir, ".config", "agentbrew", "state.yaml");

      const set = await runScenarioCli({ repoRoot, homeDir, args: ["team", "set", `file://${overlayDir}`] });
      expect(set.stdout).toContain('Team "e2e-team" active');
      expect(readFileSync(statePath, "utf-8")).toContain("team:e2e-team");

      const status = await runScenarioCli({ repoRoot, homeDir, args: ["team", "status", "--json"] });
      expect(status.stdout).toContain('"label": "e2e-team"');

      const packs = await runScenarioCli({ repoRoot, homeDir, args: ["memory", "pack", "list", "--json"] });
      expect(listPacks(packs.stdout)).toContain("team-pack");

      const unset = await runScenarioCli({ repoRoot, homeDir, args: ["team", "unset"] });
      expect(unset.stdout).toContain('Team "e2e-team" unset');
      expect(readFileSync(statePath, "utf-8")).not.toContain("team:e2e-team");
      const after = await runScenarioCli({ repoRoot, homeDir, args: ["memory", "pack", "list", "--json"] });
      expect(listPacks(after.stdout)).not.toContain("team-pack");
      const none = await runScenarioCli({ repoRoot, homeDir, args: ["team", "status"] });
      expect(none.stdout).toContain("No team overlay set.");
    });
  }, 90_000);

  it("fails with a clear message for a pack that no search path holds", async () => {
    await runWithScenarioSandbox("us27-us28-us29-team-overlay-and-packs", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      copyFixtureDirectories(fixtureDir, [{ from: "home", to: homeDir }]);
      await seedScenarioState(homeDir, repoRoot);

      const failed = await runScenarioCli({
        repoRoot,
        homeDir,
        args: ["memory", "pack", "install", "no-such-pack"],
      }).then(
        () => undefined,
        (error: { code?: number; stderr?: string }) => error,
      );
      expect(failed?.code).toBe(1);
      expect(failed?.stderr).toContain("Pack not found: no-such-pack");
    });
  }, 60_000);
});
