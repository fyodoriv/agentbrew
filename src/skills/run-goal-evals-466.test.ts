/** run-goal: a two-repo proof-of-concept goal with visual proof (#466). */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_DIR = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");
const reference = join(SKILL_DIR, "references", "cross-app-poc.md");
const evals = JSON.parse(readFileSync(join(SKILL_DIR, "evals", "evals.json"), "utf-8")).evals as Array<{
  id: number;
  prompt: string;
  expectations: string[];
}>;

describe("run-goal two-repo proof of concept (#466)", () => {
  it("has an eval for a widget from one app running inside another, with draft PRs and screenshots", () => {
    const cases = evals.filter((e) => /proof of concept/i.test(e.prompt) && /inside app A/i.test(e.prompt));
    expect(cases).toHaveLength(1);
    const expectations = cases[0]?.expectations.join(" ") ?? "";
    expect(expectations).toMatch(/contract/i);
    expect(expectations).toMatch(/one question round/i);
    expect(expectations).toMatch(/riskiest integration first/i);
    expect(expectations).toMatch(/images that load/i);
    expect(expectations).toMatch(/own heading/i);
    expect(expectations).toMatch(/numbered test steps/i);
  });

  it("points Phase 4 at a cross-app proof-of-concept reference with the three lessons", () => {
    expect(skill).toContain("references/cross-app-poc.md");
    expect(existsSync(reference)).toBe(true);
    const text = readFileSync(reference, "utf-8");
    expect(text).toMatch(/Access-Control-Allow-Private-Network: true/);
    expect(text).toMatch(/rendered page/i);
    expect(text).toMatch(/restart it through its service manager/i);
  });

  it("keeps eval ids unique and the skill under 500 lines", () => {
    expect(new Set(evals.map((e) => e.id)).size).toBe(evals.length);
    expect(skill.split("\n").length).toBeLessThan(500);
  });
});
