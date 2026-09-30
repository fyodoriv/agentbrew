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
const skillRoot = join(process.cwd(), "skill-plugins", "dev", "prefer-reuse-over-reinvent");
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

describe("prefer-reuse-over-reinvent skill contract", () => {
  it("pins GET discipline, decision order, and scope", () => {
    requireTerms(skillText, [
      "name: prefer-reuse-over-reinvent",
      "GET, don't IMPLEMENT",
      "## When to invoke",
      'reviewing a task that says "implement X"',
      "## Scope",
      "reuse-first decision discipline",
      "## The decision order",
      "### 1. GET it",
      "### 2. WRAP it",
      "### 3. CONTRIBUTE",
      "### 4. ABSORB",
      "90-day engagement window",
      "Replace? Relocate?",
      "## Anti-pattern detection",
      "We need our own X",
    ]);
  });

  it("pins execution safety and examples", () => {
    requireTerms(skillText, [
      "## Execution and verification safety",
      "GET/WRAP/CONTRIBUTE failed",
      "Replace?/Relocate?",
      "## Concrete examples from this codebase family",
      "mcpm.sh",
      "npx skills",
    ]);
  });

  it("keeps eval metadata and pressure scenarios", () => {
    expect(evals.skill_name).toBe("prefer-reuse-over-reinvent");
    expect(evals.evals).toHaveLength(10);
    requireTerms(expectationText(evalById(3)), ["repo-local typo", "outside the skill scope"]);
    requireTerms(expectationText(evalById(8)), ["90-day", "adapter"]);
  });

  it("covers implement-without-search and typo-scope pressure", () => {
    requireTerms(scenarioText(evalMatching(/own MCP sync engine/i)), [/GET/i, /mcpm/i]);
    requireTerms(scenarioText(evalMatching(/typo in our README/i)), [/outside the skill scope/i, /local fix/i]);
  });
});
