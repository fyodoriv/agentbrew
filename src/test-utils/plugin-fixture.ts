/**
 * Signed plugin repos for tests of the v2 plugin contract (#208).
 * Callers must set HOME to a scratch dir and GIT_CONFIG_GLOBAL=/dev/null first.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import yaml from "js-yaml";

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const ID = ["-c", "user.name=t", "-c", "user.email=t@example.com"];

export function fixtureGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf-8", stdio: "pipe" }).trim();
}

let keyDir: string | undefined;
/** A throwaway ed25519 key pair. */
export function fixtureKey(name = "signer"): { file: string; pub: string } {
  keyDir ??= mkdtempSync(join(tmpdir(), "plugin-keys-"));
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
  const dir = mkdtempSync(join(tmpdir(), "plugin-src-"));
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
