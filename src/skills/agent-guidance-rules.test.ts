import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const shared = read("docs/shared-rules.md");
const runGoal = read("skill-plugins/workflow/run-goal/SKILL.md");
const execution = read("skill-plugins/workflow/run-goal/references/execution.md");
const waits = read("skill-plugins/workflow/run-goal/references/external-waits.md");
const goalReport = read("skill-plugins/workflow/run-goal/references/goal-report.md");
const uiSkill = read("skill-plugins/workflow/ui-ux-rankings/SKILL.md");
const comfort = read("skill-plugins/workflow/ui-ux-rankings/references/comfort-patterns.md");
const designJudges = read("skill-plugins/workflow/ui-ux-rankings/references/design-judges.md");
const rfc = read("skill-plugins/workflow/rfc/SKILL.md");
const discoveryPlan = read("docs/plans/run-goal-skill-discovery-and-routing.md");
const gdoc = read("skill-plugins/workflow/markdown-for-gdoc/SKILL.md");
const featureReadiness = read("skill-plugins/workflow/review-pr/references/feature-readiness.md");
const evals = JSON.parse(read("skill-plugins/workflow/run-goal/evals/evals.json")).evals as Array<{
  id: number;
  prompt: string;
  expected_output: string;
  expectations: string[];
}>;
const evalText = (id: number) => {
  const entry = evals.find((candidate) => candidate.id === id);
  expect(entry, `missing eval ${id}`).toBeDefined();
  return [entry?.prompt, entry?.expected_output, ...(entry?.expectations ?? [])].join(" ");
};

describe("run-goal status cadence (#908)", () => {
  it("prints a combined block only for changes, milestones, or the interval", () => {
    for (const text of [runGoal, execution]) {
      expect(text).toMatch(/one combined goal status block/i);
      expect(text).toMatch(/criterion changes state/i);
      expect(text).toMatch(/milestone/i);
      expect(text).toMatch(/30 minutes/i);
      expect(text).toMatch(/never repeat an unchanged goal check/i);
    }
    expect(runGoal).not.toMatch(/one goal-check\s+line per turn/i);
    expect(waits).toMatch(/quiet waits print nothing/i);
    expect(runGoal).toMatch(/final report[\s\S]*every criterion[\s\S]*fresh evidence/i);
  });

  it("updates the clock case and adds a repeated-status decision eval", () => {
    expect(evalText(206)).not.toMatch(/one goal-check line per turn/i);
    expect(evalText(206)).toMatch(/unchanged[\s\S]*no[\s\S]*goal check/i);
    expect(evalText(284)).toMatch(/30 minutes/i);
    expect(evalText(284)).toMatch(/no[\s\S]*repeat/i);
    expect(evalText(284)).toMatch(/quiet wait[\s\S]*nothing/i);
  });
});

describe("expanded folds and opened review targets (#911, #893)", () => {
  it("requires expanded sections across shared, UI, artifact, and judge guidance", () => {
    for (const text of [shared, uiSkill, comfort, designJudges, rfc, gdoc, featureReadiness]) {
      expect(text).toMatch(/expanded by default/i);
      expect(text).toMatch(/real reason/i);
    }
    expect(shared).toMatch(/<details open>/);
    expect(rfc).toMatch(/<details open>/);
    expect(gdoc).toMatch(/<details open>/);
    expect(shared).toMatch(/readability checklist[\s\S]*collapsed[\s\S]*FAIL/i);
    expect(shared).toMatch(/accordions/i);
    expect(shared).toMatch(/editing a page someone else made/i);
    expect(shared).toMatch(/hallmark/i);
    expect(designJudges).toMatch(/reject[\s\S]*collaps/i);
  });

  it("opens anything the closing ask names and makes judges enforce it", () => {
    for (const text of [shared, goalReport]) {
      expect(text).toMatch(/check, review, or edit/i);
      expect(text).toMatch(/open(?:s|ing)? (?:that|the) target/i);
      expect(text).toMatch(/judge[\s\S]*FAIL/i);
      expect(text).toMatch(/opening tool result/i);
    }
    expect(shared).toMatch(/readability checklist[\s\S]*opening tool result/i);
    expect(goalReport).toMatch(/Needed from you[\s\S]*open/i);
    expect(evalText(285)).toMatch(/open[\s\S]*(?:browser|editor)/i);
    expect(evalText(285)).toMatch(/judge[\s\S]*reject/i);
    expect(discoveryPlan).toMatch(/Later authorized exception \(#908\)/);
    expect(discoveryPlan).toMatch(/eval 206/i);
    expect(discoveryPlan).toContain("fff8084b1d0a3e77f1339b9d837b1c86497a69f2913d911d07242b082d9816da");
  });
});
