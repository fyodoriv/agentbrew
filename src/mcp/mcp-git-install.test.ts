import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { ExitPromptError } from "@inquirer/core";
import { Command } from "commander";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The install and update flows end to end, with real git and a real `npm run
// build`; only state and the agent sync are mocked. Scratch HOME comes from
// vitest.isolated-home.ts; git reads an empty scratch global config.

vi.mock("../sync/mcp-sync.js", async (importOriginal) => ({
  addMcpServer: vi.fn(),
  syncMcpServers: vi.fn(),
  verifyMcpServerPublication: (await importOriginal<typeof import("../sync/mcp-sync.js")>()).verifyMcpServerPublication,
}));
vi.mock("../state.js", () => ({ requireState: vi.fn(), saveState: vi.fn(), invalidateState: vi.fn() }));
vi.mock("@inquirer/prompts", () => ({ confirm: vi.fn(), input: vi.fn(), password: vi.fn() }));

import { confirm, input, password } from "@inquirer/prompts";
import { registerInstallCommand } from "../commands/cli-install.js";
import { registerMcpCommands } from "../commands/cli-mcp.js";
import { requireState, saveState } from "../state.js";
import { addMcpServer } from "../sync/mcp-sync.js";
import type { AgentBrewState } from "../types.js";
import { MCP_BUILD_DIR } from "./git-candidate.js";
import { GIT_CACHE_DIR, installMcpFromGit, updateMcpFromGit } from "./mcp-git.js";
import { getShellConfigPath } from "./mcp-wizard.js";

const mockAddMcpServer = vi.mocked(addMcpServer);
const mockRequireState = vi.mocked(requireState);
const mockSaveState = vi.mocked(saveState);
const mockInput = vi.mocked(input);
const mockPassword = vi.mocked(password);
const mockConfirm = vi.mocked(confirm);

const TEST_ENV: Record<string, string> = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "agentbrew test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "agentbrew test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  npm_config_update_notifier: "false",
  npm_config_audit: "false",
  npm_config_fund: "false",
};

let root = "";
let compatibilityState: AgentBrewState;
const compatibilityOldRoots = new Map<string, string>();
const savedEnv: Record<string, string | undefined> = {};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
}

/** Commit a build script that writes `<outDir>/<file>` (ignored), or fails; tag it `label`. */
function commitBuild(repo: string, label: string, opts: { fails?: boolean; out?: string; noop?: boolean } = {}): void {
  const out = opts.out ?? "dist/index.js";
  // FIXTURE_BUILD_FAIL makes any build fail, like an offline `npm install`.
  const script = opts.fails
    ? "process.exit(1);\n"
    : opts.noop
      ? "// writes nothing\n"
      : `if (process.env.FIXTURE_BUILD_FAIL) process.exit(1);\nconst fs = require("fs");\nfs.mkdirSync(require("path").dirname("${out}"), { recursive: true });\nfs.writeFileSync("${out}", "// built from ${label}\\n");\n`;
  writeFileSync(join(repo, "build.js"), script);
  git(repo, "add", "build.js");
  git(repo, "commit", "--quiet", "-m", label);
  git(repo, "tag", "-a", label, "-m", label);
}

/** Write package.json with a `build` script (or none) and optional fields, and stage it. */
function writePackage(repo: string, fields: Record<string, unknown> = {}, build = true): void {
  const scripts = build ? { build: "node build.js" } : {};
  writeFileSync(
    join(repo, "package.json"),
    `${JSON.stringify({ name: "fixture", version: "1.0.0", private: true, scripts, ...fields })}\n`,
  );
  git(repo, "add", "package.json");
}

/** A node MCP repo whose tag v1 builds dist/index.js, with `files` tracked. Callers add later tags. */
function nodeRepo(name: string, fields: Record<string, unknown> = {}, files: Record<string, string> = {}): string {
  const repo = join(root, name);
  git(root, "init", "--quiet", "-b", "main", repo);
  writePackage(repo, fields);
  writeFileSync(join(repo, ".gitignore"), "dist/\nbuild/\nnode_modules/\npackage-lock.json\ntoken.json\n");
  git(repo, "add", ".gitignore");
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(repo, file, ".."), { recursive: true });
    writeFileSync(join(repo, file), text);
    git(repo, "add", file);
  }
  commitBuild(repo, "v1", fields.bin ? { out: "dist/main.js" } : {});
  return repo;
}

function cached(name: string, ...parts: string[]): string {
  return join(GIT_CACHE_DIR, name, ...parts);
}

function oldRuntime(name: string, ...parts: string[]): string {
  const oldRoot = compatibilityOldRoots.get(name);
  if (!oldRoot) throw new Error("fixture setup: original runtime absent");
  return join(oldRoot, ...parts);
}

function stateWith(name: string, gitUrl: string, gitRef: string): AgentBrewState {
  const existing = compatibilityState.mcpServers?.find((server) => server.name === name);
  if (!existing) throw new Error("fixture setup: original definition absent");
  Object.assign(existing, { gitUrl, gitRef });
  return compatibilityState;
}

function selectedRuntime(name: string, ...parts: string[]): string {
  const server = compatibilityState.mcpServers?.find((item) => item.name === name);
  if (!server?.args[0]) throw new Error("fixture setup: selected definition absent");
  const parent = join(MCP_BUILD_DIR, name);
  const attempt = relative(parent, server.args[0]).split(sep)[0];
  expect(attempt, "selected runtime stays in its candidate namespace").toMatch(
    /^attempt-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
  );
  const selectedRoot = join(parent, attempt);
  expect(realpathSync(selectedRoot), "selected lexical root has the registered repository identity").toBe(
    realpathSync(git(dirname(server.args[0]), "rev-parse", "--show-toplevel")),
  );
  return join(selectedRoot, ...parts);
}

function recoveryIdentity(path: string) {
  const stat = lstatSync(path);
  return { bytes: readFileSync(path, "utf8"), inode: stat.ino, mode: stat.mode };
}

function seedLegacyRuntime(name: string, repo: string): void {
  const oldRoot = join(GIT_CACHE_DIR, name);
  mkdirSync(GIT_CACHE_DIR, { recursive: true });
  execFileSync("git", ["clone", "--no-local", "--quiet", "--", repo, oldRoot], { stdio: "pipe" });
  git(oldRoot, "checkout", "--detach", "v1");
  execFileSync(process.execPath, ["build.js"], { cwd: oldRoot, stdio: "pipe" });
  compatibilityOldRoots.set(name, oldRoot);
  compatibilityState.mcpServers?.push({
    name,
    command: "node",
    args: [join(oldRoot, "dist/index.js")],
    env: {},
    source: "user",
    gitUrl: repo,
    gitRef: "v1",
  });
}

beforeEach(() => {
  compatibilityState = { agents: [], sources: [], catalogVersion: "0.1.0", mcpServers: [], memory: { enabled: false } };
  compatibilityOldRoots.clear();
  mockRequireState.mockImplementation(() => compatibilityState);
  mockSaveState.mockImplementation((next) => {
    compatibilityState = structuredClone(next);
  });
  mockAddMcpServer.mockImplementation(async (name, command, args, env, options) => {
    const definition = {
      name,
      command,
      args: [...args],
      env: { ...env },
      source: "user",
      gitUrl: options?.gitUrl,
      gitRef: options?.gitRef,
    };
    const existing = compatibilityState.mcpServers?.find((item) => item.name === name);
    if (existing) Object.assign(existing, definition);
    else compatibilityState.mcpServers?.push(definition);
    if (!compatibilityOldRoots.has(name)) {
      compatibilityOldRoots.set(name, git(dirname(args[0]), "rev-parse", "--show-toplevel"));
    }
  });
});

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-git-install-"));
  const globalConfig = join(root, "empty.gitconfig");
  writeFileSync(globalConfig, "");
  for (const key of Object.keys(process.env).filter((name) => name.startsWith("GIT_"))) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries({ ...TEST_ENV, GIT_CONFIG_GLOBAL: globalConfig })) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.exitCode = undefined;
  vi.clearAllMocks();
});

afterAll(() => {
  vi.restoreAllMocks();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
  rmSync(GIT_CACHE_DIR, { recursive: true, force: true });
});

