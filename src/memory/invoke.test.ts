import { describe, expect, it, vi } from "vitest";

const spawnSync = vi.fn();

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => {
    throw new Error("not found");
  }),
  spawnSync: (...args: unknown[]) => spawnSync(...args),
}));

import { MEMORY_PYTHON_VERSION } from "./constants.js";
import { invokeMemory, invokeMemoryMaintenance } from "./invoke.js";

describe("invokeMemoryMaintenance", () => {
  it("falls back to check-db when maintain is unavailable", () => {
    spawnSync
      .mockReturnValueOnce({
        status: 2,
        stdout: "",
        stderr: "Error: No such command 'maintain'.",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "schema ok",
        stderr: "",
      });

    const result = invokeMemoryMaintenance({ uvxBin: "/opt/homebrew/bin/uvx" });
    expect(result.ok).toBe(true);
    expect(result.command).toBe("check-db");
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it("passes the resolved custom base-directory database to check-db", () => {
    spawnSync
      .mockReset()
      .mockReturnValueOnce({ status: 2, stdout: "", stderr: "Error: No such command 'maintain'." })
      .mockReturnValueOnce({ status: 0, stdout: "schema ok", stderr: "" });

    invokeMemoryMaintenance({ uvxBin: "/fixture/uvx", env: { MCP_MEMORY_BASE_DIR: "/tmp/synthetic-memory" } });

    const args = spawnSync.mock.calls[1]?.[1] as string[];
    expect(args.slice(-3)).toEqual(["check-db", "--db-path", "/tmp/synthetic-memory/sqlite_vec.db"]);
  });

  it("does not invoke check-db after successful maintenance", () => {
    spawnSync.mockReset().mockReturnValueOnce({ status: 0, stdout: "ok", stderr: "" });
    invokeMemoryMaintenance({ uvxBin: "/fixture/uvx" });
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });
});

describe("invokeMemory", () => {
  it("pins the Python that uvx runs the memory CLI on", () => {
    spawnSync.mockReset().mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });
    invokeMemory(["check-db"], { uvxBin: "/opt/homebrew/bin/uvx" });
    const args = spawnSync.mock.calls[0]?.[1] as string[];
    expect(args.slice(0, 2)).toEqual(["--python", MEMORY_PYTHON_VERSION]);
    expect(args.at(-1)).toBe("check-db");
  });
});
