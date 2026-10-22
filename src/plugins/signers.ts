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

/** git reads a full 40- or 64-hex name as an object ID, never as a tag name. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/**
 * Throw unless `ref` can only mean `refs/tags/<ref>`: a valid tag name that
 * does not look like an object ID.
 */
export function assertTagName(ref: string): void {
  if (OBJECT_ID.test(ref)) throw new Error(`"${ref}" looks like an object ID. Plugins install only from tag names.`);
  if (spawnSync("git", ["check-ref-format", `refs/tags/${ref}`]).status !== 0) {
    throw new Error(`"${ref}" is not a valid tag name.`);
  }
}

/**
 * The object ID of the annotated tag at exactly `refs/tags/<ref>` in `dir`.
 * Throws when `ref` is not a plain tag name, when there is no annotated tag
 * there, or when the tag object's own `tag` field names another tag (an old
 * signed tag object published under a new name).
 */
export function tagObject(dir: string, ref: string): string {
  assertTagName(ref);
  const run = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf-8", stdio: "pipe" }).trim();
  let oid = "";
  let type = "";
  try {
    oid = run(["show-ref", "--verify", "--hash", `refs/tags/${ref}`]);
    type = run(["cat-file", "-t", oid]);
  } catch {
    type = "";
  }
  if (type !== "tag") throw new Error(`"${ref}" is not a signed tag. Plugins install only from signed tags.`);
  const header = run(["cat-file", "tag", oid]).split("\n\n", 1)[0] ?? "";
  const named = header
    .split("\n")
    .find((line) => line.startsWith("tag "))
    ?.slice(4);
  if (named !== ref) throw new Error(`The tag object at "${ref}" names tag "${named ?? ""}", not "${ref}".`);
  return oid;
}

/**
 * The key fingerprint from ssh-keygen's result line in `git verify-tag`
 * output, when that line names `principal`. Any other text, such as a gpg
 * user ID that contains a fingerprint, is ignored.
 */
export function signingFingerprint(output: string, principal: string): string | undefined {
  const good = output.match(/^Good "git" signature for (\S+) with \S+ key (SHA256:[A-Za-z0-9+/=]+)$/m);
  return good?.[1] === principal ? good[2] : undefined;
}

/**
 * Verify that tag object `oid` (from {@link tagObject} for `ref`) is signed
 * by a key in `keys`. Git gets the object ID, never the name, so it checks
 * exactly that object. Uses a scratch allowed-signers file with only those
 * keys, so the user's own git config cannot widen trust. Git picks the
 * verifier from the signature block, not from `gpg.format`, so the tag must
 * carry exactly one SSH signature and the OpenPGP and X.509 verifiers are
 * disabled: a key in the user's gpg keyring can never pass. Returns the key
 * that signed.
 */
export function verifySignedTag(dir: string, ref: string, oid: string, principal: string, keys: string[]): string {
  if (keys.length === 0)
    throw new Error(`No trusted signer for plugin "${principal}". Pass --signer <ssh-public-key>.`);
  if (!OBJECT_ID.test(oid)) throw new Error(`"${oid}" is not a tag object ID.`);
  const body = execFileSync("git", ["cat-file", "tag", oid], { cwd: dir, encoding: "utf-8", stdio: "pipe" });
  const armor = body.split("\n").filter((line) => line.startsWith("-----BEGIN "));
  if (armor.length !== 1 || armor[0] !== "-----BEGIN SSH SIGNATURE-----") {
    throw new Error(`Tag "${ref}" must carry exactly one SSH signature. Plugins install only from SSH-signed tags.`);
  }

  const scratch = mkdtempSync(join(tmpdir(), "agentbrew-signers-"));
  try {
    const file = join(scratch, "allowed_signers");
    writeFileSync(file, `${keys.map((k) => `${principal} namespaces="git" ${k}`).join("\n")}\n`);
    const result = spawnSync(
      "git",
      [
        "-c",
        "gpg.format=ssh",
        "-c",
        `gpg.ssh.allowedSignersFile=${file}`,
        "-c",
        "gpg.openpgp.program=false",
        "-c",
        "gpg.x509.program=false",
        "verify-tag",
        oid,
      ],
      { cwd: dir, encoding: "utf-8" },
    );
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.status !== 0) {
      throw new Error(`Tag "${ref}" signature is not from a trusted signer for "${principal}". ${output.trim()}`);
    }
    const fp = signingFingerprint(output, principal);
    const key = fp ? keys.find((k) => fingerprint(k) === fp) : undefined;
    if (!key) throw new Error(`Could not match the signing key of "${ref}" to a trusted signer.`);
    return key;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
