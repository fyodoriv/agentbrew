import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { throwReadFileSyncForPackageJson } = vi.hoisted(() => ({
  throwReadFileSyncForPackageJson: { value: false },
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const originalReadFileSync = actual.readFileSync;
  return {
    ...actual,
    readFileSync: vi.fn((...args: Parameters<typeof actual.readFileSync>) => {
      if (throwReadFileSyncForPackageJson.value && typeof args[0] === "string" && args[0].includes("package.json")) {
        throw new Error("ENOENT: no such file or directory");
      }
      return (originalReadFileSync as (...a: unknown[]) => unknown)(...args);
    }),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(() => "0.2.1\n") };
});

vi.mock("./utils.js", () => ({
  expandHome: (p: string) => p.replace("~", tmpDir),
}));

const tmpDir = `/tmp/agentbrew-auto-upgrade-test-${Date.now()}`;

import { execFileSync } from "node:child_process";
import { checkForAutoUpgrade } from "./auto-upgrade.js";

const mockExecFileSync = vi.mocked(execFileSync);

describe("checkForAutoUpgrade", () => {
  beforeEach(() => {
    mkdirSync(join(tmpDir, ".config", "agentbrew"), { recursive: true });
    mockExecFileSync.mockReset();
    mockExecFileSync.mockReturnValue("0.2.1\n");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does nothing when running via npx", () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "/some/path/_npx/agentbrew";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    checkForAutoUpgrade();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    process.argv[1] = origArgv1;
  });

  it("writes cache after checking npm", () => {
    mockExecFileSync.mockReturnValue("99.0.0\n");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    checkForAutoUpgrade();

    const cachePath = join(tmpDir, ".config", "agentbrew", "upgrade-check.json");
    expect(existsSync(cachePath)).toBe(true);
    const cache = JSON.parse(readFileSync(cachePath, "utf-8"));
    expect(cache.latestVersion).toBe("99.0.0");

    vi.mocked(console.log).mockRestore();
  });

  it("uses cache when fresh", () => {
    const cachePath = join(tmpDir, ".config", "agentbrew", "upgrade-check.json");
    writeFileSync(cachePath, JSON.stringify({ checkedAt: new Date().toISOString(), latestVersion: "0.2.1" }));

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    checkForAutoUpgrade();

    // Should not call npm view since cache is fresh
    expect(mockExecFileSync).not.toHaveBeenCalledWith("npm", ["view", "agentbrew", "version"], expect.anything());
    spy.mockRestore();
  });

  it("never throws — errors are swallowed", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("network down");
    });

    expect(() => checkForAutoUpgrade()).not.toThrow();
  });

  it("prints update message when global install and upgrade succeeds", () => {
    // Make isGlobalInstall() return true by having npm prefix match argv[1]
    const origArgv1 = process.argv[1];
    process.argv[1] = "/usr/local/lib/node_modules/.bin/agentbrew";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockExecFileSync.mockImplementation((cmd, args) => {
      const argsArr = args as string[];
      // npm view agentbrew version → newer version
      if (cmd === "npm" && argsArr?.includes("view")) return "99.0.0\n";
      // npm prefix -g → path that matches argv[1]
      if (cmd === "npm" && argsArr?.includes("prefix")) return "/usr/local/lib/node_modules\n";
      // npm install -g → upgrade succeeds
      if (cmd === "npm" && argsArr?.includes("install")) return "";
      return "";
    });

    checkForAutoUpgrade();

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Auto-upgraded"));
    spy.mockRestore();
    process.argv[1] = origArgv1;
  });

  it("prints manual upgrade hint when global install but upgrade fails", () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "/usr/local/lib/node_modules/.bin/agentbrew";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    let _callCount = 0;
    mockExecFileSync.mockImplementation((cmd, args) => {
      _callCount++;
      const argsArr = args as string[];
      if (cmd === "npm" && argsArr?.includes("view")) return "99.0.0\n";
      if (cmd === "npm" && argsArr?.includes("prefix")) return "/usr/local/lib/node_modules\n";
      // npm install -g → fails
      if (cmd === "npm" && argsArr?.includes("install")) throw new Error("permission denied");
      return "";
    });

    checkForAutoUpgrade();

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Update available"));
    spy.mockRestore();
    process.argv[1] = origArgv1;
  });

  it("prints npx-style hint when not a global install", () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "/some/local/path/agentbrew";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockExecFileSync.mockImplementation((cmd, args) => {
      const argsArr = args as string[];
      if (cmd === "npm" && argsArr?.includes("view")) return "99.0.0\n";
      // prefix doesn't match argv[1]
      if (cmd === "npm" && argsArr?.includes("prefix")) return "/usr/local/lib/node_modules\n";
      return "";
    });

    checkForAutoUpgrade();

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("npm i -g agentbrew"));
    spy.mockRestore();
    process.argv[1] = origArgv1;
  });

  it("handles corrupted cache file gracefully and still checks npm", () => {
    const cachePath = join(tmpDir, ".config", "agentbrew", "upgrade-check.json");
    writeFileSync(cachePath, "NOT VALID JSON {{{");

    mockExecFileSync.mockReturnValue("0.2.1\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    checkForAutoUpgrade();

    // readCache() caught the JSON parse error and returned undefined,
    // so fetchLatestVersionQuiet() was called via npm view
    expect(mockExecFileSync).toHaveBeenCalledWith("npm", ["view", "agentbrew", "version"], expect.anything());

    spy.mockRestore();
  });

  it("returns early when package.json is unreadable", () => {
    throwReadFileSyncForPackageJson.value = true;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    checkForAutoUpgrade();

    // getCurrentVersion() returns "0.0.0", so checkForAutoUpgrade returns early
    expect(mockExecFileSync).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
    throwReadFileSyncForPackageJson.value = false;
  });

  it("prints non-global hint when npm prefix -g throws", () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "/some/local/path/agentbrew";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockExecFileSync.mockImplementation((cmd, args) => {
      const argsArr = args as string[];
      if (cmd === "npm" && argsArr?.includes("view")) return "99.0.0\n";
      if (cmd === "npm" && argsArr?.includes("prefix")) {
        throw new Error("npm prefix -g failed");
      }
      return "";
    });

    checkForAutoUpgrade();

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("npm i -g agentbrew"));
    spy.mockRestore();
    process.argv[1] = origArgv1;
  });
});
