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
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { home, previousHome } = vi.hoisted(() => {
  const { mkdtempSync: mk, writeFileSync: wf } = require("node:fs") as typeof import("node:fs");
  const { tmpdir: td } = require("node:os") as typeof import("node:os");
  const { join: j } = require("node:path") as typeof import("node:path");
  const previous = process.env.HOME;
  const dir = mk(j(td(), "plugin-tag-home-"));
  const gitconfig = j(dir, "scratch.gitconfig");
  wf(gitconfig, "");
  process.env.HOME = dir;
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  return { home: dir, previousHome: previous };
});

import { readLock } from "../lock.js";
import { fixtureGit, fixtureKey, type PluginFixture, pluginFixture } from "../test-utils/plugin-fixture.js";
import { addPlugin, pluginDir } from "./store.js";
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

afterAll(() => {
  process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
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

    expect(() => addPlugin(`${f.dir}@v2.0.0`, { yes: true, signer: KEY.pub })).toThrow(/trusted signer/);
    expectNothingInstalled();
  });

  it("refuses a lightweight tag", () => {
    fixtureGit(f.dir, "tag", "v2.0.0", evilCommit());

    expect(() => addPlugin(`${f.dir}@v2.0.0`, { yes: true, signer: KEY.pub })).toThrow(/not a signed tag/);
    expectNothingInstalled();
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
