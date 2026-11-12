import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const skill = readFileSync(join(dir, "SKILL.md"), "utf-8");
const report = readFileSync(join(dir, "references", "goal-report.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(dir, "evals", "evals.json"), "utf-8")).evals as Array<{
  id: number;
  expectations: string[];
}>;

describe("goal plan artifact", () => {
  it("creates the plan after the contract and before execution, then reuses it", () => {
    const order = skill.split("## Order of work")[1]?.split("## Why")[0] ?? "";
    expect(order.indexOf("Print the goal contract")).toBeLessThan(order.indexOf("Create a plan Artifact"));
    expect(order.indexOf("Create a plan Artifact")).toBeLessThan(order.indexOf("Work, printing"));
    expect(order).toMatch(/Update the same Artifact\s+at every milestone; on resume, find and reuse it/);
    expect(order).toMatch(/private fallback in the \[goal report\]/);
    expect(report).toMatch(/private local HTML report, give its path, and state the\s+output limitation/);
    expect(report).toMatch(/without claiming publication or blocking work/);
  });

  it.each([298, 299, 300])("includes scenario %i with observable expectations", (id) => {
    const matches = evals.filter((entry) => entry.id === id);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.expectations.length).toBeGreaterThanOrEqual(3);
    expect(matches[0]?.expectations.join(" ")).toMatch(/artifact|report/i);
    expect(matches[0]?.expectations.join(" ")).toMatch(/milestone/i);
  });
});
