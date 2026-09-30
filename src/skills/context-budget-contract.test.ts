import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface SkillEval {
  id: number | string;
  prompt: string;
  expected_output: string;
  expectations?: string[];
}

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "context-budget");
const skillText = readFileSync(join(skillRoot, "SKILL.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(skillRoot, "evals", "evals.json"), "utf-8")) as {
  skill_name: string;
  evals: SkillEval[];
};

describe("context-budget skill contract", () => {
  it("pins automated metrics paths and investigation workflow", () => {
    expect(skillText).toContain("~/.config/agentbrew/metrics/latest.json");
    expect(skillText).toContain("agentbrew measure context");
    expect(skillText).toContain("agentbrew lint");
    expect(skillText).toContain("bunx ccusage");
    expect(skillText).toContain("manual-snapshots");
    expect(skillText).toMatch(/no API/i);
    expect(skillText).toContain("GET, don't build");
    expect(skillText).toContain("SessionStart hook");
    expect(skillText).toContain("context-budget-measure");
    expect(skillText).toContain("cursor-token-playbook");
    expect(skillText).toMatch(/start a new chat/i);
  });

  it("ships evals with measure-context expectations", () => {
    expect(evals.skill_name).toBe("context-budget");
    expect(evals.evals.length).toBeGreaterThanOrEqual(3);
    const auditEval = evals.evals.find((e) => /audit the agentbrew token budget/i.test(e.prompt));
    expect(auditEval?.expectations?.some((line) => /latest\.json/i.test(line))).toBe(true);
  });
});
