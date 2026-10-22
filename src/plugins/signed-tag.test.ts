/**
 * The signed-tag check installs only the commit of the exact tag object it
 * verified, on `plugin add` and `plugin update`. Two attacks used to pass on
 * a local-path source:
 *
 * - A: an unsigned tag whose name is the object ID of the real signed tag.
 *   `git verify-tag <40-hex>` read the name as that object ID.
 * - B: a branch with the signed tag's name. `git clone --branch` took it.
 *
 * Every repo, key, and HOME here is scratch. Git reads an empty global
 * config file, never the developer's ~/.gitconfig.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import yaml from "js-yaml";
import { afterAll, afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

const { home, previousEnv } = vi.hoisted(() => {
  const { mkdtempSync: mk, writeFileSync: wf } = require("node:fs") as typeof import("node:fs");
  const { tmpdir: td } = require("node:os") as typeof import("node:os");
  const { join: j } = require("node:path") as typeof import("node:path");
  const previous = {
    HOME: process.env.HOME,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  };
  const dir = mk(j(td(), "plugin-tag-home-"));
  const gitconfig = j(dir, "scratch.gitconfig");
  wf(gitconfig, "");
  process.env.HOME = dir;
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  return { home: dir, previousEnv: previous };
});

import { readLock } from "../lock.js";
import { fixtureGit, fixtureKey, type PluginFixture, pluginFixture } from "../test-utils/plugin-fixture.js";
import { signingFingerprint, tagObject, verifySignedTag } from "./signers.js";
import { addPlugin, pluginDir, pluginsRoot } from "./store.js";
import { planUpdate } from "./update.js";

const KEY = fixtureKey();
const ID = ["-c", "user.name=t", "-c", "user.email=t@example.com"];
const MANIFEST = {
  schema: 1,
  name: "acme",
  version: "1.0.0",
  capabilities: { agents: ["claude"] },
  contributes: {},
};

/**
 * A scratch GNUPGHOME with a forger's key whose user ID holds the trusted SSH
 * key's fingerprint, or undefined when gpg or its agent cannot run here (the
 * test then skips). afterAll stops its gpg-agent and deletes it.
 */
const FORGER_GNUPG = ((): string | undefined => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-gpg-"));
  const env = { ...process.env, GNUPGHOME: dir };
  const fp = execFileSync("ssh-keygen", ["-lf", `${KEY.file}.pub`], { encoding: "utf-8" }).split(/\s+/)[1];
  const args = ["--batch", "--passphrase", "", "--quick-gen-key", `forger ${fp}`, "ed25519", "sign"];
  if (spawnSync("gpg", args, { env, stdio: "pipe" }).status === 0) return dir;
  spawnSync("gpgconf", ["--kill", "all"], { env, stdio: "pipe" });
  rmSync(dir, { recursive: true, force: true });
  return undefined;
})();

let f: PluginFixture;
/** Commit and object ID of the real signed tag v1.0.0. */
let good: string;
let signedTag: string;

/** A commit nobody signed, with a marker file, on top of the signed one. */
function evilCommit(): string {
  writeFileSync(join(f.dir, "evil.txt"), "not signed\n");
  fixtureGit(f.dir, "add", "-A");
  fixtureGit(f.dir, ...ID, "commit", "-qm", "evil");
  return fixtureGit(f.dir, "rev-parse", "HEAD");
}

function expectNothingInstalled(): void {
  expect(existsSync(pluginDir("acme"))).toBe(false);
  expect(readLock().plugins ?? []).toEqual([]);
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  for (const d of [".config", ".local"]) rmSync(join(home, d), { recursive: true, force: true });
  f = pluginFixture(MANIFEST, KEY);
  f.release("v1.0.0", { "README.md": "signed\n" });
  good = fixtureGit(f.dir, "rev-parse", "v1.0.0^{commit}");
  signedTag = fixtureGit(f.dir, "rev-parse", "refs/tags/v1.0.0");
});

afterEach(() => {
  rmSync(f.dir, { recursive: true, force: true });
});

afterAll(() => {
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
  if (FORGER_GNUPG) {
    spawnSync("gpgconf", ["--kill", "all"], { env: { ...process.env, GNUPGHOME: FORGER_GNUPG }, stdio: "pipe" });
    rmSync(FORGER_GNUPG, { recursive: true, force: true });
  }
});

