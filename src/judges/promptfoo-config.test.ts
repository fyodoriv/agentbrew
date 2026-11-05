import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import type { JudgeDefinition } from "./definition.js";
import { readJudgeEvaluation } from "./evaluation-result.js";
import { buildJudgeEvaluation } from "./promptfoo-config.js";

const judge: JudgeDefinition = {
  name: "clarity",
  on: ["pr-create"],
  sees: "artifact",
  rubric: [
    { id: "clear", check: "Is the artifact clear?" },
    { id: "short", check: "Is the artifact short?" },
  ],
  passBar: 1,
  model: "fixture:model",
  maxRounds: 1,
  calibration: { cases: ["golden/clarity.yaml"], minTruePositiveRate: 1, minTrueNegativeRate: 1 },
  instructions: "Judge the draft as written.",
};

describe("judge Promptfoo configuration", () => {
  it("pins full-input settings without caller overrides", () => {
    const provider = buildJudgeEvaluation(judge, "Synthetic artifact").tests[0].assert[0].provider;
    expect(provider.config).toMatchObject({
      temperature: 0,
      num_ctx: 4096,
      truncate: false,
      passthrough: { shift: false },
    });
  });

  it("uses one explicit grader assertion per check and keeps the artifact separate", () => {
    const artifact = "Synthetic artifact {{rubric}}";
    const config = buildJudgeEvaluation(judge, artifact);
    expect(config.providers).toEqual(["echo"]);
    const [test] = config.tests;
    expect(test.providerOutput).toBe(artifact);
    expect(test.assert.map(({ type, metric, provider }) => [type, metric, provider.id])).toEqual([
      ["llm-rubric", "clear", "fixture:model"],
      ["llm-rubric", "short", "fixture:model"],
    ]);
    expect(test.assert[0].rubricPrompt).toContain("empty evidence list");
    expect(test.assert[0].rubricPrompt).not.toContain(artifact);
  });

  it("keeps file references and template syntax in data values", () => {
    const checks = ["file:///fixture/missing.js", "{% endraw %}{{ 7 * 6 }}"];
    const definition = { ...judge, rubric: checks.map((check, index) => ({ id: `check-${index}`, check })) };
    const config = buildJudgeEvaluation(definition, "Synthetic artifact");
    expect(config.tests[0].assert.map(({ value }) => value)).toEqual(
      checks.map((check) => ({ check, instructions: judge.instructions })),
    );
  });

  it("includes the request and named sources only for source-aware review", () => {
    const context = { request: "Check the claim", sources: [{ id: "S1", text: "Synthetic evidence" }] };
    const [test] = buildJudgeEvaluation({ ...judge, sees: "artifact+sources" }, "draft", context).tests;
    expect(JSON.parse(test.providerOutput)).toEqual({ artifact: "draft", ...context });
    expect(test.assert[0].rubricPrompt).toContain("supplied source ID");
  });

  it("requires complete binary response fields and empty artifact-only evidence", () => {
    const provider = buildJudgeEvaluation(judge, "draft").tests[0].assert[0].provider;
    const validate = new Ajv().compile(provider.config.format);
    const response = { reason: { critique: "Clear.", verdict: "PASS", evidence: [] }, pass: true, score: 1 };
    expect(provider.config.temperature).toBe(0);
    expect(validate(response)).toBe(true);
    for (const invalid of [
      { ...response, reason: { critique: "Clear.", verdict: "PASS" } },
      { ...response, reason: { ...response.reason, evidence: ["S1"] } },
      { ...response, score: 0.5 },
    ])
      expect(validate(invalid)).toBe(false);
  });

  it("restricts source-aware evidence to nonempty arrays of designated IDs", () => {
    const context = { request: "Verify it", sources: [{ id: "S1", text: "Synthetic fact" }] };
    const provider = buildJudgeEvaluation({ ...judge, sees: "artifact+sources" }, "draft", context).tests[0].assert[0]
      .provider;
    const validate = new Ajv().compile(provider.config.format);
    const response = { reason: { critique: "Grounded.", verdict: "PASS", evidence: ["S1"] }, pass: true, score: 1 };
    expect(validate(response)).toBe(true);
    for (const evidence of [[], ["other"], ["S1", "S1"]]) {
      expect(validate({ ...response, reason: { ...response.reason, evidence } })).toBe(false);
    }
  });

  it("refuses a context mode mismatch", () => {
    expect(() => buildJudgeEvaluation({ ...judge, sees: "artifact+sources" }, "draft")).toThrow(/context mode/);
    expect(() => buildJudgeEvaluation(judge, "draft", { request: "private fixture", sources: [] })).toThrow(
      /context mode/,
    );
  });
});

describe("judge result aggregation", () => {
  function result(metric: string, pass: boolean) {
    return {
      assertion: { type: "llm-rubric", metric },
      pass,
      score: Number(pass),
      reason: JSON.stringify({ critique: "Synthetic result", verdict: pass ? "PASS" : "FAIL", evidence: [] }),
    };
  }

  function report(componentResults: unknown[]) {
    return { results: { results: [{ success: true, gradingResult: { componentResults } }] } };
  }

  it("uses the declared order and threshold instead of the aggregate flag", () => {
    const graded = readJudgeEvaluation(judge, report([result("short", false), result("clear", true)]));
    expect(graded.checks.map(({ check, verdict }) => [check, verdict])).toEqual([
      ["clear", "PASS"],
      ["short", "FAIL"],
    ]);
    expect(graded).toMatchObject({ passingFraction: 0.5, pass: false });
  });

  it("refuses an incomplete check set", () => {
    expect(() => readJudgeEvaluation(judge, report([result("clear", true)]))).toThrow(/every rubric check/);
  });

  it("refuses duplicate checks", () => {
    expect(() => readJudgeEvaluation(judge, report([result("clear", true), result("clear", true)]))).toThrow(
      /exactly once/,
    );
  });
});