describe("a failed --git install or update exits 1 and registers nothing stale (real git)", () => {
  it("exits 1 when the ref is refused", async () => {
    const repo = nodeRepo("refused-ref");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await installMcpFromGit(repo, { ref: "--detach", nonInteractive: true });
    expect(process.exitCode).toBe(1);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
  });

  it("refuses a re-pin whose build fails: exits 1, registers nothing, and deletes nothing", async () => {
    const repo = nodeRepo("stale-build");
    commitBuild(repo, "v2", { fails: true });
    await installMcpFromGit(repo, { ref: "v1", nonInteractive: true });
    expect(process.exitCode).toBeUndefined();
    expect(mockAddMcpServer).toHaveBeenCalledTimes(1);
    // A file the user keeps in the cache, ignored by the repo, as OAuth servers do.
    writeFileSync(oldRuntime("stale-build", "token.json"), "{}\n");

    mockAddMcpServer.mockClear();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true, freshRuntime: true });
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("The build failed at"));
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining(`agentbrew install stale-build --git '${repo}' --ref <ref>`),
    );
    expect(readFileSync(oldRuntime("stale-build", "dist", "index.js"), "utf-8")).toContain("built from v1");
    expect(existsSync(oldRuntime("stale-build", "token.json"))).toBe(true);

    // A second attempt at the same commit is refused too: no successful build of v2 exists.
    process.exitCode = undefined;
    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true, freshRuntime: true });
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("refuses a failed re-pinned build even behind a tracked shim that loads the old output", async () => {
    const repo = nodeRepo("shim-build", { bin: "bin/cli.js" }, { "bin/cli.js": 'require("../dist/main.js");\n' });
    commitBuild(repo, "v2", { fails: true });
    await installMcpFromGit(repo, { ref: "v1", nonInteractive: true });
    expect(mockAddMcpServer).toHaveBeenCalledTimes(1);

    mockAddMcpServer.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true, freshRuntime: true });
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("refuses the old commit's output when the new commit has no build script", async () => {
    const repo = nodeRepo("no-build-now");
    writePackage(repo, {}, false);
    git(repo, "commit", "--quiet", "-m", "v2");
    git(repo, "tag", "-a", "v2", "-m", "v2");
    await installMcpFromGit(repo, { ref: "v1", nonInteractive: true });
    mockAddMcpServer.mockClear();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true, freshRuntime: true });
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("left over from an earlier build"));
  });

  it("exits 1 without saving when `mcp update` pulls a branch commit whose build fails", async () => {
    const repo = nodeRepo("branch-update");
    await installMcpFromGit(repo, { ref: "main", nonInteractive: true });
    commitBuild(repo, "v2", { fails: true });
    mockRequireState.mockReturnValue(stateWith("branch-update", repo, "main"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await updateMcpFromGit("branch-update", { freshRuntime: true });

    expect(process.exitCode).toBe(1);
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(readFileSync(oldRuntime("branch-update", "dist", "index.js"), "utf-8")).toContain("built from v1");
  });

  it("exits 1 with a re-pin hint, not a network hint, on a tag pin: `mcp update` and an install with no --ref", async () => {
    const repo = nodeRepo("tag-pin");
    await installMcpFromGit(repo, { ref: "v1", nonInteractive: true });
    mockRequireState.mockReturnValue(stateWith("tag-pin", repo, "v1"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const logs = vi.mocked(console.log);
    logs.mockClear();

    await updateMcpFromGit("tag-pin");
    expect(process.exitCode).toBe(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("pinned to a tag or commit"));
    expect(logs).not.toHaveBeenCalledWith(expect.stringContaining("network connection"));
    expect(mockSaveState).not.toHaveBeenCalled();

    process.exitCode = undefined;
    errors.mockClear();
    mockAddMcpServer.mockClear();
    await installMcpFromGit(repo, { nonInteractive: true });
    expect(process.exitCode).toBe(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("--ref <tag|branch|commit>"));
    expect(mockAddMcpServer).not.toHaveBeenCalled();
  });
});

describe("a re-pin registers the output its own build wrote, and a refused one puts the cache back (real git)", () => {
  const sha = (dir: string, ref: string) => git(dir, "rev-parse", `${ref}^{commit}`);

  it("removes new partial output after a failed re-pin and preserves user files", async () => {
    const repo = nodeRepo("partial-output");
    writeFileSync(
      join(repo, "build.js"),
      'const fs = require("fs"); fs.mkdirSync("build", { recursive: true }); fs.writeFileSync("build/index.js", "partial"); process.exit(1);\n',
    );
    git(repo, "add", "build.js");
    git(repo, "commit", "--quiet", "-m", "v2");
    git(repo, "tag", "v2");
    await installMcpFromGit(repo, { ref: "v1", nonInteractive: true });
    writeFileSync(oldRuntime("partial-output", "token.json"), "{}\n");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const candidateParent = join(MCP_BUILD_DIR, "partial-output");
    const attemptsBefore = new Set(readdirSync(candidateParent));
    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true, freshRuntime: true });
    const attempts = readdirSync(candidateParent).filter((entry) => !attemptsBefore.has(entry));
    expect(attempts, "one new failed candidate remains retained").toHaveLength(1);
    expect(
      readFileSync(join(candidateParent, attempts[0], "build", "index.js"), "utf8"),
      "planted partial write reached",
    ).toBe("partial");

    expect(process.exitCode).toBe(1);
    expect(existsSync(oldRuntime("partial-output", "build", "index.js"))).toBe(false);
    expect(readFileSync(oldRuntime("partial-output", "dist", "index.js"), "utf-8")).toContain("built from v1");
    expect(existsSync(oldRuntime("partial-output", "token.json"))).toBe(true);
  });

  it("preserves interrupted output instead of deleting the only saved build", async () => {
    const repo = nodeRepo("interrupted-output");
    writeFileSync(
      join(repo, "build.js"),
      'require("fs").appendFileSync("candidate-build-entered", "entered\\n"); process.exit(1);\n',
    );
    git(repo, "add", "build.js");
    git(repo, "commit", "--quiet", "-m", "v2 candidate failure");
    git(repo, "tag", "v2");
    seedLegacyRuntime("interrupted-output", repo);
    const aside = oldRuntime("interrupted-output", ".git", "agentbrew-build-aside");
    mkdirSync(aside, { recursive: true });
    renameSync(oldRuntime("interrupted-output", "dist", "index.js"), join(aside, "0"));
    const recovery = recoveryIdentity(join(aside, "0"));
    mockAddMcpServer.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const candidateParent = join(MCP_BUILD_DIR, "interrupted-output");
    const attemptsBefore = new Set(existsSync(candidateParent) ? readdirSync(candidateParent) : []);
    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true, freshRuntime: true });
    const attempts = readdirSync(candidateParent).filter((entry) => !attemptsBefore.has(entry));
    expect(attempts, "one new candidate reached preparation").toHaveLength(1);
    expect(
      readFileSync(join(candidateParent, attempts[0], "candidate-build-entered"), "utf8"),
      "candidate build failure reached once",
    ).toBe("entered\n");

    expect(process.exitCode).toBe(1);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(readFileSync(join(aside, "0"), "utf-8")).toContain("built from v1");
    expect(recoveryIdentity(join(aside, "0"))).toEqual(recovery);
  });

  it("keeps a blocked legacy recovery copy when selecting an independent runtime", async () => {
    const repo = nodeRepo("blocked-restore");
    commitBuild(repo, "v2", { out: "build/index.js" });
    seedLegacyRuntime("blocked-restore", repo);
    const aside = oldRuntime("blocked-restore", ".git", "agentbrew-build-aside");
    mkdirSync(aside, { recursive: true });
    renameSync(oldRuntime("blocked-restore", "dist", "index.js"), join(aside, "0"));
    mkdirSync(oldRuntime("blocked-restore", "dist", "index.js"));
    const recovery = recoveryIdentity(join(aside, "0"));
    const blockedInode = lstatSync(oldRuntime("blocked-restore", "dist", "index.js")).ino;
    const blockedMode = lstatSync(oldRuntime("blocked-restore", "dist", "index.js")).mode;
    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true, freshRuntime: true });
    expect(process.exitCode).toBeUndefined();
    expect(realpathSync(selectedRuntime("blocked-restore")), "independent runtime selected").not.toBe(
      realpathSync(oldRuntime("blocked-restore")),
    );
    expect(readFileSync(selectedRuntime("blocked-restore", "build", "index.js"), "utf8")).toContain("built from v2");
    expect(readFileSync(join(aside, "0"), "utf8")).toContain("built from v1");
    expect(recoveryIdentity(join(aside, "0"))).toEqual(recovery);
    expect(lstatSync(oldRuntime("blocked-restore", "dist", "index.js")).ino).toBe(blockedInode);
    expect(lstatSync(oldRuntime("blocked-restore", "dist", "index.js")).mode).toBe(blockedMode);
  });

  it("registers build/index.js on every run when v2 builds somewhere new, and keeps token.json", async () => {
    const repo = nodeRepo("moved-out");
    commitBuild(repo, "v2", { out: "build/index.js" });
    await installMcpFromGit(repo, { ref: "v1", nonInteractive: true });
    writeFileSync(oldRuntime("moved-out", "token.json"), "{}\n");

    for (const run of [1, 2]) {
      mockAddMcpServer.mockClear();
      await installMcpFromGit(repo, { ref: "v2", nonInteractive: true, freshRuntime: true });
      expect(process.exitCode, `run ${run}`).toBeUndefined();
      expect(mockAddMcpServer, `run ${run}`).toHaveBeenCalledWith(
        "moved-out",
        "node",
        [selectedRuntime("moved-out", "build", "index.js")],
        {},
        expect.objectContaining({ gitRef: "v2" }),
      );
    }
    expect(existsSync(selectedRuntime("moved-out", "dist", "index.js"))).toBe(false);
    expect(readFileSync(oldRuntime("moved-out", "dist", "index.js"), "utf8")).toContain("built from v1");
    expect(existsSync(selectedRuntime("moved-out", "token.json"))).toBe(false);
    expect(existsSync(oldRuntime("moved-out", "token.json"))).toBe(true);
  });

  it("registers build/index.js from a cache an older agentbrew made, which has no output record", async () => {
    const repo = nodeRepo("legacy-cache");
    commitBuild(repo, "v2", { out: "build/index.js" });
    seedLegacyRuntime("legacy-cache", repo);
    rmSync(oldRuntime("legacy-cache", ".git", "agentbrew-build-outputs"), { force: true });

    mockAddMcpServer.mockClear();
    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true, freshRuntime: true });
    expect(process.exitCode).toBeUndefined();
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "legacy-cache",
      "node",
      [selectedRuntime("legacy-cache", "build", "index.js")],
      {},
      expect.anything(),
    );
  });

  it("refuses a build that writes nothing, restores the cache to v1, and keeps v1's output and token.json", async () => {
    const repo = nodeRepo("noop-build");
    commitBuild(repo, "v2", { noop: true });
    await installMcpFromGit(repo, { ref: "v1", nonInteractive: true });
    writeFileSync(oldRuntime("noop-build", "token.json"), "{}\n");
    mockAddMcpServer.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});

    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true, freshRuntime: true });

    expect(process.exitCode).toBe(1);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(git(oldRuntime("noop-build"), "rev-parse", "HEAD")).toBe(sha(repo, "v1"));
    expect(readFileSync(oldRuntime("noop-build", "dist", "index.js"), "utf-8")).toContain("built from v1");
    expect(existsSync(oldRuntime("noop-build", "token.json"))).toBe(true);
  });

  it("puts the cache back at the registered commit when a re-pin is refused", async () => {
    const repo = nodeRepo("put-back");
    commitBuild(repo, "v2", { fails: true });
    await installMcpFromGit(repo, { ref: "v1", nonInteractive: true });
    writeFileSync(oldRuntime("put-back", "token.json"), "{}\n");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true, freshRuntime: true });

    expect(process.exitCode).toBe(1);
    expect(git(oldRuntime("put-back"), "rev-parse", "HEAD")).toBe(sha(repo, "v1"));
    expect(existsSync(oldRuntime("put-back", "build.js"))).toBe(true);
    expect(readFileSync(oldRuntime("put-back", "build.js"), "utf-8")).not.toBe("process.exit(1);\n");
    expect(readFileSync(oldRuntime("put-back", "dist", "index.js"), "utf-8")).toContain("built from v1");
    expect(existsSync(oldRuntime("put-back", "token.json"))).toBe(true);
  });

  it("keeps a followed branch on that branch when `mcp update` is refused", async () => {
    const repo = nodeRepo("put-back-branch");
    await installMcpFromGit(repo, { ref: "main", nonInteractive: true });
    const registered = git(oldRuntime("put-back-branch"), "rev-parse", "HEAD");
    commitBuild(repo, "v2", { fails: true });
    mockRequireState.mockReturnValue(stateWith("put-back-branch", repo, "main"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await updateMcpFromGit("put-back-branch", { freshRuntime: true });

    expect(process.exitCode).toBe(1);
    expect(git(oldRuntime("put-back-branch"), "rev-parse", "HEAD")).toBe(registered);
    expect(git(oldRuntime("put-back-branch"), "symbolic-ref", "--short", "HEAD")).toBe("main");
  });
});

