import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const execution = readFileSync(join(root, "references", "execution.md"), "utf8");
const skill = readFileSync(join(root, "SKILL.md"), "utf8");
const section = execution.split("## Borrowed sessions and guards the gate skips\n")[1]?.split("\n## ")[0] ?? "";
const evals = JSON.parse(readFileSync(join(root, "evals", "evals.json"), "utf8")).evals as Array<{
  id: number;
  prompt: string;
  expected_output: string;
  expectations: string[];
}>;
const scenario = () => evals.find(({ id }) => id === 293);
const expectations = () => [scenario()?.expected_output, ...(scenario()?.expectations ?? [])].join(" ");

describe("run-goal borrowed sessions and guards the gate skips", () => {
  it("tells the agent to read live rows back early and to keep a lost read unverified", () => {
    expect(section).toMatch(/as soon as its data exists, with the time of the read/);
    expect(section).toMatch(/Probe the session\s+again before the last criterion/);
    expect(section).toMatch(/the read is a human step/);
    expect(section).toMatch(/keep the criterion unverified/);
    expect(section).toMatch(/Never\s+present rows from an earlier read as the fresh final read/);
    expect(section).toMatch(/never sign\s+in with a password yourself/);
    expect(skill).toContain("references/execution.md#borrowed-sessions-and-guards-the-gate-skips");
  });

  it("tells the agent to run the guards a changed-files gate can skip, before and after the base merge", () => {
    expect(section).toMatch(/changed-files gate can skip the guards/);
    expect(section).toMatch(/run them by name/);
    expect(section).toMatch(/merge the base branch and run them once more/);
  });

  it("tells the agent to start a stopped worker's jobs again", () => {
    expect(section).toMatch(/list its jobs in the shared queue/);
    expect(section).toMatch(/start again each\s+job you still need, in the background/);
  });

  it("has an eval with a lost session, a skipped guard and a stopped worker", () => {
    const fixture = scenario();
    expect(fixture).toBeDefined();
    expect(fixture?.prompt).toMatch(/extension is not connected/);
    expect(fixture?.prompt).toMatch(/verify:changed. passed/);
    expect(expectations()).toMatch(/time of the read/i);
    expect(expectations()).toMatch(/keeps the criterion unverified/i);
    expect(expectations()).toMatch(/by name before the push/i);
    expect(expectations()).toMatch(/starts the needed/i);
  });
});
