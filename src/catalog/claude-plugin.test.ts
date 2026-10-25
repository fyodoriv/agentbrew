/** Catalog item type `claude-plugin`: a third-party Claude Code plugin pinned to a commit. */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkClaudePluginDrift,
  claudePluginDir,
  installClaudePlugin,
  readClaudePluginRecords,
  removeClaudePlugin,
} from "./claude-plugin.js";
import type { CatalogClaudePlugin } from "./types.js";

const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    env: gitEnv,
    encoding: "utf-8",
  }).trim();

/** A plugin repo with two commits; the pin is the first. */
function fixtureRepo(): { url: string; pinned: string; newer: string } {
  const dir = mkdtempSync(join(homedir(), "plugin-src-"));
  git(dir, "init", "-q");
  mkdirSync(join(dir, ".claude-plugin"));
  writeFileSync(join(dir, ".claude-plugin", "marketplace.json"), '{"name":"demo-market","plugins":[]}\n');
  writeFileSync(join(dir, "v.txt"), "1\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "one");
  const pinned = git(dir, "rev-parse", "HEAD");
  writeFileSync(join(dir, "v.txt"), "2\n");
  git(dir, "commit", "-qam", "two");
  return { url: dir, pinned, newer: git(dir, "rev-parse", "HEAD") };
}

/** A fake `claude` CLI: logs each call and edits settings.json the way the real one does. */
function fakeClaude(): string {
  const bin = join(homedir(), "fake-claude");
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const home = process.env.HOME, args = process.argv.slice(2);
fs.appendFileSync(path.join(home, "claude-calls.log"), args.join(" ") + "\\n");
const file = path.join(home, ".claude", "settings.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : {};
const [a, b, c, d] = args;
if (a === "plugin" && b === "marketplace" && c === "add") {
  const name = JSON.parse(fs.readFileSync(path.join(d, ".claude-plugin", "marketplace.json"), "utf-8")).name;
  s.extraKnownMarketplaces = { ...s.extraKnownMarketplaces, [name]: { source: { source: "directory", path: d } } };
} else if (a === "plugin" && b === "marketplace" && c === "remove") {
  if (s.extraKnownMarketplaces) delete s.extraKnownMarketplaces[d];
} else if (a === "plugin" && b === "install") {
  s.enabledPlugins = { ...s.enabledPlugins, [c]: true };
} else if (a === "plugin" && b === "uninstall") {
  if (s.enabledPlugins) delete s.enabledPlugins[c];
}
fs.writeFileSync(file, JSON.stringify(s, null, 2));
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

const settings = () => JSON.parse(readFileSync(join(homedir(), ".claude", "settings.json"), "utf-8"));
const calls = () => readFileSync(join(homedir(), "claude-calls.log"), "utf-8").trim().split("\n");

describe("claude-plugin catalog items", () => {
  let repo: ReturnType<typeof fixtureRepo>;
  let entry: CatalogClaudePlugin;

  beforeEach(() => {
    rmSync(claudePluginDir("demo-guard"), { recursive: true, force: true });
    rmSync(join(homedir(), ".config", "agentbrew", "claude-plugins.json"), { force: true });
    rmSync(join(homedir(), ".claude", "settings.json"), { force: true });
    rmSync(join(homedir(), ".claude", "skills", "demo-guard"), { recursive: true, force: true });
    process.env.AGENTBREW_CLAUDE_BIN = fakeClaude();
    repo = fixtureRepo();
    entry = {
      name: "demo-guard",
      description: "demo",
      category: "guardrails",
      recommended: false,
      repo: repo.url,
      commit: repo.pinned,
      plugin: "demo-guard",
      marketplace: "demo-market",
    };
  });
  afterEach(() => {
    delete process.env.AGENTBREW_CLAUDE_BIN;
  });

  it("clones the repo at the pinned commit, registers it as a directory marketplace, and enables the plugin", () => {
    installClaudePlugin(entry);
    const dir = claudePluginDir("demo-guard");
    expect(git(dir, "rev-parse", "HEAD")).toBe(repo.pinned);
    expect(settings().extraKnownMarketplaces["demo-market"].source).toEqual({ source: "directory", path: dir });
    expect(settings().enabledPlugins["demo-guard@demo-market"]).toBe(true);
    expect(calls()).toContain(`plugin install demo-guard@demo-market --scope user`);
    expect(readClaudePluginRecords()).toEqual([
      { name: "demo-guard", commit: repo.pinned, dir, key: "demo-guard@demo-market", marketplace: "demo-market" },
    ]);
    expect(checkClaudePluginDrift([entry])).toEqual([]);
  });

  it("refuses a pin that is not a full 40-character commit SHA", () => {
    expect(() => installClaudePlugin({ ...entry, commit: repo.pinned.slice(0, 7) })).toThrow(/full 40-character/);
    expect(existsSync(claudePluginDir("demo-guard"))).toBe(false);
  });

  it("reports drift when the checkout moved, the plugin is off, or the catalog pin changed", () => {
    installClaudePlugin(entry);
    const dir = claudePluginDir("demo-guard");
    git(dir, "checkout", "-q", "--detach", repo.newer);
    const s = settings();
    s.enabledPlugins["demo-guard@demo-market"] = false;
    writeFileSync(join(homedir(), ".claude", "settings.json"), JSON.stringify(s));
    const details = checkClaudePluginDrift([{ ...entry, commit: repo.newer }]).map((d) => d.detail);
    expect(details.join("\n")).toMatch(/checkout is at .* not the pinned/);
    expect(details.join("\n")).toMatch(/not enabled/);
    expect(details.join("\n")).toMatch(/catalog pin moved/);
    for (const d of checkClaudePluginDrift([entry])) expect(d.type).toBe("claude-plugin");
  });

  it("removes the plugin, the marketplace, the checkout, and the record on uninstall", () => {
    installClaudePlugin(entry);
    expect(removeClaudePlugin("demo-guard")).toBe(true);
    expect(settings().enabledPlugins["demo-guard@demo-market"]).toBeUndefined();
    expect(settings().extraKnownMarketplaces["demo-market"]).toBeUndefined();
    expect(existsSync(claudePluginDir("demo-guard"))).toBe(false);
    expect(readClaudePluginRecords()).toEqual([]);
    expect(removeClaudePlugin("demo-guard")).toBe(false);
  });
  it("refuses a name or repo that could escape the plugins folder or act as a git option", () => {
    for (const name of ["../x", "a/b", "..", "-x"]) {
      expect(() => installClaudePlugin({ ...entry, name }), name).toThrow(/invalid name/);
    }
    expect(() => installClaudePlugin({ ...entry, repo: "--upload-pack=touch pwn" })).toThrow(/invalid repo/);
    expect(() => installClaudePlugin({ ...entry, repo: "ext::sh -c touch% pwn" })).toThrow(/invalid repo/);
    expect(() => installClaudePlugin({ ...entry, marketplace: "-m" })).toThrow(/invalid marketplace/);
    expect(existsSync(join(homedir(), "pwn"))).toBe(false);
  });

  it("never removes a marketplace of the same name that agentbrew does not own", () => {
    const file = join(homedir(), ".claude", "settings.json");
    mkdirSync(join(homedir(), ".claude"), { recursive: true });
    const theirs = { source: { source: "github", repo: "someone/demo" } };
    writeFileSync(file, JSON.stringify({ extraKnownMarketplaces: { "demo-market": theirs } }));
    expect(() => installClaudePlugin(entry)).toThrow(/not managed by agentbrew/);
    expect(settings().extraKnownMarketplaces["demo-market"]).toEqual(theirs);
  });

  it("deletes only its own checkout on remove, even when the record names another path", () => {
    installClaudePlugin(entry);
    const victim = mkdtempSync(join(homedir(), "victim-"));
    const path = join(homedir(), ".config", "agentbrew", "claude-plugins.json");
    const records = JSON.parse(readFileSync(path, "utf-8"));
    records[0].dir = victim;
    writeFileSync(path, JSON.stringify(records));
    expect(removeClaudePlugin("demo-guard")).toBe(true);
    expect(existsSync(victim)).toBe(true);
    expect(existsSync(claudePluginDir("demo-guard"))).toBe(false);
  });

  it("says plainly when the claude CLI is missing, before cloning anything", () => {
    process.env.AGENTBREW_CLAUDE_BIN = join(homedir(), "no-such-claude");
    expect(() => installClaudePlugin(entry)).toThrow(/Claude Code CLI not found/);
    expect(existsSync(claudePluginDir("demo-guard"))).toBe(false);
  });

  it("keeps the record when the plugin uninstall fails, so remove can be retried", () => {
    installClaudePlugin(entry);
    const failing = join(homedir(), "failing-claude");
    writeFileSync(failing, '#!/bin/sh\n[ "$1" = --version ] && exit 0\nexit 3\n');
    chmodSync(failing, 0o755);
    process.env.AGENTBREW_CLAUDE_BIN = failing;
    expect(() => removeClaudePlugin("demo-guard")).toThrow(/could not uninstall/);
    expect(readClaudePluginRecords()).toHaveLength(1);
  });
  it("treats its own marketplace as its own when settings store the path through a symlink", () => {
    installClaudePlugin(entry);
    const link = join(homedir(), "plugins-link");
    symlinkSync(dirname(claudePluginDir("demo-guard")), link);
    const s = settings();
    s.extraKnownMarketplaces["demo-market"].source.path = join(link, "demo-guard");
    writeFileSync(join(homedir(), ".claude", "settings.json"), JSON.stringify(s));
    expect(checkClaudePluginDrift([entry])).toEqual([]);
    expect(() => installClaudePlugin(entry)).not.toThrow();
  });

  it("refuses a name that an installed skill already uses", () => {
    mkdirSync(join(homedir(), ".claude", "skills", "demo-guard"), { recursive: true });
    expect(() => installClaudePlugin(entry)).toThrow(/already names a skill/);
  });

  it("says when the marketplace could not be removed because claude is missing", () => {
    installClaudePlugin(entry);
    process.env.AGENTBREW_CLAUDE_BIN = join(homedir(), "no-such-claude");
    expect(() => removeClaudePlugin("demo-guard")).toThrow(/Claude Code CLI not found/);
    expect(readClaudePluginRecords()).toHaveLength(1);
  });
});

describe("catalog claude_plugins entries", () => {
  it("pin agent-usage-guard to a reviewed full SHA that includes the #42 trust fix", async () => {
    const { loadCatalog } = await import("./types.js");
    const entry = (loadCatalog().claude_plugins ?? []).find((p) => p.name === "agent-usage-guard");
    expect(entry).toMatchObject({
      repo: "rbartoli/agent-usage-guard",
      commit: "e9bd8d6e2dc8432f3f5f5622ef282de96a71a389",
      plugin: "agent-usage-guard",
      marketplace: "agent-usage-guard",
    });
  });

  it("pin every entry to a full 40-character SHA", async () => {
    const { loadCatalog } = await import("./types.js");
    for (const p of loadCatalog().claude_plugins ?? []) expect(p.commit, p.name).toMatch(/^[0-9a-f]{40}$/);
  });
});
