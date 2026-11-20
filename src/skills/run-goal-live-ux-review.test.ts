import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../..");
const goal = join(repo, "skill-plugins/workflow/run-goal");
const skill = readFileSync(join(goal, "SKILL.md"), "utf8");
const execution = readFileSync(join(goal, "references/execution.md"), "utf8");
const rules = readFileSync(join(repo, "docs/shared-rules.md"), "utf8");
const evals = JSON.parse(readFileSync(join(goal, "evals/evals.json"), "utf8")).evals as Array<{
  id: number;
  prompt: string;
  expectations: string[];
}>;

describe("run-goal live UX review", () => {
  it("requires a fresh live verdict before asking for review", () => {
    const rule = rules.match(/^- \*\*Independent live UX review\*\*:.*$/m)?.[0] ?? "";
    expect(rule).toMatch(/fresh-context reviewer drives the running app/);
    expect(rule).toMatch(/before asking for review/);
    expect(rule).toMatch(/loading, empty, success, error with retry/);
    expect(rule).toMatch(/reasons for disabled controls/);
    expect(rule).toMatch(
      /labels and copy, visible feedback for every action, keyboard access, accessibility, and design-system consistency/,
    );
    expect(rule).toMatch(/screenshot for each state/);
    expect(rule).toMatch(/Hold review requests and any PR creation or ready action that triggers them/);
  });

  it("applies the shared gate to UI goals and keeps ordinary delivery scoped", () => {
    expect(skill).toContain("references/execution.md#live-ux-review");
    const section = execution.split("## Live UX review\n")[1]?.split("\n## ")[0] ?? "";
    expect(section).toContain("changes the user interface");
    expect(section).toContain("Independent live UX review");
    expect(section).toContain("Hold the review request and completion");
    expect(section).toMatch(/a fresh PASS on the latest change/);
    expect(section).toMatch(/missing or mismatched, record UNVERIFIED/);
    expect(section).toMatch(/Keep the PR in draft when making it ready would ask for review/);
    expect(section).toMatch(/Goals without a UI\s+change use their existing review steps/);
  });

  it("has a pressure case with green automation and a failed live verdict", () => {
    const scenario = evals.find(({ id }) => id === 356);
    expect(scenario?.prompt).toMatch(/automated checks are green.*UX review returns FAIL/s);
    expect(scenario?.expectations.join(" ")).toMatch(/holds the review request/);
    expect(scenario?.expectations.join(" ")).toMatch(/withholds completion/);
    expect(scenario?.prompt).toContain("An older deployment had a PASS");
    expect(scenario?.expectations.join(" ")).toMatch(
      /fresh independent PASS on the updated UI tied to the current tested build/,
    );
    expect(evals.filter(({ id }) => id === 356)).toHaveLength(1);
  });
});
