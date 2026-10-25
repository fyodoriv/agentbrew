/** run-goal: check one run of a repeat loop before trusting its count, and name a new object the run measured. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_DIR = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(SKILL_DIR, "evals", "evals.json"), "utf-8")).evals as Array<{
  id: number;
  prompt: string;
  expectations: string[];
}>;

describe("run-goal loop counts and new measured objects", () => {
  it("tells the agent to read one run's result line before trusting a loop's pass count", () => {
    expect(skill).toMatch(/Before you trust a loop's pass count, read one run's result line/);
    expect(skill).toMatch(/"\$T\[0\]"` is a subscript and expands to empty/);
  });

  it("tells the agent to say so when its run measures a new object", () => {
    expect(skill).toMatch(/names one object[\s\S]{0,80}makes a new one, say so and measure the new one too/);
  });

  it("has an eval for a goal that implements every unblocked task of two queues", () => {
    const cases = evals.filter(
      (e) => /implement all unblocked tasks/.test(e.prompt) && /two task queues/.test(e.prompt),
    );
    expect(cases).toHaveLength(1);
    const expectations = cases[0]?.expectations.join(" ") ?? "";
    expect(expectations).toMatch(/fails on the unchanged base/);
    expect(expectations).toMatch(/20 times before and after/);
    expect(expectations).toMatch(/result line/);
    expect(expectations).toMatch(/new object/);
    expect(expectations).toMatch(/pivot/);
    expect(expectations).toMatch(/guard/);
    expect(expectations).toMatch(/fresh-context review/);
  });

  it("keeps eval ids unique", () => {
    expect(new Set(evals.map((e) => e.id)).size).toBe(evals.length);
  });

  it("keeps the skill under the 500-line skill limit", () => {
    expect(skill.split("\n").length).toBeLessThan(500);
  });
});
