/**
 * Allowed signers for company plugins (issue #208, step 4).
 *
 * One file, shared with dotfiles (dotfiles#145), in git's SSH
 * `gpg.ssh.allowedSignersFile` format. The principal is the plugin name, so a
 * key trusted for one plugin is never trusted for another:
 *
 *   acme namespaces="git" ssh-ed25519 AAAA...
 *
 * Path: `$AGENT_PLUGINS_ALLOWED_SIGNERS`, else
 * `${XDG_CONFIG_HOME:-~/.config}/agent-plugins/allowed_signers`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sync as writeFileSync } from "write-file-atomic";

export interface AllowedSigner {
  principal: string;
  /** `<keytype> <base64>` with no comment. */
  key: string;
}

export function allowedSignersPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AGENT_PLUGINS_ALLOWED_SIGNERS) return env.AGENT_PLUGINS_ALLOWED_SIGNERS;
  const config = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(config, "agent-plugins", "allowed_signers");
}

/** Keep `<keytype> <base64>`; drop a trailing comment. Throws on anything else. */
export function normalizeKey(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2 || !/^(ssh-|ecdsa-|sk-)/.test(parts[0] ?? "") || !/^[A-Za-z0-9+/=]+$/.test(parts[1] ?? "")) {
    throw new Error(`Not an SSH public key: "${raw.slice(0, 40)}"`);
  }
  return `${parts[0]} ${parts[1]}`;
}

export function readSigners(): AllowedSigner[] {
  const path = allowedSignersPath();
  if (!existsSync(path)) return [];
  const signers: AllowedSigner[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const m = line.trim().match(/^(\S+)\s+(?:namespaces="[^"]*"\s+)?(\S+\s+\S+)/);
    if (!m || line.trim().startsWith("#")) continue;
    signers.push({ principal: m[1] as string, key: m[2] as string });
  }
  return signers;
}

function writeSigners(signers: AllowedSigner[]): void {
  const path = allowedSignersPath();
  mkdirSync(dirname(path), { recursive: true });
  const body = signers.map((s) => `${s.principal} namespaces="git" ${s.key}`).join("\n");
  writeFileSync(path, signers.length ? `${body}\n` : "", { mode: 0o644 });
}

export function signersFor(principal: string): string[] {
  return readSigners()
    .filter((s) => s.principal === principal)
    .map((s) => s.key);
}

/** Trust `key` for plugin `principal`. Idempotent. */
export function trustSigner(principal: string, rawKey: string): void {
  const key = normalizeKey(rawKey);
  const signers = readSigners();
  if (signers.some((s) => s.principal === principal && s.key === key)) return;
  writeSigners([...signers, { principal, key }]);
}

/** Stop trusting `key` for plugin `principal`. */
export function revokeSigner(principal: string, rawKey: string): void {
  const key = normalizeKey(rawKey);
  const signers = readSigners();
  const kept = signers.filter((s) => !(s.principal === principal && s.key === key));
  if (kept.length === signers.length) throw new Error(`Signer is not trusted for "${principal}".`);
  writeSigners(kept);
}

function fingerprint(key: string): string {
  const dir = mkdtempSync(join(tmpdir(), "agentbrew-key-"));
  try {
    const file = join(dir, "key.pub");
    writeFileSync(file, `${key}\n`);
    return execFileSync("ssh-keygen", ["-lf", file], { encoding: "utf-8", stdio: "pipe" }).split(/\s+/)[1] ?? "";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Verify that `ref` in `dir` is an annotated tag signed by a key in `keys`.
 * Uses a scratch allowed-signers file with only those keys, so the user's
 * own git config cannot widen trust. Returns the key that signed.
 */
export function verifySignedTag(dir: string, ref: string, principal: string, keys: string[]): string {
  if (keys.length === 0)
    throw new Error(`No trusted signer for plugin "${principal}". Pass --signer <ssh-public-key>.`);
  const run = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf-8", stdio: "pipe" });
  let type = "";
  try {
    type = run(["cat-file", "-t", `refs/tags/${ref}`]).trim();
  } catch {
    type = "";
  }
  if (type !== "tag") throw new Error(`"${ref}" is not a signed tag. Plugins install only from signed tags.`);

  const scratch = mkdtempSync(join(tmpdir(), "agentbrew-signers-"));
  try {
    const file = join(scratch, "allowed_signers");
    writeFileSync(file, `${keys.map((k) => `${principal} namespaces="git" ${k}`).join("\n")}\n`);
    const result = spawnSync(
      "git",
      ["-c", "gpg.format=ssh", "-c", `gpg.ssh.allowedSignersFile=${file}`, "verify-tag", ref],
      { cwd: dir, encoding: "utf-8" },
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status !== 0) {
      throw new Error(`Tag "${ref}" signature is not from a trusted signer for "${principal}". ${output.trim()}`);
    }
    const fp = output.match(/SHA256:[A-Za-z0-9+/=]+/)?.[0];
    const key = keys.find((k) => fingerprint(k) === fp);
    if (!key) throw new Error(`Could not match the signing key of "${ref}" to a trusted signer.`);
    return key;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
