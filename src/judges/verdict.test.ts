import { describe, expect, it } from "vitest";
import { normalizeJudgeVerdict } from "./verdict.js";

const critique = "The artifact states the claim and its limits.";

function grade(pass: boolean, evidence: string[]) {
  return {
    pass,
    score: Number(pass),
    reason: JSON.stringify({ critique, verdict: pass ? "PASS" : "FAIL", evidence }),
  };
}

describe("judge verdict normalization", () => {
  it("returns a binary verdict with its critique", () => {
    expect(normalizeJudgeVerdict("clear", grade(true, []))).toEqual({
      check: "clear",
      critique,
      verdict: "PASS",
      evidence: [],
    });
  });

  it("retains a grounded failure verdict", () => {
    expect(normalizeJudgeVerdict("clear", grade(false, ["S1"]), ["S1", "S2"])).toEqual({
      check: "clear",
      critique,
      verdict: "FAIL",
      evidence: ["S1"],
    });
  });

  it.each([true, false])("accepts a structured reason with pass=%s", (pass) => {
    const result = grade(pass, []);
    const reason = JSON.parse(result.reason);
    expect(normalizeJudgeVerdict("clear", { ...result, reason })).toEqual({
      check: "clear",
      critique,
      verdict: pass ? "PASS" : "FAIL",
      evidence: [],
    });
  });

  it.each([
    { critique, verdict: "FAIL", evidence: [] },
    { critique, verdict: "PASS", evidence: ["S1"] },
    { critique: "x".repeat(8192), verdict: "PASS", evidence: [] },
    ["PASS"],
    null,
  ])("refuses an invalid structured reason", (reason) => {
    expect(() => normalizeJudgeVerdict("clear", { ...grade(true, []), reason })).toThrow(/Invalid judge verdict/);
  });

  it.each([
    ["a contradictory score", { ...grade(true, []), score: 0 }, undefined],
    ["a malformed critique", { ...grade(true, []), reason: "PASS" }, undefined],
    ["an inferred pass", { ...grade(true, []), reason: JSON.stringify({ critique, evidence: [] }) }, undefined],
    ["a source-aware verdict without evidence", grade(true, []), ["S1"]],
    ["an unknown source citation", grade(true, ["S3"]), ["S1", "S2"]],
    ["a source citation in artifact-only mode", grade(true, ["S1"]), undefined],
  ])("refuses %s", (_label, result, sources) => {
    expect(() => normalizeJudgeVerdict("clear", result, sources)).toThrow(/Invalid judge verdict/);
  });
});
