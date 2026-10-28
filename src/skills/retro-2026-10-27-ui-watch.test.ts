/** Retro 2026-10-27: keep the user's main color in a redesign, and land overlapping watch issues as one stack. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const skill = (name: string) => join(ROOT, "skill-plugins", "workflow", name);
const evals = (name: string) =>
  JSON.parse(readFileSync(join(skill(name), "evals", "evals.json"), "utf-8")).evals as Array<{
    id: number;
    prompt: string;
    expectations: string[];
  }>;

describe("retro 2026-10-27", () => {
  it("ui-ux-rankings keeps the user's main color and names an accent change", () => {
    const ref = readFileSync(join(skill("ui-ux-rankings"), "references", "comfort-patterns.md"), "utf-8");
    expect(ref).toMatch(/Keep the user's main color/);
    expect(ref).toMatch(/one\s+token to change back/);
    const cases = evals("ui-ux-rankings").filter((e) => /main color/.test(e.prompt));
    expect(cases).toHaveLength(1);
  });

  it("watch-issues parks overlapping issues and lands a stack by its top branch", () => {
    const cases = evals("watch-issues").filter((e) => /pm-why/.test(e.prompt));
    expect(cases).toHaveLength(1);
    expect(cases[0]?.expectations.join(" ")).toMatch(/--delete-branch/);
  });

  it("keeps eval ids unique in both skills", () => {
    for (const name of ["ui-ux-rankings", "watch-issues"]) {
      const ids = evals(name).map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
