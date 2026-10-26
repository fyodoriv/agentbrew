/** run-goal: retro rules for a pinned worker base, sandbox-only gate failures, and live-store listings. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_DIR = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");
const workers = readFileSync(join(SKILL_DIR, "references", "parallel-workers.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(SKILL_DIR, "evals", "evals.json"), "utf-8")).evals as Array<{
  id: number;
  expectations: string[];
}>;
const expectationsOf = (id: number) => evals.find((e) => e.id === id)?.expectations.join(" ") ?? "";

describe("run-goal retro rules (evals 129-131)", () => {
  it("pins the workers' base commit in the shared brief", () => {
    expect(skill).toMatch(/exact base\s+commit \(`git rev-parse HEAD` at spawn\) with "do not move the base"/);
    expect(workers).toMatch(/do not move the base/);
    expect(workers).toMatch(/nice -n 15/);
    expect(expectationsOf(129)).toMatch(/do not move the base/);
  });

  it("treats sandbox-only baseline failures as setup and checks the base", () => {
    expect(skill).toMatch(/EPERM on a cache or\s+a registry is the sandbox/);
    expect(skill).toMatch(/fails on the unchanged base is pre-existing/);
    expect(expectationsOf(130)).toMatch(/unchanged base/);
  });

  it("lists a live store read-only before writing and classifies tasks by who must act", () => {
    expect(skill).toMatch(/live store[\s\S]{0,80}read-only/);
    expect(skill).toMatch(/Classify tasks by their Details \(who must act\), not only the Blocked flag/);
    expect(expectationsOf(131)).toMatch(/read-only listing/);
    expect(expectationsOf(131)).toMatch(/Blocked flag/);
  });

  it("keeps eval ids unique and the skill under 500 lines", () => {
    expect(new Set(evals.map((e) => e.id)).size).toBe(evals.length);
    expect(skill.split("\n").length).toBeLessThan(500);
  });
});
