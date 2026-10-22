import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const sharedRules = readFileSync(join(repoRoot, "docs", "shared-rules.md"), "utf-8");
const runGoal = readFileSync(join(repoRoot, "skill-plugins", "workflow", "run-goal", "SKILL.md"), "utf-8");

function section(text: string, heading: string): string {
  return text.split(`## ${heading}`)[1]?.split("\n## ")[0] ?? "";
}

describe("long-run reports end as an HTML page", () => {
  it("shared rules: long runs end with a published HTML report", () => {
    const rule = section(sharedRules, "Long-run reports");
    expect(rule).toMatch(/ends with an HTML report, not a long chat message/);
    expect(rule).toMatch(/goal run, a nightly or overnight run, a checkup or health pass/);
    expect(rule).toMatch(/what was done, the blockers, and what to do next/);
    expect(rule).toMatch(/Artifact tool/);
    expect(rule).toMatch(/next-action questions in chat, each with its full context/);
  });

  it("shared rules: each blocker is explained in full", () => {
    const rule = section(sharedRules, "Long-run reports");
    expect(rule).toMatch(
      /what the thing is in plain words, why it is blocked, the options, and what each option changes/,
    );
  });

  it("run-goal: the final report is an HTML page and blockers are explained in full", () => {
    expect(section(runGoal, "Final report")).toMatch(/self-contained HTML page/);
    expect(section(runGoal, "Final report")).toMatch(/Do not paste the whole report/);
    expect(section(runGoal, "Phase 4")).toMatch(
      /what the thing is in\s+plain words, why it is blocked, the options, and what each option changes/,
    );
  });
});
