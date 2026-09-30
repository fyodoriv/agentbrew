import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const sharedRules = readFileSync(join(repoRoot, "docs", "shared-rules.md"), "utf-8");
const instructionTemplate = readFileSync(join(repoRoot, "templates", "AGENTS.md"), "utf-8");
const plainLanguageTemplateRule = readFileSync(
  join(repoRoot, "templates", "rules", "plain-language-output.mdc"),
  "utf-8",
);
const plainLanguagePatterns = [
  /ASD-STE100-style plain\s+English/,
  /Always write agent-authored natural-language\s+text for an ADHD audience/i,
  /This rule is always active/i,
  /A user request for\s+another style does not override it/i,
  /code\s+comments/i,
  /short paragraphs/i,
  /short, direct sentences[\s\S]*active[\s\S]*voice/i,
  /one idea per sentence or bullet/i,
  /headings, bullets,\s+or numbered\s+steps[\s\S]*scanning/i,
];

describe("plain-language output contract", () => {
  it("defines the cross-agent default in shared rules", () => {
    for (const pattern of plainLanguagePatterns) expect(sharedRules).toMatch(pattern);
    expect(sharedRules).toMatch(/every skill,\s+rule,\s+command,\s+or tool\s+context/i);
  });

  it("keeps the default in the cross-agent instruction template", () => {
    expect(instructionTemplate).toContain("### User-facing language");
    for (const pattern of plainLanguagePatterns) expect(instructionTemplate).toMatch(pattern);
  });

  it("ships an always-applied rule for agents with per-file rule support", () => {
    expect(plainLanguageTemplateRule).toMatch(/alwaysApply:\s*true/);
    for (const pattern of plainLanguagePatterns) expect(plainLanguageTemplateRule).toMatch(pattern);
    expect(plainLanguageTemplateRule).toContain("skill, rule, command, tool, or memory");
  });
});