describe("build output that belongs to HEAD still installs (real git)", () => {
  it("keeps an earlier successful build of the same commit when this build fails", async () => {
    const repo = nodeRepo("same-commit");
    await installMcpFromGit(repo, { ref: "v1", nonInteractive: true });
    mockAddMcpServer.mockClear();
    process.env.FIXTURE_BUILD_FAIL = "1";
    try {
      await installMcpFromGit(repo, { ref: "v1", nonInteractive: true });
    } finally {
      delete process.env.FIXTURE_BUILD_FAIL;
    }
    expect(process.exitCode).toBeUndefined();
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "same-commit",
      "node",
      [selectedRuntime("same-commit", "dist", "index.js")],
      {},
      expect.objectContaining({ gitRef: "v1" }),
    );
  });

  it("runs a fresh clone's committed build output when its build fails", async () => {
    const repo = join(root, "committed-dist");
    git(root, "init", "--quiet", "-b", "main", repo);
    writePackage(repo);
    writeFileSync(join(repo, "build.js"), "process.exit(1);\n");
    mkdirSync(join(repo, "dist"));
    writeFileSync(join(repo, "dist", "index.js"), "// committed\n");
    git(repo, "add", "build.js", "dist/index.js");
    git(repo, "commit", "--quiet", "-m", "committed dist");
    await installMcpFromGit(repo, { nonInteractive: true });
    expect(process.exitCode).toBeUndefined();
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "committed-dist",
      "node",
      [selectedRuntime("committed-dist", "dist", "index.js")],
      {},
      expect.objectContaining({ gitUrl: repo }),
    );

    // Every file of that fresh clone came from this commit, so a later run at it still installs.
    mockAddMcpServer.mockClear();
    await installMcpFromGit(repo, { ref: "main", nonInteractive: true });
    expect(process.exitCode).toBeUndefined();
    expect(mockAddMcpServer).toHaveBeenCalledTimes(1);
  });

  it("accepts an entrypoint that the commit itself contains, with no build", async () => {
    const repo = join(root, "tracked-entry");
    git(root, "init", "--quiet", "-b", "main", repo);
    writeFileSync(join(repo, "index.js"), "// tracked\n");
    git(repo, "add", "index.js");
    git(repo, "commit", "--quiet", "-m", "tracked entrypoint");
    await installMcpFromGit(repo, { nonInteractive: true });
    expect(process.exitCode).toBeUndefined();
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "tracked-entry",
      "node",
      [selectedRuntime("tracked-entry", "index.js")],
      {},
      expect.objectContaining({ gitUrl: repo }),
    );
  });
});

describe("git installs take env values without waiting on a prompt (real git)", () => {
  const KEY = "MCP_TEST_API_KEY";
  const SECRET = "s3cret-value-123";

  /** A repo whose tracked index.js is the entrypoint; no build. */
  function envRepo(name: string): string {
    const repo = join(root, name);
    git(root, "init", "--quiet", "-b", "main", repo);
    writeFileSync(join(repo, "index.js"), "// server\n");
    git(repo, "add", "index.js");
    git(repo, "commit", "--quiet", "-m", "server");
    return repo;
  }

  function cli(): Command {
    const program = new Command();
    registerMcpCommands(program, async () => {});
    registerInstallCommand(program);
    return program;
  }

  /** Run `fn` with stdin and stdout reporting a terminal (or not). */
  async function withTerminal(isTTY: boolean, fn: () => Promise<unknown>): Promise<void> {
    const streams = [process.stdin, process.stdout] as Array<{ isTTY?: boolean }>;
    const before = streams.map((stream) => Object.getOwnPropertyDescriptor(stream, "isTTY"));
    for (const stream of streams) Object.defineProperty(stream, "isTTY", { value: isTTY, configurable: true });
    try {
      await fn();
    } finally {
      streams.forEach((stream, i) => {
        const descriptor = before[i];
        if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
        else delete stream.isTTY;
      });
    }
  }

  /** Everything printed, to check that no env value leaks. */
  function printed(): string {
    return [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join("\n");
  }

  afterEach(() => {
    delete process.env[KEY];
  });

  beforeAll(() => {
    // A prompt that is reached never answers: a test that would wait times out.
    mockInput.mockImplementation(() => new Promise(() => {}) as ReturnType<typeof input>);
    mockPassword.mockImplementation(() => new Promise(() => {}) as ReturnType<typeof password>);
    mockConfirm.mockImplementation(() => new Promise(() => {}) as ReturnType<typeof confirm>);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("`mcp add --git --env KEY --yes` exits 1 naming a missing key, and never prompts", async () => {
    const repo = envRepo("env-mcp-add");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await withTerminal(true, () =>
      cli().parseAsync(["node", "agentbrew", "mcp", "add", "env-mcp-add", "--git", repo, "--env", KEY, "--yes"]),
    );
    expect(process.exitCode).toBe(1);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(expect.stringContaining(KEY));
    expect(mockPassword).not.toHaveBeenCalled();
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    // The missing key fails before the clone and build start.
    expect(existsSync(join(GIT_CACHE_DIR, "env-mcp-add"))).toBe(false);
  }, 5000);

  it("`install --git --env KEY` with no terminal exits 1 naming a missing key, and never prompts", async () => {
    const repo = envRepo("env-install");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await withTerminal(false, () =>
      cli().parseAsync(["node", "agentbrew", "install", "env-install", "--git", repo, "--env", KEY]),
    );
    expect(process.exitCode).toBe(1);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(expect.stringContaining(KEY));
    expect(mockPassword).not.toHaveBeenCalled();
    expect(mockAddMcpServer).not.toHaveBeenCalled();
  }, 5000);

  it("stores a reference for a key set in the environment and a value for KEY=VALUE, and never prints the value", async () => {
    const repo = envRepo("env-set");
    process.env[KEY] = SECRET;
    await cli().parseAsync([
      "node",
      "agentbrew",
      "mcp",
      "add",
      "env-set",
      "--git",
      repo,
      "--env",
      KEY,
      "MODE=fast",
      "--yes",
    ]);
    expect(process.exitCode).toBeUndefined();
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "env-set",
      "node",
      [selectedRuntime("env-set", "index.js")],
      { [KEY]: `\${${KEY}}`, MODE: "fast" },
      expect.objectContaining({ gitUrl: repo }),
    );
    expect(printed()).not.toContain(SECRET);
  }, 5000);

  it("asks in a terminal with hidden input and saves the value where agents read it", async () => {
    const repo = envRepo("env-typed");
    mockPassword.mockResolvedValueOnce(SECRET);
    mockConfirm.mockResolvedValueOnce(true);
    await withTerminal(true, () => installMcpFromGit(repo, { envPairs: [KEY] }));
    expect(mockPassword).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining(KEY), mask: true }),
    );
    expect(readFileSync(getShellConfigPath(), "utf-8")).toContain(`export ${KEY}=`);
    expect(process.exitCode).toBeUndefined();
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "env-typed",
      "node",
      expect.any(Array),
      { [KEY]: `\${${KEY}}` },
      expect.anything(),
    );
    expect(printed()).not.toContain(SECRET);
  }, 5000);

  it("exits 130 when the prompt is cancelled with Ctrl-C", async () => {
    const repo = envRepo("env-cancel");
    mockPassword.mockRejectedValueOnce(new ExitPromptError("User force closed the prompt with SIGINT"));
    await withTerminal(true, () => installMcpFromGit(repo, { envPairs: [KEY] }));
    expect(process.exitCode).toBe(130);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
  }, 5000);

  it("keeps the env vars of an installed server that a re-install does not pass again", async () => {
    const repo = envRepo("env-keep");
    process.env[KEY] = SECRET;
    compatibilityState.mcpServers = [
      { name: "env-keep", command: "node", args: [], env: { MODE: "fast", [KEY]: `\${${KEY}}` }, source: "user" },
    ];
    await installMcpFromGit(repo, { envPairs: ["LEVEL=2", "MODE=slow"], nonInteractive: true, freshRuntime: true });
    expect(process.exitCode).toBeUndefined();
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "env-keep",
      "node",
      expect.any(Array),
      { [KEY]: `\${${KEY}}`, MODE: "slow", LEVEL: "2" },
      expect.anything(),
    );
  }, 5000);

  it("refuses an entry that is not KEY or KEY=VALUE without echoing it, and a lower-case key", async () => {
    const repo = envRepo("env-bad-name");
    // A secret pasted with no key must not show up in the error.
    await installMcpFromGit(repo, { envPairs: ["MODE=fast", SECRET], nonInteractive: true });
    expect(process.exitCode).toBe(1);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(expect.stringContaining("--env entry 2"));
    expect(printed()).not.toContain(SECRET);
    process.exitCode = undefined;
    await installMcpFromGit(repo, { envPairs: ["api_key"], nonInteractive: true });
    expect(process.exitCode).toBe(1);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    // A base64 secret pasted with no key looks like KEY== : refused, and not echoed.
    process.exitCode = undefined;
    await installMcpFromGit(repo, { envPairs: ["dXNlcjpwYXNzd29yZA=="], nonInteractive: true });
    expect(process.exitCode).toBe(1);
    expect(printed()).not.toContain("dXNlcjpwYXNzd29yZA");
    // A lower-case KEY=VALUE is fine: only a bare KEY becomes a ${KEY} reference.
    process.exitCode = undefined;
    await installMcpFromGit(repo, { envPairs: ["http_proxy=http://proxy.example.com"], nonInteractive: true });
    expect(process.exitCode).toBeUndefined();
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "env-bad-name",
      "node",
      expect.any(Array),
      { http_proxy: "http://proxy.example.com" },
      expect.anything(),
    );
  }, 5000);
});

