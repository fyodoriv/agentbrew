import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../health.js", () => ({
  fix: vi.fn(),
}));

vi.mock("../lint.js", () => ({
  lint: vi.fn().mockReturnValue(true),
}));

vi.mock("../measure/context-budget.js", () => ({
  measureContextBudget: vi.fn().mockReturnValue({ snapshot: {}, writtenPaths: [], exitCode: 0 }),
}));

import { fix } from "../health.js";
import { lint } from "../lint.js";
import { measureContextBudget } from "../measure/context-budget.js";
import { registerOpsCommands } from "./cli-ops.js";
import { buildTestProgram } from "./test-program.js";

const mockFix = vi.mocked(fix);
const mockLint = vi.mocked(lint);
const mockMeasureContextBudget = vi.mocked(measureContextBudget);

const buildProgram = (): Command => buildTestProgram(registerOpsCommands);

beforeEach(() => {
  vi.clearAllMocks();
  mockLint.mockReturnValue(true);
});

describe("registerOpsCommands", () => {
  describe("fix command", () => {
    it("calls fix() when invoked", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "fix"]);
      expect(mockFix).toHaveBeenCalledOnce();
    });
  });

  describe("lint command", () => {
    it("does not set exitCode when lint passes", async () => {
      process.exitCode = undefined;
      const program = buildProgram();
      await program.parseAsync(["node", "test", "lint"]);
      expect(mockLint).toHaveBeenCalledOnce();
      expect(process.exitCode).toBeUndefined();
    });

    it("sets exitCode to 1 when lint fails", async () => {
      process.exitCode = undefined;
      mockLint.mockReturnValueOnce(false);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "lint"]);
      expect(mockLint).toHaveBeenCalledOnce();
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    });
  });

  describe("measure context command", () => {
    it("calls measureContextBudget and respects exit code", async () => {
      process.exitCode = undefined;
      mockMeasureContextBudget.mockReturnValueOnce({
        snapshot: {} as never,
        writtenPaths: ["/tmp/latest.json"],
        exitCode: 1,
      });
      const program = buildProgram();
      await program.parseAsync(["node", "test", "measure", "context"]);
      expect(mockMeasureContextBudget).toHaveBeenCalledWith({
        json: undefined,
        dryRun: undefined,
        skipCcusage: undefined,
        quiet: undefined,
        ifStaleMs: undefined,
      });
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    });

    it("passes --quick and --if-stale to measureContextBudget", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "measure", "context", "--quick", "--if-stale", "6h"]);
      expect(mockMeasureContextBudget).toHaveBeenCalledWith({
        json: undefined,
        dryRun: undefined,
        skipCcusage: true,
        quiet: true,
        ifStaleMs: 6 * 60 * 60 * 1000,
      });
    });
  });

  describe("deprecated aliases removed", () => {
    it("`log` is not a valid command", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "log"])).rejects.toThrow();
    });

    it("`doctor` is not a valid command", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "doctor"])).rejects.toThrow();
    });

    it("`check` is not a valid command", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "check"])).rejects.toThrow();
    });

    it("`rollback` is not a valid command", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "rollback"])).rejects.toThrow();
    });

    it("`clean` is not a valid command", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "clean", "my-skill"])).rejects.toThrow();
    });
  });
});
