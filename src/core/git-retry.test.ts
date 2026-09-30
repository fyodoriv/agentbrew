import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { gitExec } from "./git-retry.js";

const mockExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AGENTBREW_GIT_TIMEOUT;
});

describe("gitExec", () => {
  it("executes a git command and returns output", () => {
    mockExecFileSync.mockReturnValue(Buffer.from("ok"));
    const result = gitExec(["status"]);
    expect(result.toString()).toBe("ok");
    expect(mockExecFileSync).toHaveBeenCalledWith("git", ["status"], expect.objectContaining({ timeout: 30_000 }));
  });

  it("retries on transient errors (timeout)", () => {
    const timeoutError = new Error("ETIMEDOUT");
    mockExecFileSync.mockImplementationOnce(() => {
      throw timeoutError;
    });
    mockExecFileSync.mockReturnValue(Buffer.from("ok"));

    const result = gitExec(["pull"], { maxRetries: 2 });
    expect(result.toString()).toBe("ok");
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });

  it("does not retry on auth errors", () => {
    const authError = new Error("Authentication failed for https://github.com/org/repo");
    mockExecFileSync.mockImplementation(() => {
      throw authError;
    });

    expect(() => gitExec(["clone", "url"], { maxRetries: 3 })).toThrow("Authentication failed");
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("does not retry on repo-not-found errors", () => {
    const notFoundError = new Error("Repository not found");
    mockExecFileSync.mockImplementation(() => {
      throw notFoundError;
    });

    expect(() => gitExec(["clone", "url"], { maxRetries: 3 })).toThrow("Repository not found");
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("does not retry on ENOENT (git binary not found)", () => {
    const enoentError = new Error("spawn git ENOENT");
    mockExecFileSync.mockImplementation(() => {
      throw enoentError;
    });

    expect(() => gitExec(["status"], { maxRetries: 3 })).toThrow("ENOENT");
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("gives up after max retries", () => {
    const networkError = new Error("ECONNREFUSED");
    mockExecFileSync.mockImplementation(() => {
      throw networkError;
    });

    expect(() => gitExec(["pull"], { maxRetries: 2 })).toThrow("ECONNREFUSED");
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });

  it("uses AGENTBREW_GIT_TIMEOUT env var (in seconds) for network operations", () => {
    process.env.AGENTBREW_GIT_TIMEOUT = "120";
    mockExecFileSync.mockReturnValue(Buffer.from("ok"));

    gitExec(["pull"], { timeout: 30_000, network: true });
    expect(mockExecFileSync).toHaveBeenCalledWith("git", ["pull"], expect.objectContaining({ timeout: 120_000 }));
  });

  it("ignores invalid AGENTBREW_GIT_TIMEOUT values", () => {
    process.env.AGENTBREW_GIT_TIMEOUT = "not-a-number";
    mockExecFileSync.mockReturnValue(Buffer.from("ok"));

    gitExec(["pull"], { timeout: 30_000 });
    expect(mockExecFileSync).toHaveBeenCalledWith("git", ["pull"], expect.objectContaining({ timeout: 30_000 }));
  });

  it("passes cwd and stdio options", () => {
    mockExecFileSync.mockReturnValue(Buffer.from("ok"));
    gitExec(["status"], { cwd: "/tmp", stdio: "inherit" });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["status"],
      expect.objectContaining({ cwd: "/tmp", stdio: "inherit" }),
    );
  });
});
