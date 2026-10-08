import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockWriteFileAtomicSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

vi.mock("write-file-atomic", () => ({
  sync: (...args: unknown[]) => mockWriteFileAtomicSync(...args),
}));

vi.mock("./utils.js", () => ({
  expandHome: vi.fn((p: string) => p.replace("~", "/mock-home")),
}));

import type { RepairAction, RepairLog } from "./repair-log.js";
import { clearRepairLog, getRepairSummary, loadRepairLog, saveRepairLog, touchLastSeen } from "./repair-log.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadRepairLog", () => {
  it("returns undefined when log file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadRepairLog()).toBeUndefined();
  });

  it("parses and returns the repair log when file exists", () => {
    const log: RepairLog = {
      repairedAt: "2026-01-01T00:00:00.000Z",
      actions: [{ type: "symlink", agent: "claude", detail: "fixed skill link" }],
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(log));
    expect(loadRepairLog()).toEqual(log);
  });

  it("returns undefined when file contains invalid JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not json");
    expect(loadRepairLog()).toBeUndefined();
  });

  it("returns undefined when readFileSync throws", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(loadRepairLog()).toBeUndefined();
  });
});

describe("saveRepairLog", () => {
  it("does nothing when actions array is empty", () => {
    saveRepairLog([]);
    expect(mockWriteFileAtomicSync).not.toHaveBeenCalled();
  });

  it("writes actions to the log file", () => {
    mockExistsSync.mockReturnValue(false);
    const actions: RepairAction[] = [{ type: "symlink", agent: "cursor", detail: "recreated" }];
    saveRepairLog(actions);
    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockWriteFileAtomicSync).toHaveBeenCalledOnce();
    const written = JSON.parse(mockWriteFileAtomicSync.mock.calls[0][1]);
    expect(written.actions).toHaveLength(1);
    expect(written.actions[0].type).toBe("symlink");
    expect(written.repairedAt).toBeDefined();
  });

  it("appends to existing log entries", () => {
    const existing: RepairLog = {
      repairedAt: "2026-01-01T00:00:00.000Z",
      actions: [{ type: "mcp", agent: "kiro", detail: "added server" }],
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));

    const newActions: RepairAction[] = [{ type: "symlink", agent: "cursor", detail: "fixed" }];
    saveRepairLog(newActions);

    const written = JSON.parse(mockWriteFileAtomicSync.mock.calls[0][1]);
    expect(written.actions).toHaveLength(2);
    expect(written.actions[0].type).toBe("mcp");
    expect(written.actions[1].type).toBe("symlink");
  });

  it("does not throw when write fails", () => {
    mockWriteFileAtomicSync.mockImplementation(() => {
      throw new Error("disk full");
    });
    expect(() => saveRepairLog([{ type: "symlink", agent: "test", detail: "test" }])).not.toThrow();
  });
});

describe("clearRepairLog", () => {
  it("writes an empty actions array", () => {
    clearRepairLog();
    expect(mockWriteFileAtomicSync).toHaveBeenCalledOnce();
    const written = JSON.parse(mockWriteFileAtomicSync.mock.calls[0][1]);
    expect(written.actions).toEqual([]);
    expect(written.repairedAt).toBeDefined();
  });

  it("does not throw when write fails", () => {
    mockWriteFileAtomicSync.mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(() => clearRepairLog()).not.toThrow();
  });
});

describe("touchLastSeen", () => {
  it("writes a seenAt timestamp", () => {
    touchLastSeen();
    expect(mockWriteFileAtomicSync).toHaveBeenCalledOnce();
    const written = JSON.parse(mockWriteFileAtomicSync.mock.calls[0][1]);
    expect(written.seenAt).toBeDefined();
  });

  it("does not throw when write fails", () => {
    mockWriteFileAtomicSync.mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(() => touchLastSeen()).not.toThrow();
  });
});

describe("getRepairSummary", () => {
  it("returns undefined when no log exists", () => {
    mockExistsSync.mockReturnValue(false);
    expect(getRepairSummary()).toBeUndefined();
  });

  it("returns undefined when log has empty actions", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ repairedAt: "2026-01-01", actions: [] }));
    expect(getRepairSummary()).toBeUndefined();
  });

  it("groups actions by type and returns summary string", () => {
    const log: RepairLog = {
      repairedAt: "2026-01-01T00:00:00.000Z",
      actions: [
        { type: "symlink", agent: "claude", detail: "a" },
        { type: "symlink", agent: "cursor", detail: "b" },
        { type: "mcp", agent: "kiro", detail: "c" },
      ],
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(log));

    const summary = getRepairSummary();
    expect(summary).toContain("2 symlink");
    expect(summary).toContain("1 mcp");
    expect(summary).toContain("Auto-repaired since last run:");
  });

  it("handles single action type", () => {
    const log: RepairLog = {
      repairedAt: "2026-01-01T00:00:00.000Z",
      actions: [{ type: "permissions", agent: "cursor", detail: "fixed" }],
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(log));
    expect(getRepairSummary()).toBe("Auto-repaired since last run: 1 permissions");
  });
});
