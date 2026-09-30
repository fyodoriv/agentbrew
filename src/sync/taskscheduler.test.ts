import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
}));

vi.mock("./scheduler-paths.js", () => ({
  AUTO_SYNC_INTERVAL_MINUTES: 30,
  AUTO_SYNC_INTERVAL_SECONDS: 1800,
  getAgentBrewBin: () => "/home/user/.local/bin/agentbrew",
  getLogDir: () => "/tmp/agentbrew-test-logs",
}));

import { execFileSync } from "node:child_process";
import { installTaskScheduler, isTaskSchedulerInstalled, uninstallTaskScheduler } from "./taskscheduler.js";

const mockExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("isTaskSchedulerInstalled", () => {
  it("returns true when schtasks query succeeds", () => {
    mockExecFileSync.mockReturnValue(Buffer.from(""));
    expect(isTaskSchedulerInstalled()).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "schtasks.exe",
      expect.arrayContaining(["/Query"]),
      expect.objectContaining({ timeout: 10_000 }),
    );
  });

  it("returns false when schtasks query fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(isTaskSchedulerInstalled()).toBe(false);
  });
});

describe("installTaskScheduler", () => {
  it("skips if already installed", async () => {
    // First call = isTaskSchedulerInstalled (succeeds)
    mockExecFileSync.mockReturnValue(Buffer.from(""));
    await installTaskScheduler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("already installed"));
    // Should NOT call schtasks /Create
    expect(mockExecFileSync).toHaveBeenCalledTimes(1); // only the query
  });

  it("installs task when not already installed", async () => {
    // First call = isTaskSchedulerInstalled (fails), second = create (succeeds)
    mockExecFileSync
      .mockImplementationOnce(() => {
        throw new Error("not found");
      })
      .mockReturnValueOnce(Buffer.from(""));
    await installTaskScheduler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Task Scheduler task installed"));
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });

  it("shows error with manual command when create fails", async () => {
    // First call = isTaskSchedulerInstalled (fails), second = create (fails)
    mockExecFileSync.mockImplementation(() => {
      throw new Error("access denied");
    });
    await installTaskScheduler();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to install"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("schtasks /Create"));
  });
});

describe("uninstallTaskScheduler", () => {
  it("skips if not installed", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    await uninstallTaskScheduler();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not installed"));
  });

  it("uninstalls when installed", async () => {
    // First call = isTaskSchedulerInstalled (succeeds), second = delete (succeeds)
    mockExecFileSync.mockReturnValue(Buffer.from(""));
    await uninstallTaskScheduler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("uninstalled"));
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });

  it("shows error when delete fails", async () => {
    // First call = isTaskSchedulerInstalled (succeeds), second = delete (fails)
    mockExecFileSync.mockReturnValueOnce(Buffer.from("")).mockImplementationOnce(() => {
      throw new Error("access denied");
    });
    await uninstallTaskScheduler();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to remove"));
  });
});
