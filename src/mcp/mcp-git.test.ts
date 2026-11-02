import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
    statSync: vi.fn(() => ({ isFile: () => true })),
  };
});

vi.mock("../sync/mcp-sync.js", async (importOriginal) => ({
  addMcpServer: vi.fn(),
  syncMcpServers: vi.fn(),
  verifyMcpServerPublication: (await importOriginal<typeof import("../sync/mcp-sync.js")>()).verifyMcpServerPublication,
}));

vi.mock("../state.js", () => ({
  requireState: vi.fn(),
  saveState: vi.fn(),
  invalidateState: vi.fn(),
}));

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    checkGitAvailable: vi.fn(() => true),
  };
});

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  password: vi.fn(),
}));

// Exact-ref checkout runs real git in mcp-git-ref.test.ts. The marker env proves
// that every cache git call gets cacheGitEnv() (no inherited GIT_DIR).
const { CACHE_ENV } = vi.hoisted(() => ({ CACHE_ENV: { AGENTBREW_TEST_CACHE_ENV: "1" } }));
vi.mock("./git-ref.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./git-ref.js")>()),
  assertCacheOrigin: vi.fn(),
  assertOwnRepo: vi.fn(),
  assertPinnedRef: vi.fn(),
  cacheGitEnv: vi.fn(() => CACHE_ENV),
  checkoutPinnedRef: vi.fn(),
  headCommit: vi.fn(() => "abc1234"),
  isDetachedHead: vi.fn(() => false),
  isInHeadCommit: vi.fn(() => true),
  isLocalRepoPath: vi.fn(() => false),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { ExitPromptError } from "@inquirer/core";
import { password } from "@inquirer/prompts";
import { requireState, saveState } from "../state.js";
import { addMcpServer } from "../sync/mcp-sync.js";
import type { AgentBrewState, McpServer } from "../types.js";
import { MCP_BUILD_DIR } from "./git-candidate.js";
import {
  assertCacheOrigin,
  assertOwnRepo,
  assertPinnedRef,
  cacheGitEnv,
  checkoutPinnedRef,
  headCommit,
  isDetachedHead,
  isInHeadCommit,
  isLocalRepoPath,
} from "./git-ref.js";
import {
  buildRepoIfNeeded,
  cloneOrUpdateRepo,
  deriveRepoName,
  detectEntrypoint,
  GIT_CACHE_DIR,
  installMcpFromGit,
  promptForMissingEnvVars,
  resolveHeadSha,
  updateMcpFromGit,
  validateRepoName,
} from "./mcp-git.js";

const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const actualChild = await vi.importActual<typeof import("node:child_process")>("node:child_process");
const actualRef = await vi.importActual<typeof import("./git-ref.js")>("./git-ref.js");

