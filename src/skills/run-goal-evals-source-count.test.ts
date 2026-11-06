import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const execution = readFileSync(join(root, "references", "execution.md"), "utf8");
const served = execution.split("## Served output\n")[1]?.split("\n## ")[0] ?? "";
const evals = JSON.parse(readFileSync(join(root, "evals", "evals.json"), "utf8")).evals as Array<{
  id: number;
  prompt: string;
  expected_output: string;
  expectations: string[];
}>;
const scenario = () => evals.find(({ id }) => id === 233);

describe("run-goal source-count verification (#774)", () => {
  it("requires a source-count done-criterion for dashboard and report goals", () => {
    expect(served).toMatch(
      /dashboard or report goal[\s\S]*done-criterion[\s\S]*headline numbers[\s\S]*source-of-truth/i,
    );
    expect(served).toMatch(/same time window, filters[\s\S]*counting unit/i);
    expect(served).toMatch(/every query runs[^.]*not a correctness check/i);
    expect(served).toMatch(/independent judge[\s\S]*source records/i);
    expect(served).toMatch(/source access[\s\S]*missing[\s\S]*unverified/i);
  });

  it("supplies raw events that independently reproduce exactly one wrong headline", () => {
    const fixture = scenario();
    expect(fixture).toBeDefined();
    const raw = /Raw source events:\n```json\n([\s\S]+?)\n```/.exec(fixture?.prompt ?? "");
    expect(raw).not.toBeNull();
    const rows = JSON.parse(raw?.[1] ?? "[]") as Array<{
      id: string;
      timestamp: string;
      kind: string;
      valid: boolean;
      requester: string | null;
      resolved: boolean;
    }>;
    const requests = rows.filter(
      (row) =>
        row.kind === "request" &&
        row.valid &&
        row.timestamp >= "2026-11-04T00:00:00Z" &&
        row.timestamp < "2026-11-05T00:00:00Z",
    );
    const observed = [new Set(requests.map(({ id }) => id)).size, requests.filter(({ resolved }) => resolved).length];
    expect(observed).toEqual([6, 2]);
    expect(requests.filter(({ requester }) => requester === null)).toHaveLength(1);
    expect(observed.filter((count, index) => count !== [5, 2][index])).toHaveLength(1);
    expect(fixture?.prompt).toMatch(/Requests: 5; Resolved: 2/);
    expect(fixture?.prompt).toMatch(/all queries[\s\S]*filters[\s\S]*pass/i);
  });

  it("requires independent source comparison and preserves unknown and read-only outcomes", () => {
    const fixture = scenario();
    expect(fixture).toBeDefined();
    const expected = [fixture?.expected_output, ...(fixture?.expectations ?? [])].join(" ");
    expect(expected).toMatch(/independent judge[\s\S]*raw source/i);
    expect(expected).toMatch(/5[\s\S]*6[\s\S]*undercount/i);
    expect(expected).toMatch(/missing requester[\s\S]*valid request/i);
    expect(expected).toMatch(/query[\s\S]*not[\s\S]*correctness/i);
    expect(expected).toMatch(/unavailable[\s\S]*unverified/i);
    expect(expected).toMatch(/does not[\s\S]*change[\s\S]*source/i);
  });

  it("retains verification of actual served output after deployment", () => {
    expect(served).toMatch(/measure the\s+served output after the deploy/i);
    expect(served).toMatch(/fetch the served output and read every entry/i);
  });
});
