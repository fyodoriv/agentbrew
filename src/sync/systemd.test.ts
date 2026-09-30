/**
 * Tests for systemd.ts — Linux systemd user-timer backend.
 * Covers hasSystemctl, isSystemdTimerInstalled, installSystemdTimer, and uninstallSystemdTimer
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
  getAgentBrewBin: () => "/home/user/.local/bin/agentbrew",
  getLogDir: () => "/tmp/agentbrew-test-logs",
  getNodeBinDir: () => "/home/user/.nvm/versions/node/v22.0.0/bin",
}));

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { hasSystemctl, installSystemdTimer, isSystemdTimerInstalled, uninstallSystemdTimer } from "./systemd.js";

const mockExecFileSync = vi.mocked(execFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockUnlinkSync = vi.mocked(unlinkSync);
const mockWriteFileAtomicSync = vi.mocked(writeFileAtomicSync);

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// ── hasSystemctl ──────────────────────────────────────────────────────────────

describe("hasSystemctl", () => {
  it("returns true when `which systemctl` succeeds", () => {
    mockExecFileSync.mockReturnValue(Buffer.from("/usr/bin/systemctl\n"));
    expect(hasSystemctl()).toBe(true);
  });

  it("returns false when `which systemctl` throws (not found)", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(hasSystemctl()).toBe(false);
  });
});

// ── isSystemdTimerInstalled ───────────────────────────────────────────────────

describe("isSystemdTimerInstalled", () => {
  it("returns true when the timer unit file exists", () => {
    mockExistsSync.mockReturnValue(true);
    expect(isSystemdTimerInstalled()).toBe(true);
  });

  it("returns false when the timer unit file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(isSystemdTimerInstalled()).toBe(false);
  });

  it("checks for the agentbrew-check.timer file specifically", () => {
    mockExistsSync.mockImplementation((path) => String(path).includes("agentbrew-check.timer"));
    expect(isSystemdTimerInstalled()).toBe(true);
  });
});

// ── installSystemdTimer ───────────────────────────────────────────────────────

describe("installSystemdTimer", () => {
  it("creates the systemd user directory and log directory", async () => {
    await installSystemdTimer();
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("systemd"), { recursive: true });
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("logs"), { recursive: true });
  });

  it("writes both the service unit and timer unit files", async () => {
    await installSystemdTimer();
    const paths = mockWriteFileAtomicSync.mock.calls.map((call) => call[0] as string);
    expect(paths.some((p) => p.includes("agentbrew-check.service"))).toBe(true);
    expect(paths.some((p) => p.includes("agentbrew-check.timer"))).toBe(true);
  });

  it("service unit content contains the agentbrew fix ExecStart", async () => {
    await installSystemdTimer();
    const serviceCall = mockWriteFileAtomicSync.mock.calls.find((call) => (call[0] as string).includes(".service"));
    const content = serviceCall?.[1] as string;
    expect(content).toContain("ExecStart=");
    expect(content).toContain("fix");
  });

  it("service unit PATH includes the Node binary directory for NVM/mise/asdf compatibility", async () => {
    await installSystemdTimer();
    const serviceCall = mockWriteFileAtomicSync.mock.calls.find((call) => (call[0] as string).includes(".service"));
    const content = serviceCall?.[1] as string;
    expect(content).toContain("/home/user/.nvm/versions/node/v22.0.0/bin:");
  });

  it("timer unit content specifies the 30-minute activation interval", async () => {
    await installSystemdTimer();
    const timerCall = mockWriteFileAtomicSync.mock.calls.find((call) => (call[0] as string).includes(".timer"));
    const content = timerCall?.[1] as string;
    expect(content).toContain("OnUnitActiveSec=30min");
    expect(content).toContain("Persistent=true");
  });

  it("runs systemctl daemon-reload and enable after writing units", async () => {
    await installSystemdTimer();
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "systemctl",
      expect.arrayContaining(["--user", "daemon-reload"]),
      expect.anything(),
    );
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "systemctl",
      expect.arrayContaining(["--user", "enable", "--now", "agentbrew-check.timer"]),
      expect.anything(),
    );
  });

  it("does not throw when systemctl enable fails (best-effort enable)", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("systemctl: not found");
    });
    await expect(installSystemdTimer()).resolves.toBeUndefined();
  });
});

// ── uninstallSystemdTimer ─────────────────────────────────────────────────────

describe("uninstallSystemdTimer", () => {
  it("disables the timer and removes both unit files when they exist", async () => {
    mockExistsSync.mockReturnValue(true);
    await uninstallSystemdTimer();
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "systemctl",
      expect.arrayContaining(["--user", "disable", "--now", "agentbrew-check.timer"]),
      expect.anything(),
    );
    expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining("agentbrew-check.timer"));
    expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining("agentbrew-check.service"));
  });

  it("does nothing when neither unit file exists", async () => {
    mockExistsSync.mockReturnValue(false);
    await uninstallSystemdTimer();
    expect(mockExecFileSync).not.toHaveBeenCalled();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it("still removes files when systemctl disable throws", async () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("not active");
    });
    await uninstallSystemdTimer();
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it("runs daemon-reload after removing units", async () => {
    mockExistsSync.mockReturnValue(true);
    await uninstallSystemdTimer();
    const daemonReloadCall = mockExecFileSync.mock.calls.find((call) =>
      (call[1] as string[])?.includes("daemon-reload"),
    );
    expect(daemonReloadCall).toBeDefined();
  });
});
