import { describe, expect, it } from "vitest";
import { evalMatcher, expectationText, requireTerms, type SkillEval } from "./skill-contract-test-helpers.js";

const sampleEval: SkillEval = {
  id: 1,
  prompt: "Add an MCP server",
  expected_output: "Registers it",
  expectations: ["names the layer"],
  assertions: ["runs sync"],
};

describe("skill contract test helpers", () => {
  it("names the missing term or pattern when requireTerms fails", () => {
    expect(() => requireTerms("alpha beta", ["alpha", "gamma"])).toThrow(/missing term: gamma/);
    expect(() => requireTerms("alpha beta", [/delta/])).toThrow(/missing pattern: \/delta\//);
    expect(() => requireTerms("alpha beta", ["alpha", /beta/])).not.toThrow();
  });

  it("joins expectations and assertions", () => {
    expect(expectationText(sampleEval)).toBe("names the layer\nruns sync");
  });

  it("finds an eval by scenario text and names the pattern when none matches", () => {
    const evalMatching = evalMatcher([sampleEval]);
    expect(evalMatching(/runs sync/).id).toBe(1);
    expect(() => evalMatching(/no such scenario/)).toThrow(/missing eval matching \/no such scenario\//);
  });
});
