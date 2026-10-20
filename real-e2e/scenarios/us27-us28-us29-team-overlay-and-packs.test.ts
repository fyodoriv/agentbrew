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

// US27: a company ships its setup as a signed plugin; `team set` (removed in
// 1.0) explains the migration instead. US28: `plugin add` and `plugin remove`
// are the install and uninstall pair. US29: a missing memory pack fails clearly.

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

/** Commit the overlay and SSH-sign tag v1; return the signer's public key. */
function signedRepo(dir: string, keyDir: string): string {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env: GIT_ENV, stdio: "pipe" });
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "", "-f", join(keyDir, "signer")]);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=e2e", "-c", "user.email=e2e@example.com", "commit", "-q", "-m", "overlay");
  git("-c", "gpg.format=ssh", "-c", `user.signingkey=${join(keyDir, "signer")}`, "tag", "-s", "v1", "-m", "v1");
  return readFileSync(join(keyDir, "signer.pub"), "utf-8").trim();
}

const failure = (error: { code?: number; stderr?: string }) => error;

describe("us27 us28 us29 company plugins and memory packs", () => {
  it("team set explains the 1.0 migration; plugin migrate, add, list, and remove work end to end", async () => {
    await runWithScenarioSandbox("us27-us28-us29-team-overlay-and-packs", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const overlayDir = join(rootDir, "overlay");
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      copyFixtureDirectories(fixtureDir, [
        { from: "home", to: homeDir },
        { from: "overlay", to: overlayDir },
      ]);
      const signer = signedRepo(overlayDir, rootDir);
      await seedScenarioState(homeDir, repoRoot);
      const extraEnv = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

      const team = await runScenarioCli({ repoRoot, homeDir, args: ["team", "set", `file://${overlayDir}`] }).then(
        () => undefined,
        failure,
      );
      expect(team?.code).toBe(1);
      expect(team?.stderr).toContain("removed in agentbrew 1.0");

      const draft = await runScenarioCli({ repoRoot, homeDir, args: ["plugin", "migrate", overlayDir] });
      expect(draft.stdout).toContain("name: e2e-team");

      const add = await runScenarioCli({
        repoRoot,
        homeDir,
        extraEnv,
        args: ["plugin", "add", `file://${overlayDir}@v1`, "--yes", "--signer", signer],
      });
      expect(add.stdout).toContain("Plugin e2e-team pinned");
      const listed = await runScenarioCli({ repoRoot, homeDir, args: ["plugin", "list", "--json"] });
      expect(JSON.parse(listed.stdout).map((p: { name: string }) => p.name)).toEqual(["e2e-team"]);

      await runScenarioCli({ repoRoot, homeDir, args: ["plugin", "remove", "e2e-team"] });
      const after = await runScenarioCli({ repoRoot, homeDir, args: ["plugin", "list", "--json"] });
      expect(JSON.parse(after.stdout)).toEqual([]);
    });
  }, 120_000);

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
      }).then(() => undefined, failure);
      expect(failed?.code).toBe(1);
      expect(failed?.stderr).toContain("Pack not found: no-such-pack");
    });
  }, 60_000);
});
