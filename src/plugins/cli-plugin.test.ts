/**
 * Interactive `agentbrew plugin add` installs the exact checkout it showed
 * for approval: it fetches once, so a tag moved while the user reads the
 * prompt cannot change what gets installed.
 *
 * Repos, keys, and HOME are scratch. Git reads an empty global config file.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { home, previousEnv } = vi.hoisted(() => {
  const { mkdtempSync: mk, writeFileSync: wf } = require("node:fs") as typeof import("node:fs");
  const { tmpdir: td } = require("node:os") as typeof import("node:os");
  const { join: j } = require("node:path") as typeof import("node:path");
  const previous = {
    HOME: process.env.HOME,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  };
  const dir = mk(j(td(), "plugin-cli-home-"));
  const gitconfig = j(dir, "scratch.gitconfig");
  wf(gitconfig, "");
  process.env.HOME = dir;
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  return { home: dir, previousEnv: previous };
});

vi.mock("@inquirer/prompts", () => ({ confirm: vi.fn() }));

import { confirm } from "@inquirer/prompts";
import { Command } from "commander";
import { readLock } from "../lock.js";
import { fixtureGit, fixtureKey, type PluginFixture, pluginFixture } from "../test-utils/plugin-fixture.js";
import { marketplaceDir } from "./claude-native.js";
import { registerPluginCommands } from "./cli-plugin.js";
import { revokeSigner, trustSigner } from "./signers.js";
import { addPlugin, applyAdd, planAdd, pluginDir, pluginsRoot } from "./store.js";

const KEY = fixtureKey();
const ID = ["-c", "user.name=t", "-c", "user.email=t@example.com"];
const MANIFEST = { schema: 1, name: "acme", version: "1.0.0", capabilities: { agents: ["claude"] }, contributes: {} };
const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

let f: PluginFixture;
/** The commit of the signed tag v1.0.0 when the prompt is shown. */
let shown: string;

/** The signer moves v1.0.0 to a new signed commit. */
function moveTag(): void {
  writeFileSync(join(f.dir, "README.md"), "moved\n");
  fixtureGit(f.dir, "add", "-A");
  fixtureGit(f.dir, ...ID, "commit", "-qm", "moved");
  fixtureGit(
    f.dir,
    ...ID,
    "-c",
    "gpg.format=ssh",
    "-c",
    `user.signingkey=${KEY.file}`,
    "tag",
    "-f",
    "-s",
    "v1.0.0",
    "-m",
    "v1.0.0",
  );
}

async function add(...extra: string[]): Promise<void> {
  const program = new Command().exitOverride();
  registerPluginCommands(program);
  await program.parseAsync(["node", "agentbrew", "plugin", "add", `${f.dir}@v1.0.0`, "--signer", KEY.pub, ...extra]);
}

function staging(): string[] {
  return existsSync(pluginsRoot()) ? readdirSync(pluginsRoot()).filter((n) => n.startsWith(".staging-")) : [];
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const d of [".config", ".local"]) rmSync(join(home, d), { recursive: true, force: true });
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  f = pluginFixture(MANIFEST, KEY);
  f.release("v1.0.0", { "README.md": "shown\n" });
  shown = fixtureGit(f.dir, "rev-parse", "v1.0.0^{commit}");
});

afterEach(() => {
  if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
  process.exitCode = undefined;
  vi.mocked(confirm).mockReset();
});

afterAll(() => {
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
});

