import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintMdcBloat } from "../agent-bloat-lint.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("templates/rules — research reads latest", () => {
  const researchPullLatest = readFileSync(join(REPO_ROOT, "templates/rules/research-pull-latest.mdc"), "utf-8");

  it("requires fetch and read at origin before publishing repo facts", () => {
    expect(researchPullLatest).toMatch(/fetch.*repo/i);
    expect(researchPullLatest).toMatch(/origin\/<default>/);
    expect(researchPullLatest).toMatch(/stale local checkout is not evidence/i);
  });

  it("forbids checkout ref paths that overwrite the working tree", () => {
    expect(researchPullLatest).toMatch(/git checkout <ref> -- \./);
    expect(researchPullLatest).toMatch(/git show origin\/<ref>:<path>/);
  });

  it("stays within always-applied soft byte budget", () => {
    const findings = lintMdcBloat(researchPullLatest, "templates/rules/research-pull-latest.mdc");
    expect(findings.filter((f) => f.severity === "error")).toHaveLength(0);
  });
});