const mockExecFileSync = vi.mocked(execFileSync);
const mockSpawnSync = vi.mocked(spawnSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockAddMcpServer = vi.mocked(addMcpServer);
const mockRequireState = vi.mocked(requireState);
const mockSaveState = vi.mocked(saveState);
const mockPassword = vi.mocked(password);
const mockCheckoutPinnedRef = vi.mocked(checkoutPinnedRef);
const mockAssertCacheOrigin = vi.mocked(assertCacheOrigin);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(servers: McpServer[] = []): AgentBrewState {
  return { agents: [], sources: [], mcpServers: servers, catalogVersion: "0.1.0" };
}

// These fixtures own only this test file's isolated HOME. Git sees no owner config.
let fixtureRoot = "";
let fixtureRepo = "";
let fixtureCommit = "";
let fixtureState: AgentBrewState;
let savedFixtureEnv: NodeJS.ProcessEnv;
const fixtureUrl = "https://github.com/org/my-mcp.git";

function fixtureGit(cwd: string, ...args: string[]): string {
  return actualChild.execFileSync("git", args, { cwd, env: process.env, encoding: "utf8", stdio: "pipe" }).trim();
}

function freshBuildAttempt(): string {
  const parent = join(MCP_BUILD_DIR, "unit-build");
  actualFs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const root = join(parent, `attempt-${randomUUID()}`);
  actualFs.mkdirSync(root, { mode: 0o700 });
  return root;
}

function initializeHandlerFixture(): void {
  vi.clearAllMocks();
  savedFixtureEnv = { ...process.env };
  const home = homedir();
  fixtureRoot = actualFs.mkdtempSync(join(homedir(), "unit-handlers-"));
  const tools = join(fixtureRoot, "tools");
  actualFs.mkdirSync(tools);
  for (const name of ["npm", "npx", "mcpm", "launchctl", "crontab", "systemctl"]) {
    actualFs.writeFileSync(join(tools, name), "#!/bin/sh\nexit 127\n", { mode: 0o700 });
  }
  const config = join(fixtureRoot, "empty.gitconfig");
  actualFs.writeFileSync(config, "");
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(fixtureRoot, "cache"),
    XDG_DATA_HOME: join(fixtureRoot, "data"),
    XDG_STATE_HOME: join(fixtureRoot, "state"),
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
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_SYSTEM: config,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ALLOW_PROTOCOL: "file",
    GIT_AUTHOR_NAME: "agentbrew fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_COMMITTER_NAME: "agentbrew fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${join(fixtureRoot, "local-mcp")}.insteadOf`,
    GIT_CONFIG_VALUE_0: fixtureUrl,
    AGENTBREW_EVENTS: "0",
    AGENTBREW_POSTHOG_KEY: "",
    AGENTBREW_TELEMETRY_URL: "http://127.0.0.1:9/",
    AGENTBREW_MCPM_BIN: join(fixtureRoot, "unavailable-mcpm"),
  });
  fixtureRepo = join(fixtureRoot, "local-mcp");
  fixtureGit(fixtureRoot, "init", "--quiet", "-b", "main", fixtureRepo);
  actualFs.mkdirSync(join(fixtureRepo, "dist"));
  actualFs.writeFileSync(join(fixtureRepo, "dist/index.js"), "// fixture entrypoint\n");
  fixtureGit(fixtureRepo, "add", ".");
  fixtureGit(fixtureRepo, "commit", "--quiet", "-m", "fixture");
  fixtureGit(fixtureRepo, "tag", "v1.2.0");
  fixtureCommit = fixtureGit(fixtureRepo, "rev-parse", "HEAD");
  mockExistsSync.mockImplementation(actualFs.existsSync);
  mockReadFileSync.mockImplementation(actualFs.readFileSync);
  vi.mocked(statSync).mockImplementation(actualFs.statSync);
  mockExecFileSync.mockImplementation((file, args, options) => {
    if (file !== "git") throw new Error("fixture refused non-Git subprocess");
    return actualChild.execFileSync(file, args, options);
  });
  mockSpawnSync.mockImplementation((file, args, options) => {
    if (file !== "git") throw new Error("fixture refused non-Git subprocess");
    return actualChild.spawnSync(file, args, options);
  });
  for (const key of [
    "assertCacheOrigin",
    "assertOwnRepo",
    "assertPinnedRef",
    "cacheGitEnv",
    "checkoutPinnedRef",
    "headCommit",
    "isDetachedHead",
    "isInHeadCommit",
    "isLocalRepoPath",
  ] as const) {
    const mocked = {
      assertCacheOrigin,
      assertOwnRepo,
      assertPinnedRef,
      cacheGitEnv,
      checkoutPinnedRef,
      headCommit,
      isDetachedHead,
      isInHeadCommit,
      isLocalRepoPath,
    }[key];
    vi.mocked(mocked).mockImplementation(actualRef[key] as never);
  }
  fixtureState = makeState();
  mockRequireState.mockImplementation(() => fixtureState);
  mockSaveState.mockImplementation((state) => {
    fixtureState = state;
  });
  mockAddMcpServer.mockImplementation(async (name, command, args, env, options) => {
    fixtureState.mcpServers?.push({
      name,
      command,
      args: [...args],
      env: { ...env },
      source: "user",
      gitUrl: options?.gitUrl,
      gitRef: options?.gitRef,
    });
  });
  mockPassword.mockReset();
}

function restoreHandlerFixture(): void {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, savedFixtureEnv);
  actualFs.rmSync(fixtureRoot, { recursive: true, force: true });
  actualFs.rmSync(GIT_CACHE_DIR, { recursive: true, force: true });
  actualFs.rmSync(MCP_BUILD_DIR, { recursive: true, force: true });
}

function acquiredRoot(): string {
  const clones = mockSpawnSync.mock.calls.filter(([file, args]) => file === "git" && args?.[0] === "clone");
  expect(clones).toHaveLength(1);
  const root = clones[0][1]?.at(-1);
  expect(typeof root).toBe("string");
  return String(root);
}

function seedOldRuntime(): { server: McpServer; root: string; bytes: string; inode: number } {
  const root = join(GIT_CACHE_DIR, "my-mcp");
  actualFs.mkdirSync(GIT_CACHE_DIR, { recursive: true });
  fixtureGit(GIT_CACHE_DIR, "clone", "--no-local", "--quiet", fixtureUrl, root);
  const server: McpServer = {
    name: "my-mcp",
    command: "node",
    args: [join(root, "dist/index.js")],
    env: {},
    source: "user",
    gitUrl: fixtureUrl,
    gitRef: fixtureCommit,
  };
  fixtureState.mcpServers?.push(server);
  return {
    server,
    root,
    bytes: actualFs.readFileSync(server.args[0], "utf8"),
    inode: actualFs.lstatSync(server.args[0]).ino,
  };
}

function expectOldRuntime(old: ReturnType<typeof seedOldRuntime>): void {
  expect(actualFs.readFileSync(join(old.root, "dist/index.js"), "utf8")).toBe(old.bytes);
  expect(actualFs.lstatSync(join(old.root, "dist/index.js")).ino).toBe(old.inode);
}

function removeFixtureEntrypoint(): void {
  fixtureGit(fixtureRepo, "rm", "dist/index.js");
  fixtureGit(fixtureRepo, "commit", "--quiet", "-m", "without entrypoint");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("deriveRepoName", () => {
  it("returns last path segment without .git", () => {
    expect(deriveRepoName("https://github.com/org/my-mcp-server.git")).toBe("my-mcp-server");
  });

  it("handles URL without .git suffix", () => {
    expect(deriveRepoName("https://github.com/org/my-mcp-server")).toBe("my-mcp-server");
  });

  it("handles bare repo name", () => {
    expect(deriveRepoName("my-mcp-server")).toBe("my-mcp-server");
  });

  it("handles GitHub Enterprise URLs", () => {
    expect(deriveRepoName("github.example.com/org/some-mcp-server.git")).toBe("some-mcp-server");
  });
});

describe("validateRepoName", () => {
  it("accepts valid names", () => {
    expect(() => validateRepoName("my-mcp-server")).not.toThrow();
    expect(() => validateRepoName("server_v2.0")).not.toThrow();
    expect(() => validateRepoName("MCP.Server")).not.toThrow();
  });

  it("rejects path traversal attempts", () => {
    expect(() => validateRepoName("../../etc/crontab")).toThrow(/Invalid server name/);
    expect(() => validateRepoName("../passwd")).toThrow(/Invalid server name/);
  });

  it("rejects names with path separators", () => {
    expect(() => validateRepoName("foo/bar")).toThrow(/Invalid server name/);
    expect(() => validateRepoName("foo\\bar")).toThrow(/Invalid server name/);
  });

  it("rejects empty names", () => {
    expect(() => validateRepoName("")).toThrow(/Invalid server name/);
  });

  it("rejects names made only of dots, including ones derived from a URL", () => {
    expect(() => validateRepoName(".")).toThrow(/Invalid server name/);
    expect(() => validateRepoName("..")).toThrow(/Invalid server name/);
    expect(() => validateRepoName(deriveRepoName("https://example.com/org/...git"))).toThrow(/Invalid server name/);
    expect(() => validateRepoName(".config")).not.toThrow();
  });
});

describe("GIT_CACHE_DIR", () => {
  it("points inside ~/.config/agentbrew/mcp-repos", () => {
    expect(GIT_CACHE_DIR).toBe(join(homedir(), ".config", "agentbrew", "mcp-repos"));
  });
});

describe("cloneOrUpdateRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects names with path traversal sequences", () => {
    expect(() => cloneOrUpdateRepo("https://example.com/repo.git", "../../etc/crontab")).toThrow(/Invalid server name/);
  });

  it("clones a repo when the directory does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from("") } as ReturnType<typeof spawnSync>);

    const repoDir = cloneOrUpdateRepo("https://github.com/org/my-mcp.git", "my-mcp");

    expect(repoDir).toBe(join(GIT_CACHE_DIR, "my-mcp"));
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "git",
      ["clone", "-o", "origin", "--end-of-options", "https://github.com/org/my-mcp.git", repoDir],
      {
        env: CACHE_ENV,
        stdio: "pipe",
        timeout: 60_000,
      },
    );
  });

  it("clones without a checkout, then checks out the exact ref, when a ref is provided", () => {
    mockExistsSync.mockReturnValue(false);
    mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from("") } as ReturnType<typeof spawnSync>);

    const repoDir = cloneOrUpdateRepo("https://github.com/org/my-mcp.git", "my-mcp", "v1.2.0");

    expect(mockSpawnSync).toHaveBeenCalledWith(
      "git",
      ["clone", "-o", "origin", "--no-checkout", "--end-of-options", "https://github.com/org/my-mcp.git", repoDir],
      { env: CACHE_ENV, stdio: "pipe", timeout: 60_000 },
    );
    expect(mockCheckoutPinnedRef).toHaveBeenCalledWith(repoDir, "v1.2.0", CACHE_ENV);
  });

  it("throws on clone failure", () => {
    mockExistsSync.mockReturnValue(false);
    mockSpawnSync.mockReturnValue({
      status: 128,
      stderr: Buffer.from("Repository not found"),
    } as ReturnType<typeof spawnSync>);

    expect(() => cloneOrUpdateRepo("https://github.com/org/nonexistent.git", "nonexistent")).toThrow(
      "git clone failed: Repository not found",
    );
  });

  it("throws with 'unknown error' when stderr is null", () => {
    mockExistsSync.mockReturnValue(false);
    mockSpawnSync.mockReturnValue({
      status: 128,
      stderr: null,
    } as unknown as ReturnType<typeof spawnSync>);

    expect(() => cloneOrUpdateRepo("https://github.com/org/broken.git", "broken")).toThrow(
      "git clone failed: unknown error",
    );
  });

  it("fetches and pulls when repo already exists (no ref)", () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockReturnValue(Buffer.from(""));

    cloneOrUpdateRepo("https://github.com/org/my-mcp.git", "my-mcp");

    const inCache = expect.objectContaining({ env: CACHE_ENV });
    expect(mockExecFileSync).toHaveBeenCalledWith("git", ["fetch", "--tags"], inCache);
    expect(mockExecFileSync).toHaveBeenCalledWith("git", ["pull"], inCache);
  });

  it("fetches and checks out ref when repo already exists with ref", () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockReturnValue(Buffer.from(""));

    const repoDir = cloneOrUpdateRepo("https://github.com/org/my-mcp.git", "my-mcp", "v2.0.0");

    // checkoutPinnedRef fetches what the ref needs; no --tags fetch that a moved tag could fail.
    expect(mockExecFileSync).not.toHaveBeenCalledWith("git", ["fetch", "--tags"], expect.anything());
    expect(mockCheckoutPinnedRef).toHaveBeenCalledWith(repoDir, "v2.0.0", CACHE_ENV);
    // Should NOT call git pull when a ref is specified
    expect(mockExecFileSync).not.toHaveBeenCalledWith("git", ["pull"], expect.anything());
  });

  it("throws on fetch/pull failure when repo exists", () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("network error");
    });

    expect(() => cloneOrUpdateRepo("https://github.com/org/my-mcp.git", "my-mcp")).toThrow(
      "Failed to update repo: network error",
    );
  });
});

describe("resolveHeadSha", () => {
  it("returns the trimmed SHA from git rev-parse", () => {
    mockExecFileSync.mockReturnValue(Buffer.from("abc1234\n"));
    expect(resolveHeadSha("/some/repo")).toBe("abc1234");
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--short", "HEAD"],
      expect.objectContaining({ env: CACHE_ENV }),
    );
  });

  it("returns 'unknown' when git fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(resolveHeadSha("/some/path")).toBe("unknown");
  });
});

describe("buildRepoIfNeeded", () => {
  let attempt: string;
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockImplementation(actualFs.existsSync);
    mockReadFileSync.mockImplementation(actualFs.readFileSync);
    vi.mocked(cacheGitEnv).mockReturnValue(CACHE_ENV);
    attempt = freshBuildAttempt();
  });
  afterEach(() => {
    actualFs.rmSync(MCP_BUILD_DIR, { recursive: true, force: true });
  });

  it("does nothing when package.json is absent", () => {
    buildRepoIfNeeded(attempt);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("does nothing when package.json has no build script", () => {
    actualFs.writeFileSync(join(attempt, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    buildRepoIfNeeded(attempt);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("runs npm install and build when build script exists", () => {
    actualFs.writeFileSync(join(attempt, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
    mockExecFileSync.mockReturnValue(Buffer.from(""));

    buildRepoIfNeeded(attempt);

    const inCache = expect.objectContaining({ env: { ...CACHE_ENV, GIT_OPTIONAL_LOCKS: "0" } });
    expect(mockExecFileSync).toHaveBeenCalledWith("npm", ["install", "--prefer-offline"], inCache);
    expect(mockExecFileSync).toHaveBeenCalledWith("npm", ["run", "build"], inCache);
  });

  it("warns but does not throw on build failure", () => {
    actualFs.writeFileSync(join(attempt, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
    mockExecFileSync
      .mockReturnValueOnce(Buffer.from("")) // npm install succeeds
      .mockImplementationOnce(() => {
        throw new Error("build error");
      });

    // Should not throw
    expect(() => buildRepoIfNeeded(attempt)).not.toThrow();
  });

  it("does nothing when package.json has no scripts field at all", () => {
    actualFs.writeFileSync(join(attempt, "package.json"), JSON.stringify({}));
    buildRepoIfNeeded(attempt);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("returns early when package.json is malformed JSON (line 123)", () => {
    actualFs.writeFileSync(join(attempt, "package.json"), "{ not valid json }");

    // Should not throw and should not attempt to run npm
    expect(() => buildRepoIfNeeded(attempt)).not.toThrow();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});

describe("detectEntrypoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns node dist/index.js when present", () => {
    const repoDir = "/some/repo";
    mockExistsSync.mockImplementation((path) => String(path) === join(repoDir, "dist/index.js"));

    const result = detectEntrypoint(repoDir);
    expect(result).toEqual({ command: "node", args: [join(repoDir, "dist/index.js")] });
  });

  it("returns python3 run_server.py for Python servers", () => {
    const repoDir = "/some/repo";
    mockExistsSync.mockImplementation((path) => String(path) === join(repoDir, "run_server.py"));

    const result = detectEntrypoint(repoDir);
    expect(result).toEqual({ command: "python3", args: [join(repoDir, "run_server.py")] });
  });

  it("falls back to package.json bin when no candidate exists", () => {
    const repoDir = "/some/repo";
    // Only package.json and the bin path exist
    const binPath = join(repoDir, "bin/server.js");
    mockExistsSync.mockImplementation((path) => {
      const p = String(path);
      return p === join(repoDir, "package.json") || p === binPath;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ bin: { server: "bin/server.js" } }));

    const result = detectEntrypoint(repoDir);
    expect(result).toEqual({ command: "node", args: [binPath] });
  });

  it("falls back to package.json main when no candidate or bin exists", () => {
    const repoDir = "/some/repo";
    const mainPath = join(repoDir, "lib/main.js");
    mockExistsSync.mockImplementation((path) => {
      const p = String(path);
      return p === join(repoDir, "package.json") || p === mainPath;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ main: "lib/main.js" }));

    const result = detectEntrypoint(repoDir);
    expect(result).toEqual({ command: "node", args: [mainPath] });
  });

  it("returns undefined when nothing is found", () => {
    mockExistsSync.mockReturnValue(false);
    expect(detectEntrypoint("/empty/repo")).toBeUndefined();
  });

  it("returns undefined when package.json is malformed", () => {
    const repoDir = "/some/repo";
    mockExistsSync.mockImplementation((path) => String(path) === join(repoDir, "package.json"));
    mockReadFileSync.mockReturnValue("not json");

    expect(detectEntrypoint(repoDir)).toBeUndefined();
  });

  it("returns undefined when bin field is an empty object", () => {
    const repoDir = "/some/repo";
    mockExistsSync.mockImplementation((path) => String(path) === join(repoDir, "package.json"));
    mockReadFileSync.mockReturnValue(JSON.stringify({ bin: {} }));

    expect(detectEntrypoint(repoDir)).toBeUndefined();
  });

  it("falls through to main when bin path does not exist on disk", () => {
    const repoDir = "/some/repo";
    const mainPath = join(repoDir, "lib/main.js");
    mockExistsSync.mockImplementation((path) => {
      const p = String(path);
      return p === join(repoDir, "package.json") || p === mainPath;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ bin: "nonexistent.js", main: "lib/main.js" }));

    const result = detectEntrypoint(repoDir);
    expect(result).toEqual({ command: "node", args: [mainPath] });
  });

  it("returns undefined when main path does not exist on disk", () => {
    const repoDir = "/some/repo";
    mockExistsSync.mockImplementation((path) => String(path) === join(repoDir, "package.json"));
    mockReadFileSync.mockReturnValue(JSON.stringify({ main: "nonexistent.js" }));

    expect(detectEntrypoint(repoDir)).toBeUndefined();
  });
});

describe("promptForMissingEnvVars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear env vars used in tests
    delete process.env.MY_SECRET_KEY;
    delete process.env.API_TOKEN;
  });

  afterEach(() => {
    delete process.env.MY_SECRET_KEY;
    delete process.env.API_TOKEN;
  });

  it("returns empty object when no env vars are required", async () => {
    const result = await promptForMissingEnvVars({ args: [], env: {} });
    expect(result).toEqual({});
    expect(mockPassword).not.toHaveBeenCalled();
  });

  it("returns empty object when all required vars are already set", async () => {
    process.env.MY_SECRET_KEY = "existing-value";
    const result = await promptForMissingEnvVars({ args: ["${MY_SECRET_KEY}"], env: {} });
    expect(result).toEqual({});
    expect(mockPassword).not.toHaveBeenCalled();
  });

  it("prompts for missing env vars and sets them in process.env", async () => {
    mockPassword.mockResolvedValue("secret-value");
    const result = await promptForMissingEnvVars({ args: ["${MY_SECRET_KEY}"], env: {} });
    expect(result).toEqual({ MY_SECRET_KEY: "secret-value" });
    expect(process.env.MY_SECRET_KEY).toBe("secret-value");
  });

  it("prompts for multiple missing vars", async () => {
    mockPassword.mockResolvedValueOnce("value-a").mockResolvedValueOnce("value-b");
    const result = await promptForMissingEnvVars({
      args: ["${MY_SECRET_KEY}"],
      env: { API_TOKEN: "${API_TOKEN}" },
    });
    expect(Object.keys(result)).toHaveLength(2);
  });
});

describe("installMcpFromGit", () => {
  beforeEach(initializeHandlerFixture);
  afterEach(restoreHandlerFixture);

  it("logs error and returns when clone fails", async () => {
    actualFs.rmSync(fixtureRepo, { recursive: true });
    await installMcpFromGit(fixtureUrl);
    acquiredRoot();
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("logs error and returns when no entrypoint is detected", async () => {
    removeFixtureEntrypoint();
    await installMcpFromGit(fixtureUrl);
    expect(actualFs.existsSync(join(acquiredRoot(), "dist/index.js"))).toBe(false);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("registers and syncs when entrypoint is found", async () => {
    await installMcpFromGit(fixtureUrl, { nonInteractive: true });
    const entrypointPath = join(acquiredRoot(), "dist/index.js");
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "my-mcp",
      "node",
      [entrypointPath],
      {},
      expect.objectContaining({ gitUrl: fixtureUrl, gitRef: fixtureCommit }),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("uses custom name when provided", async () => {
    await installMcpFromGit(fixtureUrl, { name: "custom-name", nonInteractive: true });
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "custom-name",
      expect.any(String),
      expect.any(Array),
      {},
      expect.any(Object),
    );
    expect(mockAddMcpServer.mock.calls[0]?.[2]).toEqual([join(acquiredRoot(), "dist/index.js")]);
    expect(process.exitCode).toBeUndefined();
  });

  it("uses provided ref when installing", async () => {
    await installMcpFromGit(fixtureUrl, { ref: "v1.2.0", nonInteractive: true });
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "my-mcp",
      expect.any(String),
      expect.any(Array),
      {},
      expect.objectContaining({ gitRef: "v1.2.0" }),
    );
    expect(mockAddMcpServer.mock.calls[0]?.[2]).toEqual([join(acquiredRoot(), "dist/index.js")]);
    expect(process.exitCode).toBeUndefined();
  });

  it("records a local relative path as an absolute one, the way git stores the origin", async () => {
    const operand = relative(process.cwd(), fixtureRepo);
    await installMcpFromGit(operand, { nonInteractive: true });
    const repoDir = acquiredRoot();
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining([resolve(operand), repoDir]),
      expect.anything(),
    );
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "local-mcp",
      expect.any(String),
      expect.any(Array),
      {},
      expect.objectContaining({ gitUrl: resolve(operand) }),
    );
    expect(mockAddMcpServer.mock.calls[0]?.[2]).toEqual([join(repoDir, "dist/index.js")]);
    expect(process.exitCode).toBeUndefined();
  });

  it("exits 130 when the env var prompt is cancelled with Ctrl-C in a terminal", async () => {
    mockPassword.mockRejectedValue(new ExitPromptError("cancelled"));
    delete process.env.CANCEL_TEST_VAR;
    const streams = [process.stdin, process.stdout] as Array<{ isTTY?: boolean }>;
    const before = streams.map((stream) => Object.getOwnPropertyDescriptor(stream, "isTTY"));
    for (const stream of streams) Object.defineProperty(stream, "isTTY", { value: true, configurable: true });
    try {
      await installMcpFromGit("https://github.com/org/my-mcp-env.git", { envPairs: ["CANCEL_TEST_VAR"] });
    } finally {
      streams.forEach((stream, i) => {
        const descriptor = before[i];
        if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
        else delete stream.isTTY;
      });
    }
    expect(process.exitCode).toBe(130);
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(mockPassword).toHaveBeenCalledTimes(1);
    expect(mockSpawnSync.mock.calls.some(([, args]) => args?.[0] === "clone")).toBe(false);
  });

  it("re-throws non-ExitPromptError from env var prompt", async () => {
    delete process.env.RETHROW_TEST_VAR;
    mockPassword.mockRejectedValue(new Error("unexpected failure"));

    await expect(promptForMissingEnvVars({ args: ["${RETHROW_TEST_VAR}"], env: {} })).rejects.toThrow(
      "unexpected failure",
    );
  });
});

describe("updateMcpFromGit", () => {
  beforeEach(initializeHandlerFixture);
  afterEach(restoreHandlerFixture);

  it("returns early without logging when requireState returns undefined", async () => {
    mockRequireState.mockReturnValue(undefined);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await updateMcpFromGit("any-server");

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    consoleSpy.mockRestore();
  });

  it("logs error when server is not found in state", async () => {
    mockRequireState.mockReturnValue(makeState([]));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await updateMcpFromGit("nonexistent");

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("not found in state"));
    expect(process.exitCode).toBe(1);
    consoleSpy.mockRestore();
  });

  it("logs error when server has no gitUrl", async () => {
    mockRequireState.mockReturnValue(
      makeState([{ name: "my-server", command: "node", args: [], env: {}, source: "user" }]),
    );
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await updateMcpFromGit("my-server");

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("was not installed from git"));
    expect(process.exitCode).toBe(1);
    consoleSpy.mockRestore();
  });

  it("updates command, args, and gitRef in state and saves", async () => {
    const old = seedOldRuntime();
    actualFs.writeFileSync(join(fixtureRepo, "dist/index.js"), "// updated entrypoint\n");
    fixtureGit(fixtureRepo, "add", ".");
    fixtureGit(fixtureRepo, "commit", "--quiet", "-m", "updated");
    const nextCommit = fixtureGit(fixtureRepo, "rev-parse", "HEAD");
    const { syncMcpServers } = await import("../sync/mcp-sync.js");
    vi.mocked(syncMcpServers).mockResolvedValue(undefined);
    await updateMcpFromGit("my-mcp", { freshRuntime: true });
    expect(old.server.command).toBe("node");
    expect(old.server.args).toEqual([join(acquiredRoot(), "dist/index.js")]);
    expect(old.server.gitRef).toBe(nextCommit);
    expect(mockSaveState).toHaveBeenCalledWith(fixtureState);
    expectOldRuntime(old);
    expect(process.exitCode).toBeUndefined();
  });

  it("logs error and returns early when cloneOrUpdateRepo throws", async () => {
    const old = seedOldRuntime();
    actualFs.rmSync(fixtureRepo, { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await updateMcpFromGit("my-mcp", { freshRuntime: true });
    acquiredRoot();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("clone failed with terminal prompts disabled"));
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expectOldRuntime(old);
    consoleSpy.mockRestore();
  });

  it("prints a refused cache's own advice, without the network retry hint", async () => {
    const old = seedOldRuntime();
    fixtureGit(old.root, "remote", "set-url", "origin", "https://example.com/other");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await updateMcpFromGit("my-mcp", { freshRuntime: true });
    expect(mockAssertCacheOrigin).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("runtime origin could not be verified against github.com"),
    );
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("Failed to update repo"));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("network connection"));
    expect(mockSpawnSync.mock.calls.some(([, args]) => args?.[0] === "clone")).toBe(false);
    expect(mockSaveState).not.toHaveBeenCalled();
    expectOldRuntime(old);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("logs error and returns early when detectEntrypoint returns undefined", async () => {
    const old = seedOldRuntime();
    removeFixtureEntrypoint();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await updateMcpFromGit("my-mcp", { freshRuntime: true });
    expect(actualFs.existsSync(join(acquiredRoot(), "dist/index.js"))).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No usable entrypoint in this candidate"));
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expectOldRuntime(old);
    consoleSpy.mockRestore();
  });
});

// These qualification controls are separate from the retained 54 cases.
describe("actual candidate build ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockImplementation(actualFs.existsSync);
    mockReadFileSync.mockImplementation(actualFs.readFileSync);
  });
  afterEach(() => {
    actualFs.rmSync(MCP_BUILD_DIR, { recursive: true, force: true });
  });

  it("refuses an outside namespace before npm", () => {
    freshBuildAttempt();
    expect(() => buildRepoIfNeeded(join(homedir(), "outside-candidate"))).toThrow("build does not own a fresh attempt");
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("refuses a sealed attempt before npm", () => {
    const root = freshBuildAttempt();
    actualFs.mkdirSync(join(root, ".git"));
    actualFs.writeFileSync(join(root, ".git/agentbrew-candidate.json"), "{}");
    expect(() => buildRepoIfNeeded(root)).toThrow("a sealed runtime cannot be rebuilt in place");
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});
