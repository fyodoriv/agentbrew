import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const waits = readFileSync(join(root, "references", "external-waits.md"), "utf8");
const section = waits.split("## A failure in one CI event type only\n")[1]?.split("\n## ")[0] ?? "";
const evals = JSON.parse(readFileSync(join(root, "evals", "evals.json"), "utf8")).evals as Array<{
  id: number;
  expected_output: string;
  expectations: string[];
}>;

describe("run-goal: a failure in one CI event type only", () => {
  it("points the agent at tools that read the event", () => {
    expect(section).toMatch(/points at a tool that reads the event/);
    expect(section).toMatch(/GITHUB_EVENT_PATH/);
    expect(section).toMatch(/small throwaway workflow/);
    expect(section).toMatch(/delete the branch after/);
    expect(section).toMatch(/add a test that fails without the fix/);
  });

  it("has an eval for it", () => {
    const scenario = evals.find(({ id }) => id === 311);
    const text = [scenario?.expected_output, ...(scenario?.expectations ?? [])].join(" ");
    expect(text).toMatch(/GITHUB_EVENT_PATH/);
    expect(text).toMatch(/throwaway workflow/);
  });
});
