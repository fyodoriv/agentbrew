import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface SkillEval {
  id: number | string;
  prompt: string;
  expected_output: string;
  expectations?: string[];
}

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "cursor-token-playbook");
const skillText = readFileSync(join(skillRoot, "SKILL.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(skillRoot, "evals", "evals.json"), "utf-8")) as {
  skill_name: string;
  evals: SkillEval[];
};

describe("cursor-token-playbook skill contract", () => {
  it("pins model mix, chat rules, and measure-context workflow", () => {
    expect(skillText).toContain("70%");
    expect(skillText).toContain("agentbrew measure context");
    expect(skillText).toContain(".cursorignore");
    expect(skillText).toContain("context-budget");
    expect(skillText).toMatch(/new chat/i);
    expect(skillText).toContain("When to tell the user");
    expect(skillText).toContain("@file");
    expect(skillText).toMatch(/Ask vs Agent/i);
  });

  it("ships evals with playbook expectations", () => {
    expect(evals.skill_name).toBe("cursor-token-playbook");
    expect(evals.evals.length).toBeGreaterThanOrEqual(5);
    const modelEval = evals.evals.find((e) => /pick models/i.test(e.prompt));
    expect(modelEval?.expectations?.some((line) => /Composer/i.test(line))).toBe(true);
  });
});
