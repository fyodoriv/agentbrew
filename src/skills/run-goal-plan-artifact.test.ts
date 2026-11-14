import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const skill = readFileSync(join(dir, "SKILL.md"), "utf-8");
const judge = readFileSync(join(dir, "references", "plan-artifact-judge.md"), "utf-8");
const report = readFileSync(join(dir, "references", "goal-report.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(dir, "evals", "evals.json"), "utf-8")).evals as Array<{
  id: number;
  expectations: string[];
}>;

function hasPlanOrder(order: string): boolean {
  const contract = order.indexOf("Print the goal contract");
  const plan = order.indexOf("Create a plan Artifact");
  const work = order.indexOf("Work, printing");
  return contract >= 0 && contract < plan && plan < work;
}

describe("goal plan artifact", () => {
  it("creates the plan after the contract and before execution, then reuses it", () => {
    const order = skill.split("## Order of work")[1]?.split("## Why")[0] ?? "";
    expect(hasPlanOrder(order)).toBe(true);
    expect(hasPlanOrder(order.replace("Print the goal contract", ""))).toBe(false);
    expect(order).toMatch(/Update the same Artifact\s+at every milestone; on resume, find and reuse it/);
    expect(order).toMatch(/private fallback in the \[goal report\]/);
    expect(report).toMatch(/private local HTML report, give its path, and state the\s+output limitation/);
    expect(report).toMatch(/without claiming publication or blocking work/);
    expect(report).toMatch(/same private report at every milestone and reuse it on resume/);
  });

  it("invokes an independent review and handles missing evidence truthfully", () => {
    const order = skill.split("## Order of work")[1]?.split("## Why")[0] ?? "";
    expect(order).toMatch(/independent review using the\s+\[plan artifact judge\]/);
    expect(judge).toMatch(/pass, fail, or unverified/);
    expect(judge).toMatch(/current file timestamp alone does\s+not prove/);
    expect(judge).toMatch(/proven missing\s+artifact fails.*inaccessible listing is unverified/s);
    expect(judge).toMatch(
      /proven different identity fails continuity;\s+an unknown prior identity makes it unverified/,
    );
    expect(judge).toMatch(/entries as failed only when the milestone and plan state are evidenced/);
    expect(judge).toMatch(/Each needs evidence, blockers \(or none\), and the next action/);
    expect(judge).toMatch(/unverified result does not stop ongoing work or the private\s+fallback/);
    expect(judge).toMatch(/not a change to the tool-less native goal evaluator/);
  });

  it("pins the distinct failure and unknown scenarios", () => {
    const expectations = (id: number) => evals.find((entry) => entry.id === id)?.expectations.join(" ") ?? "";
    expect(expectations(308)).toMatch(/missing artifact failed.*unreadable output unverified/i);
    expect(expectations(309)).toMatch(/replacement failed.*unknown prior identity unverified/i);
    expect(expectations(310)).toMatch(/missing milestone failed.*same plan.*evidence, blockers and next action/i);
  });

  it.each([298, 299, 300, 306, 307])("includes scenario %i with observable expectations", (id) => {
    const matches = evals.filter((entry) => entry.id === id);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.expectations.length).toBeGreaterThanOrEqual(3);
    expect(matches[0]?.expectations.join(" ")).toMatch(/artifact|report/i);
    expect(matches[0]?.expectations.join(" ")).toMatch(/milestone/i);
  });
});
