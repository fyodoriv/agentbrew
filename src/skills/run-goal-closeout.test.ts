/** run-goal: every finished goal ends with what was done, why it helps, and the one next task. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SKILL_DIR = join(ROOT, "skill-plugins", "workflow", "run-goal");
const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");
const report = readFileSync(join(SKILL_DIR, "references", "goal-report.md"), "utf-8");
const goalSet = readFileSync(join(ROOT, "hooks", "checks", "goal-set-loads-run-goal.sh"), "utf-8");
const evals = JSON.parse(readFileSync(join(SKILL_DIR, "evals", "evals.json"), "utf-8")).evals as Array<{
  prompt: string;
  expectations: string[];
}>;
const LABELS = ["Accomplished:", "Why useful:", "Next task:"];

describe("run-goal closeout", () => {
  it("the skill's final report asks for every closeout label and names the hook", () => {
    for (const label of LABELS) expect(skill).toContain(`\`${label}\``);
    expect(skill).toMatch(/goal-retro-before-stop/);
  });

  it("the report template carries each closeout label as its own row", () => {
    for (const label of LABELS) expect(report).toMatch(new RegExp(`^${label} <`, "m"));
  });

  it("the /goal context tells the agent to write them in the retro and the closing message", () => {
    for (const label of LABELS) expect(goalSet).toContain(label);
    expect(goalSet).toMatch(/closing message/);
  });

  it("has an eval that rejects placeholders and a menu of next tasks", () => {
    const cases = evals.filter((e) => e.expectations.some((x) => /Next task names exactly one task/.test(x)));
    expect(cases).toHaveLength(1);
    expect(cases[0]?.expectations.join(" ")).toMatch(/placeholder/i);
  });
});
