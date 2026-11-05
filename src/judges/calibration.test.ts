import { describe, expect, it } from "vitest";
import { planCalibration, runCalibrationPair, scoreCalibration } from "./calibration.js";

import type { JudgeDefinition } from "./definition.js";
import type { buildJudgeEvaluation } from "./promptfoo-config.js";

const cases = [
  { id: "clear", expected: "PASS" },
  { id: "opaque", expected: "FAIL" },
] as const;
const thresholds = { minTruePositiveRate: 1, minTrueNegativeRate: 1 };

describe("judge calibration", () => {
  it("plans each labeled example in both orders", () => {
    expect(planCalibration(cases).map(({ id, order }) => [id, order])).toEqual([
      ["clear", "forward"],
      ["opaque", "forward"],
      ["opaque", "reverse"],
      ["clear", "reverse"],
    ]);
  });

  it("qualifies a balanced set that passes in both orders", () => {
    const results = planCalibration(cases).map((entry) => ({ ...entry, verdict: entry.expected }));
    expect(scoreCalibration(cases, results, thresholds)).toEqual({
      forward: { truePositiveRate: 1, trueNegativeRate: 1 },
      reverse: { truePositiveRate: 1, trueNegativeRate: 1 },
      orderDisagreements: 0,
      pass: true,
    });
  });

  it("keeps an order-induced false positive visible", () => {
    const results = planCalibration(cases).map((entry) => ({
      ...entry,
      verdict: entry.order === "reverse" ? ("PASS" as const) : entry.expected,
    }));
    expect(scoreCalibration(cases, results, thresholds)).toMatchObject({
      reverse: { truePositiveRate: 1, trueNegativeRate: 0 },
      orderDisagreements: 1,
      pass: false,
    });
  });

  it("refuses a partial result set", () => {
    const results = planCalibration(cases).map((entry) => ({ ...entry, verdict: entry.expected }));
    expect(() => scoreCalibration(cases, results.slice(1), thresholds)).toThrow(/every case and order/);
  });
});

describe("judge calibration position exposure", () => {
  const judge: JudgeDefinition = {
    name: "clarity",
    on: ["pr-create"],
    sees: "artifact",
    rubric: [{ id: "clear", check: "Is the draft clear?" }],
    passBar: 1,
    model: "fixture:model",
    maxRounds: 1,
    calibration: { cases: ["golden/clarity.md"], ...thresholds },
    instructions: "",
  };
  const pair = [
    { ...cases[0], artifact: "The task is finished." },
    { ...cases[1], artifact: "Ongoing completion state exists." },
  ] as const;

  function report(pass: boolean) {
    return {
      results: {
        results: [
          {
            gradingResult: {
              componentResults: [
                {
                  assertion: { type: "llm-rubric", metric: "clear" },
                  pass,
                  score: Number(pass),
                  reason: JSON.stringify({ critique: "Fixture result", verdict: pass ? "PASS" : "FAIL", evidence: [] }),
                },
              ],
            },
          },
        ],
      },
    };
  }

  function comparison(config: ReturnType<typeof buildJudgeEvaluation>) {
    return JSON.parse(config.tests[0].providerOutput) as {
      target: 1 | 2;
      examples: Array<{ artifact: string }>;
    };
  }

  it("grades both examples at both positions and keeps human labels out of the prompt", async () => {
    const inputs: unknown[] = [];
    const result = await runCalibrationPair(judge, pair, (config) => {
      const input = comparison(config);
      inputs.push(input);
      return report(input.examples[input.target - 1].artifact === pair[0].artifact);
    });
    const forward = pair.map(({ artifact }) => ({ artifact }));
    const reverse = [...forward].reverse();
    expect(inputs).toEqual([
      { target: 1, examples: forward },
      { target: 2, examples: forward },
      { target: 1, examples: reverse },
      { target: 2, examples: reverse },
    ]);
    expect(result).toMatchObject({ pass: true, orderDisagreements: 0 });
  });

  it("detects a grader that always passes the first example", async () => {
    const result = await runCalibrationPair(judge, pair, (config) => report(comparison(config).target === 1));
    expect(result).toMatchObject({
      reverse: { truePositiveRate: 0, trueNegativeRate: 0 },
      orderDisagreements: 2,
      pass: false,
    });
  });
});
