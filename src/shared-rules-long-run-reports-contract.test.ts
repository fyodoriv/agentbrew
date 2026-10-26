import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const sharedRules = readFileSync(join(repoRoot, "docs", "shared-rules.md"), "utf-8");
const runGoal = readFileSync(join(repoRoot, "skill-plugins", "workflow", "run-goal", "SKILL.md"), "utf-8");
const wrapUp = readFileSync(join(repoRoot, "skill-plugins", "workflow", "wrap-up", "SKILL.md"), "utf-8");
const watchIssues = readFileSync(join(repoRoot, "skill-plugins", "workflow", "watch-issues", "SKILL.md"), "utf-8");

function section(text: string, heading: string): string {
  return text.split(`## ${heading}`)[1]?.split("\n## ")[0] ?? "";
}

describe("long-run reports end as a published Artifact", () => {
  it("shared rules: long runs end with a published Artifact or Dashboard", () => {
    const rule = section(sharedRules, "Long-run reports");
    expect(rule).toMatch(/ends with a published Artifact, not a long chat message and not a loose HTML file/);
    expect(rule).toMatch(/Dashboard Artifact/);
    expect(rule).toMatch(/update the same dashboard each run/);
    expect(rule).toMatch(/Only without an Artifact tool/);
    expect(rule).not.toMatch(/ends with an HTML report/);
    expect(rule).toMatch(/goal run, a nightly or overnight run, a checkup or health pass/);
    expect(rule).toMatch(/what was done, the blockers, and what to do next/);
    expect(rule).toMatch(/Artifact tool's quickstart/);
    expect(rule).toMatch(/next-action questions in chat, each with its full context/);
  });

  it("shared rules: each blocker is explained in full", () => {
    const rule = section(sharedRules, "Long-run reports");
    expect(rule).toMatch(
      /what the thing is in plain words, why it is blocked, the options, and what each option changes/,
    );
  });

  it("run-goal: the final report is an Artifact and blockers are explained in full", () => {
    expect(section(runGoal, "Final report")).toMatch(/as an Artifact/);
    expect(section(runGoal, "Final report")).toMatch(/Dashboard Artifact/);
    expect(section(runGoal, "Final report")).toMatch(/not a loose HTML file/);
    expect(section(runGoal, "Final report")).not.toMatch(/self-contained HTML page/);
    expect(section(runGoal, "Final report")).toMatch(/or with private data/);
    expect(section(runGoal, "Final report")).toMatch(/Do not paste the whole report/);
    expect(section(runGoal, "Phase 4")).toMatch(
      /what the thing is in\s+plain words, why it is blocked, the options, and what each option changes/,
    );
  });

  it("wrap-up and watch-issues reports are published Artifacts too", () => {
    expect(section(wrapUp, "4. Report")).toMatch(/published Artifact/);
    expect(section(wrapUp, "4. Report")).toMatch(/or with private data/);
    expect(watchIssues).toMatch(/a published Artifact \(shared-rules \*\*## Long-run reports\*\*\)/);
    expect(watchIssues).not.toMatch(/one HTML page/);
  });
});
