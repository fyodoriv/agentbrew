import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadState } from "../state.js";
import { runCalibrationPair } from "./calibration.js";
import { loadCalibrationCases } from "./calibration-cases.js";
import { registerJudgeCommand } from "./judge-command.js";
import { type LoadedJudge, loadJudgeDefinitions } from "./load.js";

import { reserveJudgeRound } from "./review-rounds.js";
import { runJudge } from "./runner.js";

vi.mock("./review-rounds.js", () => ({ reserveJudgeRound: vi.fn() }));
vi.mock("./runner.js", () => ({ runJudge: vi.fn() }));
vi.mock("../state.js", () => ({ loadState: vi.fn() }));
vi.mock("./calibration-cases.js", () => ({ loadCalibrationCases: vi.fn() }));
vi.mock("./calibration.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./calibration.js")>()),
  runCalibrationPair: vi.fn(),
}));
vi.mock("./load.js", () => ({ loadJudgeDefinitions: vi.fn() }));

const judge: LoadedJudge = {
  owner: process.cwd(),
  path: "judges/clarity.md",
  sha256: "a".repeat(64),
  definition: {
    name: "clarity",
    on: ["pr-create"],
    sees: "artifact",
    rubric: [{ id: "clear", check: "Is it clear?" }],
    passBar: 1,
    model: "fixture:model",
    maxRounds: 1,
    calibration: {
      cases: ["golden/clarity.md", "golden/second.md"],
      minTruePositiveRate: 1,
      minTrueNegativeRate: 1,
    },
    instructions: "",
  },
};
const pair = [
  { id: "clear", expected: "PASS", artifact: "Done." },
  { id: "opaque", expected: "FAIL", artifact: "Existence of completion." },
] as const;
const rates = { truePositiveRate: 1, trueNegativeRate: 1 };

async function invoke(name?: string) {
  const program = new Command().exitOverride();
  registerJudgeCommand(program);
  await program.parseAsync(["judge", "eval", ...(name ? [name] : [])], { from: "user" });
}

describe("judge eval command", () => {
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.resetAllMocks();
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(loadState).mockReturnValue({
      agents: [],
      catalogVersion: "fixture",
      agentfileJudges: { [judge.owner]: [judge] },
    });
    vi.mocked(loadJudgeDefinitions).mockReturnValue([judge]);
    vi.mocked(loadCalibrationCases).mockReturnValue([pair, pair]);
    vi.mocked(runCalibrationPair).mockResolvedValue({
      forward: rates,
      reverse: rates,
      orderDisagreements: 0,
      pass: true,
    });
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  });

  it("reloads the selected declaration and grades each pair", async () => {
    await invoke("clarity");
    expect(loadJudgeDefinitions).toHaveBeenCalledWith(
      {
        judgeSources: [{ owner: judge.owner, paths: [judge.path] }],
      },
      process.cwd(),
    );
    expect(runCalibrationPair).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBeUndefined();
  });

  it("reports weak calibration and exits nonzero", async () => {
    vi.mocked(runCalibrationPair).mockResolvedValueOnce({
      forward: rates,
      reverse: { ...rates, trueNegativeRate: 0 },
      orderDisagreements: 1,
      pass: false,
    });
    await invoke();
    expect(process.exitCode).toBe(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"trueNegativeRate":0.5'));
  });

  it("applies the threshold to all pairs instead of failing a single weak pair", async () => {
    const calibration = { ...judge.definition.calibration, minTrueNegativeRate: 0.5 };
    vi.mocked(loadJudgeDefinitions).mockReturnValue([{ ...judge, definition: { ...judge.definition, calibration } }]);
    vi.mocked(runCalibrationPair).mockResolvedValueOnce({
      forward: rates,
      reverse: { ...rates, trueNegativeRate: 0 },
      orderDisagreements: 1,
      pass: false,
    });
    await invoke();
    expect(process.exitCode).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"trueNegativeRate":0.5'));
  });

  it("refuses a bad fixture before dispatch", async () => {
    vi.mocked(loadCalibrationCases).mockImplementation(() => {
      throw new Error("Fixture refused");
    });
    await expect(invoke()).rejects.toThrow("Fixture refused");
    expect(runCalibrationPair).not.toHaveBeenCalled();
  });
});

describe("judge run command", () => {
  let root: string;
  let artifact: string;
  const bytes = Buffer.from("Exact draft.\r\n");

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    root = mkdtempSync(join(tmpdir(), "agentbrew-judge-cli-"));
    artifact = join(root, "artifact");
    writeFileSync(artifact, bytes);
    vi.mocked(loadState).mockReturnValue({
      agents: [],
      catalogVersion: "fixture",
      agentfileJudges: { [judge.owner]: [judge] },
    });
    vi.mocked(loadJudgeDefinitions).mockReturnValue([judge]);
    vi.mocked(runJudge).mockResolvedValue({
      version: 1,
      key: "a".repeat(64),
      issuedAt: 100,
      passBar: 1,
      pass: true,
      checks: [],
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function run(...args: string[]) {
    const program = new Command().exitOverride();
    registerJudgeCommand(program);
    await program.parseAsync(["judge", "run", "--artifact", artifact, ...args], { from: "user" });
  }

  it("keeps the exact artifact bytes and routes a named judge to its sole event", async () => {
    await run("clarity");
    expect(runJudge).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        judge,
        event: "pr-create",
        artifact: bytes,
        context: undefined,
      }),
    );
  });

  it("gives sources only to the source-aware judge selected by event", async () => {
    const reality: LoadedJudge = {
      ...judge,
      definition: { ...judge.definition, name: "reality", sees: "artifact+sources" },
    };
    vi.mocked(loadJudgeDefinitions).mockReturnValue([judge, reality]);
    const request = join(root, "request");
    const source = join(root, "source");
    writeFileSync(request, "Original request");
    writeFileSync(source, "Fixture evidence");
    await run("--event", "pr-create", "--request", request, "--source", `fact=${source}`);
    expect(vi.mocked(runJudge).mock.calls.map(([input]) => input.context)).toEqual([
      undefined,
      { request: Buffer.from("Original request"), sources: [{ id: "fact", bytes: Buffer.from("Fixture evidence") }] },
    ]);
  });

  it("refuses ambiguous selection and missing sources before grading", async () => {
    await expect(run("clarity", "--event", "pr-create")).rejects.toThrow(/Choose either/);
    vi.mocked(loadJudgeDefinitions).mockReturnValue([
      {
        ...judge,
        definition: { ...judge.definition, sees: "artifact+sources" },
      },
    ]);
    await expect(run("--event", "pr-create")).rejects.toThrow(/requires sources/);
    expect(runJudge).not.toHaveBeenCalled();
  });
  it("rejects invalid evidence before reserving rounds or grading any judge", async () => {
    const reality: LoadedJudge = {
      ...judge,
      definition: { ...judge.definition, name: "reality", sees: "artifact+sources" },
    };
    vi.mocked(loadJudgeDefinitions).mockReturnValue([judge, reality]);
    await expect(run("--event", "pr-create", "--request", artifact, "--source", `request=${artifact}`)).rejects.toThrow(
      /uniquely named sources/,
    );
    expect(reserveJudgeRound).not.toHaveBeenCalled();
    expect(runJudge).not.toHaveBeenCalled();
  });
});
