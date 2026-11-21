import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const skill = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const workerGuide = readFileSync(join(skill, "references", "parallel-workers.md"), "utf8");
const waiting = workerGuide.split("## Waiting\n")[1]?.split("\n## ")[0] ?? "";
const reviews = workerGuide.split("## Fix rounds, waiting workers, and duplicate PRs\n")[1] ?? "";

describe("run-goal finished worker handoff (#1155)", () => {
  it("checks the complete report before deciding whether to keep waiting", () => {
    expect(waiting).toMatch(/finish notice, read its full last report[\s\S]*before you reply/);
    expect(waiting).toMatch(/reported PR, revision, and gate result against their sources/);
    expect(waiting).toMatch(/full report is unavailable,[\s\S]*result unverified/);
    expect(waiting).toMatch(/one line and send[\s\S]*only for a change or an owner decision/);
  });

  it("limits judge rounds and requires authorized evidence for verdict claims", () => {
    expect(reviews).toMatch(/at most two rounds for the same review/);
    expect(reviews).toMatch(/same authorized evidence the\s+author used/);
    expect(reviews).toMatch(/sources next to each claim/);
    expect(reviews).toMatch(/required source cannot be read,[\s\S]*check as unverified/);
  });

  it("preserves separate dispositions when workers finish, wait, or lack a report", () => {
    const { evals } = JSON.parse(readFileSync(join(skill, "evals", "evals.json"), "utf8")) as {
      evals: Array<{ prompt: string; expected_output: string; expectations: string[] }>;
    };
    const matches = evals.filter(({ prompt }) => prompt.startsWith("/goal finish the worker handoff"));
    expect(matches).toHaveLength(1);
    const fixture = matches[0];
    expect(fixture.prompt).toContain("Worker A is finished");
    expect(fixture.prompt).toContain("Worker B is still running");
    expect(fixture.prompt).toContain("Worker C finished");
    expect(fixture.prompt).toContain("one pending merge condition");
    expect(fixture.prompt).toContain("judge already used an initial pass and a recheck");
    const assessed = [fixture.expected_output, ...fixture.expectations].join(" ");
    expect(assessed).toMatch(/full report[\s\S]*verify the draft PR, revision, and gate/);
    expect(assessed).toMatch(/worker B[\s\S]*quiet watch/i);
    expect(assessed).toMatch(/worker C[\s\S]*unverified/i);
    expect(assessed).toMatch(/two rounds[\s\S]*authorized sources[\s\S]*inline evidence/i);
    expect(assessed).toContain("pending merge condition");
    expect(assessed).toContain("Do not request a third pass");
  });
});
