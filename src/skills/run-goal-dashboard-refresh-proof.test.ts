import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const skill = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");

describe("run-goal dashboard refresh evidence (#1042)", () => {
  it("requires a refresh mechanism and a timestamped read of served values", () => {
    const execution = readFileSync(join(skill, "references", "execution.md"), "utf8");
    expect(execution).toMatch(/register the freshness\s+window and identify the live query or scheduled refresh/);
    expect(execution).toMatch(
      /Read the deployed panel\s+values and record both the read time and the data's as-of time/,
    );
    expect(execution).toMatch(/delivery open if the mechanism is missing or the data is stale/);
  });

  it("distinguishes equal served counts by refresh evidence and age", () => {
    const { evals } = JSON.parse(readFileSync(join(skill, "evals", "evals.json"), "utf8")) as {
      evals: Array<{ prompt: string; expected_output: string }>;
    };
    const cases = evals.filter(({ prompt }) =>
      prompt.startsWith("/goal merge the dashboard PR and deliver current data"),
    );
    expect(cases).toHaveLength(1);
    const scenario = cases[0];
    const block = /Synthetic receipt:\n```json\n([\s\S]+?)\n```/.exec(scenario.prompt);
    expect(block).not.toBeNull();
    const receipt = JSON.parse(block?.[1] ?? "{}") as {
      read_at: string;
      maximum_minutes: number;
      snapshot: { as_of: string; refresh: null; values: number[] };
      scheduled: { as_of: string; refresh: { completed_at: string }; values: number[] };
    };
    const age = (asOf: string) => (Date.parse(receipt.read_at) - Date.parse(asOf)) / 60_000;
    expect(receipt.maximum_minutes).toBe(30);
    expect(receipt.snapshot.values).toEqual(receipt.scheduled.values);
    expect(receipt.snapshot.refresh).toBeNull();
    expect(age(receipt.snapshot.as_of)).toBe(10_080);
    expect(receipt.scheduled.refresh.completed_at).toBe(receipt.scheduled.as_of);
    expect(age(receipt.scheduled.as_of)).toBe(15);
    expect(scenario.expected_output).toContain("Keep freshness open in the snapshot case");
    expect(scenario.expected_output).toContain("scheduled case meets freshness for this read");
  });
});
