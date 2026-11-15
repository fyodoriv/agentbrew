import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const execution = readFileSync(join(root, "references", "execution.md"), "utf8");
const evals = JSON.parse(readFileSync(join(root, "evals", "evals.json"), "utf8")).evals as Array<{
  id: number;
  prompt: string;
  expectations: string[];
}>;

describe("run-goal reruns only the current head's CI run", () => {
  it("matches the head SHA before a rerun", () => {
    const section = execution.split("## Hosted checks")[1]?.split("\n## ")[0] ?? "";
    expect(section).toMatch(/Rerun only the run of the PR's current head/);
    expect(section).toMatch(/concurrency group cancel the newer run/);
  });

  it("has eval 322 for a stale-head rerun", () => {
    const fixture = evals.find(({ id }) => id === 322);
    expect(fixture?.prompt).toMatch(/older run for a previous head/);
    expect(fixture?.expectations.join(" ")).toMatch(/head SHA[\s\S]*older head[\s\S]*cancelled/);
  });
});
