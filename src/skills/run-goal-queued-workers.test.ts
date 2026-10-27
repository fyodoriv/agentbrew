/** run-goal: workers that stop while their run waits for the shared lock, and watch-loop issues that overlap a worker. */
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

describe("run-goal queued workers", () => {
  it("has an eval for 'completed' workers whose run is still queued, and overlapping new issues", () => {
    const cases = evals.filter((e) => /still queued/i.test(e.prompt) && /new owner issues/i.test(e.prompt));
    expect(cases).toHaveLength(1);
    const expectations = cases[0]?.expectations.join(" ") ?? "";
    expect(expectations).toMatch(/worktree state/i);
    expect(expectations).toMatch(/SendMessage/);
    expect(expectations).toMatch(/no file overlap/i);
    expect(expectations).toMatch(/dependencies before queuing/i);
  });

  it("tells the orchestrator to read a worker's worktree and set up deps before queuing a gate", () => {
    expect(reference).toMatch(/reports\s+"completed" with an interim line/);
    expect(reference).toMatch(/set up the worktree's deps first/);
    expect(reference).toMatch(/waits until that worker's PR merges/);
  });

  it("keeps eval ids unique", () => {
    expect(new Set(evals.map((e) => e.id)).size).toBe(evals.length);
  });
});
