import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../completions.js", () => ({
  generateCompletion: vi.fn().mockReturnValue("# completion script\n"),
  installCompletion: vi.fn(),
  uninstallCompletion: vi.fn(),
}));

import { generateCompletion, installCompletion, uninstallCompletion } from "../completions.js";
import { registerCompletionCommands } from "./cli-completions.js";
import { buildTestProgram } from "./test-program.js";

const mockGenerateCompletion = vi.mocked(generateCompletion);
const mockInstallCompletion = vi.mocked(installCompletion);
const mockUninstallCompletion = vi.mocked(uninstallCompletion);

const buildProgram = (): Command => buildTestProgram(registerCompletionCommands);

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateCompletion.mockReturnValue("# completion script\n");
});

describe("registerCompletionCommands", () => {
  describe("completions generate subcommand", () => {
    it("calls generateCompletion and writes to stdout with no shell arg", async () => {
      const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "completions", "generate"]);
      expect(mockGenerateCompletion).toHaveBeenCalledWith(program, undefined);
      expect(writeSpy).toHaveBeenCalledWith("# completion script\n");
      writeSpy.mockRestore();
    });

    it("passes shell argument to generateCompletion", async () => {
      const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "completions", "generate", "zsh"]);
      expect(mockGenerateCompletion).toHaveBeenCalledWith(program, "zsh");
      writeSpy.mockRestore();
    });

    it("passes bash shell argument to generateCompletion", async () => {
      const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "completions", "generate", "bash"]);
      expect(mockGenerateCompletion).toHaveBeenCalledWith(program, "bash");
      writeSpy.mockRestore();
    });
  });

  describe("completions install subcommand", () => {
    it("calls installCompletion with no shell arg", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "completions", "install"]);
      expect(mockInstallCompletion).toHaveBeenCalledWith(program, undefined);
    });

    it("passes shell argument to installCompletion", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "completions", "install", "fish"]);
      expect(mockInstallCompletion).toHaveBeenCalledWith(program, "fish");
    });
  });

  describe("completions uninstall subcommand", () => {
    it("calls uninstallCompletion with no shell arg", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "completions", "uninstall"]);
      expect(mockUninstallCompletion).toHaveBeenCalledWith(undefined);
    });

    it("passes shell argument to uninstallCompletion", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "completions", "uninstall", "zsh"]);
      expect(mockUninstallCompletion).toHaveBeenCalledWith("zsh");
    });
  });
});
