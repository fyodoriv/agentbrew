/** silentLintCounts: the agentbrew lint counts without any output (measure-quiet-lint-counts). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { lintCounts, silentLintCounts } from "./lint.js";

describe("silentLintCounts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the same counts as lintCounts and prints nothing", () => {
    const loud = lintCounts();
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");

    const quiet = silentLintCounts();

    expect(quiet).toEqual(loud);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("restores console output after it returns", () => {
    const before = console.log;
    silentLintCounts();
    expect(console.log).toBe(before);
  });
});
