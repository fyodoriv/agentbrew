/** run-goal: workflow fan-outs stay inside the agent-usage-guard rolling start cap. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_DIR = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const reference = readFileSync(join(SKILL_DIR, "references", "parallel-workers.md"), "utf-8");
const tasks = readFileSync(join(SKILL_DIR, "..", "..", "..", "TASKS.md"), "utf-8");
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

  it("tells the lead to read the live cap instead of a machine-specific number", () => {
    expect(reference).not.toMatch(/owner's Mac/);
    expect(reference).not.toMatch(/all 40 starts/);
    expect(reference).toContain(`jq -r '.env.AGENT_GUARD_ROLLING_MAX // "12"' ~/.claude/settings.json`);
    const expectations = evals.filter((e) => /rolling start cap/i.test(e.prompt))[0]?.expectations.join(" ") ?? "";
    expect(expectations).toMatch(/reads the live cap/i);
  });

  it("warns about the session fuse and says to stop the fan-out after the first refusal", () => {
    expect(reference).toMatch(/refuses\s+agent\s+calls\s+5\s+times\s+within\s+10\s+minutes/);
    expect(reference).toMatch(/pauses?\s+every\s+agent\s+spawn\s+in\s+(that|the)\s+session/);
    expect(reference).toMatch(/after\s+the\s+first\s+refusal,\s+stop\s+or\s+cancel\s+the\s+rest\s+of\s+the\s+fan-out/i);
  });

  it("keeps a follow-up task for the upstream workflow-authoring proposal", () => {
    const block = tasks
      .split(/\n(?=- \[ \] )/)
      .find((b) => /\*\*ID\*\*: workflow-authoring-guard-budget-upstream/.test(b));
    expect(block).toBeDefined();
    expect(block).toMatch(/workflow-authoring/);
    expect(block).toMatch(/\*\*Blocked\*\*: needs-owner-approval/);
    const p3 = tasks.slice(tasks.indexOf("\n## P3"));
    expect(p3).toContain("workflow-authoring-guard-budget-upstream");
  });

  it("keeps eval ids unique", () => {
    expect(new Set(evals.map((e) => e.id)).size).toBe(evals.length);
  });
});
