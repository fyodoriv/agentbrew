import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  rmSync: vi.fn(),
}));

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { rollbackAgentConfigs, snapshotAgentConfigs } from "./ops.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockCopyFileSync = vi.mocked(copyFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockRmSync = vi.mocked(rmSync);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("snapshotAgentConfigs", () => {
  it("returns undefined when no config paths collected", () => {
    mockExistsSync.mockReturnValue(false);

    const result = snapshotAgentConfigs();

    expect(result).toBeUndefined();
  });

  it("creates snapshot dir and copies files", () => {
    mockExistsSync.mockImplementation((p) => String(p).includes("mcp.json"));
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

    const result = snapshotAgentConfigs();

    expect(result).toBeTypeOf("string");
    expect(result).toContain("config-snapshot-");
    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockCopyFileSync).toHaveBeenCalled();
  });

  it("returns undefined and cleans up when no files could be copied", () => {
    mockExistsSync.mockImplementation((p) => String(p).includes("mcp.json"));
    mockCopyFileSync.mockImplementation(() => {
      throw new Error("permission denied");
    });
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

    const result = snapshotAgentConfigs();

    expect(result).toBeUndefined();
    expect(mockRmSync).toHaveBeenCalled();
  });

  it("prunes old snapshots exceeding retention limit", () => {
    mockExistsSync.mockImplementation((p) => String(p).includes("mcp.json"));
    mockCopyFileSync.mockImplementation(() => {});
    const snapshots = Array.from({ length: 12 }, (_, i) => `config-snapshot-2026-01-${String(i + 1).padStart(2, "0")}`);
    mockReaddirSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("backups")) return snapshots as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    const result = snapshotAgentConfigs();

    expect(result).toBeTypeOf("string");
    expect(mockRmSync).toHaveBeenCalledTimes(2);
  });
});

describe("rollbackAgentConfigs", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("warns when no backup dir", async () => {
    mockExistsSync.mockReturnValue(false);

    await rollbackAgentConfigs();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("No config snapshots"));
  });

  it("warns when no snapshots found", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

    await rollbackAgentConfigs();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("No config snapshots"));
  });

  it("restores files from latest snapshot", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("config-snapshot")) {
        return [".cursor__mcp.json", ".claude__CLAUDE.md"] as unknown as ReturnType<typeof readdirSync>;
      }
      return ["config-snapshot-2026-01-01", "config-snapshot-2026-01-02"] as unknown as ReturnType<typeof readdirSync>;
    });

    await rollbackAgentConfigs();

    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockCopyFileSync).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Restored"));
  });

  it("warns on individual file restore failure", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("config-snapshot")) {
        return [".cursor__mcp.json"] as unknown as ReturnType<typeof readdirSync>;
      }
      return ["config-snapshot-2026-01-01"] as unknown as ReturnType<typeof readdirSync>;
    });
    mockCopyFileSync.mockImplementation(() => {
      throw new Error("permission denied");
    });

    await rollbackAgentConfigs();

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to restore"));
  });
});
