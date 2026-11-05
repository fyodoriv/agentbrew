import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(resolve(import.meta.dirname, "../.."), "skill-plugins/workflow/run-goal");
const read = (path: string) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : "");
const skill = read("SKILL.md");
const waits = read("references/external-waits.md");
const contract = read("references/goal-contract.md");
const execution = read("references/execution.md");
const workers = read("references/parallel-workers.md");
const evals = JSON.parse(read("evals/evals.json")).evals as Array<{
  id: number;
  prompt: string;
  expectations: string[];
}>;
const fixture = (id: number, label: string) => {
  const scenario = evals.find((entry) => entry.id === id);
  expect(scenario, `missing behavioral scenario ${id}`).toBeDefined();
  const raw = new RegExp(`${label}:\\n\x60\x60\x60json\\n([\\s\\S]+?)\\n\x60\x60\x60`).exec(scenario?.prompt ?? "");
  expect(raw, `missing structured fixture ${id}`).not.toBeNull();
  return JSON.parse(raw?.[1] ?? "{}");
};

describe("P0 goal external waits and metric binding", () => {
  it("routes native CI waits to a host-specific completion procedure", () => {
    expect(skill).toContain("references/external-waits.md");
    expect(waits).toMatch(/background[\s\S]*defers[\s\S]*evaluation/i);
    expect(waits).toContain("run_in_background");
    expect(waits).toContain("gh pr checks");
    expect(waits).toMatch(/Codex[\s\S]*within the\s+(?:current\s+)?turn/i);
  });

  it("keeps quiet repeated observations distinct from terminal notifications", () => {
    const data = fixture(238, "Wait fixture");
    expect(data.observations.filter((event: { state: string }) => event.state === "pending")).toHaveLength(10);
    expect(data.observations.at(-1).state).toBe("success");
    expect(data.expected).toEqual({
      watchers: 1,
      duplicateWaitReplies: 0,
      terminalNotifications: 1,
      freshResultReads: 1,
    });
    expect(waits).toMatch(/unchanged[\s\S]*no[\s\S]*message/i);
    expect(waits).toMatch(/existing[\s\S]*watcher[\s\S]*before[\s\S]*another/i);
  });

  it("binds results to the watched revision and refuses missing notification evidence", () => {
    expect(waits).toMatch(/repository[\s\S]*head[\s\S]*run[\s\S]*attempt/i);
    expect(waits).toMatch(/expired[\s\S]*unknown/i);
    expect(waits).toMatch(/authoritative[\s\S]*before[\s\S]*merg/i);
    expect(waits).toMatch(/clear[\s\S]*pause[\s\S]*blocked/i);
  });

  it("supplies discriminating metric windows and both comparator directions", () => {
    const data = fixture(239, "Metric fixture");
    expect(data.selected.window).toBe("quarter");
    expect(data.obsolete.window).toBe("month");
    const value = data.selected.value;
    const old = data.obsolete.value;
    expect(value <= data.threshold).toBe(true);
    expect(old <= data.threshold).toBe(false);
    expect(value >= data.threshold).toBe(false);
    expect(data.cases).toEqual([
      { comparator: "<=", metricVerdict: "met", deliveryVerdict: "pending" },
      { comparator: ">=", metricVerdict: "unmet", deliveryVerdict: "pending" },
      { comparator: null, metricVerdict: "unverified", deliveryVerdict: "pending" },
    ]);
  });

  it("requires the full metric binding in the saved contract and correction path", () => {
    for (const field of ["window", "denominator", "unit", "comparator", "threshold", "revision"]) {
      expect(contract.toLowerCase(), `contract lacks ${field}`).toContain(field);
    }
    expect(execution).toContain("external-waits.md");
    expect(waits).toMatch(/native\s+condition[\s\S]*readback/i);
    expect(waits).toMatch(/unsupported[\s\S]*unverified/i);
  });

  it("does not prescribe an observer event for every repeated failure", () => {
    expect(workers).not.toContain("The poller prints a line for every");
    expect(workers).toContain("external-waits.md");
    expect(waits).toMatch(/Monitor[\s\S]*stdout/i);
    expect(waits).toMatch(/shipping[\s\S]*pending/i);
  });

  it("does not restart a verified quiet wait on transcript silence", () => {
    expect(workers).toContain("STALLED is a silence signal, not proof of job death");
    expect(workers).toMatch(/accepted live owned wait[\s\S]*exempt/i);
    expect(workers).not.toContain("say\n  its gate shell is gone");
  });
});
