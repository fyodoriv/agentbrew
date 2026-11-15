import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const execution = readFileSync(join(root, "references", "execution.md"), "utf8");
const section = execution.split("## Hosted checks\n")[1]?.split("\n## ")[0] ?? "";
const evals = JSON.parse(readFileSync(join(root, "evals", "evals.json"), "utf8")).evals as Array<{
  id: number;
  prompt: string;
  expected_output: string;
  expectations: string[];
}>;
const scenario = () => evals.find(({ id }) => id === 320);
const expectations = () => [scenario()?.expected_output, ...(scenario()?.expectations ?? [])].join(" ");

describe("run-goal agents rely on hosted CI", () => {
  it("moves agent entry points to the hosted result for the exact tip", () => {
    expect(section).toMatch(/every agent entry point\s+that still runs the local gate/);
    expect(section).toMatch(/exact tip commit/);
    expect(section).toMatch(/older\s+green run never counts/);
  });

  it("measures speed on the default branch after the merge and stops filter variables at the gate", () => {
    expect(section).toMatch(/push run after the\s+change merges/);
    expect(section).toMatch(/unexport it/);
  });

  it("has an eval with a stale green run and a pull-request-only time", () => {
    const fixture = scenario();
    expect(fixture).toBeDefined();
    expect(fixture?.prompt).toMatch(/older commit/);
    expect(expectations()).toMatch(/exact tip commit/);
    expect(expectations()).toMatch(/unexports/i);
    expect(expectations()).toMatch(/main's push run/);
  });
});
