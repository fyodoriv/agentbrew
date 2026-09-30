import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliError, cliMissingArg, cliNotFound } from "./cli-error.js";

describe("cli-error", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
    process.exitCode = undefined;
  });

  describe("cliError", () => {
    it("prints red error and sets exit code", () => {
      cliError("something broke");
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toContain("something broke");
      expect(process.exitCode).toBe(1);
    });

    it("prints hint lines in dim", () => {
      cliError("bad input", "Try `agentbrew help`", "Or `agentbrew status`");
      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(logSpy.mock.calls[0][0]).toContain("Try `agentbrew help`");
      expect(logSpy.mock.calls[1][0]).toContain("Or `agentbrew status`");
    });

    it("works with no hints", () => {
      cliError("bare error");
      expect(logSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe("cliMissingArg", () => {
    it("formats as 'ArgName is required.'", () => {
      cliMissingArg("Server name", "agentbrew setup <server>");
      expect(errorSpy.mock.calls[0][0]).toContain("Server name is required.");
      expect(logSpy.mock.calls[0][0]).toContain("agentbrew setup <server>");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("cliNotFound", () => {
    it("formats as \"'name' not found context.\"", () => {
      cliNotFound("foo", "in the registry", "Run `agentbrew search`.");
      expect(errorSpy.mock.calls[0][0]).toContain("'foo' not found in the registry.");
      expect(logSpy.mock.calls[0][0]).toContain("Run `agentbrew search`.");
      expect(process.exitCode).toBe(1);
    });
  });
});
