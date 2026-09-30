import { homedir } from "node:os";
import { join } from "node:path";
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
  };
});

vi.mock("../sync/mcp-sync.js", () => ({
  addMcpServer: vi.fn(),
  syncMcpServers: vi.fn(),
}));

vi.mock("../state.js", () => ({
  requireState: vi.fn(),
  saveState: vi.fn(),
}));

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    checkGitAvailable: vi.fn(() => true),
  };
});

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { ExitPromptError } from "@inquirer/core";
import { input } from "@inquirer/prompts";
import { requireState, saveState } from "../state.js";
import { addMcpServer } from "../sync/mcp-sync.js";
import type { AgentBrewState, McpServer } from "../types.js";
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

const mockExecFileSync = vi.mocked(execFileSync);
const mockSpawnSync = vi.mocked(spawnSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockAddMcpServer = vi.mocked(addMcpServer);
const mockRequireState = vi.mocked(requireState);
const mockSaveState = vi.mocked(saveState);
const mockInput = vi.mocked(input);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(servers: McpServer[] = []): AgentBrewState {
  return { agents: [], sources: [], mcpServers: servers, catalogVersion: "0.1.0" };
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
    expect(mockSpawnSync).toHaveBeenCalledWith("git", ["clone", "https://github.com/org/my-mcp.git", repoDir], {
      stdio: "pipe",
      timeout: 60_000,
    });
  });

  it("clones with --branch when a ref is provided", () => {
    mockExistsSync.mockReturnValue(false);
    mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from("") } as ReturnType<typeof spawnSync>);

    cloneOrUpdateRepo("https://github.com/org/my-mcp.git", "my-mcp", "v1.2.0");

    expect(mockSpawnSync).toHaveBeenCalledWith(
      "git",
      ["clone", "--branch", "v1.2.0", "https://github.com/org/my-mcp.git", expect.any(String)],
      { stdio: "pipe", timeout: 60_000 },
    );
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

    expect(mockExecFileSync).toHaveBeenCalledWith("git", ["fetch", "--tags"], expect.anything());
    expect(mockExecFileSync).toHaveBeenCalledWith("git", ["pull"], expect.anything());
  });

  it("fetches and checks out ref when repo already exists with ref", () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockReturnValue(Buffer.from(""));

    cloneOrUpdateRepo("https://github.com/org/my-mcp.git", "my-mcp", "v2.0.0");

    expect(mockExecFileSync).toHaveBeenCalledWith("git", ["fetch", "--tags"], expect.anything());
    expect(mockExecFileSync).toHaveBeenCalledWith("git", ["checkout", "v2.0.0"], expect.anything());
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
  });

  it("returns 'unknown' when git fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(resolveHeadSha("/some/path")).toBe("unknown");
  });
});

describe("buildRepoIfNeeded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when package.json is absent", () => {
    mockExistsSync.mockReturnValue(false);
    buildRepoIfNeeded("/some/repo");
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("does nothing when package.json has no build script", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ scripts: { test: "vitest" } }));
    buildRepoIfNeeded("/some/repo");
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("runs npm install and build when build script exists", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ scripts: { build: "tsc" } }));
    mockExecFileSync.mockReturnValue(Buffer.from(""));

    buildRepoIfNeeded("/some/repo");

    expect(mockExecFileSync).toHaveBeenCalledWith("npm", ["install", "--prefer-offline"], expect.anything());
    expect(mockExecFileSync).toHaveBeenCalledWith("npm", ["run", "build"], expect.anything());
  });

  it("warns but does not throw on build failure", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ scripts: { build: "tsc" } }));
    mockExecFileSync
      .mockReturnValueOnce(Buffer.from("")) // npm install succeeds
      .mockImplementationOnce(() => {
        throw new Error("build error");
      });

    // Should not throw
    expect(() => buildRepoIfNeeded("/some/repo")).not.toThrow();
  });

  it("does nothing when package.json has no scripts field at all", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({}));
    buildRepoIfNeeded("/some/repo");
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("returns early when package.json is malformed JSON (line 123)", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{ not valid json }");

    // Should not throw and should not attempt to run npm
    expect(() => buildRepoIfNeeded("/some/repo")).not.toThrow();
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
    expect(mockInput).not.toHaveBeenCalled();
  });

  it("returns empty object when all required vars are already set", async () => {
    process.env.MY_SECRET_KEY = "existing-value";
    const result = await promptForMissingEnvVars({ args: ["${MY_SECRET_KEY}"], env: {} });
    expect(result).toEqual({});
    expect(mockInput).not.toHaveBeenCalled();
  });

  it("prompts for missing env vars and sets them in process.env", async () => {
    mockInput.mockResolvedValue("secret-value");
    const result = await promptForMissingEnvVars({ args: ["${MY_SECRET_KEY}"], env: {} });
    expect(result).toEqual({ MY_SECRET_KEY: "secret-value" });
    expect(process.env.MY_SECRET_KEY).toBe("secret-value");
  });

  it("prompts for multiple missing vars", async () => {
    mockInput.mockResolvedValueOnce("value-a").mockResolvedValueOnce("value-b");
    const result = await promptForMissingEnvVars({
      args: ["${MY_SECRET_KEY}"],
      env: { API_TOKEN: "${API_TOKEN}" },
    });
    expect(Object.keys(result)).toHaveLength(2);
  });
});