describe("plugin add: signed-tag attacks", () => {
  it("attack A: refuses an unsigned tag named like the signed tag's object ID", () => {
    fixtureGit(f.dir, ...ID, "tag", "-a", signedTag, "-m", "unsigned", evilCommit());

    expect(() => addPlugin(`${f.dir}@${signedTag}`, { yes: true, signer: KEY.pub })).toThrow(/object ID/);
    expectNothingInstalled();
  });

  it("attack B: a branch with the signed tag's name never wins", () => {
    fixtureGit(f.dir, "branch", "v1.0.0", evilCommit());

    const entry = addPlugin(`${f.dir}@v1.0.0`, { yes: true, signer: KEY.pub });

    expect(entry.commit).toBe(good);
    expect(fixtureGit(pluginDir("acme"), "rev-parse", "HEAD")).toBe(good);
    expect(existsSync(join(pluginDir("acme"), "evil.txt"))).toBe(false);
  });

  it("refuses an old signed tag object published under a new tag name", () => {
    evilCommit();
    fixtureGit(f.dir, "update-ref", "refs/tags/v2.0.0", signedTag);

    expect(() => addPlugin(`${f.dir}@v2.0.0`, { yes: true, signer: KEY.pub })).toThrow(/names tag "v1\.0\.0"/);
    expectNothingInstalled();
  });

  it("refuses an unsigned annotated tag", () => {
    fixtureGit(f.dir, ...ID, "tag", "-a", "v2.0.0", "-m", "v2.0.0", evilCommit());

    expect(() => addPlugin(`${f.dir}@v2.0.0`, { yes: true, signer: KEY.pub })).toThrow(/SSH signature/);
    expectNothingInstalled();
  });

  it("refuses a lightweight tag", () => {
    fixtureGit(f.dir, "tag", "v2.0.0", evilCommit());

    expect(() => addPlugin(`${f.dir}@v2.0.0`, { yes: true, signer: KEY.pub })).toThrow(/not a signed tag/);
    expectNothingInstalled();
  });

  it.skipIf(!FORGER_GNUPG)(
    "refuses an OpenPGP-signed tag, even one whose user ID names the trusted key's fingerprint",
    () => {
      const gnupg = FORGER_GNUPG as string;
      const sign = ["-c", "gpg.format=openpgp", "-c", "user.signingkey=forger", "tag", "-s", "v2.0.0", "-m", "v2.0.0"];
      execFileSync("git", [...ID, ...sign, evilCommit()], {
        cwd: f.dir,
        env: { ...process.env, GNUPGHOME: gnupg },
        stdio: "pipe",
      });
      // The forger's key is in the user's keyring, as auto-key-retrieve would leave it.
      process.env.GNUPGHOME = gnupg;
      try {
        expect(() => addPlugin(`${f.dir}@v2.0.0`, { yes: true, signer: KEY.pub })).toThrow(/SSH signature/);
        expectNothingInstalled();
      } finally {
        delete process.env.GNUPGHOME;
      }
    },
  );

  it.each([
    ["only a branch", "v2.0.0"],
    ["only a branch named refs/tags/<ref>", "refs/tags/v2.0.0"],
  ])("refuses a source with %s and no tag of that exact name", (_label, branch) => {
    fixtureGit(f.dir, "branch", branch, evilCommit());

    expect(() => addPlugin(`${f.dir}@v2.0.0`, { yes: true, signer: KEY.pub })).toThrow(/"v2\.0\.0" is not a tag in/);
    expectNothingInstalled();
  });

  it("resolves a relative source from the plugins folder, as before", () => {
    mkdirSync(pluginsRoot(), { recursive: true });

    expect(addPlugin(`${relative(pluginsRoot(), f.dir)}@v1.0.0`, { yes: true, signer: KEY.pub }).commit).toBe(good);
  });

  it.each([
    ["a 64-hex name", "a".repeat(64), /object ID/],
    ["an invalid tag name", "v1..0", /not a valid tag name/],
  ])("refuses %s before it fetches anything", (_label, ref, error) => {
    expect(() => addPlugin(`${f.dir}@${ref}`, { yes: true, signer: KEY.pub })).toThrow(error);
    expectNothingInstalled();
  });

  it.each([
    ["a local path", () => f.dir],
    ["a file:// URL", () => `file://${f.dir}`],
  ])("installs a valid signed tag from %s at its commit", (_label, source) => {
    evilCommit();

    const entry = addPlugin(`${source()}@v1.0.0`, { yes: true, signer: KEY.pub });

    expect(entry.commit).toBe(good);
    expect(entry.tree).toBe(fixtureGit(f.dir, "rev-parse", "v1.0.0^{tree}"));
    expect(entry.signer).toBe(KEY.pub);
    expect(fixtureGit(pluginDir("acme"), "rev-parse", "HEAD")).toBe(good);
    expect(fixtureGit(pluginDir("acme"), "status", "--porcelain", "--untracked-files=all")).toBe("");
  });
});

