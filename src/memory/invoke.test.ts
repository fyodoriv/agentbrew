import { describe, expect, it, vi } from "vitest";

const spawnSync = vi.fn();

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => {
    throw new Error("not found");
  }),
  spawnSync: (...args: unknown[]) => spawnSync(...args),
}));

import { invokeMemoryMaintenance } from "./invoke.js";

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
});
