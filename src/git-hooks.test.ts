import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  chmodSync: vi.fn(),
}));

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { sync as writeFileSync } from "write-file-atomic";
import { installHook, removeHook } from "./git-hooks.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockUnlinkSync = vi.mocked(unlinkSync);
const mockChmodSync = vi.mocked(chmodSync);
const mockExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockExecFileSync.mockReturnValue("/fake/repo\n" as never);
});

describe("installHook", () => {
  it("logs error when not in a git repo", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    installHook();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Not inside"));
  });

  it("creates new hook file when none exists", () => {
    mockExistsSync.mockReturnValue(false);
    installHook();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("post-commit"),
      expect.stringContaining("agentbrew sync"),
    );
    expect(mockChmodSync).toHaveBeenCalledWith(expect.any(String), 0o755);
  });

  it("skips when hook already installed", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("#!/bin/sh\n# agentbrew-managed\nagentbrew sync --quiet &\n");
    installHook();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("already installed"));
  });

  it("appends to existing non-agentbrew hook", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("#!/bin/sh\necho 'existing'\n");
    installHook();
    expect(mockWriteFileSync).toHaveBeenCalled();
    const written = String(mockWriteFileSync.mock.calls[0][1]);
    expect(written).toContain("existing");
    expect(written).toContain("agentbrew sync");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Appended"));
  });
});

describe("removeHook", () => {
  it("logs message when no hook exists", () => {
    mockExistsSync.mockReturnValue(false);
    removeHook();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("No post-commit hook"));
  });

  it("refuses to remove non-agentbrew hook", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("#!/bin/sh\necho 'other'\n");
    removeHook();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("not managed"));
  });

  it("deletes hook file when entirely agentbrew-managed", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "#!/bin/sh\n# agentbrew-managed\n# Auto-sync agent config after commit\nagentbrew sync --quiet &\n",
    );
    removeHook();
    expect(mockUnlinkSync).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Removed post-commit"));
  });

  it("removes only agentbrew lines when other content exists", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("#!/bin/sh\necho 'keep this'\n# agentbrew-managed\nagentbrew sync --quiet &\n");
    removeHook();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalled();
    const written = String(mockWriteFileSync.mock.calls[0][1]);
    expect(written).toContain("keep this");
    expect(written).not.toContain("agentbrew sync");
  });
});
