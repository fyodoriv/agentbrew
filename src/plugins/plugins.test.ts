/**
 * Plugin contract v2, step 3 of #208: manifest schema, lock `plugins:`
 * section, and `plugin add/list/remove` with a tree hash.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  return { home: dir, previousHome: previous };
});

import { findLockViolations, readLock } from "../lock.js";
import { validateManifest } from "./manifest.js";
import { addPlugin, listPlugins, parsePluginSpec, pluginDir, removePlugin } from "./store.js";

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

function makePluginRepo(manifest: unknown = MANIFEST, tag = "v1.0.0"): string {
  const dir = mkdtempSync(join(tmpdir(), "plugin-src-"));
  writeFileSync(join(dir, "agentbrew-plugin.yaml"), yaml.dump(manifest));
  git(dir, "init", "-q");
  git(dir, "add", ".");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init");
  git(dir, "tag", tag);
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
    const entry = addPlugin(`${src}@v1.0.0`, { yes: true });

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
    expect(() => addPlugin(`${src}@v1.0.0`, { yes: true })).toThrow(/manifest/i);
    expect(existsSync(pluginDir("acme"))).toBe(false);
    expect(readLock().plugins ?? []).toEqual([]);
  });

  it("add refuses without approval when not confirmed", () => {
    const src = makePluginRepo();
    expect(() => addPlugin(`${src}@v1.0.0`, { yes: false })).toThrow(/approval/i);
    expect(existsSync(pluginDir("acme"))).toBe(false);
  });

  it("add refuses a name that is already installed", () => {
    const src = makePluginRepo();
    addPlugin(`${src}@v1.0.0`, { yes: true });
    expect(() => addPlugin(`${src}@v1.0.0`, { yes: true })).toThrow(/already installed/);
  });

  it("remove deletes the checkout and the lock entry", () => {
    const src = makePluginRepo();
    addPlugin(`${src}@v1.0.0`, { yes: true });
    removePlugin("acme");
    expect(existsSync(pluginDir("acme"))).toBe(false);
    expect(readLock().plugins ?? []).toEqual([]);
  });

  it("sync check: a changed byte in the plugin checkout is a lock violation", () => {
    const src = makePluginRepo();
    addPlugin(`${src}@v1.0.0`, { yes: true });
    expect(findLockViolations([])).toEqual([]);

    appendFileSync(join(pluginDir("acme"), "agentbrew-plugin.yaml"), "\n# tampered\n");

    expect(findLockViolations([]).map((v) => v.source)).toEqual(["plugin acme"]);
  });
});
