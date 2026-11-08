/** run-goal: workflow fan-outs stay inside the agent-usage-guard rolling start cap. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_DIR = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const reference = readFileSync(join(SKILL_DIR, "references", "parallel-workers.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(SKILL_DIR, "evals", "evals.json"), "utf-8")).evals as Array<{
  id: number;
  prompt: string;
  expectations: string[];
}>;

describe("run-goal guard start budget", () => {
  it("tells the lead to count planned agent starts against the guard's rolling cap", () => {
    expect(reference).toMatch(/AGENT_GUARD_ROLLING_MAX/);
    expect(reference).toMatch(/count the agent starts it\s+plans/i);
    expect(reference).toMatch(/one reviewer for several\s+small PRs/i);
    expect(reference).toMatch(/agents started\s+on this machine/);
  });

  it("has one eval that pins the start budget and grouped reviews", () => {
    const cases = evals.filter((e) => /rolling start cap/i.test(e.prompt));
    expect(cases).toHaveLength(1);
    const expectations = cases[0]?.expectations.join(" ") ?? "";
    expect(expectations).toMatch(/counts planned agent starts/i);
    expect(expectations).toMatch(/one reviewer/i);
    expect(expectations).toMatch(/headroom/i);
    expect(expectations).toMatch(/does not retry/i);
  });

  it("keeps eval ids unique", () => {
    expect(new Set(evals.map((e) => e.id)).size).toBe(evals.length);
  });
});
