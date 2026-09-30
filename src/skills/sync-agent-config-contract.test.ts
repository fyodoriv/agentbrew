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
const skillRoot = join(process.cwd(), "skill-plugins", "dev", "sync-agent-config");
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

describe("sync-agent-config skill contract", () => {
  it("pins sync workflow, verification, and wrong-tool boundaries", () => {
    requireTerms(skillText, [
      "name: sync-agent-config",
      /Don't use for creating new skills \(use Anthropic skill-creator or Superpowers writing-skills\)/,
      /adding MCP servers \(use agentbrew-add-mcp\)/,
      "agentbrew status",
      "agentbrew sync",
      "agentbrew sync --only",
      "mcpm ls",
      "Token overhead check",
    ]);
  });

  it("pins auto-repair and sync surface map", () => {
    requireTerms(skillText, ["## What Gets Synced Where", "skills-sync", "Auto-Repair"]);
  });

  it("keeps eval metadata and pressure scenarios", () => {
    expect(evals.skill_name).toBe("sync-agent-config");
    expect(evals.evals).toHaveLength(3);
    requireTerms(expectationText(evalById(1)), ["agentbrew sync"]);
    requireTerms(expectationText(evalById(2)), ["--only mcp"]);
  });

  it("covers direct-edit and MCP-only pressure", () => {
    requireTerms(scenarioText(evalMatching(/sync everything to all agents/i)), [
      /agentbrew sync/i,
      /Does not edit individual generated agent config files directly/i,
    ]);
    requireTerms(scenarioText(evalMatching(/Only MCP server config changed/i)), [/--only mcp/i]);
  });
});
