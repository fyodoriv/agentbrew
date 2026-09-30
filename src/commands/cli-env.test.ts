import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/env-sanitize.js", () => ({
  checkEnvHygiene: vi.fn().mockReturnValue([]),
  displayEnvCheck: vi.fn(),
  displaySanitizeCommands: vi.fn(),
}));

import { checkEnvHygiene, displayEnvCheck, displaySanitizeCommands } from "../core/env-sanitize.js";
import { registerEnvCommands } from "./cli-env.js";
import { buildTestProgram } from "./test-program.js";

const mockCheckEnvHygiene = vi.mocked(checkEnvHygiene);
const mockDisplayEnvCheck = vi.mocked(displayEnvCheck);
const mockDisplaySanitizeCommands = vi.mocked(displaySanitizeCommands);

const buildProgram = (): Command => buildTestProgram(registerEnvCommands);

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
});

describe("registerEnvCommands", () => {
  describe("env check subcommand", () => {
    it("calls checkEnvHygiene and displayEnvCheck", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "env", "check"]);
      expect(mockCheckEnvHygiene).toHaveBeenCalled();
      expect(mockDisplayEnvCheck).toHaveBeenCalledWith([]);
    });

    it("sets exitCode 1 when warnings exist", async () => {
      mockCheckEnvHygiene.mockReturnValue([{ variable: "ANTHROPIC_MODEL", value: "test" }]);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "env", "check"]);
      expect(process.exitCode).toBe(1);
    });

    it("does not set exitCode when no warnings", async () => {
      mockCheckEnvHygiene.mockReturnValue([]);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "env", "check"]);
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe("env sanitize subcommand", () => {
    it("calls displaySanitizeCommands", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "env", "sanitize"]);
      expect(mockDisplaySanitizeCommands).toHaveBeenCalled();
    });
  });
});
