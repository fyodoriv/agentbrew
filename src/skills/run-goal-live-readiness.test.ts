import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const skill = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");

describe("run-goal live readiness (#1145)", () => {
  it("keeps the observed and requested tier separate and verifies gaps from the live checks", () => {
    const intake = readFileSync(join(skill, "references", "goal-intake.md"), "utf8");
    expect(intake).toMatch(/authorized system of record\s+and record the read time/);
    expect(intake).toMatch(/observed tier and the requested target\s+separately/);
    expect(intake).toMatch(/gaps from the live checks for the target tier/);
    expect(intake).toMatch(/independent reviewer the same authorized capture/);
    expect(intake).toMatch(/current source cannot be read, keep readiness unverified/);
  });

  it("finds the two exact readiness gaps despite a stale tier claim", () => {
    const { evals } = JSON.parse(readFileSync(join(skill, "evals", "evals.json"), "utf8")) as {
      evals: Array<{ prompt: string; expected_output: string; expectations: string[] }>;
    };
    const cases = evals.filter(({ prompt }) => prompt.startsWith("/goal verify current Tier 2 readiness"));
    expect(cases).toHaveLength(1);
    const scenario = cases[0];
    const raw = /Live readiness receipt:\n```json\n([\s\S]+?)\n```/.exec(scenario.prompt);
    expect(raw).not.toBeNull();
    const receipt = JSON.parse(raw?.[1] ?? "{}") as {
      read_at: string;
      observed_tier: number;
      requested_tier: number;
      target_checks: Record<string, boolean>;
    };
    expect([receipt.observed_tier, receipt.requested_tier]).toEqual([1, 2]);
    const gaps = Object.entries(receipt.target_checks)
      .filter(([, passed]) => !passed)
      .map(([check]) => check);
    expect(gaps).toEqual(["recovery drill", "alert routing"]);
    expect(receipt.read_at).toBe("2026-11-20T16:00:00Z");
    expect(scenario.expected_output).toContain(receipt.read_at);
    expect(scenario.expected_output).toMatch(/Tier 1 observed and Tier 2 requested/);
    expect(scenario.expected_output).toContain("recovery drill and alert routing");
    expect(scenario.expected_output).toMatch(/read time[\s\S]*independent reviewer[\s\S]*same read-only receipt/i);
    expect(scenario.expected_output).toContain("Make no source changes");
  });
});
