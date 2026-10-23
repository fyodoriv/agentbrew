/** run-goal eval cases from #438 (loaded launchd job) and #445 (stale repo gate). */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_DIR = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const evals = JSON.parse(readFileSync(join(SKILL_DIR, "evals", "evals.json"), "utf-8")).evals as Array<{
  id: number;
  prompt: string;
  expectations: string[];
}>;

describe("run-goal evals", () => {
  it("cover proving a LaunchAgent fix on the loaded job, not only the plist (#438)", () => {
    const cases = evals.filter((e) => e.expectations.some((x) => x.includes("launchctl print")));
    expect(cases).toHaveLength(1);
    expect(cases[0]?.prompt).toMatch(/failed to quit/);
  });

  it("cover a stale repo gate in a 'get PR to green' goal (#445)", () => {
    const cases = evals.filter((e) => /get .*to green/i.test(e.prompt) && /stale/i.test(e.prompt));
    expect(cases).toHaveLength(1);
    expect(cases[0]?.expectations.join(" ")).toMatch(/no code edits/i);
  });

  it("cover a mid-goal request to move logic to the parent app (#453)", () => {
    const cases = evals.filter((e) => /parent app/i.test(e.prompt) && /issue-only/i.test(e.prompt));
    expect(cases).toHaveLength(1);
    expect(cases[0]?.expectations.join(" ")).toMatch(/issue before/i);
  });

  it("cover reviewing every fix round (#453)", () => {
    expect(evals.some((e) => e.expectations.some((x) => /review of each fix commit/i.test(x)))).toBe(true);
  });

  it("keep eval ids unique", () => {
    expect(new Set(evals.map((e) => e.id)).size).toBe(evals.length);
  });

  it("name launchctl print as the live state of a LaunchAgent in the skill", () => {
    expect(readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8")).toContain("launchctl print gui/$UID/<label>");
  });
});
