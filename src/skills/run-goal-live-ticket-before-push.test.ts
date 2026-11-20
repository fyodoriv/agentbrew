import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const skill = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");

describe("run-goal ticket status before the first push (#1022)", () => {
  it("checks the live ticket and reads back the gate requirements", () => {
    const workflow = readFileSync(join(skill, "SKILL.md"), "utf8");
    const intake = readFileSync(join(skill, "references", "goal-intake.md"), "utf8");
    expect(workflow).toContain("Before the first push, read the ticket's current status");
    expect(workflow).toContain("references/goal-intake.md#ticket-gates-before-first-push");
    expect(intake).toContain("A Done or Closed ticket cannot satisfy a gate that requires work in progress");
    expect(intake).toMatch(/Read back the required status and assignee before\s+the first push/);
    expect(intake).toMatch(/required permission is\s+unavailable, hold the push/);
  });

  it("pins the approved replacement, required readback and held push variant", () => {
    const { evals } = JSON.parse(readFileSync(join(skill, "evals", "evals.json"), "utf8")) as {
      evals: Array<{ id: number; prompt: string; expected_output: string }>;
    };
    const cases = evals.filter(({ prompt }) => prompt.startsWith("/goal ship the onboarding page with PROJ-123"));
    expect(cases).toHaveLength(1);
    const scenario = cases[0];
    expect(scenario.prompt).toContain("PROJ-123 is Done");
    expect(scenario.prompt).toContain("PROJ-456 is Open, unassigned and covers the same page");
    expect(scenario.expected_output).toContain(
      "Read back PROJ-456 as In Progress and assigned to the requester before any push",
    );
    expect(scenario.expected_output).toContain("PROJ-456 in the commit header and pull request title");
    expect(scenario.expected_output).toContain("Without mutation permission, hold the push");
    expect(evals.find(({ id }) => id === 9)?.expected_output).toContain("The notification reports the echo");
  });
});
