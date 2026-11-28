import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const skill = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const execution = readFileSync(join(skill, "references", "execution.md"), "utf8");
const { evals } = JSON.parse(readFileSync(join(skill, "evals", "evals.json"), "utf8")) as {
  evals: Array<{ id: number; prompt: string; expected_output: string; expectations: string[] }>;
};

describe("run-goal live hook proof", () => {
  it("requires installed evidence and records a known operator step in the goal contract", () => {
    expect(execution).toMatch(/live hook, rule, or plugin stays open until you verify\s+the installed copy/);
    expect(execution).toMatch(/operator-only step in the goal\s+contract as soon as you know it applies/);
  });

  it("places the capability approval under the required operator action label", () => {
    expect(execution).toMatch(
      /Keep an operator-only capability prompt open until the operator acts\.\s+Put the action only the operator can take under `Needed from you`\./,
    );
  });

  it("exercises both decisions alongside the existing signed release checks", () => {
    const scenario = evals.find(({ id }) => id === 428);
    expect(scenario?.prompt).toContain("At intake you learn");
    expect(scenario?.expected_output).toContain("initial goal contract");
    expect(scenario?.expected_output).toContain("Keep the live criterion open after the merge");
    expect(scenario?.expected_output).toContain("Use the signed release");
    expect(scenario?.expectations).toContain("Runs or adds a matcher-to-manifest coverage check before the release");
    expect(scenario?.expectations).toContain(
      "Verifies the installed version, hook files, registration, and behavior after approval",
    );
  });
});
