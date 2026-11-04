import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { parseJudgeDefinition } from "./definition.js";

const metadata = {
  on: ["pr-create", "pr-ready"],
  sees: "artifact",
  rubric: [{ id: "plain-language", check: "Does the draft use plain language?" }],
  pass_bar: 1,
  model: "fixture:model",
  max_rounds: 2,
  calibration: {
    cases: ["golden/clarity.yaml"],
    min_true_positive_rate: 0.9,
    min_true_negative_rate: 0.8,
  },
};

function definition(overrides: Record<string, unknown> = {}): string {
  return `---\n${yaml.dump({ ...metadata, ...overrides })}---\nReview the artifact.\n`;
}

describe("judge metadata", () => {
  it("preserves the declared identity, rubric, thresholds and instructions", () => {
    expect(parseJudgeDefinition("clarity", definition())).toMatchObject({
      name: "clarity",
      on: metadata.on,
      sees: "artifact",
      rubric: metadata.rubric,
      passBar: 1,
      model: "fixture:model",
      maxRounds: 2,
      calibration: {
        cases: ["golden/clarity.yaml"],
        minTruePositiveRate: 0.9,
        minTrueNegativeRate: 0.8,
      },
      instructions: "Review the artifact.",
    });
  });

  it("keeps source-aware review distinct", () => {
    expect(parseJudgeDefinition("reality", definition({ sees: "artifact+sources" })).sees).toBe("artifact+sources");
  });

  it.each([
    ["duplicate check IDs", { rubric: [...metadata.rubric, ...metadata.rubric] }],
    ["an unknown event", { on: ["merge-all"] }],
    ["an unknown context mode", { sees: "transcript" }],
    ["an invalid pass fraction", { pass_bar: 1.1 }],
    ["zero rounds", { max_rounds: 0 }],
    ["a missing model", { model: "" }],
    ["an invalid calibration rate", { calibration: { ...metadata.calibration, min_true_negative_rate: -1 } }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => parseJudgeDefinition("clarity", definition(overrides))).toThrow(/Judge definition/);
  });
});
