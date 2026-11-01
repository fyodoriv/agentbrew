/** run-goal: retro edits get a fast check before the full suite (task run-goal-retro-fast-check). */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_DIR = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const retro = readFileSync(join(SKILL_DIR, "references", "retro.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(SKILL_DIR, "evals", "evals.json"), "utf-8")).evals as Array<{
  id: number;
  prompt: string;
  expectations: string[];
}>;

describe("run-goal retro fast check", () => {
  it("tells the retro to run wc -l and the skill's own tests before the full suite", () => {
    expect(retro).toMatch(/wc -l/);
    expect(retro).toMatch(/skill's own test/i);
    expect(retro).toMatch(/full\s+suite once/i);
  });

  it("has an eval for a retro edit near the 500-line cap", () => {
    const cases = evals.filter((e) => /498 lines/.test(e.prompt));
    expect(cases).toHaveLength(1);
    expect(cases[0]?.expectations.join(" ")).toMatch(/full suite once/i);
  });
});
