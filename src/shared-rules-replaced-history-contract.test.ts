import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sharedRules = readFileSync(join(process.cwd(), "docs", "shared-rules.md"), "utf-8");

function replacedHistoryRule(): string {
  const line = sharedRules.split("\n").find((l) => l.includes("**Replaced history (dated"));
  if (!line) throw new Error("missing Replaced history bullet in docs/shared-rules.md");
  return line;
}

describe("docs/shared-rules.md — Replaced history rule", () => {
  it("lives in the Git and delivery section", () => {
    const section = sharedRules.split("## Git and delivery")[1]?.split("\n## ")[0] ?? "";
    expect(section).toContain("**Replaced history (dated");
  });

  it("carries its date", () => {
    expect(replacedHistoryRule()).toMatch(/dated \d{4}-\d{2}-\d{2}/);
  });

  it("names the signal an agent can check", () => {
    const rule = replacedHistoryRule();
    expect(rule).toContain("git merge-base HEAD origin/<default>");
    expect(rule).toContain("`diverged`");
  });

  it("forbids the commands that lose work or leak old history", () => {
    expect(replacedHistoryRule()).toMatch(/Do not pull, merge, reset, or push/);
  });

  it("points at the migration page on the remote branch", () => {
    const rule = replacedHistoryRule();
    expect(rule).toContain("docs/migrate-to-public-history.md");
    expect(rule).toMatch(/tell the user in one line/);
  });
});
