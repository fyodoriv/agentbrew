/**
 * Tests for cron.ts — Linux/macOS cron-based auto-sync backend.
 * Covers isCronInstalled, installCron, and uninstallCron via mocked child_process and fs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
}));

vi.mock("../utils.js", () => ({
  expandHome: vi.fn((p: string) => p.replace("~", "/home/user")),
}));

vi.mock("./scheduler-paths.js", () => ({
  AUTO_SYNC_INTERVAL_MINUTES: 30,
  AUTO_SYNC_INTERVAL_SECONDS: 1800,
  getAgentBrewBin: () => "/home/user/.local/bin/agentbrew",
  getLogDir: () => "/tmp/agentbrew-test-logs",
}));

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { installCron, isCronInstalled, uninstallCron } from "./cron.js";

const mockExecFileSync = vi.mocked(execFileSync);
const mockSpawnSync = vi.mocked(spawnSync);
const mockMkdirSync = vi.mocked(mkdirSync);

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// ── isCronInstalled ───────────────────────────────────────────────────────────

describe("isCronInstalled", () => {
  it("returns true when the cron marker is present in the crontab", () => {
    mockExecFileSync.mockReturnValue(
      Buffer.from("*/30 * * * * /home/user/.local/bin/agentbrew fix # agentbrew auto-sync\n"),
    );
    expect(isCronInstalled()).toBe(true);
  });

  it("returns false when the cron marker is absent from the crontab", () => {
    mockExecFileSync.mockReturnValue(Buffer.from("*/5 * * * * /usr/bin/some-other-job\n"));
    expect(isCronInstalled()).toBe(false);
  });

  it("returns false when crontab -l fails (no crontab set)", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("no crontab for user");
    });
    expect(isCronInstalled()).toBe(false);
  });

  it("returns false for an empty crontab", () => {
    mockExecFileSync.mockReturnValue(Buffer.from(""));
    expect(isCronInstalled()).toBe(false);
  });
});

// ── installCron ───────────────────────────────────────────────────────────────

describe("installCron", () => {
  it("creates the log directory before writing the crontab", async () => {
    // No existing crontab — throws so readCrontab returns ""
    mockExecFileSync.mockImplementation(() => {
      throw new Error("no crontab for user");
    });
    await installCron();
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("logs"), { recursive: true });
  });

  it("installs the cron entry by piping to `crontab -`", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("no crontab for user");
    });
    await installCron();
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "crontab",
      ["-"],
      expect.objectContaining({ input: expect.stringContaining("agentbrew auto-sync") }),
    );
  });

  it("includes the agentbrew fix command in the new cron entry", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("no crontab for user");
    });
    await installCron();
    const call = mockSpawnSync.mock.calls[0];
    const input = (call?.[2] as { input?: string })?.input ?? "";
    expect(input).toContain("agentbrew");
    expect(input).toContain("fix");
  });

  it("skips installation when the marker is already in the crontab", async () => {
    mockExecFileSync.mockReturnValue(
      Buffer.from("*/30 * * * * /home/user/.local/bin/agentbrew fix # agentbrew auto-sync\n"),
    );
    await installCron();
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("appends the new entry without removing existing cron jobs", async () => {
    const existingJob = "*/5 * * * * /usr/bin/backup\n";
    mockExecFileSync.mockReturnValue(Buffer.from(existingJob));
    await installCron();
    const call = mockSpawnSync.mock.calls[0];
    const input = (call?.[2] as { input?: string })?.input ?? "";
    expect(input).toContain("backup");
    expect(input).toContain("agentbrew auto-sync");
  });

  it("logs success when spawnSync returns status 0", async () => {
    mockExecFileSync.mockReturnValue(Buffer.from(""));
    mockSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      status: 0,
      signal: null,
    });
    await installCron();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("cron job installed"));
  });

  it("logs failure when spawnSync returns non-zero status", async () => {
    mockExecFileSync.mockReturnValue(Buffer.from(""));
    mockSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: Buffer.from(""),
      stderr: Buffer.from("permission denied"),
      status: 1,
      signal: null,
    });
    await installCron();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to install cron job"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Add manually"));
  });

  it("logs failure with error message when spawnSync returns an error", async () => {
    mockExecFileSync.mockReturnValue(Buffer.from(""));
    mockSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      status: 1,
      signal: null,
      error: new Error("spawn failed"),
    });
    await installCron();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("spawn failed"));
  });

  it("logs 'unknown error' when spawnSync returns no stderr and no error", async () => {
    mockExecFileSync.mockReturnValue(Buffer.from(""));
    mockSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      status: 1,
      signal: null,
    });
    await installCron();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("unknown error"));
  });

  it("falls back to catch block when spawnSync throws", async () => {
    mockExecFileSync.mockReturnValue(Buffer.from(""));
    mockSpawnSync.mockImplementation(() => {
      throw new Error("unexpected");
    });
    await installCron();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to install cron job"));
  });
});

