import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface SkillEval {
  id: number | string;
  prompt: string;
  expected_output: string;
  expectations?: string[];
  assertions?: string[];
}
const skillRoot = join(process.cwd(), "skill-plugins", "dev", "write-vision");
const skillText = readFileSync(join(skillRoot, "SKILL.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(skillRoot, "evals", "evals.json"), "utf-8")) as {
  skill_name: string;
  evals: SkillEval[];
};
function requireTerms(text: string, terms: Array<string | RegExp>) {
  for (const term of terms) {
    if (typeof term === "string") expect(text, `missing term: ${term}`).toContain(term);
    else expect(text, `missing pattern: ${term}`).toMatch(term);
  }
}
function expectationText(skillEval: SkillEval) {
  return [...(skillEval.expectations ?? []), ...(skillEval.assertions ?? [])].join("\n");
}
function scenarioText(skillEval: SkillEval) {
  return [skillEval.prompt, skillEval.expected_output, expectationText(skillEval)].join("\n");
}
function evalMatching(match: RegExp) {
  const found = evals.evals.find((skillEval) => match.test(scenarioText(skillEval)));
  expect(found, `missing eval matching ${match}`).toBeDefined();
  return found as SkillEval;
}
function evalById(id: number) {
  const found = evals.evals.find((skillEval) => skillEval.id === id);
  expect(found, `missing eval ${id}`).toBeDefined();
  return found as SkillEval;
}

describe("write-vision skill contract", () => {
  it("pins decision-framework role, doctrines, and wrong-tool boundaries", () => {
    requireTerms(skillText, [
      "name: write-vision",
      /Don't use for code-level bugs \(use project-audit\)/,
      /one-shot strategic analysis with no durable output \(use strategic-review\)/,
      "## The four non-negotiable doctrines",
      "Delegate → Contribute → Absorb",
      "Permanent scope = ecosystem gaps",
      "decision frameworks",
    ]);
  });

  it("pins competitor verdicts and canonical reference", () => {
    requireTerms(skillText, [
      "agentbrew/docs/VISION.md",
      "overlap percentage",
      "90-day engagement window",
      "triggers for re-evaluation",
    ]);
  });

  it("keeps eval metadata and pressure scenarios", () => {
    expect(evals.skill_name).toBe("write-vision");
    expect(evals.evals).toHaveLength(6);
    requireTerms(expectationText(evalById(1)), ["delegate"]);
  });

  it("covers marketing-copy and skip-competitor pressure", () => {
    requireTerms(scenarioText(evalMatching(/one-time strategic analysis/i)), [
      /strategic-review|one-shot strategic analysis/i,
    ]);
    requireTerms(scenarioText(evalMatching(/two tools that cover everything/i)), [
      /fatal-gap|dissolution into upstream|may not need to exist/i,
    ]);
  });
});