describe("an unattended clone never waits on git's login prompt (real git)", () => {
  /**
   * An HTTP git remote that asks for a login on every request, like a private
   * https repo. It runs in its own process: the clone uses spawnSync, which
   * blocks this process's event loop, so a server here could never answer.
   */
  async function loginServer(): Promise<{ url: string; close: () => void }> {
    const script = [
      'const server = require("node:http").createServer((_req, res) => {',
      '  res.writeHead(401, { "WWW-Authenticate": \'Basic realm="private"\' });',
      "  res.end();",
      "});",
      'server.listen(0, "127.0.0.1", () => console.log(server.address().port));',
    ].join("\n");
    const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
    const port = await new Promise<string>((resolve, reject) => {
      child.stdout.once("data", (data) => resolve(String(data).trim()));
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`login server exited early (${code})`)));
    });
    return { url: `http://127.0.0.1:${port}/org/private-mcp.git`, close: () => child.kill() };
  }

  for (const [label, options] of [
    ["--yes", { nonInteractive: true }],
    ["no terminal", {}],
  ] as const) {
    it(`fails fast with ${label} on a repo that needs a login`, async () => {
      const remote = await loginServer();
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const started = Date.now();
      try {
        await installMcpFromGit(remote.url, { name: "private-mcp", ...options });
      } finally {
        remote.close();
      }
      expect(process.exitCode).toBe(1);
      expect(errors).toHaveBeenCalledWith(expect.stringContaining("terminal prompts disabled"));
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(mockAddMcpServer).not.toHaveBeenCalled();
    }, 20_000);
  }
});

describe("a git URL's credentials never reach output or state (real git)", () => {
  const TOKEN = "tok123secret";

  function printed(): string {
    return [
      ...vi.mocked(console.log).mock.calls,
      ...vi.mocked(console.error).mock.calls,
      ...vi.mocked(process.stdout.write).mock.calls,
      ...vi.mocked(process.stderr.write).mock.calls,
    ]
      .flat()
      .map(String)
      .join("\n");
  }

  /** A local repo reachable as `https://alice:<token>@mcp.example.invalid/<name>` through an env insteadOf. */
  function tokenUrl(name: string): { url: string; repo: string; restore: () => void } {
    const repo = join(root, name);
    git(root, "init", "--quiet", "-b", "main", repo);
    writeFileSync(join(repo, "index.js"), "// server\n");
    git(repo, "add", "index.js");
    git(repo, "commit", "--quiet", "-m", "server");
    const url = `https://alice:${TOKEN}@mcp.example.invalid/${name}`;
    const config = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${repo}.insteadOf`, GIT_CONFIG_VALUE_0: url };
    Object.assign(process.env, config);
    return {
      url,
      repo,
      restore: () => {
        for (const key of Object.keys(config)) delete process.env[key];
      },
    };
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("installs from a URL with a token, prints no token, and saves the URL without it", async () => {
    const remote = tokenUrl("token-url");
    try {
      await installMcpFromGit(remote.url, { nonInteractive: true });
    } finally {
      remote.restore();
    }
    expect(process.exitCode).toBeUndefined();
    expect(printed()).not.toContain(TOKEN);
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "token-url",
      "node",
      expect.any(Array),
      {},
      expect.objectContaining({ gitUrl: "https://mcp.example.invalid/token-url" }),
    );
  });

  it("`mcp update` after the cache is gone fails with a credential-helper hint, and prints no token", async () => {
    const remote = tokenUrl("token-update");
    try {
      await installMcpFromGit(remote.url, { nonInteractive: true });
    } finally {
      remote.restore();
    }
    rmSync(selectedRuntime("token-update"), { recursive: true, force: true });
    mockRequireState.mockReturnValueOnce(stateWith("token-update", "https://mcp.example.invalid/token-update", "main"));
    await updateMcpFromGit("token-update");
    expect(process.exitCode).toBe(1);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringContaining("credential helper"));
    expect(printed()).not.toContain(TOKEN);
  }, 20_000);

  it("prints no token in an error that names the URL", async () => {
    const first = envRepoFor("token-clash");
    await installMcpFromGit(first, { name: "token-clash", nonInteractive: true });
    const remote = tokenUrl("token-clash-b");
    try {
      await installMcpFromGit(remote.url, { name: "token-clash", nonInteractive: true });
    } finally {
      remote.restore();
    }
    expect(process.exitCode).toBe(1);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(expect.stringContaining("mcp.example.invalid"));
    expect(printed()).not.toContain(TOKEN);
  });

  function envRepoFor(name: string): string {
    const repo = join(root, name);
    git(root, "init", "--quiet", "-b", "main", repo);
    writeFileSync(join(repo, "index.js"), "// server\n");
    git(repo, "add", "index.js");
    git(repo, "commit", "--quiet", "-m", "server");
    return repo;
  }
});

describe("an unattended SSH clone never waits on ssh's prompts (real git)", () => {
  it("runs ssh with BatchMode, so a clone that would prompt fails fast", async () => {
    const log = join(root, "ssh-args.log");
    const fakeSsh = join(root, "fake-ssh");
    writeFileSync(fakeSsh, `#!/bin/sh\necho "$@" >> "${log}"\nexit 255\n`);
    execFileSync("chmod", ["+x", fakeSsh]);
    process.env.GIT_SSH_COMMAND = fakeSsh;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const started = Date.now();
    try {
      await installMcpFromGit("ssh://git@ssh.example.invalid/org/private-mcp.git", {
        name: "ssh-private",
        nonInteractive: true,
      });
    } finally {
      delete process.env.GIT_SSH_COMMAND;
    }
    expect(process.exitCode).toBe(1);
    expect(readFileSync(log, "utf-8")).toContain("-o BatchMode=yes");
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 20_000);
});

