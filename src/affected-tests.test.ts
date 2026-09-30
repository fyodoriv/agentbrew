import { describe, expect, it, vi } from "vitest";
import {
  buildVitestArgs,
  type CommandResult,
  collectAffectedFiles,
  parseArgs,
  resolveBaseRef,
  runAffectedTests,
  type SyncRunner,
} from "./affected-tests.js";

function ok(stdout = ""): CommandResult {
  return { status: 0, stdout, stderr: "" };
}

function fail(stderr = "command failed"): CommandResult {
  return { status: 1, stdout: "", stderr };
}

function createRunner(results: Record<string, CommandResult>): SyncRunner {
  return vi.fn((command, args) => results[`${command} ${args.join(" ")}`] ?? ok());
}

describe("resolveBaseRef", () => {
  it("prefers origin HEAD when available", () => {
    const runner = createRunner({
      "git symbolic-ref --quiet refs/remotes/origin/HEAD": ok("refs/remotes/origin/main\n"),
    });

    expect(resolveBaseRef("/repo", runner)).toBe("origin/main");
  });

  it("falls back to main when origin HEAD is unavailable", () => {
    const runner = createRunner({
      "git symbolic-ref --quiet refs/remotes/origin/HEAD": fail(),
      "git rev-parse --verify origin/main": fail(),
      "git rev-parse --verify main": ok("main\n"),
    });

    expect(resolveBaseRef("/repo", runner)).toBe("main");
  });
});

describe("collectAffectedFiles", () => {
  it("merges branch, staged, unstaged, and untracked changes", () => {
    const runner = createRunner({
      "git merge-base HEAD origin/main": ok("abc123\n"),
      "git diff --name-only abc123...HEAD": ok("src/foo.ts\nREADME.md\n"),
      "git diff --name-only --cached": ok("src/bar.ts\n"),
      "git diff --name-only": ok("src/foo.ts\nsrc/foo.test.ts\n"),
      "git ls-files --others --exclude-standard": ok("src/baz.ts\n"),
    });

    expect(collectAffectedFiles("/repo", { baseRef: "origin/main", runner })).toEqual([
      "README.md",
      "src/bar.ts",
      "src/baz.ts",
      "src/foo.test.ts",
      "src/foo.ts",
    ]);
  });
});

describe("buildVitestArgs", () => {
  it("runs the full suite when a global test trigger changes", () => {
    expect(buildVitestArgs(["package.json", "src/foo.ts"])).toEqual(["vitest", "run"]);
  });

  it("runs only related tests for testable changed files", () => {
    expect(buildVitestArgs(["README.md", "src/foo.ts", "src/foo.test.ts"])).toEqual([
      "vitest",
      "related",
      "--run",
      "src/foo.ts",
      "src/foo.test.ts",
    ]);
  });

  it("skips vitest when no testable files changed", () => {
    expect(buildVitestArgs(["README.md", "docs/COMPETITION.md"])).toBeNull();
  });
});

describe("parseArgs", () => {
  it("accepts explicit Vitest path targets", () => {
    expect(parseArgs(["src/agent-artifacts"])).toEqual({
      baseRef: undefined,
      help: false,
      paths: ["src/agent-artifacts"],
    });
  });
});

describe("runAffectedTests", () => {
  it("executes requested Vitest path targets without inspecting git state", () => {
    const output = { write: vi.fn() };
    const runner = createRunner({
      "npx vitest run src/agent-artifacts": ok("agent artifacts ok\n"),
    });

    expect(runAffectedTests("/repo", { paths: ["src/agent-artifacts"], runner, output, errorOutput: output })).toBe(0);
    expect(runner).toHaveBeenCalledWith("npx", ["vitest", "run", "src/agent-artifacts"], "/repo");
    expect(runner).not.toHaveBeenCalledWith("git", expect.any(Array), "/repo");
  });

  it("skips when only non-testable files changed", () => {
    const output = { write: vi.fn() };
    const runner = createRunner({
      "git symbolic-ref --quiet refs/remotes/origin/HEAD": ok("refs/remotes/origin/main\n"),
      "git merge-base HEAD origin/main": ok("abc123\n"),
      "git diff --name-only abc123...HEAD": ok("README.md\n"),
      "git diff --name-only --cached": ok(),
      "git diff --name-only": ok(),
      "git ls-files --others --exclude-standard": ok(),
    });

    expect(runAffectedTests("/repo", { runner, output, errorOutput: output })).toBe(0);
    expect(output.write).toHaveBeenCalledWith(expect.stringContaining("No affected testable files detected"));
  });

  it("executes vitest related for affected source files", () => {
    const output = { write: vi.fn() };
    const runner = createRunner({
      "git symbolic-ref --quiet refs/remotes/origin/HEAD": ok("refs/remotes/origin/main\n"),
      "git merge-base HEAD origin/main": ok("abc123\n"),
      "git diff --name-only abc123...HEAD": ok("src/foo.ts\n"),
      "git diff --name-only --cached": ok(),
      "git diff --name-only": ok(),
      "git ls-files --others --exclude-standard": ok(),
      "npx vitest related --run src/foo.ts": ok("related ok\n"),
    });

    expect(runAffectedTests("/repo", { runner, output, errorOutput: output })).toBe(0);
    expect(runner).toHaveBeenCalledWith("npx", ["vitest", "related", "--run", "src/foo.ts"], "/repo");
    expect(output.write).toHaveBeenCalledWith(expect.stringContaining("Running affected Vitest tests"));
  });
});