describe("tagObject and verifySignedTag", () => {
  it("resolve and verify exactly refs/tags/<ref>, past a same-named branch and an object-ID-named tag", () => {
    const evil = evilCommit();
    fixtureGit(f.dir, "branch", "v1.0.0", evil);
    fixtureGit(f.dir, ...ID, "tag", "-a", signedTag, "-m", "unsigned", evil);
    const unsigned = fixtureGit(f.dir, "show-ref", "--verify", "--hash", `refs/tags/${signedTag}`);

    expect(tagObject(f.dir, "v1.0.0")).toBe(signedTag);
    expect(verifySignedTag(f.dir, "v1.0.0", signedTag, "acme", [KEY.pub])).toBe(KEY.pub);
    expect(() => verifySignedTag(f.dir, signedTag, unsigned, "acme", [KEY.pub])).toThrow(/SSH signature/);
  });
});

describe("signingFingerprint", () => {
  const FP = "SHA256:4XgAIWK94lNDAIY3oMsDeDep1ni5C2CwUhkjAIkbYy8";
  it.each([
    ["ssh-keygen's result line", `Good "git" signature for acme with ED25519 key ${FP}\n`, FP],
    ["a result line for another principal", `Good "git" signature for globex with ED25519 key ${FP}\n`, undefined],
    ["a gpg user ID that holds a fingerprint", `gpg: Good signature from "forger ${FP}" [unknown]\n`, undefined],
    ["a result line inside other text", `x Good "git" signature for acme with ED25519 key ${FP}\n`, undefined],
  ])("reads %s", (_label, output, expected) => {
    expect(signingFingerprint(output, "acme")).toBe(expected);
  });
});

describe("object formats", () => {
  it("installs a signed tag from a SHA-256 repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-src-sha256-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    fixtureGit(dir, "init", "-q", "--object-format=sha256");
    writeFileSync(join(dir, "agentbrew-plugin.yaml"), yaml.dump(MANIFEST));
    fixtureGit(dir, "add", "-A");
    fixtureGit(dir, ...ID, "commit", "-qm", "init");
    fixtureGit(
      dir,
      ...ID,
      "-c",
      "gpg.format=ssh",
      "-c",
      `user.signingkey=${KEY.file}`,
      "tag",
      "-s",
      "v1.0.0",
      "-m",
      "v1",
    );

    const entry = addPlugin(`${dir}@v1.0.0`, { yes: true, signer: KEY.pub });

    expect(entry.commit).toBe(fixtureGit(dir, "rev-parse", "v1.0.0^{commit}"));
    expect(entry.commit).toHaveLength(64);
  });

  it("installs a SHA-1 repo when the user's git defaults to SHA-256", () => {
    const config = process.env.GIT_CONFIG_GLOBAL as string;
    writeFileSync(config, "[init]\n\tdefaultObjectFormat = sha256\n");
    try {
      expect(addPlugin(`${f.dir}@v1.0.0`, { yes: true, signer: KEY.pub }).commit).toBe(good);
    } finally {
      writeFileSync(config, "");
    }
  });
});

describe("plugin update: signed-tag attacks", () => {
  beforeEach(() => {
    addPlugin(`${f.dir}@v1.0.0`, { yes: true, signer: KEY.pub });
  });

  it("attack A: refuses a tag named like a signed tag's object ID", () => {
    f.release("v1.1.0", { "README.md": "signed again\n" });
    const tag = fixtureGit(f.dir, "rev-parse", "refs/tags/v1.1.0");
    fixtureGit(f.dir, ...ID, "tag", "-a", tag, "-m", "unsigned", evilCommit());

    expect(() => planUpdate("acme", tag)).toThrow(/object ID/);
  });

  it("attack B: a branch with the new tag's name never wins", () => {
    f.release("v1.1.0", { "README.md": "signed again\n" });
    const next = fixtureGit(f.dir, "rev-parse", "v1.1.0^{commit}");
    fixtureGit(f.dir, "branch", "v1.1.0", evilCommit());

    const plan = planUpdate("acme", "v1.1.0");
    try {
      expect(plan.entry.commit).toBe(next);
      expect(existsSync(join(plan.staged.dir, "evil.txt"))).toBe(false);
    } finally {
      plan.discard();
    }
  });
});