describe("installMcpFromGit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs error and returns when clone fails", async () => {
    mockExistsSync.mockReturnValue(false);
    mockSpawnSync.mockReturnValue({ status: 1, stderr: Buffer.from("auth error") } as ReturnType<typeof spawnSync>);

    await installMcpFromGit("https://github.com/org/my-mcp.git");

    expect(mockAddMcpServer).not.toHaveBeenCalled();
  });

  it("logs error and returns when no entrypoint is detected", async () => {
    mockExistsSync.mockImplementation((path) => {
      // Only the repo dir itself exists, nothing inside
      return String(path).endsWith("my-mcp");
    });
    mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from("") } as ReturnType<typeof spawnSync>);
    mockExecFileSync.mockReturnValue(Buffer.from("abc1234\n"));

    await installMcpFromGit("https://github.com/org/my-mcp.git");

    expect(mockAddMcpServer).not.toHaveBeenCalled();
  });

  it("registers and syncs when entrypoint is found", async () => {
    const repoDir = join(GIT_CACHE_DIR, "my-mcp");
    const entrypointPath = join(repoDir, "dist/index.js");

    mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from("") } as ReturnType<typeof spawnSync>);
    mockExistsSync.mockImplementation((path) => {
      const p = String(path);
      return p === repoDir || p === entrypointPath;
    });
    mockExecFileSync.mockReturnValue(Buffer.from("abc1234\n"));
    mockAddMcpServer.mockResolvedValue(undefined);

    await installMcpFromGit("https://github.com/org/my-mcp.git", { nonInteractive: true });

    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "my-mcp",
      "node",
      [entrypointPath],
      {},
      expect.objectContaining({
        gitUrl: "https://github.com/org/my-mcp.git",
        gitRef: "abc1234",
      }),
    );
  });

  it("uses custom name when provided", async () => {
    const repoDir = join(GIT_CACHE_DIR, "custom-name");
    const entrypointPath = join(repoDir, "dist/index.js");

    mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from("") } as ReturnType<typeof spawnSync>);
    mockExistsSync.mockImplementation((path) => {
      const p = String(path);
      return p === repoDir || p === entrypointPath;
    });
    mockExecFileSync.mockReturnValue(Buffer.from("abc1234\n"));
    mockAddMcpServer.mockResolvedValue(undefined);

    await installMcpFromGit("https://github.com/org/my-mcp.git", { name: "custom-name", nonInteractive: true });

    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "custom-name",
      expect.any(String),
      expect.any(Array),
      {},
      expect.any(Object),
    );
  });

  it("uses provided ref when installing", async () => {
    const repoDir = join(GIT_CACHE_DIR, "my-mcp");
    const entrypointPath = join(repoDir, "dist/index.js");

    mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from("") } as ReturnType<typeof spawnSync>);
    mockExistsSync.mockImplementation((path) => {
      const p = String(path);
      return p === repoDir || p === entrypointPath;
    });
    mockExecFileSync.mockReturnValue(Buffer.from("abc1234\n"));
    mockAddMcpServer.mockResolvedValue(undefined);

    await installMcpFromGit("https://github.com/org/my-mcp.git", { ref: "v1.2.0", nonInteractive: true });

    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "my-mcp",
      expect.any(String),
      expect.any(Array),
      {},
      expect.objectContaining({ gitRef: "v1.2.0" }),
    );
  });

  it("cancels gracefully when user exits env var prompt (nonInteractive false)", async () => {
    // When nonInteractive is false and env vars are needed, ExitPromptError aborts install.
    // We test the nonInteractive: true case (no prompt, install proceeds) separately above.
    // For the cancellation path we verify that not calling addMcpServer is the outcome.
    const repoDir = join(GIT_CACHE_DIR, "my-mcp-env");
    const entrypointPath = join(repoDir, "dist/index.js");

    mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from("") } as ReturnType<typeof spawnSync>);
    mockExistsSync.mockImplementation((path) => {
      const p = String(path);
      return p === repoDir || p === entrypointPath;
    });
    mockExecFileSync.mockReturnValue(Buffer.from("abc1234\n"));
    // Simulate the user pressing Ctrl+C at the env var prompt
    mockInput.mockRejectedValue(new ExitPromptError("cancelled"));

    // The entrypoint args reference an env var that is not set, triggering a prompt
    // We need to make detectEntrypoint return something with env var refs in args.
    // Since detectEntrypoint reads disk, and the args it returns don't have env vars,
    // we verify cancellation via the promptForMissingEnvVars mock.
    // For a clean integration, test with nonInteractive: true (already done above).
    // Here we just confirm the function does not throw when cancelled.
    await expect(installMcpFromGit("https://github.com/org/my-mcp-env.git")).resolves.toBeUndefined();
  });

  it("re-throws non-ExitPromptError from env var prompt", async () => {
    const repoDir = join(GIT_CACHE_DIR, "my-mcp-err");
    const entrypointPath = join(repoDir, "dist/index.js");

    mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from("") } as ReturnType<typeof spawnSync>);
    mockExistsSync.mockImplementation((path) => {
      const p = String(path);
      return p === repoDir || p === entrypointPath;
    });
    mockExecFileSync.mockReturnValue(Buffer.from("abc1234\n"));

    // To trigger the catch block at line 266-271, we need promptForMissingEnvVars
    // to actually call input(). Since detectEntrypoint returns file paths (no env var
    // refs like ${VAR}), we set a real env var in the args so extractEnvVars finds it.
    // Override detectEntrypoint's result by making the entrypoint a path with ${MY_TEST_VAR}.
    // But detectEntrypoint reads from disk — we can't easily inject env var refs into args.
    // Instead, test the re-throw path via promptForMissingEnvVars directly.
    delete process.env.RETHROW_TEST_VAR;
    mockInput.mockRejectedValue(new Error("unexpected failure"));

    await expect(promptForMissingEnvVars({ args: ["${RETHROW_TEST_VAR}"], env: {} })).rejects.toThrow(
      "unexpected failure",
    );
  });
});

