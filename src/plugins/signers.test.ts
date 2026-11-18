import { spawnSync } from "node:child_process";
import { chmodSync, chownSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revokeSigner, signersFor, trustSigner } from "./signers.js";

const ORIGINAL_KEY = "ssh-ed25519 T3JpZ2luYWw=";
const NEXT_KEY = "ssh-ed25519 TmV4dA==";
const OTHER_ROW = `neighbor namespaces="git,fixture" ${NEXT_KEY} keep this comment\n`;
const ORIGINAL_ROW = `fixture namespaces="git" ${ORIGINAL_KEY}\n`;
const REGISTRY_COMMENT = "# Keep the synthetic policy comment.\n";
const SEED = REGISTRY_COMMENT + ORIGINAL_ROW + OTHER_ROW;
const SUPPORTED = process.platform === "darwin" || process.platform === "linux";

let home: string;
let registry: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agentbrew-signer-writer-"));
  registry = join(home, "allowed_signers");
  vi.stubEnv("HOME", home);
  vi.stubEnv("AGENT_PLUGINS_ALLOWED_SIGNERS", registry);
  writeFileSync(registry, SEED, { mode: 0o640 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

it("trusts and revokes one signer while keeping the other signer available", () => {
  trustSigner("fixture", NEXT_KEY);
  expect(signersFor("fixture")).toEqual([ORIGINAL_KEY, NEXT_KEY]);
  revokeSigner("fixture", ORIGINAL_KEY);
  expect(signersFor("fixture")).toEqual([NEXT_KEY]);
  expect(signersFor("neighbor")).toEqual([NEXT_KEY]);
});

it("matches a signer with mixed whitespace while preserving all other registry bytes", () => {
  const mixed = `fixture\tnamespaces="git"\tssh-ed25519  ${ORIGINAL_KEY.split(" ")[1]}\r\n`;
  const original = REGISTRY_COMMENT + mixed + OTHER_ROW;
  writeFileSync(registry, original);

  trustSigner("fixture", ORIGINAL_KEY);
  expect(readFileSync(registry, "utf8")).toBe(original);
  expect(signersFor("fixture")).toEqual([ORIGINAL_KEY]);
  revokeSigner("fixture", ORIGINAL_KEY);
  expect(readFileSync(registry, "utf8")).toBe(REGISTRY_COMMENT + OTHER_ROW);
});

it("keeps a restricted signer row out of unrestricted trust and lets revoke remove it", () => {
  const restricted = `fixture namespaces="git",valid-before="20300101" ${ORIGINAL_KEY}\n`;
  const original = REGISTRY_COMMENT + restricted + OTHER_ROW;
  writeFileSync(registry, original);

  trustSigner("fixture", ORIGINAL_KEY);
  expect(readFileSync(registry, "utf8")).toBe(original);
  expect(signersFor("fixture")).toEqual([]);
  revokeSigner("fixture", ORIGINAL_KEY);
  expect(readFileSync(registry, "utf8")).toBe(REGISTRY_COMMENT + OTHER_ROW);
});

const alternateGroup = process.getgroups?.().find((group) => group !== process.getgid?.());
it.skipIf(!SUPPORTED || alternateGroup === undefined)("preserves the existing registry group", () => {
  if (alternateGroup === undefined) throw new Error("Synthetic secondary group is unavailable");
  const before = statSync(registry);
  expect(before.gid).not.toBe(alternateGroup);
  chownSync(registry, before.uid, alternateGroup);
  chmodSync(registry, 0o640);

  trustSigner("fixture", NEXT_KEY);

  const saved = statSync(registry);
  expect(saved.gid).toBe(alternateGroup);
  expect(saved.mode & 0o777).toBe(0o640);
});

describe.skipIf(!SUPPORTED)("shared signer CLI writer", () => {
  const holder = `
    use Fcntl qw(:DEFAULT :flock);
    my $file = shift @ARGV;
    sysopen(my $lock, $file, O_CREAT | O_RDWR, 0600) or exit 76;
    flock($lock, LOCK_EX | LOCK_NB) or exit 76;
    my $status = system(@ARGV);
    exit($status == -1 || ($status & 127) ? 76 : $status >> 8);
  `;

  function runTrust(key: string, options: { held?: boolean; revoke?: boolean } = {}) {
    const url = new URL("./cli-plugin.ts", import.meta.url).href;
    const source = `
      import { Command } from "commander";
      import { registerPluginCommands } from ${JSON.stringify(url)};
      const program = new Command();
      registerPluginCommands(program);
      await program.parseAsync(process.argv.slice(1), {from: "user"});
    `;
    const args = [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      source,
      "--",
      "plugin",
      "trust",
      "fixture",
      "--signer",
      key,
      "--yes",
      ...(options.revoke ? ["--revoke"] : []),
    ];
    const argv = options.held
      ? ["perl", "-e", holder, `${registry}.agentbrew-signer-v1.lock`, process.execPath, ...args]
      : [process.execPath, ...args];
    return spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: 10_000 });
  }

  it("refuses both locked mutations, then applies both without losing policy or lock identity", () => {
    const lock = `${registry}.agentbrew-signer-v1.lock`;
    chmodSync(registry, 0o640);
    expect(runTrust(NEXT_KEY, { held: true }).status).toBe(75);
    expect(readFileSync(registry, "utf8")).toBe(SEED);
    expect(runTrust(ORIGINAL_KEY, { held: true, revoke: true }).status).toBe(75);
    expect(readFileSync(registry, "utf8")).toBe(SEED);
    const identity = statSync(lock);

    expect(runTrust(NEXT_KEY).status).toBe(0);
    expect(runTrust(ORIGINAL_KEY, { revoke: true }).status).toBe(0);
    expect(readFileSync(registry, "utf8")).toBe(
      `${REGISTRY_COMMENT}${OTHER_ROW}fixture namespaces="git" ${NEXT_KEY}\n`,
    );
    expect(statSync(registry).mode & 0o777).toBe(0o640);
    expect(statSync(lock)).toMatchObject({ dev: identity.dev, ino: identity.ino, mode: identity.mode });
  }, 25_000);

  it("keeps revocation available when an earlier native publication record exists", () => {
    const owner = join(home, ".agentbrew-native-publication.lock");
    writeFileSync(owner, "Synthetic prior native operation.\n", { mode: 0o600 });

    expect(runTrust(ORIGINAL_KEY, { revoke: true }).status).toBe(0);
    expect(readFileSync(registry, "utf8")).toBe(REGISTRY_COMMENT + OTHER_ROW);
    expect(existsSync(owner)).toBe(true);
  }, 15_000);
});
