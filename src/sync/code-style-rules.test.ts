import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOAT_RULE, lintMdcBloat, MDC_FILE_CHAR_SOFT } from "../agent-bloat-lint.js";
import { CATALOG_OWNED_RULE_FILES } from "./catalog-template-rules.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("code-style.mdc catalog rule", () => {
  const codeStyle = readFileSync(join(REPO_ROOT, "templates/rules/code-style.mdc"), "utf-8");

  it("is catalog-owned and under the mdc soft byte budget", () => {
    expect(CATALOG_OWNED_RULE_FILES).toContain("code-style.mdc");
    expect(Buffer.byteLength(codeStyle, "utf8")).toBeLessThanOrEqual(MDC_FILE_CHAR_SOFT);
    const findings = lintMdcBloat(codeStyle, "templates/rules/code-style.mdc");
    expect(findings.filter((f) => f.ruleId === BLOAT_RULE.MDC_FILE_SOFT)).toEqual([]);
  });

  it("keeps core TypeScript safety and comment IRON LAWs", () => {
    expect(codeStyle).toMatch(/`any` is forbidden in production code/);
    expect(codeStyle).toMatch(/Comment Adjacency \(IRON LAW\)/);
    expect(codeStyle).toMatch(/Comment Brevity \(IRON LAW\)/);
    expect(codeStyle).toMatch(/ASD-STE100-style plain English/);
    expect(codeStyle).toMatch(/Deprecation Naming \(IRON LAW\)/);
    expect(codeStyle).toMatch(/docs\/code-style-comment-examples\.md/);
    expect(codeStyle).toMatch(/testing\.mdc/);
  });

  it("requires validated boundaries and configuration provenance", () => {
    expect(codeStyle).toMatch(/use an existing schema library such as Zod/);
    expect(codeStyle).toMatch(/Avoid type assertions/);
    expect(codeStyle).toMatch(/Async functions that cross a network/);
    expect(codeStyle).toMatch(/Name functions for their domain outcome/);
    expect(codeStyle).toMatch(/Every committed static configuration literal/);
    expect(codeStyle).toMatch(/Declare module augmentations immediately after/);
    expect(codeStyle).toMatch(/Do not create a hook that only calls a selector/);
    expect(codeStyle).toMatch(/Each `useMemo` needs an adjacent comment/);
  });

  it("scopes to TypeScript sources only", () => {
    expect(codeStyle).toMatch(/globs:\s*\["\*\*\/\*\.ts", "\*\*\/\*\.tsx"\]/);
    const findings = lintMdcBloat(codeStyle, "templates/rules/code-style.mdc");
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });
});

describe("testing.mdc catalog rule", () => {
  const testingRules = readFileSync(join(REPO_ROOT, "templates/rules/testing.mdc"), "utf-8");

  it("is catalog-owned and under the mdc soft byte budget", () => {
    expect(CATALOG_OWNED_RULE_FILES).toContain("testing.mdc");
    expect(Buffer.byteLength(testingRules, "utf8")).toBeLessThanOrEqual(MDC_FILE_CHAR_SOFT);
    const findings = lintMdcBloat(testingRules, "templates/rules/testing.mdc");
    expect(findings.filter((f) => f.ruleId === BLOAT_RULE.MDC_FILE_SOFT)).toEqual([]);
  });

  it("keeps test-only code outside production sources", () => {
    expect(testingRules).toMatch(/Keep test-only helpers, fixtures, mocks, and setup/);
    expect(testingRules).toMatch(/Do not add production branches/);
  });
});
