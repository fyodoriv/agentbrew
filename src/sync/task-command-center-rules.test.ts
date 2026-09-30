import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintMdcBloat } from "../agent-bloat-lint.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("templates/rules — task command center", () => {
  const taskCommandCenter = readFileSync(join(REPO_ROOT, "templates/rules/task-command-center.mdc"), "utf-8");

  it("task-command-center.mdc points at the skill and DO NOT MERGE draft PR pattern", () => {
    expect(taskCommandCenter).toMatch(/task-command-center/);
    expect(taskCommandCenter).toMatch(/DO NOT MERGE/);
    expect(taskCommandCenter).toMatch(/load-project-context/);
    expect(taskCommandCenter).toMatch(/writing-plans/);
    expect(taskCommandCenter).toMatch(/implementation-plan-template\.md/);
    expect(taskCommandCenter).toMatch(/overall goal\/vision/);
    expect(taskCommandCenter).toMatch(/dependencies\/parallelism/);
    expect(taskCommandCenter).toMatch(/Requirements checklist/);
    expect(taskCommandCenter).toMatch(/gh-pr-body-requires-validation/);
    expect(taskCommandCenter).toMatch(/Recurring reconciliation \(IRON LAW\)/);
    expect(taskCommandCenter).toMatch(/Product contract \(immutable\)/);
    expect(taskCommandCenter).toMatch(/Engineering guidance \(dynamic\)/);
    expect(taskCommandCenter).toMatch(/fields or dated comments/);
    expect(taskCommandCenter).toMatch(/Jira scope \(IRON LAW\)/);
    expect(taskCommandCenter).toMatch(/Do not repeat them in descriptions/);
    expect(taskCommandCenter).toMatch(/Never state PR or branch status/);
    expect(taskCommandCenter).toMatch(/one canonical ticket and one\s+delivery PR/);
    expect(taskCommandCenter).toMatch(/e2e, cleanup, import\/dependency decoupling/);
  });

  it("task-command-center.mdc uses narrow TASKS.md glob only", () => {
    expect(taskCommandCenter).toMatch(/globs:\s*\["\*\*\/TASKS\.md"\]/);
    expect(taskCommandCenter).not.toMatch(/\*\*\/\*\.md/);
    const findings = lintMdcBloat(taskCommandCenter, "templates/rules/task-command-center.mdc");
    expect(findings.some((f) => f.ruleId === "mdc-always-apply-broad" && f.severity === "error")).toBe(false);
  });
});
