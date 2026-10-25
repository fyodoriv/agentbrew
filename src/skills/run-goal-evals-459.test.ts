/** run-goal: grade a draft before saving it, and print the contract early in a Q&A goal (#459). */
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

describe("run-goal Q&A and draft grading (#459)", () => {
  it("tells a research or Q&A goal to print the contract once the questions are known", () => {
    expect(skill).toMatch(
      /Print the goal contract[\s\S]{0,600}research or Q&A goal, print it as soon as the questions are known/i,
    );
  });

  it("tells the agent to grade a draft others will read before saving or posting it", () => {
    expect(skill).toMatch(/grade[^.]*draft[^.]*before (?:you )?sav/i);
  });

  it("has an eval for a Q&A goal from a chat thread with a graded, saved, unsent draft", () => {
    const cases = evals.filter((e) => /real proven answers/i.test(e.prompt) && /three questions/i.test(e.prompt));
    expect(cases).toHaveLength(1);
    const expectations = cases[0]?.expectations.join(" ") ?? "";
    expect(expectations).toMatch(/contract/i);
    expect(expectations).toMatch(/primary source/i);
    expect(expectations).toMatch(/without the outliers/i);
    expect(expectations).toMatch(/fresh-context grader/i);
    expect(expectations).toMatch(/overstated/i);
    expect(expectations).toMatch(/nothing is sent/i);
  });

  it("keeps eval ids unique", () => {
    expect(new Set(evals.map((e) => e.id)).size).toBe(evals.length);
  });

  it("keeps the skill under the 500-line skill limit", () => {
    expect(skill.split("\n").length).toBeLessThan(500);
  });
});
