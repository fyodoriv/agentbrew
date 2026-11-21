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

describe("run-goal query readiness (#1207)", () => {
  it("requires an approved read-only query where the target data lives before review", () => {
    expect(served).toMatch(/green PR lists an unchecked live query[\s\S]*hold\s+the review request/i);
    expect(served).toMatch(/environment contains the target data[\s\S]*read-only there, with approved access/i);
    expect(served).toMatch(/dropped eligible rows as a\s+defect/i);
    expect(served).toMatch(/test-environment[\s\S]*cannot cover an unchecked target environment/i);
  });

  it("distinguishes a passing test query from one dropped production row", () => {
    const fixture = evals.find(({ id }) => id === 366);
    expect(evals.filter(({ id }) => id === 366)).toHaveLength(1);
    const raw = /Environment receipts:\n```json\n([\s\S]+?)\n```/.exec(fixture?.prompt ?? "");
    expect(raw).not.toBeNull();
    const { environments } = JSON.parse(raw?.[1] ?? "{}") as {
      environments: Array<{
        name: string;
        contains_target_data: boolean;
        eligible_ids: string[];
        query_ids: string[];
      }>;
    };
    const comparison = environments.map(({ name, contains_target_data, eligible_ids, query_ids }) => ({
      name,
      contains_target_data,
      missing: eligible_ids.filter((id) => !query_ids.includes(id)),
    }));
    expect(comparison).toEqual([
      { name: "test", contains_target_data: false, missing: [] },
      { name: "production", contains_target_data: true, missing: ["P2"] },
    ]);
    expect(fixture?.prompt).toMatch(/PR checks are green[\s\S]*not been checked against live target data/i);
    expect(fixture?.expected_output).toMatch(/production drops P2, one eligible row/i);
    expect(fixture?.expected_output).toMatch(/lacks access[\s\S]*unverified[\s\S]*hold/i);
  });
});
