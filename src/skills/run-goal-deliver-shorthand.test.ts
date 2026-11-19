import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const skill = readFileSync(join(root, "SKILL.md"), "utf8");
const intake = readFileSync(join(root, "references", "goal-intake.md"), "utf8");
const section = intake.split("## Shorthand goals\n")[1]?.split("\n## ")[0] ?? "";
const evals = JSON.parse(readFileSync(join(root, "evals", "evals.json"), "utf8")).evals as Array<{
  id: number;
  prompt: string;
  expected_output: string;
  expectations: string[];
}>;

describe("run-goal /goal deliver shorthand", () => {
  it("points the quick start at the shorthand", () => {
    expect(skill).toContain("`/goal deliver`");
    expect(skill).toContain("references/goal-intake.md#shorthand-goals");
  });

  it("expands deliver into related work, green checks, merge, live install, proof and report", () => {
    expect(section).toMatch(/Do not ask what "deliver" means/);
    expect(section).toMatch(/\*\*Related work, listed\.\*\*/);
    expect(section).toMatch(/hosted checks at its\s+current head/);
    expect(section).toMatch(/fresh-context reviewer/);
    expect(section).toMatch(/cited approval/);
    expect(section).toMatch(/`agentbrew\s+sync`/);
    expect(section).toMatch(/byte-equal to the\s+merged source/);
    expect(section).toMatch(/baseline taken before the merge/);
    expect(section).toMatch(/before\/after table/);
    expect(section).toMatch(/never merges, closes, or\s+force-pushes work this session did not create/);
    expect(section).toMatch(/every\s+required review approved/);
    expect(section).toMatch(/Never bypass a check/);
    expect(section).toMatch(/park the merge and ask once at the end/);
    expect(section).toMatch(/write the BLOCKED report/);
    expect(section).toMatch(
      /deploy to a shared or production\s+target, a publish, or a release needs a cited approval/,
    );
  });

  it("has an eval that runs a bare /goal deliver end to end", () => {
    const scenario = evals.find(({ id }) => id === 352);
    expect(scenario?.prompt.startsWith("/goal deliver")).toBe(true);
    const expected = [scenario?.expected_output, ...(scenario?.expectations ?? [])].join(" ");
    expect(expected).toMatch(/does not ask the user what 'deliver' means/);
    expect(expected).toMatch(/hosted checks pass at the current head/);
    expect(expected).toMatch(/compares the installed files with the merged source/);
    expect(expected).toMatch(/before\/after table/);
    expect(new Set(evals.map(({ id }) => id)).size).toBe(evals.length);
  });
});
