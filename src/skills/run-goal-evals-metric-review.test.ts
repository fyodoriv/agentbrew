/** run-goal: review a new metric before trusting it, and rerun a gate that started before the last edit. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_DIR = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
// Phase 4 practices live in references/execution.md, which SKILL.md links.
const skill = ["SKILL.md", "references/execution.md"].map((f) => readFileSync(join(SKILL_DIR, f), "utf-8")).join("\n");
const evals = JSON.parse(readFileSync(join(SKILL_DIR, "evals", "evals.json"), "utf-8")).evals as Array<{
  id: number;
  prompt: string;
  expectations: string[];
}>;

describe("run-goal metric review and stale gates", () => {
  it("tells the agent to have a fresh-context reviewer check a new metric before trusting it", () => {
    expect(skill).toMatch(/metric is code too[\s\S]{0,200}fresh-context\s+reviewer/i);
  });

  it("tells the agent to rerun a gate that started before the last edit", () => {
    expect(skill).toMatch(/gate you started before your last edit tests old code/i);
  });

  it("has an eval for a metric PR reviewed, fixed, and gated again", () => {
    const cases = evals.filter((e) => /metric PR/i.test(e.prompt));
    expect(cases).toHaveLength(1);
    const expectations = cases[0]?.expectations.join(" ") ?? "";
    expect(expectations).toMatch(/fresh-context reviewer/i);
    expect(expectations).toMatch(/stopped and run again/i);
  });
});