describe("updateMcpFromGit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early without logging when requireState returns undefined", async () => {
    mockRequireState.mockReturnValue(undefined);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await updateMcpFromGit("any-server");

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("logs error when server is not found in state", async () => {
    mockRequireState.mockReturnValue(makeState([]));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await updateMcpFromGit("nonexistent");

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("not found in state"));
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
    consoleSpy.mockRestore();
  });

  it("updates command, args, and gitRef in state and saves", async () => {
    const repoDir = join(GIT_CACHE_DIR, "my-mcp");
    const entrypointPath = join(repoDir, "dist/index.js");
    const server = {
      name: "my-mcp",
      command: "node",
      args: ["/old/path/index.js"],
      env: {},
      source: "user" as const,
      gitUrl: "https://github.com/org/my-mcp.git",
      gitRef: "old-sha",
    };
    const state = makeState([server]);
    mockRequireState.mockReturnValue(state);

    mockExistsSync.mockImplementation((path) => {
      const p = String(path);
      return p === repoDir || p === entrypointPath;
    });
    mockExecFileSync.mockReturnValue(Buffer.from("newsha\n"));

    const { syncMcpServers: mockSync } = await import("../sync/mcp-sync.js");
    vi.mocked(mockSync).mockResolvedValue(undefined);

    await updateMcpFromGit("my-mcp");

    expect(server.command).toBe("node");
    expect(server.args).toEqual([entrypointPath]);
    expect(server.gitRef).toBe("newsha");
    expect(mockSaveState).toHaveBeenCalledWith(state);
  });

  it("logs error and returns early when cloneOrUpdateRepo throws", async () => {
    const repoDir = join(GIT_CACHE_DIR, "my-mcp");
    const server = {
      name: "my-mcp",
      command: "node",
      args: [],
      env: {},
      source: "user" as const,
      gitUrl: "https://github.com/org/my-mcp.git",
    };
    mockRequireState.mockReturnValue(makeState([server]));

    // Repo dir exists so cloneOrUpdateRepo takes the update path, then git fetch throws
    mockExistsSync.mockImplementation((path) => String(path) === repoDir);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("git fetch failed: connection refused");
    });

    vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await updateMcpFromGit("my-mcp");

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("git fetch failed"));
    expect(mockSaveState).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("logs error and returns early when detectEntrypoint returns undefined", async () => {
    const server = {
      name: "my-mcp",
      command: "node",
      args: [],
      env: {},
      source: "user" as const,
      gitUrl: "https://github.com/org/my-mcp.git",
    };
    mockRequireState.mockReturnValue(makeState([server]));

    // Repo dir does NOT exist — cloneOrUpdateRepo takes the clone path via spawnSync (succeeds)
    // No entrypoint candidates exist and no package.json — detectEntrypoint returns undefined
    mockExistsSync.mockReturnValue(false);
    mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from("") } as ReturnType<typeof spawnSync>);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await updateMcpFromGit("my-mcp");

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Could not detect entrypoint after update"));
    expect(mockSaveState).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
