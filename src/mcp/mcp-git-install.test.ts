import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The install and update flows end to end, with real git and a real `npm run
// build`; only state and the agent sync are mocked. Scratch HOME comes from
// vitest.isolated-home.ts; git reads an empty scratch global config.

vi.mock("../sync/mcp-sync.js", () => ({ addMcpServer: vi.fn(), syncMcpServers: vi.fn() }));
vi.mock("../state.js", () => ({ requireState: vi.fn(), saveState: vi.fn() }));

import { requireState, saveState } from "../state.js";
import { addMcpServer } from "../sync/mcp-sync.js";
import type { AgentBrewState } from "../types.js";
import { GIT_CACHE_DIR, installMcpFromGit, updateMcpFromGit } from "./mcp-git.js";

const mockAddMcpServer = vi.mocked(addMcpServer);
const mockRequireState = vi.mocked(requireState);
const mockSaveState = vi.mocked(saveState);

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
const savedEnv: Record<string, string | undefined> = {};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
}

/** Commit a build script that writes `<outDir>/<file>` (ignored), or fails; tag it `label`. */
function commitBuild(repo: string, label: string, opts: { fails?: boolean; out?: string } = {}): void {
  const out = opts.out ?? "dist/index.js";
  // FIXTURE_BUILD_FAIL makes any build fail, like an offline `npm install`.
  const script = opts.fails
    ? "process.exit(1);\n"
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

function stateWith(name: string, gitUrl: string, gitRef: string): AgentBrewState {
  return {
    agents: [],
    sources: [],
    catalogVersion: "0.1.0",
    mcpServers: [{ name, command: "node", args: [], env: {}, source: "user", gitUrl, gitRef }],
  };
}

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
    writeFileSync(cached("stale-build", "token.json"), "{}\n");

    mockAddMcpServer.mockClear();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true });
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("The build failed at"));
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining(`agentbrew install stale-build --git '${repo}' --ref <ref>`),
    );
    expect(readFileSync(cached("stale-build", "dist", "index.js"), "utf-8")).toContain("built from v1");
    expect(existsSync(cached("stale-build", "token.json"))).toBe(true);

    // A second attempt at the same commit is refused too: no successful build of v2 exists.
    process.exitCode = undefined;
    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true });
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
    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true });
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
    await installMcpFromGit(repo, { ref: "v2", nonInteractive: true });
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

    await updateMcpFromGit("branch-update");

    expect(process.exitCode).toBe(1);
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(readFileSync(cached("branch-update", "dist", "index.js"), "utf-8")).toContain("built from v1");
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
      [cached("same-commit", "dist", "index.js")],
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
      [cached("committed-dist", "dist", "index.js")],
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
      [cached("tracked-entry", "index.js")],
      {},
      expect.objectContaining({ gitUrl: repo }),
    );
  });
});
