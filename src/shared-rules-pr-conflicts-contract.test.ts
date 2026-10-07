import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sharedRules = readFileSync(join(process.cwd(), "docs", "shared-rules.md"), "utf-8");

function prConflictsRule(): string {
  const line = sharedRules.split("\n").find((l) => l.includes("**PR conflicts (IRON LAW):**"));
  if (!line) throw new Error("missing PR conflicts (IRON LAW) bullet in docs/shared-rules.md");
  return line;
}

describe("docs/shared-rules.md — PR conflicts IRON LAW", () => {
  it("lives in the Git and delivery section", () => {
    const section = sharedRules.split("## Git and delivery")[1]?.split("\n## ")[0] ?? "";
    expect(section).toContain("**PR conflicts (IRON LAW):**");
  });

  it("says green checks do not prove mergeability", () => {
    const rule = prConflictsRule();
    expect(rule).toMatch(/green checks do not prove/i);
    expect(rule).toMatch(/PR head, not its merge with the base/i);
  });

  it("requires both conflict probes on every PR touch", () => {
    const rule = prConflictsRule();
    expect(rule).toMatch(/every PR touch/i);
    expect(rule).toContain("git merge-tree --write-tree --name-only <base> HEAD");
    expect(rule).toContain("gh pr view <n> --json mergeable,mergeStateStatus");
  });

  it("treats CONFLICTING as not green", () => {
    expect(prConflictsRule()).toMatch(/`CONFLICTING` as not green/);
  });

  it("defers to the rebase rule for bringing in the base", () => {
    expect(prConflictsRule()).toContain("rebase-verification.mdc");
  });
});
