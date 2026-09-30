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
const skillRoot = join(process.cwd(), "skill-plugins", "dev", "verify-vision-trace");
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

describe("verify-vision-trace skill contract", () => {
  it("pins vision frontmatter schema and script invocation", () => {
    requireTerms(skillText, [
      "name: verify-vision-trace",
      "pr-vision-trace",
      "schema: vision-v1",
      "verify-vision-trace.sh",
      "Vision goal:",
      "soft warning",
    ]);
  });

  it("pins goal resolution and exit codes", () => {
    requireTerms(skillText, [
      "Parses the YAML frontmatter",
      "Exits 0 on success; 1 on cited id not found",
      "0 with warning on missing frontmatter",
    ]);
  });

  it("keeps eval metadata and pressure scenarios", () => {
    expect(evals.skill_name).toBe("verify-vision-trace");
    expect(evals.evals).toHaveLength(6);
    requireTerms(expectationText(evalById(1)), ["NOT FOUND"]);
  });

  it("covers invented goal id and missing frontmatter pressure", () => {
    requireTerms(scenarioText(evalMatching(/Vision goal: G7/i)), [/NOT FOUND|missing|failed/i]);
    requireTerms(scenarioText(evalMatching(/without frontmatter/i)), [
      /warning|missing frontmatter|validation skipped/i,
    ]);
  });
});