describe("isolated candidate boundary", () => {
  type Tree = Map<string, { inode: number; mode: number; kind: string; hash: string }>;
  type Active = { name: string; repo: string; dir: string; args: string[]; head: string };
  let boundaryState: AgentBrewState;
  let priorEnvironment: Record<string, string | undefined>;
  const fixtureHomes = new Set<string>();

  function fixtureEnvironment(home: string, controls: Record<string, string> = {}): Record<string, string> {
    fixtureHomes.add(home);
    for (const key of Object.keys(controls)) {
      if (
        ![
          "BOUNDARY_READY",
          "BOUNDARY_RELEASE",
          "BOUNDARY_DONE",
          "BOUNDARY_PIDS",
          "BOUNDARY_ENTERED",
          "BOUNDARY_RESULT",
        ].includes(key)
      )
        throw new Error("fixture setup: unknown environment control");
    }
    const tools = join(home, "boundary-tools");
    mkdirSync(tools, { recursive: true });
    for (const name of ["mcpm", "launchctl", "crontab", "systemctl"]) {
      writeFileSync(
        join(tools, name),
        `#!/bin/sh\nprintf '%s\\n' '${name}' >> "$HOME/boundary-forbidden-tools"\nexit 127\n`,
        { mode: 0o700 },
      );
    }
    writeFileSync(join(tools, "deny-askpass"), "#!/bin/sh\nexit 127\n", { mode: 0o700 });
    const config = join(home, "boundary.gitconfig");
    writeFileSync(config, "");
    mkdirSync(join(home, "tmp"), { recursive: true });
    return {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_DATA_HOME: join(home, ".local/share"),
      XDG_STATE_HOME: join(home, ".local/state"),
      TMPDIR: join(home, "tmp"),
      PATH: [
        tools,
        dirname(process.execPath),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ].join(":"),
      LANG: "en_US.UTF-8",
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_SYSTEM: config,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: join(tools, "deny-askpass"),
      GIT_ALLOW_PROTOCOL: "file",
      GIT_AUTHOR_NAME: "agentbrew fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "agentbrew fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
      npm_config_cache: join(home, "npm-cache"),
      npm_config_userconfig: config,
      npm_config_globalconfig: join(home, "empty.npmrc"),
      npm_config_offline: "true",
      npm_config_update_notifier: "false",
      npm_config_audit: "false",
      npm_config_fund: "false",
      AGENTBREW_EVENTS: "0",
      AGENTBREW_MCPM_BIN: join(home, "boundary-unavailable-mcpm"),
      AGENTBREW_POSTHOG_KEY: "",
      AGENTBREW_TELEMETRY_URL: "http://127.0.0.1:9/",
      ...controls,
    };
  }

  beforeEach(() => {
    fixtureHomes.clear();
    priorEnvironment = { ...process.env };
    const env = fixtureEnvironment(homedir());
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env);
    boundaryState = { agents: [], sources: [], catalogVersion: "0.1.0", mcpServers: [], memory: { enabled: false } };
    mockRequireState.mockImplementation(() => boundaryState);
    mockSaveState.mockImplementation((next) => {
      boundaryState = structuredClone(next);
    });
    mockAddMcpServer.mockImplementation(async (name, command, args, envValues, options) => {
      const definition = {
        name,
        command,
        args: [...args],
        env: { ...envValues },
        source: "user",
        gitUrl: options?.gitUrl,
        gitRef: options?.gitRef,
      };
      const previous = boundaryState.mcpServers?.find((server) => server.name === name);
      if (previous) Object.assign(previous, definition);
      else boundaryState.mcpServers?.push(definition);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    const forbidden = [...fixtureHomes].filter((home) => existsSync(join(home, "boundary-forbidden-tools")));
    for (const key of Object.keys(process.env)) delete process.env[key];
    for (const [key, value] of Object.entries(priorEnvironment)) if (value !== undefined) process.env[key] = value;
    mockAddMcpServer.mockReset();
    mockRequireState.mockReset();
    mockSaveState.mockReset();
    if (forbidden.length > 0) throw new Error("fixture setup: forbidden tool dispatch");
  });

  function tree(dir: string): Tree {
    const result: Tree = new Map();
    let bytes = 0;
    const walk = (base: string, prefix: string) => {
      for (const name of readdirSync(base).sort()) {
        const file = join(base, name);
        const rel = prefix ? `${prefix}/${name}` : name;
        const stat = lstatSync(file);
        if (result.size >= 10_000) throw new Error("fixture setup: tree inventory limit");
        let data = Buffer.alloc(0);
        const kind = stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "dir" : "file";
        if (kind === "link") data = Buffer.from(readlinkSync(file));
        else if (kind === "file") data = readFileSync(file);
        bytes += data.length;
        if (bytes > 16 * 1024 * 1024) throw new Error("fixture setup: tree byte limit");
        result.set(rel, {
          inode: stat.ino,
          mode: stat.mode,
          kind,
          hash: createHash("sha256").update(data).digest("hex"),
        });
        if (kind === "dir") walk(file, rel);
      }
    };
    walk(dir, "");
    return result;
  }

  function changes(before: Tree, after: Tree): string[] {
    return [...new Set([...before.keys(), ...after.keys()])]
      .sort()
      .filter((key) => JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key)));
  }

  function registeredRoot(name: string): string {
    const server = boundaryState.mcpServers?.find((item) => item.name === name);
    if (!server?.args[0]) throw new Error("fixture setup: initial registration absent");
    return realpathSync(git(dirname(server.args[0]), "rev-parse", "--show-toplevel"));
  }

  async function active(name: string, repo = nodeRepo(name), ref = "v1"): Promise<Active> {
    await installMcpFromGit(repo, { name, ref, nonInteractive: true });
    expect(process.exitCode, "fixture setup: initial install").toBeUndefined();
    const server = boundaryState.mcpServers?.find((item) => item.name === name);
    if (!server) throw new Error("fixture setup: initial state absent");
    const dir = registeredRoot(name);
    mkdirSync(join(dir, "node_modules", "runtime-data"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "runtime-data", "keep"), "synthetic dependency state\n");
    writeFileSync(join(dir, "token.json"), "synthetic runtime state\n");
    mockAddMcpServer.mockClear();
    mockSaveState.mockClear();
    return { name, repo, dir, args: [...server.args], head: git(dir, "rev-parse", "HEAD") };
  }

  async function repin(value: Active, ref: string, freshRuntime = true): Promise<void> {
    const request = { name: value.name, ref, nonInteractive: true, freshRuntime };
    await installMcpFromGit(value.repo, request);
  }

  function commitFixture(repo: string, label: string, script: string, build = true): void {
    writePackage(repo, {}, build);
    writeFileSync(join(repo, "build.js"), script);
    git(repo, "add", "build.js");
    git(repo, "commit", "--quiet", "-m", label);
    git(repo, "tag", label);
  }

  async function untilReady(path: string, child?: ReturnType<typeof spawn>): Promise<void> {
    const end = Date.now() + 8_000;
    while (!existsSync(path)) {
      if (child && (child.exitCode !== null || child.signalCode !== null))
        throw new Error("fixture setup: child exited before ready");
      if (Date.now() > end) throw new Error("fixture setup: readiness deadline");
      await new Promise((done) => setTimeout(done, 10));
    }
  }

  function startNode(code: string, args: string[], env: Record<string, string>) {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, ...args], {
      cwd: process.cwd(),
      env,
      stdio: "ignore",
    });
    const closed = new Promise<number | null>((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
    });
    return { child, closed };
  }

  async function closedWithin(run: ReturnType<typeof startNode>): Promise<number | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run.closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("fixture setup: child cleanup deadline")), 8_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function ownedPidsGone(pids: number[]): Promise<void> {
    const end = Date.now() + 8_000;
    while (
      pids.some((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code !== "ESRCH";
        }
      })
    ) {
      if (Date.now() > end) throw new Error("fixture setup: owned build process still present");
      await new Promise((done) => setTimeout(done, 10));
    }
  }

  const waitScript =
    "const until=Date.now()+7000; while(!fs.existsSync(process.env.BOUNDARY_RELEASE)){ if(Date.now()>until) process.exit(91); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10); }";
  const outputScript =
    'fs.mkdirSync("build",{recursive:true}); fs.writeFileSync("build/index.js","// candidate output\\n");';
  const moduleUrl = pathToFileURL(resolve("src/mcp/mcp-git.ts")).href;
  const installChild = `import fs from "node:fs";const m=await import(${JSON.stringify(moduleUrl)});if(process.env.BOUNDARY_ENTERED)fs.writeFileSync(process.env.BOUNDARY_ENTERED,"handler");let threw=false;try { await m.installMcpFromGit(process.argv[1], {name:process.argv[2],ref:process.argv[3],nonInteractive:true,freshRuntime:true}); } catch { threw=true;process.exitCode=1; }if(process.env.BOUNDARY_RESULT)fs.writeFileSync(process.env.BOUNDARY_RESULT,JSON.stringify({threw,code:process.exitCode??0}));`;

  it("refuses invalid package metadata before publishing a tracked entrypoint", async () => {
    const name = "boundary-invalid-metadata";
    const repo = join(root, name);
    const invalidPackage = "{ invalid synthetic package metadata }\n";
    git(root, "init", "--quiet", "-b", "main", repo);
    writeFileSync(join(repo, "package.json"), invalidPackage);
    writeFileSync(join(repo, "index.js"), "// tracked synthetic entrypoint\n");
    git(repo, "add", "package.json", "index.js");
    git(repo, "commit", "--quiet", "-m", "invalid metadata with tracked entrypoint");
    const sourceHead = git(repo, "rev-parse", "HEAD");
    expect(git(repo, "ls-files", "--", "index.js")).toBe("index.js");
    const beforeState = structuredClone(boundaryState);
    const npmMarker = join(homedir(), "invalid-metadata-npm-called");
    const npmPort = join(homedir(), "boundary-tools", "npm");
    writeFileSync(npmPort, '#!/bin/sh\nprintf called > "$HOME/invalid-metadata-npm-called"\nexit 127\n', {
      mode: 0o700,
    });
    const parse = JSON.parse;
    let metadataRefusalReached = 0;
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
      try {
        return parse(text, reviver);
      } catch (error) {
        if (text === invalidPackage) metadataRefusalReached++;
        throw error;
      }
    });
    try {
      await installMcpFromGit(repo, { name, ref: "main", nonInteractive: true });
    } finally {
      parseSpy.mockRestore();
      rmSync(npmPort);
    }
    const parent = join(MCP_BUILD_DIR, name);
    const attempts = readdirSync(parent);
    expect(attempts, "one actual candidate acquired before metadata refusal").toHaveLength(1);
    const candidate = join(parent, attempts[0]);
    expect(git(candidate, "rev-parse", "HEAD"), "candidate matches the controlled source").toBe(sourceHead);
    expect(git(candidate, "ls-files", "--", "index.js"), "entrypoint really tracked in candidate").toBe("index.js");
    expect(readFileSync(join(candidate, "package.json"), "utf8")).toBe(invalidPackage);
    expect(metadataRefusalReached, "actual invalid package parser refusal reached once").toBe(1);
    expect(process.exitCode).toBe(1);
    expect(existsSync(npmMarker), "invalid metadata never starts npm").toBe(false);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(boundaryState).toEqual(beforeState);
    expect(
      existsSync(join(candidate, ".git/agentbrew-candidate.json")),
      "invalid candidate receives no acceptance receipt",
    ).toBe(false);
  });

  it("N01 moved output twice leaves the prior tree and dependencies untouched", async () => {
    const value = await active("boundary-n01");
    commitBuild(value.repo, "v2", { out: "build/index.js" });
    const before = tree(value.dir);
    const outcomes: Array<{
      attempt: number;
      code: typeof process.exitCode;
      selected: boolean;
      changed: string[];
      distinct: boolean;
    }> = [];
    for (const attempt of [1, 2]) {
      await repin(value, "v2");
      const selected = boundaryState.mcpServers?.find((server) => server.name === value.name)?.args[0];
      outcomes.push({
        attempt,
        code: process.exitCode,
        selected: selected?.endsWith("/build/index.js") === true,
        changed: changes(before, tree(value.dir)),
        distinct: registeredRoot(value.name) !== value.dir,
      });
      process.exitCode = undefined;
    }
    expect(outcomes, "both moved-output attempts").toEqual(
      outcomes.map((value) => ({ ...value, code: undefined, selected: true, changed: [], distinct: true })),
    );
  });

  it("N02 partial failed output leaves old files, inodes and state untouched", async () => {
    const value = await active("boundary-n02");
    commitFixture(
      value.repo,
      "v2",
      'const fs=require("fs");fs.mkdirSync("build",{recursive:true});fs.writeFileSync("build/index.js","partial");process.exit(1);',
    );
    const before = tree(value.dir);
    const state = structuredClone(boundaryState);
    await repin(value, "v2");
    expect(process.exitCode).toBe(1);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(boundaryState).toEqual(state);
    expect(changes(before, tree(value.dir)), "old runtime changed").toEqual([]);
  });

  it("N03 ignored-to-tracked collision cannot replace the old ignored inode", async () => {
    const value = await active("boundary-n03");
    mkdirSync(join(value.repo, "dist"), { recursive: true });
    writeFileSync(join(value.repo, "dist/index.js"), "// new committed artifact\n");
    git(value.repo, "add", "-f", "dist/index.js");
    commitFixture(value.repo, "v2", "process.exit(1);\n");
    const before = tree(value.dir);
    await repin(value, "v2");
    expect(changes(before, tree(value.dir)), "old ignored file or metadata changed").toEqual([]);
  });

  it("N04 build-created config and concurrent runtime token remain owned by the old runtime", async () => {
    const repo = join(root, "boundary-n04");
    git(root, "init", "--quiet", "-b", "main", repo);
    writeFileSync(
      join(repo, ".gitignore"),
      "dist/\nbuild/\nconfig.json\ntoken.json\nnode_modules/\npackage-lock.json\n",
    );
    git(repo, "add", ".gitignore");
    commitFixture(
      repo,
      "v1",
      'const fs=require("fs");if(!fs.existsSync("config.json"))fs.writeFileSync("config.json","template");fs.mkdirSync("dist",{recursive:true});fs.writeFileSync("dist/index.js","// v1");',
    );
    const value = await active("boundary-n04", repo);
    writeFileSync(join(value.dir, "config.json"), "synthetic user configuration\n");
    const ready = join(root, "n04.ready");
    const ack = join(root, "n04.ack");
    commitFixture(
      repo,
      "v2",
      `const fs=require("fs");fs.writeFileSync(process.env.BOUNDARY_READY,"ready");${waitScript}${outputScript}`,
    );
    const before = tree(value.dir);
    const writer = startNode(
      'import fs from "node:fs";const [ready,ack,target]=process.argv.slice(1);const until=Date.now()+7000;while(!fs.existsSync(ready)){if(Date.now()>until)process.exit(91);await new Promise(r=>setTimeout(r,10));}fs.writeFileSync(target,"synthetic runtime update");fs.writeFileSync(ack,"done");',
      [ready, ack, join(value.dir, "token.json")],
      fixtureEnvironment(homedir()),
    );
    try {
      process.env.BOUNDARY_READY = ready;
      process.env.BOUNDARY_RELEASE = ack;
      await repin(value, "v2");
    } finally {
      writeFileSync(ready, "release");
      await closedWithin(writer);
      delete process.env.BOUNDARY_READY;
      delete process.env.BOUNDARY_RELEASE;
    }
    expect(existsSync(ack), "fixture setup: runtime writer did not acknowledge").toBe(true);
    expect(
      changes(before, tree(value.dir)).filter((path) => path !== "token.json"),
      "undeclared old-runtime mutation",
    ).toEqual([]);
    expect(readFileSync(join(value.dir, "token.json"), "utf8") === "synthetic runtime update").toBe(true);
  }, 45_000);

  it("N05 a legacy cache without records cannot supply the selected runtime", async () => {
    const value = await active("boundary-n05");
    rmSync(join(value.dir, ".git/agentbrew-build-outputs"), { force: true });
    rmSync(join(value.dir, ".git/agentbrew-built-commit"), { force: true });
    commitBuild(value.repo, "v2", { out: "build/index.js" });
    const before = tree(value.dir);
    await repin(value, "v2");
    const selected = boundaryState.mcpServers?.find((server) => server.name === value.name)?.args[0];
    expect(
      process.exitCode === 1 || (selected?.endsWith("/build/index.js") && registeredRoot(value.name) !== value.dir),
      "legacy reuse is not new provenance",
    ).toBe(true);
    expect(changes(before, tree(value.dir))).toEqual([]);
  });

  it("N06 no-op build cannot register old output", async () => {
    const value = await active("boundary-n06");
    commitBuild(value.repo, "v2", { noop: true });
    const before = tree(value.dir);
    await repin(value, "v2");
    expect(process.exitCode).toBe(1);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(changes(before, tree(value.dir))).toEqual([]);
  });

  it("N07 refused branch update never checks out or reinstalls the old runtime", async () => {
    const value = await active("boundary-n07", undefined, "main");
    commitBuild(value.repo, "v2", { fails: true });
    const before = tree(value.dir);
    const state = structuredClone(boundaryState);
    const request = { freshRuntime: true };
    await Reflect.apply(updateMcpFromGit, undefined, [value.name, request]);
    expect(process.exitCode).toBe(1);
    expect(boundaryState).toEqual(state);
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(changes(before, tree(value.dir)), "old branch or dependencies changed").toEqual([]);
  });

  it("N08 actual interrupted preparation retains its directory and never mutates the active tree", async () => {
    const value = await active("boundary-n08");
    const ready = join(root, "n08.ready");
    const release = join(root, "n08.release");
    const done = join(root, "n08.done");
    const pids = join(root, "n08.pids");
    commitFixture(
      value.repo,
      "v2",
      `const fs=require("fs");fs.writeFileSync(process.env.BOUNDARY_PIDS,JSON.stringify([process.pid,process.ppid]));fs.writeFileSync(process.env.BOUNDARY_READY,process.cwd());${waitScript}${outputScript}fs.writeFileSync(process.env.BOUNDARY_DONE,"done");`,
    );
    mkdirSync(join(homedir(), ".config/agentbrew"), { recursive: true });
    writeFileSync(join(homedir(), ".config/agentbrew/state.yaml"), JSON.stringify(boundaryState));
    const before = tree(value.dir);
    const run = startNode(
      installChild,
      [value.repo, value.name, "v2"],
      fixtureEnvironment(homedir(), {
        BOUNDARY_READY: ready,
        BOUNDARY_RELEASE: release,
        BOUNDARY_DONE: done,
        BOUNDARY_PIDS: pids,
      }),
    );
    let prepared = "";
    let setupError: unknown;
    try {
      await untilReady(ready, run.child);
      prepared = readFileSync(ready, "utf8");
      run.child.kill("SIGTERM");
    } catch (error) {
      setupError = error;
    } finally {
      writeFileSync(release, "release");
      await closedWithin(run);
      await untilReady(done);
    }
    const owned = JSON.parse(readFileSync(pids, "utf8")) as number[];
    if (owned.length !== 2 || !owned.every((pid) => Number.isSafeInteger(pid) && pid > 1))
      throw new Error("fixture setup: invalid owned process receipt");
    await ownedPidsGone(owned);
    if (setupError) throw setupError;
    const interrupted = tree(prepared);
    process.env.BOUNDARY_READY = ready;
    process.env.BOUNDARY_RELEASE = release;
    process.env.BOUNDARY_DONE = done;
    process.env.BOUNDARY_PIDS = pids;
    try {
      await repin(value, "v2");
    } finally {
      for (const key of ["BOUNDARY_READY", "BOUNDARY_RELEASE", "BOUNDARY_DONE", "BOUNDARY_PIDS"])
        delete process.env[key];
    }
    expect(existsSync(prepared), "interrupted directory must remain").toBe(true);
    expect(changes(interrupted, tree(prepared)), "retry changed the interrupted directory").toEqual([]);
    expect(realpathSync(prepared) === value.dir, "preparation ran in active runtime").toBe(false);
    expect(changes(before, tree(value.dir))).toEqual([]);
  }, 90_000);

  it("N09 external entrypoint targets and linked cache roots refuse without outside writes", async () => {
    const outside = join(root, "n09.outside.js");
    writeFileSync(outside, "// outside canary\n");
    const outsideBefore = lstatSync(outside);
    const repo = join(root, "boundary-n09-link");
    git(root, "init", "--quiet", "-b", "main", repo);
    symlinkSync(outside, join(repo, "index.js"));
    git(repo, "add", "index.js");
    git(repo, "commit", "--quiet", "-m", "external entry");
    const request = { name: "boundary-n09-link", nonInteractive: true, freshRuntime: true };
    await installMcpFromGit(repo, request);
    const externalRegistered = mockAddMcpServer.mock.calls.some(
      (call) => realpathSync(call[2][0]) === realpathSync(outside),
    );
    const externalRefused = process.exitCode === 1;
    process.exitCode = undefined;
    mockAddMcpServer.mockClear();
    const other = nodeRepo("boundary-n09-root");
    const linked = cached("boundary-n09-root");
    mkdirSync(dirname(linked), { recursive: true });
    symlinkSync(repo, linked);
    const before = tree(repo);
    await installMcpFromGit(other, { nonInteractive: true });
    expect(process.exitCode).toBe(1);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(changes(before, tree(repo))).toEqual([]);
    expect(externalRegistered, "external target registered").toBe(false);
    expect(externalRefused, "external target was not refused").toBe(true);
    expect(lstatSync(outside).ino).toBe(outsideBefore.ino);
    expect(readFileSync(outside, "utf8") === "// outside canary\n").toBe(true);
  });

  it("N10 changed entrypoint and legacy records never authorize accepted-runtime reuse", async () => {
    const value = await active("boundary-n10");
    writeFileSync(value.args[0], "// synthetic changed runtime\n");
    writeFileSync(join(value.dir, ".git/agentbrew-built-commit"), `${"0".repeat(40)}\n`);
    writeFileSync(join(value.dir, ".git/agentbrew-build-outputs"), '{"commit":"invalid","paths":["../outside.js"]}\n');
    const before = tree(value.dir);
    await repin(value, "v1");
    expect(process.exitCode === 1 || registeredRoot(value.name) !== value.dir, "changed runtime reused").toBe(true);
    expect(changes(before, tree(value.dir))).toEqual([]);
  });

  it("N11 overlapping same-name and different-name installers cannot both report success for lost definitions", async () => {
    const observations: Array<{
      sameName: boolean;
      codes: Array<number | null>;
      disjoint: boolean;
      kept: boolean;
      pinned: boolean;
    }> = [];
    for (const sameName of [true, false]) {
      const home = join(root, sameName ? "n11-same-home" : "n11-different-home");
      mkdirSync(join(home, ".config/agentbrew"), { recursive: true });
      writeFileSync(
        join(home, ".config/agentbrew/state.yaml"),
        JSON.stringify({ agents: [], catalogVersion: "0.1.0", mcpServers: [], memory: { enabled: false } }),
      );
      const repo = nodeRepo(sameName ? "boundary-n11-same-source" : "boundary-n11-different-source");
      const readyA = join(home, "a.ready");
      const readyB = join(home, "b.ready");
      const release = join(home, "release");
      const doneA = join(home, "a.done");
      const doneB = join(home, "b.done");
      const enteredA = join(home, "a.entered");
      const enteredB = join(home, "b.entered");
      const resultA = join(home, "a.result");
      const resultB = join(home, "b.result");
      commitFixture(
        repo,
        "v2",
        `const fs=require("fs");fs.writeFileSync(process.env.BOUNDARY_READY,process.cwd());${waitScript}${outputScript}fs.writeFileSync(process.env.BOUNDARY_DONE,"done");`,
      );
      const names = sameName ? ["overlap", "overlap"] : ["overlap-a", "overlap-b"];
      const envA = fixtureEnvironment(home, {
        BOUNDARY_READY: readyA,
        BOUNDARY_RELEASE: release,
        BOUNDARY_DONE: doneA,
        BOUNDARY_ENTERED: enteredA,
        BOUNDARY_RESULT: resultA,
      });
      const envB = fixtureEnvironment(home, {
        BOUNDARY_READY: readyB,
        BOUNDARY_RELEASE: release,
        BOUNDARY_DONE: doneB,
        BOUNDARY_ENTERED: enteredB,
        BOUNDARY_RESULT: resultB,
      });
      const first = startNode(installChild, [repo, names[0], "v2"], envA);
      let second: ReturnType<typeof startNode> | undefined;
      let codes: Array<number | null> = [];
      try {
        await untilReady(readyA, first.child);
        second = startNode(installChild, [repo, names[1], "v2"], envB);
        const end = Date.now() + 8_000;
        while (!existsSync(readyB) && second.child.exitCode === null && second.child.signalCode === null) {
          if (Date.now() > end) throw new Error("fixture setup: second installer readiness deadline");
          await new Promise((done) => setTimeout(done, 10));
        }
      } finally {
        writeFileSync(release, "release");
        codes = [await closedWithin(first)];
        if (second) codes.push(await closedWithin(second));
      }
      expect(codes.length, "both requested invocations have results").toBe(2);
      expect(
        codes.every((code) => code === 0 || code === 1),
        "fixture setup: unexpected child termination",
      ).toBe(true);
      for (const [entered, result, ready, done] of [
        [enteredA, resultA, readyA, doneA],
        [enteredB, resultB, readyB, doneB],
      ]) {
        if (!existsSync(entered) || !existsSync(result))
          throw new Error("fixture setup: installer did not reach its handler result");
        const value = JSON.parse(readFileSync(result, "utf8")) as { threw: boolean; code: number };
        if (value.threw || ![0, 1].includes(value.code)) throw new Error("fixture setup: unexpected handler exception");
        if (existsSync(ready) && !existsSync(done)) throw new Error("fixture setup: declared build did not finish");
      }
      const text = readFileSync(join(home, ".config/agentbrew/state.yaml"), "utf8");
      const { default: yaml } = await import("js-yaml");
      const saved = yaml.load(text) as AgentBrewState;
      const savedNames = new Set(saved.mcpServers?.map((server) => server.name));
      const bothSucceeded = codes.every((code) => code === 0);
      const kept = bothSucceeded
        ? [...new Set(names)].every((name) => savedNames.has(name))
        : savedNames.size <= new Set(names).size;
      const disjoint =
        !bothSucceeded ||
        !existsSync(readyB) ||
        realpathSync(readFileSync(readyA, "utf8")) !== realpathSync(readFileSync(readyB, "utf8"));
      let pinned = true;
      for (const server of saved.mcpServers ?? []) {
        const actual = git(dirname(server.args[0]), "rev-parse", "HEAD");
        pinned &&= actual === git(repo, "rev-parse", "v2^{commit}");
      }
      observations.push({ sameName, codes, disjoint, kept, pinned });
    }
    expect(observations, "overlapping publication outcomes").toEqual(
      observations.map((value) => ({ ...value, disjoint: true, kept: true, pinned: true })),
    );
  }, 90_000);

  it("N12 save or fan-out failure cannot produce an installed success claim", async () => {
    const outcomes: Array<{
      failure: string;
      reached: number;
      code: typeof process.exitCode;
      falseSuccess: boolean;
      changed: string[];
    }> = [];
    for (const failure of ["save", "fanout"] as const) {
      const value = await active(`boundary-n12-${failure}`, undefined, "main");
      commitBuild(value.repo, "v2", { out: "build/index.js" });
      const before = tree(value.dir);
      const logs = vi.mocked(console.log);
      logs.mockClear();
      let reached = 0;
      if (failure === "save") {
        mockSaveState.mockImplementationOnce(() => {
          reached++;
          process.exitCode = 1;
        });
        await Reflect.apply(updateMcpFromGit, undefined, [value.name, { freshRuntime: true }]);
      } else {
        mockAddMcpServer.mockImplementationOnce(async () => {
          reached++;
          process.exitCode = 1;
        });
        await repin(value, "v2");
      }
      outcomes.push({
        failure,
        reached,
        code: process.exitCode,
        falseSuccess: logs.mock.calls.some((call) => /installed from git|updated to/u.test(String(call[0]))),
        changed: changes(before, tree(value.dir)),
      });
      process.exitCode = undefined;
    }
    expect(outcomes, "partial publication outcomes").toEqual(
      outcomes.map((value) => ({ ...value, reached: 1, code: 1, falseSuccess: false, changed: [] })),
    );
  });

  it.each(["save", "fanout"] as const)("N15 real registration failure (%s) emits no success", async (failure) => {
    const value = await active(`boundary-n15-${failure}`, undefined, "main");
    commitBuild(value.repo, "v2", { out: "build/index.js" });
    const before = tree(value.dir);
    const head = git(value.dir, "rev-parse", "HEAD");
    const parent = dirname(value.dir);
    const existingAttempts = new Set(readdirSync(parent));
    const logs = vi.mocked(console.log);
    logs.mockClear();
    const realCommands =
      await vi.importActual<typeof import("../sync/mcp-sync-commands.js")>("../sync/mcp-sync-commands.js");
    mockAddMcpServer.mockImplementationOnce(realCommands.addMcpServer);
    const realSync = await vi.importActual<typeof import("../sync/mcp-sync.js")>("../sync/mcp-sync.js");
    const fanout = vi.spyOn(realSync, "syncMcpServers").mockResolvedValue(undefined);
    let reached = 0;
    if (failure === "save") {
      mockSaveState.mockImplementationOnce(() => {
        reached++;
        process.exitCode = 1;
      });
    } else {
      fanout.mockImplementationOnce(async () => {
        reached++;
        process.exitCode = 1;
      });
    }
    try {
      await repin(value, "v2");
    } finally {
      fanout.mockRestore();
    }
    const attempts = readdirSync(parent).filter((entry) => !existingAttempts.has(entry));
    expect(reached, "selected real registration fault reached").toBe(1);
    expect(process.exitCode, "partial publication exits nonzero").toBe(1);
    expect(attempts, "one candidate prepared before the real registration fault").toHaveLength(1);
    const receipt = JSON.parse(readFileSync(join(parent, attempts[0], ".git", "agentbrew-candidate.json"), "utf8"));
    expect(receipt.status, "failed candidate stays ready, never accepted").toBe("ready");
    expect(changes(before, tree(value.dir)), "prior runtime bytes/inodes/modes unchanged").toEqual([]);
    expect(git(value.dir, "rev-parse", "HEAD"), "prior HEAD unchanged").toBe(head);
    const falseSuccess = logs.mock.calls.some((call) =>
      call.some((part) => /\bregistered\b|installed from git|updated to/u.test(String(part))),
    );
    expect(falseSuccess, "real registration must not claim success on partial publication").toBe(false);
  });

  it("N13 a different runtime requires fresh-state consent at the handler", async () => {
    const value = await active("boundary-n13");
    commitBuild(value.repo, "v2", { out: "build/index.js" });
    const before = tree(value.dir);
    const state = structuredClone(boundaryState);
    await repin(value, "v2", false);
    expect(process.exitCode, "missing consent must refuse").toBe(1);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(boundaryState).toEqual(state);
    expect(changes(before, tree(value.dir))).toEqual([]);
  });

  it("N14 ordinary non-interactive yes is not fresh-runtime consent", async () => {
    const value = await active("boundary-n14");
    commitBuild(value.repo, "v2", { out: "build/index.js" });
    const program = new Command();
    registerInstallCommand(program);
    const before = tree(value.dir);
    await program.parseAsync(["install", value.name, "--git", value.repo, "--ref", "v2", "--yes"], { from: "user" });
    expect(process.exitCode, "--yes silently authorized new runtime state").toBe(1);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(changes(before, tree(value.dir))).toEqual([]);
  });

  it("P01 an accepted same-commit runtime is reused without an in-place failed rebuild", async () => {
    const value = await active("boundary-p01");
    const before = tree(value.dir);
    process.env.FIXTURE_BUILD_FAIL = "1";
    try {
      await repin(value, "v1", false);
    } finally {
      delete process.env.FIXTURE_BUILD_FAIL;
    }
    expect(process.exitCode).toBeUndefined();
    expect(boundaryState.mcpServers?.find((server) => server.name === value.name)?.args).toEqual(value.args);
    expect(changes(before, tree(value.dir))).toEqual([]);
  });

  it("P02 fresh committed output remains eligible after its side build fails", async () => {
    const repo = join(root, "boundary-p02");
    git(root, "init", "--quiet", "-b", "main", repo);
    mkdirSync(join(repo, "dist"));
    writeFileSync(join(repo, "dist/index.js"), "// committed target\n");
    git(repo, "add", "dist/index.js");
    commitFixture(repo, "v1", "process.exit(1);\n");
    await installMcpFromGit(repo, { ref: "v1", nonInteractive: true });
    expect(process.exitCode).toBeUndefined();
    const server = boundaryState.mcpServers?.find((item) => item.name === "boundary-p02");
    expect(server?.args[0]?.endsWith("/dist/index.js")).toBe(true);
    expect(readFileSync(server?.args[0] ?? "", "utf8") === "// committed target\n").toBe(true);
  });

  it("P03 tracked Node file, Node directory and Python entrypoints remain supported", async () => {
    for (const kind of ["node-file", "node-directory", "python"] as const) {
      const name = `boundary-p03-${kind}`;
      const repo = join(root, name);
      git(root, "init", "--quiet", "-b", "main", repo);
      const entry = kind === "python" ? "server.py" : kind === "node-directory" ? "dist/index.js/index.js" : "index.js";
      mkdirSync(dirname(join(repo, entry)), { recursive: true });
      writeFileSync(join(repo, entry), kind === "python" ? "# fixture\n" : "// fixture\n");
      git(repo, "add", ".");
      git(repo, "commit", "--quiet", "-m", "tracked runtime");
      await installMcpFromGit(repo, { nonInteractive: true });
      expect(process.exitCode, kind).toBeUndefined();
      const server = boundaryState.mcpServers?.find((item) => item.name === name);
      expect(server?.command, kind).toBe(kind === "python" ? "python3" : "node");
      expect(existsSync(server?.args[0] ?? ""), kind).toBe(true);
    }
  });

  it("P04 exact refs, detached refusal, origin checks and secret-safe env values remain", async () => {
    const repo = nodeRepo("boundary-p04");
    commitBuild(repo, "v2", { out: "build/index.js" });
    git(repo, "branch", "v1", "v2");
    await installMcpFromGit(repo, {
      ref: "v1",
      nonInteractive: true,
      envPairs: ["BOUNDARY_VALUE=SYNTHETIC_PRIVATE_VALUE"],
    });
    expect(process.exitCode).toBeUndefined();
    const dir = registeredRoot("boundary-p04");
    expect(git(dir, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "refs/tags/v1^{commit}"));
    expect(boundaryState.mcpServers?.[0]?.env.BOUNDARY_VALUE === "SYNTHETIC_PRIVATE_VALUE").toBe(true);
    expect(vi.mocked(console.log).mock.calls.some((call) => String(call[0]).includes("SYNTHETIC_PRIVATE_VALUE"))).toBe(
      false,
    );
    mockSaveState.mockClear();
    await updateMcpFromGit("boundary-p04");
    expect(process.exitCode).toBe(1);
    expect(mockSaveState).not.toHaveBeenCalled();
    process.exitCode = undefined;
    mockAddMcpServer.mockClear();
    const other = nodeRepo("boundary-p04-other");
    await installMcpFromGit(other, { name: "boundary-p04", nonInteractive: true });
    expect(process.exitCode).toBe(1);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
  });

  it("P05 structural fresh-runtime intent reaches each real handler and its generated action", async () => {
    const program = new Command();
    registerInstallCommand(program);
    registerMcpCommands(program, async () => {});
    const install = program.commands.find((command) => command.name() === "install");
    const mcp = program.commands.find((command) => command.name() === "mcp");
    const add = mcp?.commands.find((command) => command.name() === "add");
    const update = mcp?.commands.find((command) => command.name() === "update");
    for (const command of [install, add, update]) {
      if (!command) throw new Error("fixture setup: existing command absent");
      command.setOptionValue("freshRuntime", true);
    }
    const source = nodeRepo("boundary-p05-source");
    const routes: Array<{ action: string; code: typeof process.exitCode; candidate: boolean }> = [];
    const capture = (action: string, name: string) => {
      let candidate = false;
      try {
        const rel = relative(realpathSync(join(homedir(), ".config/agentbrew/mcp-builds")), registeredRoot(name));
        candidate = !rel.startsWith("..") && resolve(rel) !== rel;
      } catch {
        candidate = false;
      }
      routes.push({ action, code: process.exitCode, candidate });
      process.exitCode = undefined;
    };
    await program.parseAsync(["install", "boundary-p05-install", "--git", source, "--ref", "main", "--yes"], {
      from: "user",
    });
    capture("install", "boundary-p05-install");
    await program.parseAsync(["mcp", "add", "boundary-p05-add", "--git", source, "--ref", "main", "--yes"], {
      from: "user",
    });
    capture("mcp.add", "boundary-p05-add");
    commitBuild(source, "v2", { out: "build/index.js" });
    await program.parseAsync(["mcp", "update", "boundary-p05-add"], { from: "user" });
    capture("mcp.update", "boundary-p05-add");
    const { actionCatalog } = await import("../actions.js");
    const actions = actionCatalog(program);
    const parity = ["install", "mcp.add", "mcp.update"].map((name) => ({
      name,
      present:
        actions
          .find((action) => action.name === name)
          ?.args.some((argument) => argument.flag?.includes("--fresh-runtime")) === true,
    }));
    expect({ routes, parity }, "all runtime and generated action paths").toEqual({
      routes: routes.map((value) => ({ ...value, code: undefined, candidate: true })),
      parity: parity.map((value) => ({ ...value, present: true })),
    });
  });
});
