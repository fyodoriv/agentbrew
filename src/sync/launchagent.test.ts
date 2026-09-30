/**
 * Tests for launchagent.ts — macOS LaunchAgent management.
 * Covers query functions, cleanupLegacyAgents, installLaunchAgent, and uninstallLaunchAgent
 * via mocked child_process, fs, and write-file-atomic.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn<() => boolean>(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("../utils.js", () => ({
  expandHome: vi.fn((p: string) => p.replace("~", "/home/user")),
}));

vi.mock("./scheduler-paths.js", () => ({
  AUTO_SYNC_INTERVAL_MINUTES: 30,
  AUTO_SYNC_INTERVAL_SECONDS: 1800,
  buildLaunchAgentFixArgs: () => [
    "/home/user/.nvm/versions/node/v22.0.0/bin/node",
    "/home/user/apps/tooling/agentbrew/dist/cli.js",
    "fix",
  ],
  buildLaunchAgentPath: () =>
    "/home/user/.nvm/versions/node/v22.0.0/bin:/home/user/apps/tooling/dotfiles/bin:/home/user/.local/bin:/usr/bin:/bin",
  getLogDir: () => "/tmp/agentbrew-test-logs",
  LAUNCHAGENT_LANG: "C.UTF-8",
}));

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import {
  cleanupLegacyAgents,
  getLaunchAgentPlistPath,
  getLegacyPlistsOnDisk,
  installLaunchAgent,
  isLaunchAgentInstalled,
  uninstallLaunchAgent,
} from "./launchagent.js";

const mockExecFileSync = vi.mocked(execFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockUnlinkSync = vi.mocked(unlinkSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockWriteFileAtomicSync = vi.mocked(writeFileAtomicSync);

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// ── getLaunchAgentPlistPath ───────────────────────────────────────────────────

describe("getLaunchAgentPlistPath", () => {
  it("returns a path containing the plist label", () => {
    expect(getLaunchAgentPlistPath()).toContain("com.agentbrew.check");
  });

  it("returns a path ending with .plist", () => {
    expect(getLaunchAgentPlistPath().endsWith(".plist")).toBe(true);
  });

  it("returns a path inside LaunchAgents directory", () => {
    expect(getLaunchAgentPlistPath()).toContain("LaunchAgents");
  });
});

// ── isLaunchAgentInstalled ────────────────────────────────────────────────────

describe("isLaunchAgentInstalled", () => {
  it("returns true when the plist file exists", () => {
    mockExistsSync.mockReturnValue(true);
    expect(isLaunchAgentInstalled()).toBe(true);
  });

  it("returns false when the plist file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(isLaunchAgentInstalled()).toBe(false);
  });
});

// ── getLegacyPlistsOnDisk ─────────────────────────────────────────────────────

describe("getLegacyPlistsOnDisk", () => {
  it("returns empty array when no legacy plists exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(getLegacyPlistsOnDisk()).toEqual([]);
  });

  it("returns paths for legacy plists that exist on disk", () => {
    // Return true only for paths containing legacy names
    mockExistsSync.mockImplementation(
      (path) => String(path).includes("com.agentbrew.watch") || String(path).includes("com.agentbrew.drift"),
    );
    const result = getLegacyPlistsOnDisk();
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.endsWith(".plist"))).toBe(true);
  });

  it("only returns legacy plists, not the current plist", () => {
    mockExistsSync.mockImplementation((path) => String(path).includes("com.agentbrew.watch"));
    const result = getLegacyPlistsOnDisk();
    expect(result.every((p) => !p.includes("com.agentbrew.check.plist"))).toBe(true);
  });
});

// ── cleanupLegacyAgents ───────────────────────────────────────────────────────

describe("cleanupLegacyAgents", () => {
  it("returns 0 when no legacy plists exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(cleanupLegacyAgents()).toBe(0);
  });

  it("unloads and removes each legacy plist that exists", () => {
    mockExistsSync.mockReturnValue(true);
    cleanupLegacyAgents();
    expect(mockExecFileSync).toHaveBeenCalledWith("launchctl", expect.arrayContaining(["unload"]), expect.anything());
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it("returns the count of removed plists", () => {
    mockExistsSync.mockReturnValue(true);
    const removed = cleanupLegacyAgents();
    // Two legacy plist names (com.agentbrew.watch, com.agentbrew.drift)
    expect(removed).toBe(2);
  });

  it("continues removing remaining plists when launchctl unload throws", () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not loaded");
    });
    // Should not throw — errors are caught internally
    expect(() => cleanupLegacyAgents()).not.toThrow();
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it("returns 0 and does not call unlinkSync when plists are absent", () => {
    mockExistsSync.mockReturnValue(false);
    const removed = cleanupLegacyAgents();
    expect(removed).toBe(0);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });
});

// ── installLaunchAgent ────────────────────────────────────────────────────────

describe("installLaunchAgent", () => {
  it("creates the LaunchAgents directory before writing the plist", async () => {
    mockExistsSync.mockReturnValue(false);
    await installLaunchAgent();
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("LaunchAgents"), { recursive: true });
  });

  it("creates the log directory before writing the plist", async () => {
    // existsSync for legacy plists returns false; launchctl load may throw — that's ok
    mockExistsSync.mockReturnValue(false);
    await installLaunchAgent();
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("logs"), { recursive: true });
  });

  it("writes the plist file via writeFileAtomicSync", async () => {
    mockExistsSync.mockReturnValue(false);
    await installLaunchAgent();
    expect(mockWriteFileAtomicSync).toHaveBeenCalledWith(
      expect.stringContaining("com.agentbrew.check"),
      expect.stringContaining("agentbrew"),
      "utf-8",
    );
  });

  it("plist content contains explicit node + cli.js ProgramArguments (no shebang)", async () => {
    mockExistsSync.mockReturnValue(false);
    await installLaunchAgent();
    const content = mockWriteFileAtomicSync.mock.calls[0]?.[1] as string;
    expect(content).toContain("<string>/home/user/.nvm/versions/node/v22.0.0/bin/node</string>");
    expect(content).toContain("<string>/home/user/apps/tooling/agentbrew/dist/cli.js</string>");
    expect(content).toContain("<string>fix</string>");
    expect(content).not.toMatch(/<string>\/home\/user\/\.local\/bin\/agentbrew<\/string>/);
  });

  it("plist content contains the agentbrew fix ProgramArguments", async () => {
    mockExistsSync.mockReturnValue(false);
    await installLaunchAgent();
    const content = mockWriteFileAtomicSync.mock.calls[0]?.[1] as string;
    expect(content).toContain("<string>fix</string>");
    expect(content).toContain("StartInterval");
    expect(content).toContain("1800");
  });

  it("plist sets WorkingDirectory away from filesystem root", async () => {
    mockExistsSync.mockReturnValue(false);
    await installLaunchAgent();
    const content = mockWriteFileAtomicSync.mock.calls[0]?.[1] as string;
    expect(content).toContain("<key>WorkingDirectory</key>");
    expect(content).toContain("<string>/tmp/agentbrew-test-logs</string>");
    expect(content).not.toMatch(/<key>WorkingDirectory<\/key>\s*<string>\/<\/string>/);
  });

  it("plist PATH includes node bin and dotfiles bin before /usr/bin", async () => {
    mockExistsSync.mockReturnValue(false);
    await installLaunchAgent();
    const content = mockWriteFileAtomicSync.mock.calls[0]?.[1] as string;
    expect(content).toContain("/home/user/.nvm/versions/node/v22.0.0/bin:");
    expect(content).toContain("/home/user/apps/tooling/dotfiles/bin");
    expect(content).toContain("/usr/bin");
  });

  it("plist sets LANG so launchd jobs run with a locale", async () => {
    mockExistsSync.mockReturnValue(false);
    await installLaunchAgent();
    const content = mockWriteFileAtomicSync.mock.calls[0]?.[1] as string;
    expect(content).toContain("<key>LANG</key>\n        <string>C.UTF-8</string>");
  });

  it("attempts to reload the launchctl service after writing the plist", async () => {
    mockExistsSync.mockReturnValue(false);
    await installLaunchAgent();
    expect(mockExecFileSync).toHaveBeenCalledWith("launchctl", expect.arrayContaining(["load"]), expect.anything());
  });

  it("reports loaded only after launchctl print finds the job", async () => {
    mockExistsSync.mockReturnValue(false);
    await installLaunchAgent();
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "launchctl",
      ["print", expect.stringMatching(/^gui\/\d+\/com\.agentbrew\.check$/u)],
      expect.anything(),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("installed and loaded"));
  });

  it("does not claim loaded when launchd has the job disabled", async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(((_cmd: string, args: string[]) => {
      if (args[0] === "print") throw new Error('Could not find service "com.agentbrew.check"');
      if (args[0] === "print-disabled") return '\t\t"com.agentbrew.check" => disabled\n';
      return "";
    }) as unknown as typeof execFileSync);

    await installLaunchAgent();

    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("installed and loaded"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("disabled, so it will not run"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("launchctl enable gui/"));
  });

  it("reports a load failure when launchctl print cannot find a job that is not disabled", async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(((_cmd: string, args: string[]) => {
      if (args[0] === "print") throw new Error('Could not find service "com.agentbrew.check"');
      return "";
    }) as unknown as typeof execFileSync);

    await installLaunchAgent();

    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("installed and loaded"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("could not be loaded"));
  });

  it("does not throw when launchctl load fails (best-effort load)", async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("launchctl: no such file");
    });
    await expect(installLaunchAgent()).resolves.toBeUndefined();
  });
});

// ── uninstallLaunchAgent ──────────────────────────────────────────────────────

describe("uninstallLaunchAgent", () => {
  it("unloads and removes the plist when it exists", async () => {
    mockExistsSync.mockReturnValue(true);
    await uninstallLaunchAgent();
    expect(mockExecFileSync).toHaveBeenCalledWith("launchctl", expect.arrayContaining(["unload"]), expect.anything());
    expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining("com.agentbrew.check"));
  });

  it("does nothing when the plist is not present", async () => {
    mockExistsSync.mockReturnValue(false);
    await uninstallLaunchAgent();
    expect(mockExecFileSync).not.toHaveBeenCalled();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it("still removes the plist when launchctl unload throws", async () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not loaded");
    });
    await uninstallLaunchAgent();
    expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining("com.agentbrew.check"));
  });
});
