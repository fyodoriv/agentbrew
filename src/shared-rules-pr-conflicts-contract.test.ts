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

describe("docs/shared-rules.md — live merge gate", () => {
  const section = sharedRules.split("## Git and delivery")[1]?.split("\n## ")[0] ?? "";
  const rule = section.split("\n").find((line) => line.includes("**Merge gate (IRON LAW).**")) ?? "";

  it("requires current GitHub evidence for every merge path", () => {
    expect(rule).toMatch(/before any normal, admin, auto, API, or web merge/i);
    expect(rule).toContain("`headRefOid`, `mergeStateStatus`, and `statusCheckRollup` live");
    expect(rule).toContain("latest PR head includes the latest base");
  });

  it("blocks pending, failed, missing, and unknown outcomes", () => {
    expect(rule).toContain("contains every expected check for that head");
    expect(rule).toContain("`SUCCESS`, `SKIPPED`, or `NEUTRAL`");
    expect(rule).toContain("pending, failed, missing, or unknown check blocks merge");
    expect(rule).toContain("`BEHIND`, `DIRTY`, or unknown merge state also blocks merge");
  });

  it("keeps stricter gates and requires new checks after a rebase", () => {
    expect(rule).toContain("subject to stricter repository gates");
    expect(rule).toContain("push, and wait for checks on the new head");
    expect(rule).toContain("admin merge can waive review only");
    expect(rule).toContain("Judges fail any merge action or recommendation");
  });
});
