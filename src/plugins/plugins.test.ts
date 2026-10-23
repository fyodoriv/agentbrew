/**
 * Plugin contract v2, step 3 of #208: manifest schema, lock `plugins:`
 * section, and `plugin add/list/remove` with a tree hash.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { home, previousHome } = vi.hoisted(() => {
  const { mkdtempSync: mk } = require("node:fs") as typeof import("node:fs");
  const { tmpdir: td } = require("node:os") as typeof import("node:os");
  const { join: j } = require("node:path") as typeof import("node:path");
  const previous = process.env.HOME;
  const dir = mk(j(td(), "plugins-home-"));
  process.env.HOME = dir;
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  return { home: dir, previousHome: previous };
});

import { findLockViolations, readLock, writeLock } from "../lock.js";
import { fixtureDir } from "../test-utils/plugin-fixture.js";
import { validateManifest } from "./manifest.js";
import { allowedSignersPath, revokeSigner, trustSigner } from "./signers.js";
import { addPlugin, listPlugins, parsePluginSpec, pluginDir, removePlugin, rollbackPlugin } from "./store.js";

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const MANIFEST = {
  schema: 1,
  name: "acme",
  version: "1.0.0",
  capabilities: { agents: ["claude"], repos: { include: ["git.acme.example/**"] } },
  contributes: { skills: "skills/" },
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf-8", stdio: "pipe" }).trim();
}

const KEYS = fixtureDir("plugin-keys-");
function makeKey(name: string): { file: string; pub: string } {
  const file = join(KEYS, name);
  if (!existsSync(file)) execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "", "-f", file]);
  return { file, pub: readFileSync(`${file}.pub`, "utf-8").trim() };
}
const SIGNER = makeKey("signer");
const OTHER = makeKey("other");

/** A plugin repo whose `tag` is SSH-signed by `key` (or lightweight when key is null). */
function makePluginRepo(manifest: unknown = MANIFEST, tag = "v1.0.0", key: { file: string } | null = SIGNER): string {
  const dir = fixtureDir("plugin-src-");
  writeFileSync(join(dir, "agentbrew-plugin.yaml"), yaml.dump(manifest));
  git(dir, "init", "-q");
  git(dir, "add", ".");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init");
  if (key) {
    git(
      dir,
      "-c",
      "gpg.format=ssh",
      "-c",
      `user.signingkey=${key.file}`,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "tag",
      "-s",
      tag,
      "-m",
      tag,
    );
  } else {
    git(dir, "tag", tag);
  }
  return dir;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  rmSync(join(home, ".config"), { recursive: true, force: true });
  rmSync(join(home, ".local"), { recursive: true, force: true });
});

