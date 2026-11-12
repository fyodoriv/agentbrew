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
const scenario = () => evals.find(({ id }) => id === 294);
const expectations = () => [scenario()?.expected_output, ...(scenario()?.expectations ?? [])].join(" ");

describe("run-goal runner outage before the tests start", () => {
  it("tells the agent to prove the outage from the log and to stop waiting after one new start", () => {
    expect(section).toMatch(/fails before your tests start/);
    expect(section).toMatch(/runner outage, not your change/);
    expect(section).toMatch(/quote the failing step and line/);
    expect(section).toMatch(/again once/);
    expect(section).toMatch(/remove the need for the failing service/);
  });

  it("keeps the green gate: an outage never permits a merge on a red check", () => {
    expect(section).toMatch(/green run of\s+the edited workflow/);
    expect(section).toMatch(/never permits a merge on a red check/);
  });

  it("has an eval with a package-server outage and a reviewer the guard refuses", () => {
    const fixture = scenario();
    expect(fixture).toBeDefined();
    expect(fixture?.prompt).toMatch(/Temporary failure resolving/);
    expect(fixture?.prompt).toMatch(/guard refuses the independent reviewer/);
    expect(expectations()).toMatch(/again once/i);
    expect(expectations()).toMatch(/same pull request/i);
    expect(expectations()).toMatch(/never merges on (a|the) red or pending check/i);
    expect(expectations()).toMatch(/asks the owner once/i);
    expect(expectations()).toMatch(/no independent review ran/i);
  });
});