// ── uninstallCron ─────────────────────────────────────────────────────────────

describe("uninstallCron", () => {
  it("removes the agentbrew cron entry and rewrites the crontab", async () => {
    const crontabWithEntry =
      "*/5 * * * * /usr/bin/backup\n*/30 * * * * /home/user/.local/bin/agentbrew fix # agentbrew auto-sync\n";
    mockExecFileSync.mockReturnValue(Buffer.from(crontabWithEntry));
    mockSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      status: 0,
      signal: null,
    });
    await uninstallCron();
    const call = mockSpawnSync.mock.calls[0];
    const input = (call?.[2] as { input?: string })?.input ?? "";
    expect(input).not.toContain("agentbrew auto-sync");
    expect(input).toContain("backup");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("cron job uninstalled"));
  });

  it("logs failure when spawnSync returns non-zero status during uninstall", async () => {
    const crontabWithEntry = "*/30 * * * * /home/user/.local/bin/agentbrew fix # agentbrew auto-sync\n";
    mockExecFileSync.mockReturnValue(Buffer.from(crontabWithEntry));
    mockSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: Buffer.from(""),
      stderr: Buffer.from("crontab: error"),
      status: 1,
      signal: null,
    });
    await uninstallCron();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to update crontab"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("crontab -e"));
  });

  it("logs error.message when stderr is empty during uninstall failure", async () => {
    const crontabWithEntry = "*/30 * * * * /home/user/.local/bin/agentbrew fix # agentbrew auto-sync\n";
    mockExecFileSync.mockReturnValue(Buffer.from(crontabWithEntry));
    mockSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      status: 1,
      signal: null,
      error: new Error("spawn failed"),
    });
    await uninstallCron();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("spawn failed"));
  });

  it("logs 'unknown error' when stderr and error are both empty during uninstall", async () => {
    const crontabWithEntry = "*/30 * * * * /home/user/.local/bin/agentbrew fix # agentbrew auto-sync\n";
    mockExecFileSync.mockReturnValue(Buffer.from(crontabWithEntry));
    mockSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      status: 1,
      signal: null,
    });
    await uninstallCron();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("unknown error"));
  });

  it("falls back to catch block when spawnSync throws during uninstall", async () => {
    const crontabWithEntry = "*/30 * * * * /home/user/.local/bin/agentbrew fix # agentbrew auto-sync\n";
    mockExecFileSync.mockReturnValue(Buffer.from(crontabWithEntry));
    mockSpawnSync.mockImplementation(() => {
      throw new Error("unexpected");
    });
    await uninstallCron();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to update crontab"));
  });

  it("does not call spawnSync when the marker is absent", async () => {
    mockExecFileSync.mockReturnValue(Buffer.from("*/5 * * * * /usr/bin/backup\n"));
    await uninstallCron();
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("does not call spawnSync when there is no existing crontab", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("no crontab for user");
    });
    await uninstallCron();
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });
});
