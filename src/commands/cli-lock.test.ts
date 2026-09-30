import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lock.js", () => ({
  showLock: vi.fn(),
  showVerify: vi.fn(),
}));

vi.mock("../state.js", () => ({
  requireState: vi.fn(),
}));

import { showLock, showVerify } from "../lock.js";
import { requireState } from "../state.js";
import { registerLockCommands } from "./cli-lock.js";
import { buildTestProgram } from "./test-program.js";

const mockShowLock = vi.mocked(showLock);
const mockShowVerify = vi.mocked(showVerify);
const mockRequireState = vi.mocked(requireState);

const buildProgram = (): Command => buildTestProgram(registerLockCommands);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerLockCommands", () => {
  describe("lock command — no flags", () => {
    it("calls showLock when no --verify flag", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "lock"]);
      expect(mockShowLock).toHaveBeenCalledOnce();
    });

    it("does not call requireState or showVerify without --verify", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "lock"]);
      expect(mockRequireState).not.toHaveBeenCalled();
      expect(mockShowVerify).not.toHaveBeenCalled();
    });
  });

  describe("lock command — --verify flag", () => {
    it("calls requireState when --verify is passed", async () => {
      mockRequireState.mockReturnValue(undefined);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "lock", "--verify"]);
      expect(mockRequireState).toHaveBeenCalledOnce();
    });

    it("calls showVerify with state.sources when state is present", async () => {
      const fakeSources = [{ name: "my-source", url: "https://example.com" }];
      mockRequireState.mockReturnValue({ sources: fakeSources } as unknown as ReturnType<typeof requireState>);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "lock", "--verify"]);
      expect(mockShowVerify).toHaveBeenCalledWith(fakeSources);
    });

    it("does not call showVerify when requireState returns undefined", async () => {
      mockRequireState.mockReturnValue(undefined);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "lock", "--verify"]);
      expect(mockShowVerify).not.toHaveBeenCalled();
    });

    it("does not call showLock when --verify is passed", async () => {
      mockRequireState.mockReturnValue(undefined);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "lock", "--verify"]);
      expect(mockShowLock).not.toHaveBeenCalled();
    });
  });
});
