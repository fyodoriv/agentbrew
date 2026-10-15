import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evalMatcher,
  expectationText,
  requireTerms,
  type SkillEval,
  scenarioText,
} from "./skill-contract-test-helpers.js";

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "prefer-reuse-over-reinvent");
const skillText = readFileSync(join(skillRoot, "SKILL.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(skillRoot, "evals", "evals.json"), "utf-8")) as {
  skill_name: string;
  evals: SkillEval[];
};
const evalMatching = evalMatcher(evals.evals);
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