describe("agentbrew plugin add (interactive)", () => {
  it("installs the commit it showed, even when the tag moves before the answer", async () => {
    vi.mocked(confirm).mockImplementation(async () => {
      moveTag();
      return true;
    });

    await add();

    expect(process.exitCode).toBeUndefined();
    expect(fixtureGit(f.dir, "rev-parse", "v1.0.0^{commit}")).not.toBe(shown);
    expect(readLock().plugins?.[0]?.commit).toBe(shown);
    expect(fixtureGit(pluginDir("acme"), "rev-parse", "HEAD")).toBe(shown);
    expect(staging()).toEqual([]);
  });

  it("asks once and installs nothing when the answer is no", async () => {
    vi.mocked(confirm).mockResolvedValue(false);

    await add();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
    expect(existsSync(pluginDir("acme"))).toBe(false);
    expect(readLock().plugins ?? []).toEqual([]);
    expect(staging()).toEqual([]);
  });

  it("leaves no staged checkout when the prompt is cancelled", async () => {
    vi.mocked(confirm).mockRejectedValue(new Error("User force closed the prompt"));

    await add();

    expect(process.exitCode).toBe(1);
    expect(existsSync(pluginDir("acme"))).toBe(false);
    expect(staging()).toEqual([]);
  });

  it("--yes installs without a prompt", async () => {
    await add("--yes");

    expect(confirm).not.toHaveBeenCalled();
    expect(readLock().plugins?.[0]?.commit).toBe(shown);
  });
});

describe("planAdd and applyAdd", () => {
  const spec = () => `${f.dir}@v1.0.0`;

  it("refuses at install when the same name was installed while the user answered", () => {
    const plan = planAdd(spec(), { signer: KEY.pub });
    addPlugin(spec(), { yes: true, signer: KEY.pub });

    expect(() => applyAdd(plan, { yes: true })).toThrow(/already installed/);
    expect(staging()).toEqual([]);
  });

  it("refuses at install when the signer was revoked while the user answered", () => {
    trustSigner("acme", KEY.pub);
    const plan = planAdd(spec(), {});
    revokeSigner("acme", KEY.pub);

    expect(() => applyAdd(plan, { yes: true })).toThrow(/no longer trusted/);
    expect(existsSync(pluginDir("acme"))).toBe(false);
    expect(readLock().plugins ?? []).toEqual([]);
    expect(staging()).toEqual([]);
  });

  it("deletes staging dirs of runs that died, and keeps this run's own", () => {
    const dead = spawnSync("true").pid;
    mkdirSync(join(pluginsRoot(), `.staging-${dead}-1`), { recursive: true });
    mkdirSync(join(pluginsRoot(), `.staging-${process.pid}-1`), { recursive: true });

    addPlugin(spec(), { yes: true, signer: KEY.pub });

    expect(staging()).toEqual([`.staging-${process.pid}-1`]);
    rmSync(join(pluginsRoot(), `.staging-${process.pid}-1`), { recursive: true });
  });
});

describe("plugin commands re-emit the Claude Code plugin copy (#447)", () => {
  const run = async (...args: string[]) => {
    const program = new Command().exitOverride();
    registerPluginCommands(program);
    await program.parseAsync(["node", "agentbrew", "plugin", ...args]);
  };
  const copy = () => join(marketplaceDir(), "plugins", "acme");
  const hook = JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo acme-v2-hook" }] }] },
  });

  it("add, update, rollback, and remove keep the marketplace copy current", async () => {
    await run("add", `${f.dir}@v1.0.0`, "--signer", KEY.pub, "--yes");
    expect(existsSync(copy())).toBe(true);
    const hooks = () => {
      const path = join(copy(), "hooks", "hooks.json");
      return existsSync(path) ? readFileSync(path, "utf-8") : "";
    };
    expect(hooks()).not.toContain("acme-v2-hook");

    const manifest = {
      ...MANIFEST,
      capabilities: { ...MANIFEST.capabilities, hooks: ["SessionStart"] },
      contributes: { hooks: "hooks/hooks.json" },
    };
    f.release("v2.0.0", { "agentbrew-plugin.yaml": yaml.dump(manifest), "hooks/hooks.json": hook });
    vi.mocked(confirm).mockResolvedValue(true);
    await run("update", "acme", "v2.0.0");
    expect(process.exitCode).toBeUndefined();
    expect(hooks()).toContain("acme-v2-hook");

    await run("rollback", "acme");
    expect(hooks()).not.toContain("acme-v2-hook");

    await run("remove", "acme");
    expect(existsSync(copy())).toBe(false);
  });
});
