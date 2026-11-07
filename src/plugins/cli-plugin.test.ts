/**
 * Interactive `agentbrew plugin add` installs the exact checkout it showed
 * for approval: it fetches once, so a tag moved while the user reads the
 * prompt cannot change what gets installed.
 *
 * Repos, keys, and HOME are scratch. Git reads an empty global config file.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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
import { defaultState, saveState } from "../state.js";
import { fixtureGit, fixtureKey, type PluginFixture, pluginFixture } from "../test-utils/plugin-fixture.js";
import { marketplaceDir } from "./claude-native.js";
import { registerPluginCommands } from "./cli-plugin.js";
import { lifecycleObservation, writeObservation } from "./lifecycle-observation.js";
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

async function runObservationChild(args: string[], timeout: number) {
  const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let timedOut = false;
  let killError: unknown;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    output += chunk;
  });
  const status = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          killError = error;
        }
      }
    }, timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  if (killError && (killError as NodeJS.ErrnoException).code !== "ESRCH") throw killError;
  return { status, output, timedOut, pid: child.pid };
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

describe("plugin lifecycle observation", () => {
  it("records a completed stage once", async () => {
    const records: string[] = [];
    const times = [10, 12];
    const observe = lifecycleObservation(
      "test",
      (record) => records.push(record),
      () => times.shift() ?? NaN,
    );
    expect(await observe("add", async () => 42)).toBe(42);
    const parsed = records.map((record) => JSON.parse(record));
    expect(parsed).toEqual([
      { invocation: "test", stage: "add", state: "begin", time: 10 },
      { invocation: "test", stage: "add", state: "complete", time: 12, duration: 2 },
    ]);
  });

  it("leaves an unresolved stage incomplete", () => {
    const records: string[] = [];
    const observe = lifecycleObservation("test", (record) => records.push(record));
    void observe("add", () => new Promise(() => {}));
    expect(records.map((record) => JSON.parse(record).state)).toEqual(["begin"]);
  });

  it("rethrows failures without disclosing their contents", async () => {
    const records: string[] = [];
    const observe = lifecycleObservation("test", (record) => records.push(record));
    const failure = new Error("private-marker");
    await expect(
      observe("add", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(records.map((record) => JSON.parse(record).state)).toEqual(["begin", "failed"]);
    expect(records.join(" ")).not.toContain("private-marker");
  });

  it("preserves an action error if recording its failure also fails", async () => {
    const failure = new Error("action failure");
    const observe = lifecycleObservation("test", (record) => {
      if (JSON.parse(record).state === "failed") throw new Error("sink failure");
    });
    await expect(
      observe("add", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it("does not record a second terminal when completion recording fails", async () => {
    const states: string[] = [];
    const observe = lifecycleObservation("test", (record) => {
      const state = JSON.parse(record).state;
      states.push(state);
      if (state === "complete") throw new Error("sink failure");
    });
    await expect(observe("add", async () => 42)).rejects.toThrow("sink failure");
    expect(states).toEqual(["begin", "complete"]);
  });

  it("rejects an invalid initial clock before emitting a record", async () => {
    const records: string[] = [];
    const observe = lifecycleObservation(
      "test",
      (record) => records.push(record),
      () => NaN,
    );
    await expect(observe("add", async () => 42)).rejects.toThrow("Invalid observation timing");
    expect(records).toEqual([]);
  });

  it("marks invalid failure timing while preserving the action error", async () => {
    const records: string[] = [];
    const times = [10, 9];
    const failure = new Error("action failure");
    const observe = lifecycleObservation(
      "test",
      (record) => records.push(record),
      () => times.shift() ?? NaN,
    );
    await expect(
      observe("add", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(records.map((record) => JSON.parse(record).state)).toEqual(["begin", "invalid"]);
  });

  it("retains an incomplete record when the observing process times out", () => {
    const child = spawnSync(process.execPath, ["--import", "tsx", "src/plugins/lifecycle-observation-fixture.ts"], {
      encoding: "utf8",
      timeout: 3000,
    });
    expect((child.error as NodeJS.ErrnoException | undefined)?.code).toBe("ETIMEDOUT");
    const records = child.stderr
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ invocation: "synthetic", stage: "add", state: "begin" });
  });

  it("finishes a partial observation write", () => {
    const chunks: Buffer[] = [];
    writeObservation("record", (_fd, bytes, offset, length) => {
      const count = Math.min(length, 2);
      chunks.push(bytes.subarray(offset, offset + count));
      return count;
    });
    expect(Buffer.concat(chunks).toString()).toBe("record\n");
  });

  it("terminates a stalled runner and its same-group child", async () => {
    const script =
      'const {spawn}=require("node:child_process"); spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"}); console.log("ready"); setInterval(()=>{},1000)';
    const child = await runObservationChild(["-e", script], 1500);
    expect(child.output).toContain("ready");
    expect(child.timedOut).toBe(true);
    expect(child.pid).toBeDefined();
    let error: NodeJS.ErrnoException | undefined;
    try {
      process.kill(-child.pid!, 0);
    } catch (caught) {
      error = caught as NodeJS.ErrnoException;
    }
    expect(error?.code).toBe("ESRCH");
  });

  it("retains an incomplete record through a Vitest timeout", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "lifecycle-reporter-"));
    try {
      symlinkSync(join(process.cwd(), "node_modules"), join(scratch, "node_modules"));
      writeFileSync(
        join(scratch, "vitest.config.mjs"),
        'export default { test: { include: ["*.test.ts"], testTimeout: 500 } };\n',
      );
      const modulePath = JSON.stringify(join(process.cwd(), "src/plugins/lifecycle-observation.ts"));
      writeFileSync(
        join(scratch, "timeout.test.ts"),
        `import { it } from "vitest";\nimport { lifecycleObservation, writeObservation } from ${modulePath};\nit("synthetic timeout", async () => { await lifecycleObservation("synthetic", writeObservation)("add", () => new Promise(() => {})); });\n`,
      );
      const child = await runObservationChild(
        [
          join(process.cwd(), "node_modules/vitest/vitest.mjs"),
          "run",
          "--root",
          scratch,
          "--maxWorkers=1",
          "--reporter=default",
        ],
        20000,
      );
      expect(child.timedOut).toBe(false);
      expect(child.status).toBe(1);
      expect(child.output).toContain("Test timed out in 500ms");
      const records = child.output.split("\n").filter((line) => line.startsWith('{"invocation":'));
      expect(records).toHaveLength(1);
      expect(JSON.parse(records[0])).toMatchObject({ invocation: "synthetic", stage: "add", state: "begin" });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
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
    const observe = lifecycleObservation(randomUUID(), writeObservation);
    await observe("add", () => run("add", `${f.dir}@v1.0.0`, "--signer", KEY.pub, "--yes"));
    const hooks = () => {
      const path = join(copy(), "hooks", "hooks.json");
      return existsSync(path) ? readFileSync(path, "utf-8") : "";
    };
    await observe("initial-copy", () => {
      expect(existsSync(copy())).toBe(true);
      expect(hooks()).not.toContain("acme-v2-hook");
    });

    const manifest = {
      ...MANIFEST,
      capabilities: { ...MANIFEST.capabilities, hooks: ["SessionStart"] },
      contributes: { hooks: "hooks/hooks.json" },
    };
    await observe("release", () =>
      f.release("v2.0.0", { "agentbrew-plugin.yaml": yaml.dump(manifest), "hooks/hooks.json": hook }),
    );
    vi.mocked(confirm).mockResolvedValue(true);
    await observe("update", () => run("update", "acme", "v2.0.0"));
    await observe("updated-copy", () => {
      expect(process.exitCode).toBeUndefined();
      expect(hooks()).toContain("acme-v2-hook");
    });

    await observe("rollback", () => run("rollback", "acme"));
    await observe("rolled-back-copy", () => expect(hooks()).not.toContain("acme-v2-hook"));

    await observe("remove", () => run("remove", "acme"));
    await observe("final-copy", () => expect(existsSync(copy())).toBe(false));
  });
});

describe("plugin update guidance", () => {
  it("lists installed names and the newest remote tag when arguments are missing", async () => {
    const relativeSource = relative(pluginsRoot(), f.dir);
    addPlugin(`${relativeSource}@v1.0.0`, { yes: true, signer: KEY.pub });
    f.release("v2.0.0", { "README.md": "new version\n" });
    const program = new Command().exitOverride();
    registerPluginCommands(program);
    await program.parseAsync(["node", "agentbrew", "plugin", "update"]);
    expect(process.exitCode).toBe(1);
    const output = vi.mocked(console.error).mock.calls.flat().join("\n");
    expect(output).toContain("acme");
    expect(output).toContain("v2.0.0");
    expect(output).toContain("unverified");
    expect(output).toContain("agentbrew plugin update <name> <ref>");
  });

  it("suggests the registered name for an unknown plugin", async () => {
    addPlugin(`${f.dir}@v1.0.0`, { yes: true, signer: KEY.pub });
    const program = new Command().exitOverride();
    registerPluginCommands(program);
    await program.parseAsync(["node", "agentbrew", "plugin", "update", "acmee", "v2.0.0", "--yes"]);
    expect(process.exitCode).toBe(1);
    const output = vi.mocked(console.error).mock.calls.flat().join("\n");
    expect(output).toContain("Did you mean acme");
    expect(readLock().plugins?.[0]?.ref).toBe("v1.0.0");
  });
});

describe("plugin update duplicate skill source", () => {
  it("updates the locked skills but warns instead of modifying an independent source", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    f = pluginFixture({ ...MANIFEST, contributes: { skills: "skills/" } }, KEY);
    f.release("v1.0.0", { "skills/greet/SKILL.md": "---\nname: greet\ndescription: greet\n---\nold\n" });
    addPlugin(`${f.dir}@v1.0.0`, { yes: true, signer: KEY.pub });
    const legacy = join(home, "legacy-skills");
    mkdirSync(join(legacy, "greet"), { recursive: true });
    const oldText = "---\nname: greet\ndescription: greet\n---\nlegacy old\n";
    writeFileSync(join(legacy, "greet/SKILL.md"), oldText);
    saveState({
      ...defaultState(),
      sources: [
        { availableItems: [], addedAt: "2026-11-01T00:00:00Z", type: "local", url: legacy, skillsInstalled: ["greet"] },
      ],
    });
    f.release("v2.0.0", { "skills/greet/SKILL.md": "---\nname: greet\ndescription: greet\n---\nnew\n" });
    const program = new Command().exitOverride();
    registerPluginCommands(program);
    await program.parseAsync(["node", "agentbrew", "plugin", "update", "acme", "v2.0.0", "--yes"]);
    expect(process.exitCode).toBeUndefined();
    expect(readFileSync(join(pluginDir("acme"), "skills/greet/SKILL.md"), "utf-8")).toContain("new");
    expect(readFileSync(join(legacy, "greet/SKILL.md"), "utf-8")).toBe(oldText);
    expect(warnings.mock.calls.flat().join("\n")).toContain("higher-priority source legacy-skills");
    warnings.mockRestore();
  });
});

describe("plugin update optional diagnostics", () => {
  it("keeps a successful update successful when source scanning throws", async () => {
    addPlugin(`${f.dir}@v1.0.0`, { yes: true, signer: KEY.pub });
    f.release("v2.0.0", { "README.md": "updated\n" });
    const sources = await import("../sync/skills-sync.js");
    const scan = vi.spyOn(sources, "getSkillSources").mockImplementation(() => {
      throw new Error("PRIVATE_FIXTURE_PAYLOAD");
    });
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const program = new Command().exitOverride();
      registerPluginCommands(program);
      await program.parseAsync(["node", "agentbrew", "plugin", "update", "acme", "v2.0.0", "--yes"]);
      expect(process.exitCode).toBeUndefined();
      expect(readLock().plugins?.[0]?.ref).toBe("v2.0.0");
      const output = warnings.mock.calls.flat().join("\n");
      expect(output).toContain("optional skill-source inspection failed");
      expect(output).not.toContain("PRIVATE_FIXTURE_PAYLOAD");
    } finally {
      scan.mockRestore();
      warnings.mockRestore();
    }
  });
});
