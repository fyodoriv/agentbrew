import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const skill = readFileSync(join(root, "SKILL.md"), "utf8");
const hook = readFileSync(
  join(resolve(import.meta.dirname, "..", ".."), "hooks", "checks", "goal-contract-before-edit.sh"),
  "utf8",
);
const evals = JSON.parse(readFileSync(join(root, "evals", "evals.json"), "utf8")).evals as Array<{
  id: number;
  prompt: string;
  expected_output: string;
  expectations: string[];
}>;

describe("run-goal research or choice goal", () => {
  it("gives a 3-line contract path with a sourced chat answer and no heavy outputs", () => {
    const path = skill.split("**Research or choice goal**")[1]?.split("\n\n")[0] ?? "";
    expect(path).toMatch(/3-line contract/);
    expect(path).toMatch(/`Done when:`[\s\S]*`Metric:`[\s\S]*`Pivot:`/);
    expect(path).toMatch(/source link per\s+claim/);
    expect(path).toMatch(/Skip the plan Artifact, HTML report, and skill PR/);
  });

  it("still passes the contract hook, which only needs the three labels", () => {
    expect(hook).toMatch(/test\("Done when"\) and test\("Metric"\) and test\("Pivot"\)/);
  });

  it("has eval 314 that picks between two restaurants", () => {
    const fixture = evals.find(({ id }) => id === 314);
    expect(fixture?.prompt).toMatch(/two restaurants/);
    expect(fixture?.expectations.join(" ")).toMatch(/3-line contract[\s\S]*source link[\s\S]*Skips the plan Artifact/);
  });
});
