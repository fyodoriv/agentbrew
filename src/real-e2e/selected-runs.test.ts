import { describe, expect, it, vi } from "vitest";

import {
  buildSelectedRealE2ECommandArgs,
  parseSelectedRealE2EArgs,
  runSelectedRealE2EScenarios,
} from "./selected-runs.js";

describe("parseSelectedRealE2EArgs", () => {
  it("collects scenario paths and forwards trailing vitest arguments", () => {
    expect(
      parseSelectedRealE2EArgs([
        "real-e2e/scenarios/us04-share-rules.test.ts",
        "real-e2e/scenarios/us21-shell-hooks.test.ts",
        "--",
        "--reporter=dot",
      ]),
    ).toEqual({
      forwardedArgs: ["--reporter=dot"],
      help: false,
      scenarios: ["real-e2e/scenarios/us04-share-rules.test.ts", "real-e2e/scenarios/us21-shell-hooks.test.ts"],
    });
  });

  it("resolves surface aliases to their real e2e scenario paths", () => {
    expect(parseSelectedRealE2EArgs(["instructions", "rules", "agents", "hooks", "mcp"])).toEqual({
      forwardedArgs: [],
      help: false,
      scenarios: [
        "real-e2e/scenarios/us06-instructions-drift.test.ts",
        "real-e2e/scenarios/us04-us06-rules-drift.test.ts",
        "real-e2e/scenarios/us06-us20-agents-drift.test.ts",
        "real-e2e/scenarios/us06-us21-hooks-drift.test.ts",
        "real-e2e/scenarios/us03-us06-mcp-drift.test.ts",
      ],
    });
  });

  it("requires at least one scenario file", () => {
    expect(() => parseSelectedRealE2EArgs([])).toThrow("Provide at least one real e2e scenario file.");
  });

  it("rejects vitest flags before the separator", () => {
    expect(() => parseSelectedRealE2EArgs(["--reporter=dot"])).toThrow(
      'Pass Vitest flags after `--`; received option-like scenario argument "--reporter=dot".',
    );
  });
});

describe("buildSelectedRealE2ECommandArgs", () => {
  it("builds a vitest command for one selected scenario", () => {
    expect(buildSelectedRealE2ECommandArgs("real-e2e/scenarios/us04-share-rules.test.ts", ["--reporter=dot"])).toEqual([
      "vitest",
      "run",
      "--config",
      "vitest.real-e2e.config.ts",
      "real-e2e/scenarios/us04-share-rules.test.ts",
      "--reporter=dot",
    ]);
  });
});

describe("runSelectedRealE2EScenarios", () => {
  it("fails fast when a selected scenario path is malformed", () => {
    const output = { write: vi.fn() };
    const errorOutput = { write: vi.fn() };
    const runner = vi.fn();

    const exitCode = runSelectedRealE2EScenarios("/repo", {
      errorOutput,
      output,
      runner,
      scenarioExists: () => true,
      scenarios: ["us04-share-rules.test.ts"],
    });

    expect(exitCode).toBe(1);
    expect(runner).not.toHaveBeenCalled();
    expect(errorOutput.write).toHaveBeenCalledWith(
      'Selected real e2e scenario must match "real-e2e/scenarios/*.test.ts": "us04-share-rules.test.ts"\n',
    );
  });

  it("fails fast when a selected scenario path does not exist", () => {
    const output = { write: vi.fn() };
    const errorOutput = { write: vi.fn() };
    const runner = vi.fn();

    const exitCode = runSelectedRealE2EScenarios("/repo", {
      errorOutput,
      output,
      runner,
      scenarioExists: (scenario) => scenario.endsWith("us04-share-rules.test.ts"),
      scenarios: ["real-e2e/scenarios/us04-share-rules.test.ts", "real-e2e/scenarios/missing.test.ts"],
    });

    expect(exitCode).toBe(1);
    expect(runner).not.toHaveBeenCalled();
    expect(errorOutput.write).toHaveBeenCalledWith(
      'Selected real e2e scenario does not exist: "real-e2e/scenarios/missing.test.ts"\n',
    );
  });

  it("runs each selected scenario sequentially", () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const output = { write: vi.fn() };
    const errorOutput = { write: vi.fn() };

    const exitCode = runSelectedRealE2EScenarios("/repo", {
      errorOutput,
      output,
      runner: (command, args, cwd) => {
        calls.push({ args: [command, ...args], cwd });
        return { status: 0, stderr: "", stdout: `ok ${args[4]}\n` };
      },
      scenarioExists: () => true,
      scenarios: ["real-e2e/scenarios/us04-share-rules.test.ts", "real-e2e/scenarios/us21-shell-hooks.test.ts"],
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        args: [
          "npx",
          "vitest",
          "run",
          "--config",
          "vitest.real-e2e.config.ts",
          "real-e2e/scenarios/us04-share-rules.test.ts",
        ],
        cwd: "/repo",
      },
      {
        args: [
          "npx",
          "vitest",
          "run",
          "--config",
          "vitest.real-e2e.config.ts",
          "real-e2e/scenarios/us21-shell-hooks.test.ts",
        ],
        cwd: "/repo",
      },
    ]);
    expect(output.write).toHaveBeenCalledWith(
      "Running real e2e scenario 1/2: real-e2e/scenarios/us04-share-rules.test.ts\n",
    );
    expect(output.write).toHaveBeenCalledWith(
      "Running real e2e scenario 2/2: real-e2e/scenarios/us21-shell-hooks.test.ts\n",
    );
  });

  it("stops after the first failing scenario", () => {
    const calls: string[][] = [];

    const exitCode = runSelectedRealE2EScenarios("/repo", {
      errorOutput: { write: vi.fn() },
      output: { write: vi.fn() },
      runner: (command, args) => {
        calls.push([command, ...args]);
        return {
          status: args[4].includes("us04") ? 1 : 0,
          stderr: "",
          stdout: "",
        };
      },
      scenarioExists: () => true,
      scenarios: ["real-e2e/scenarios/us04-share-rules.test.ts", "real-e2e/scenarios/us21-shell-hooks.test.ts"],
    });

    expect(exitCode).toBe(1);
    expect(calls).toHaveLength(1);
  });
});
