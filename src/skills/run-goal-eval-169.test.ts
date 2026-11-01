/** run-goal: check a tool path where its consumer runs, not only in the shell (#613). */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_DIR = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(SKILL_DIR, "evals", "evals.json"), "utf-8")).evals as Array<{
  id: number;
  expectations: string[];
}>;
const expectationsOf = (id: number) => evals.find((e) => e.id === id)?.expectations.join(" ") ?? "";

describe("run-goal consumer environment check (eval 169)", () => {
  it("checks the tool path in the environment its consumer runs in", () => {
    expect(skill).toMatch(/where\s+its\s+consumer\s+runs/);
    expect(skill).toMatch(/a\s+GUI\s+app\s+reads\s+the\s+launchd\s+env/);
    expect(expectationsOf(169)).toMatch(/launchd env/);
    expect(expectationsOf(169)).toMatch(/user step, not as met/);
  });
});
