import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const execution = readFileSync(join(root, "references", "execution.md"), "utf8");
const section = execution.split("## Proof inputs and decided measurements\n")[1]?.split("\n## ")[0] ?? "";
const evals = JSON.parse(readFileSync(join(root, "evals", "evals.json"), "utf8")).evals as Array<{
  id: number;
  prompt: string;
  expected_output: string;
  expectations: string[];
}>;
const scenario = () => evals.find(({ id }) => id === 291);
const expectations = () => [scenario()?.expected_output, ...(scenario()?.expectations ?? [])].join(" ");

describe("run-goal proof inputs and decided measurements", () => {
  it("tells the agent to check each proof input on this machine before the contract", () => {
    expect(section).toMatch(/Check each input at intake, read-only, before you print the\s+contract/);
    expect(section).toMatch(/real data\s+now, a fixture or scratch run, or real data after a named date or event/);
    expect(section).toMatch(/Never create the missing record or send invented events/);
  });

  it("stops a measurement whose verdict is decided", () => {
    expect(section).toMatch(/stops when the verdict is decided/);
    expect(section).toMatch(/report the partial counts as measured/);
    expect(section).toMatch(/apply the registered pivot/);
    expect(section).toMatch(/shared queue/);
  });

  it("has an eval with a missing install record, a young cohort and a decided measurement", () => {
    const fixture = scenario();
    expect(fixture).toBeDefined();
    expect(fixture?.prompt).toMatch(/has no such file/);
    expect(fixture?.prompt).toMatch(/run 5 was a false alarm/);
    expect(expectations()).toMatch(/fixture/i);
    expect(expectations()).toMatch(/does not fabricate|never fabricates/i);
    expect(expectations()).toMatch(/stops the measurement/i);
    expect(expectations()).toMatch(/registered pivot/i);
  });
});
