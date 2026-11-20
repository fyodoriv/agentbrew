import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const skill = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");

describe("run-goal integration precedent (#1051)", () => {
  it("checks authorized working routes and keeps their safeguards", () => {
    const intake = readFileSync(join(skill, "references", "goal-intake.md"), "utf8");
    expect(intake).toMatch(/search authorized projects and\s+their current docs for a working client first/);
    expect(intake).toMatch(/Cite the source and the\s+documented route before choosing a new transport/);
    expect(intake).toMatch(/Keep its consent and\s+credential checks/);
    expect(intake).toMatch(/cite the source for the\s+remaining step and report the unverified outcome/);
  });

  it("pins a supported route, two send safeguards, and the deployment blocker", () => {
    const { evals } = JSON.parse(readFileSync(join(skill, "evals", "evals.json"), "utf8")) as {
      evals: Array<{ prompt: string; expected_output: string; expectations: string[] }>;
    };
    const cases = evals.filter(({ prompt }) => prompt.startsWith("/goal integrate event export"));
    expect(cases).toHaveLength(1);
    const scenario = cases[0];
    expect(scenario.prompt).toContain("docs/old-transport.md:9 describes a retired direct transport");
    expect(scenario.prompt).toContain("guides/event-export.md:12 names the supported event-client API");
    expect(scenario.prompt).toContain("opt-in false with credential present sends zero events");
    expect(scenario.prompt).toContain("opt-in true with credential absent sends zero events");
    expect(scenario.prompt).toContain("opt-in true with credential present sends one synthetic event");
    expect(scenario.expected_output).toContain("guides/event-export.md:12 and src/export.ts:24");
    expect(scenario.expected_output).toContain("both user opt-in and credential presence");
    expect(scenario.expected_output).toContain("Deployment remains unverified");
    expect(scenario.expected_output).toContain("guides/deployment.md:18");
    expect(scenario.prompt).toContain("draft-export-1 and an exact readback succeeds");
    expect(scenario.expected_output).toContain("verified synthetic draft receipt separately");
    expect(scenario.expected_output).toContain("zero credential values");
  });
});
