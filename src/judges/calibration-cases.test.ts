import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCalibrationCases } from "./calibration-cases.js";
import { parseJudgeDefinition } from "./definition.js";
import type { LoadedJudge } from "./load.js";
import { readJudgeSource } from "./source.js";

vi.mock("./source.js", () => ({ readJudgeSource: vi.fn() }));

const reader = vi.mocked(readJudgeSource);
const judge: LoadedJudge = {
  owner: "/synthetic-owner",
  path: "judges/clarity.md",
  sha256: "a".repeat(64),
  definition: {
    name: "clarity",
    on: ["pr-create"],
    sees: "artifact",
    rubric: [{ id: "clear", check: "Does the draft use plain language?" }],
    passBar: 1,
    model: "fixture:model",
    maxRounds: 1,
    calibration: { cases: ["golden/clarity.md"], minTruePositiveRate: 1, minTrueNegativeRate: 1 },
    instructions: "",
  },
};
const good = { id: "clear", expected: "PASS", artifact: "The task is finished." };
const bad = { id: "opaque", expected: "FAIL", artifact: "Ongoing completion state exists." };

function fixture(...cases: unknown[]) {
  reader.mockReturnValue(`---\n${yaml.dump({ cases })}---\n`);
}

describe("judge calibration fixtures", () => {
  beforeEach(() => {
    reader.mockReset();
  });

  it("loads each pair through the judge declaration owner", () => {
    fixture(good, bad);
    expect(loadCalibrationCases(judge)).toEqual([[good, bad]]);
    expect(reader).toHaveBeenCalledExactlyOnceWith(judge.owner, "golden/clarity.md");
  });

  it("loads the documented judge and its golden pair together", () => {
    const path = "docs/examples/judges/clarity.md";
    const owner = process.cwd();
    reader.mockImplementation((directory, file) => readFileSync(resolve(directory, file), "utf8"));
    const definition = parseJudgeDefinition("clarity", readFileSync(resolve(owner, path), "utf8"));
    expect(loadCalibrationCases({ ...judge, path, owner, definition })[0].map(({ expected }) => expected)).toEqual([
      "PASS",
      "FAIL",
    ]);
  });

  it("refuses duplicate cases and labels outside the binary set", () => {
    for (const entry of [
      { ...bad, id: good.id },
      { ...bad, expected: "UNKNOWN" },
      { ...bad, expected: "PASS" },
    ]) {
      fixture(good, entry);
      expect(() => loadCalibrationCases(judge)).toThrow(/fixture is invalid/);
    }
  });

  it("requires valid source IDs and the original request for source-aware cases", () => {
    const grounded: LoadedJudge = { ...judge, definition: { ...judge.definition, sees: "artifact+sources" } };
    const context = { request: "Verify the result", sources: [{ id: "result", text: "Fixture evidence" }] };
    fixture({ ...good, context }, { ...bad, context });
    expect(loadCalibrationCases(grounded)).toEqual([
      [
        { ...good, context },
        { ...bad, context },
      ],
    ]);
    for (const invalid of [
      { ...context, request: "" },
      { ...context, sources: [{ id: "request", text: "Fixture" }] },
    ]) {
      fixture({ ...good, context: invalid }, { ...bad, context });
      expect(() => loadCalibrationCases(grounded)).toThrow(/fixture is invalid/);
    }
  });

  it("propagates a refused native path without parsing a substitute", () => {
    reader.mockImplementation(() => {
      throw new Error("Judge source unavailable.");
    });
    expect(() => loadCalibrationCases(judge)).toThrow(/source unavailable/);
  });
});