afterAll(() => {
  process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("validateManifest", () => {
  it("accepts a valid manifest", () => {
    expect(validateManifest(MANIFEST)).toEqual({ ok: true, manifest: MANIFEST });
  });

  it.each([
    ["unknown top-level key", { ...MANIFEST, bootstrap: "./x.sh" }],
    ["wrong schema version", { ...MANIFEST, schema: 2 }],
    ["bad name", { ...MANIFEST, name: "Acme Corp" }],
    ["bad version", { ...MANIFEST, version: "latest" }],
    ["unknown capability", { ...MANIFEST, capabilities: { shell: true } }],
    ["path escapes the plugin", { ...MANIFEST, contributes: { skills: "../outside" } }],
    ["absolute path", { ...MANIFEST, contributes: { rules: "/etc/rules" } }],
  ])("rejects %s", (_label, manifest) => {
    const result = validateManifest(manifest);
    expect(result.ok).toBe(false);
  });
});

describe("parsePluginSpec", () => {
  it.each([
    ["https://git.example.com/acme/plugin.git@v1.2.0", "https://git.example.com/acme/plugin.git", "v1.2.0"],
    ["git@git.example.com:acme/plugin.git@v1.2.0", "git@git.example.com:acme/plugin.git", "v1.2.0"],
    ["/tmp/plugin@v1", "/tmp/plugin", "v1"],
  ])("splits %s", (spec, url, ref) => {
    expect(parsePluginSpec(spec)).toEqual({ url, ref });
  });

  it("requires a ref", () => {
    expect(() => parsePluginSpec("git@git.example.com:acme/plugin.git")).toThrow(/@<ref>/);
  });
});

describe("plugin add / list / remove", () => {
  it("add clones the ref, validates, and locks commit, tree and capabilities hash", () => {
    const src = makePluginRepo();
    const entry = addPlugin(`${src}@v1.0.0`, { yes: true, signer: SIGNER.pub });

    expect(entry.name).toBe("acme");
    expect(existsSync(join(pluginDir("acme"), "agentbrew-plugin.yaml"))).toBe(true);
    const locked = readLock().plugins?.[0];
    expect(locked).toMatchObject({ name: "acme", source: src, ref: "v1.0.0" });
    expect(locked?.commit).toBe(git(src, "rev-parse", "v1.0.0^{commit}"));
    expect(locked?.tree).toBe(git(src, "rev-parse", "v1.0.0^{tree}"));
    expect(locked?.capabilitiesHash).toMatch(/^[0-9a-f]{64}$/);
    expect(listPlugins().map((p) => p.name)).toEqual(["acme"]);
  });

  it("add refuses an invalid manifest and leaves nothing behind", () => {
    const src = makePluginRepo({ ...MANIFEST, bootstrap: "./x.sh" });
    expect(() => addPlugin(`${src}@v1.0.0`, { yes: true, signer: SIGNER.pub })).toThrow(/manifest/i);
    expect(existsSync(pluginDir("acme"))).toBe(false);
    expect(readLock().plugins ?? []).toEqual([]);
  });

  it("add refuses without approval when not confirmed", () => {
    const src = makePluginRepo();
    expect(() => addPlugin(`${src}@v1.0.0`, { yes: false, signer: SIGNER.pub })).toThrow(/approval/i);
    expect(existsSync(pluginDir("acme"))).toBe(false);
  });

  it("add refuses a name that is already installed", () => {
    const src = makePluginRepo();
    addPlugin(`${src}@v1.0.0`, { yes: true, signer: SIGNER.pub });
    expect(() => addPlugin(`${src}@v1.0.0`, { yes: true, signer: SIGNER.pub })).toThrow(/already installed/);
  });

  it("add records the signer and writes it to the shared allowed-signers file", () => {
    const src = makePluginRepo();
    const entry = addPlugin(`${src}@v1.0.0`, { yes: true, signer: SIGNER.pub });
    expect(entry.signer).toBe(SIGNER.pub);
    expect(readFileSync(allowedSignersPath(), "utf-8")).toContain(`acme namespaces="git" ${SIGNER.pub}`);
  });

  it("add refuses an unsigned (lightweight) tag", () => {
    const src = makePluginRepo(MANIFEST, "v1.0.0", null);
    expect(() => addPlugin(`${src}@v1.0.0`, { yes: true, signer: SIGNER.pub })).toThrow(/signed tag/i);
    expect(existsSync(pluginDir("acme"))).toBe(false);
  });

  it("add refuses a tag signed by a key the user did not approve", () => {
    const src = makePluginRepo(MANIFEST, "v1.0.0", OTHER);
    expect(() => addPlugin(`${src}@v1.0.0`, { yes: true, signer: SIGNER.pub })).toThrow(/signature/i);
    expect(readLock().plugins ?? []).toEqual([]);
  });

  it("add refuses when no signer is trusted for the plugin", () => {
    const src = makePluginRepo();
    expect(() => addPlugin(`${src}@v1.0.0`, { yes: true })).toThrow(/no trusted signer/i);
  });

  it("a signer trusted for another plugin name is not trusted for this one", () => {
    trustSigner("globex", SIGNER.pub);
    const src = makePluginRepo();
    expect(() => addPlugin(`${src}@v1.0.0`, { yes: true })).toThrow(/no trusted signer/i);
  });

  it("trust then add works without --signer; revoke makes sync fail closed", () => {
    trustSigner("acme", SIGNER.pub);
    const src = makePluginRepo();
    addPlugin(`${src}@v1.0.0`, { yes: true });
    expect(findLockViolations([])).toEqual([]);

    revokeSigner("acme", SIGNER.pub);

    expect(findLockViolations([]).map((v) => `${v.source} ${v.currentSha}`)).toEqual(["plugin acme signer revoked"]);
  });

  it("rollback re-pins the previous lock entry after verifying it", () => {
    const src = makePluginRepo();
    git(src, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "two", "--allow-empty");
    git(
      src,
      "-c",
      "gpg.format=ssh",
      "-c",
      `user.signingkey=${SIGNER.file}`,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "tag",
      "-s",
      "v1.1.0",
      "-m",
      "v1.1.0",
    );
    const old = addPlugin(`${src}@v1.0.0`, { yes: true, signer: SIGNER.pub });
    removePlugin("acme");
    const current = addPlugin(`${src}@v1.1.0`, { yes: true });
    const lock = readLock();
    lock.plugins = [{ ...current, previous: { ...old, previous: undefined } }];
    writeLock(lock);

    const rolled = rollbackPlugin("acme");

    expect(rolled.ref).toBe("v1.0.0");
    expect(rolled.commit).toBe(old.commit);
    expect(rolled.previous?.ref).toBe("v1.1.0");
    expect(findLockViolations([])).toEqual([]);
  });

  it("rollback without a previous entry is an error", () => {
    const src = makePluginRepo();
    addPlugin(`${src}@v1.0.0`, { yes: true, signer: SIGNER.pub });
    expect(() => rollbackPlugin("acme")).toThrow(/no previous/i);
  });

  it("add refuses a plugin whose contributions exceed its capabilities (exit code 3)", () => {
    const src = makePluginRepo({ ...MANIFEST, capabilities: {}, contributes: { rules: "rules/" } });
    mkdirSync(join(src, "rules"));
    writeFileSync(join(src, "rules", "a.md"), "rule");
    git(src, "add", ".");
    git(src, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "rules");
    git(
      src,
      "-c",
      "gpg.format=ssh",
      "-c",
      `user.signingkey=${SIGNER.file}`,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "tag",
      "-s",
      "v2.0.0",
      "-m",
      "v2.0.0",
    );
    expect(() => addPlugin(`${src}@v2.0.0`, { yes: true, signer: SIGNER.pub })).toThrow(
      /capability not declared: agents \* \(plugin acme\)/,
    );
    expect(existsSync(pluginDir("acme"))).toBe(false);
  });

  it("remove deletes the checkout and the lock entry", () => {
    const src = makePluginRepo();
    addPlugin(`${src}@v1.0.0`, { yes: true, signer: SIGNER.pub });
    removePlugin("acme");
    expect(existsSync(pluginDir("acme"))).toBe(false);
    expect(readLock().plugins ?? []).toEqual([]);
  });

  it("sync check: a changed byte in the plugin checkout is a lock violation", () => {
    const src = makePluginRepo();
    addPlugin(`${src}@v1.0.0`, { yes: true, signer: SIGNER.pub });
    expect(findLockViolations([])).toEqual([]);

    appendFileSync(join(pluginDir("acme"), "agentbrew-plugin.yaml"), "\n# tampered\n");

    expect(findLockViolations([]).map((v) => v.source)).toEqual(["plugin acme"]);
  });
});
