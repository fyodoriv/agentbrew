/**
 * Signed plugin repos for tests of the v2 plugin contract (#208).
 * Callers must set HOME to a scratch dir and GIT_CONFIG_GLOBAL=/dev/null first.
 *
 * Every temp dir made here is deleted after the test file, even when a test
 * fails: importing this module registers an `afterAll` hook in that file.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import yaml from "js-yaml";
import { afterAll } from "vitest";

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const ID = ["-c", "user.name=t", "-c", "user.email=t@example.com"];

export function fixtureGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf-8", stdio: "pipe" }).trim();
}

/**
 * Temp dirs this module made. Test-file module scope: vitest gives each test
 * file its own copy of this module, and the afterAll hook below empties it.
 */
const made: string[] = [];
let keyDir: string | undefined;

/** A new temp dir under `tmpdir()`, deleted after the test file. */
export function fixtureDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** Delete every temp dir this module made, keys included. */
export function cleanupPluginFixtures(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  keyDir = undefined;
}

afterAll(cleanupPluginFixtures);

/** A throwaway ed25519 key pair. */
export function fixtureKey(name = "signer"): { file: string; pub: string } {
  keyDir ??= fixtureDir("plugin-keys-");
  const file = join(keyDir, name);
  if (!existsSync(file)) execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "", "-f", file]);
  return { file, pub: readFileSync(`${file}.pub`, "utf-8").trim() };
}

export interface PluginFixture {
  dir: string;
  /** Write files, commit, and SSH-sign `tag`. */
  release(tag: string, files: Record<string, string>): void;
}

/** A plugin source repo with `manifest` at its root. Nothing is tagged until `release`. */
export function pluginFixture(manifest: Record<string, unknown>, key = fixtureKey()): PluginFixture {
  const dir = fixtureDir("plugin-src-");
  fixtureGit(dir, "init", "-q");
  writeFileSync(join(dir, "agentbrew-plugin.yaml"), yaml.dump(manifest));
  return {
    dir,
    release(tag, files) {
      for (const [rel, body] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), body);
      }
      fixtureGit(dir, "add", "-A");
      fixtureGit(dir, ...ID, "commit", "-qm", tag, "--allow-empty");
      fixtureGit(dir, ...ID, "-c", "gpg.format=ssh", "-c", `user.signingkey=${key.file}`, "tag", "-s", tag, "-m", tag);
    },
  };
}
