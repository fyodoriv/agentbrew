import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compressSkillsListing,
  DEFAULT_TOKEN_WARNING_THRESHOLD,
  deduplicateByHeading,
  estimateTokens,
  extractCursorRules,
  extractHeadings,
  isInstructionsUpToDate,
  measureSections,
  mergeInstructionsWithManagedSection,
  stripCursorRulesSection,
  usesAgentsMdStandardPath,
} from "./instructions-content.js";

const instructionsTemplatePath = join(import.meta.dirname, "..", "..", "templates", "AGENTS.md");

describe("templates/AGENTS.md token budget", () => {
  it("keeps always-loaded instructions under the warning threshold", () => {
    const template = readFileSync(instructionsTemplatePath, "utf8");

    expect(template.length).toBeLessThanOrEqual(DEFAULT_TOKEN_WARNING_THRESHOLD);
    expect(estimateTokens(template)).toBeLessThanOrEqual(8000);
  });
});

describe("estimateTokens", () => {
  it("returns ceil(charCount / 4) for a number", () => {
    expect(estimateTokens(100)).toBe(25);
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(5)).toBe(2);
  });

  it("returns ceil(string.length / 4) for a string", () => {
    expect(estimateTokens("hello")).toBe(2); // 5 / 4 = 1.25 → 2
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
  });
});

describe("measureSections", () => {
  it("returns sections sorted largest-first", () => {
    const content = ["## Small", "one line", "## Big", "line 1", "line 2", "line 3", "line 4"].join("\n");

    const sections = measureSections(content);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("Big");
    expect(sections[1].heading).toBe("Small");
    expect(sections[0].chars).toBeGreaterThan(sections[1].chars);
  });

  it("returns empty array for content with no H2 headings", () => {
    expect(measureSections("# Title\nSome text")).toEqual([]);
  });

  it("handles single section", () => {
    const sections = measureSections("## Only\ncontent here");
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("Only");
  });
});

describe("compressSkillsListing", () => {
  it("returns content unchanged when no Skills section exists", () => {
    const content = "## Other\nSome text";
    expect(compressSkillsListing(content)).toBe(content);
  });

  it("returns content unchanged when skills section is below compress threshold", () => {
    const content = ["## Skills", "", "**Category:** `skill1`, `skill2`"].join("\n");
    expect(compressSkillsListing(content)).toBe(content);
  });

  it("compresses inline skill listings", () => {
    const content = [
      "# Title",
      "",
      "## Skills",
      "",
      "**Workflow:** `s1`, `s2`, `s3`",
      "**Dev:** `s4`, `s5`, `s6`",
      "",
      "## Next",
      "other content",
    ].join("\n");

    const result = compressSkillsListing(content);
    expect(result).toContain("6 skills installed");
    expect(result).toContain("**Workflow:** 3 skills");
    expect(result).toContain("**Dev:** 3 skills");
    expect(result).toContain("## Next");
    expect(result).not.toContain("`s1`");
  });

  it("compresses bullet-list skill listings", () => {
    const content = [
      "## Skills",
      "",
      "**Category A:**",
      "- `skill-1` — does something",
      "- `skill-2` — does another thing",
      "- `skill-3` — third thing",
      "**Category B:**",
      "- `skill-4` — fourth",
      "- `skill-5` — fifth",
    ].join("\n");

    const result = compressSkillsListing(content);
    expect(result).toContain("5 skills installed");
    expect(result).toContain("**Category A:** 3 skills");
    expect(result).toContain("**Category B:** 2 skills");
  });

  it("handles case-insensitive Skills heading", () => {
    const content = ["## SKILLS", "", "**Cat:** `a`, `b`, `c`, `d`, `e`"].join("\n");
    const result = compressSkillsListing(content);
    expect(result).toContain("5 skills installed");
  });
});

describe("extractCursorRules", () => {
  it("returns empty string when no Auto-Synced Cursor Rules section", () => {
    expect(extractCursorRules("## Other\nSome content")).toBe("");
  });

  it("extracts content after the heading, skipping blockquotes and empty lines", () => {
    const content = ["## Auto-Synced Cursor Rules", "> Auto-generated note", "", "Rule 1", "Rule 2"].join("\n");

    expect(extractCursorRules(content)).toBe("Rule 1\nRule 2\n");
  });
});

describe("usesAgentsMdStandardPath", () => {
  it("matches AGENTS.md basename only", () => {
    expect(usesAgentsMdStandardPath("/home/user/.codex/AGENTS.md")).toBe(true);
    expect(usesAgentsMdStandardPath("/home/user/.claude/CLAUDE.md")).toBe(false);
    expect(usesAgentsMdStandardPath("/home/user/.gemini/GEMINI.md")).toBe(false);
  });
});

describe("stripCursorRulesSection", () => {
  it("returns content unchanged when no Auto-Synced Cursor Rules section", () => {
    const content = "## Other\nContent\n";
    expect(stripCursorRulesSection(content)).toBe(content);
  });

  it("removes the section and preserves surrounding content", () => {
    const content = [
      "## Before",
      "Before content",
      "",
      "## Auto-Synced Cursor Rules",
      "Rule line 1",
      "Rule line 2",
      "",
      "## After",
      "After content",
    ].join("\n");

    const result = stripCursorRulesSection(content);
    expect(result).toContain("## Before");
    expect(result).toContain("Before content");
    expect(result).toContain("## After");
    expect(result).toContain("After content");
    expect(result).not.toContain("Auto-Synced Cursor Rules");
    expect(result).not.toContain("Rule line 1");
  });

  it("handles section at end of file", () => {
    const content = ["## Before", "Content", "", "## Auto-Synced Cursor Rules", "Some rules here"].join("\n");

    const result = stripCursorRulesSection(content);
    expect(result).toContain("## Before");
    expect(result).not.toContain("Auto-Synced Cursor Rules");
  });
});

describe("extractHeadings", () => {
  it("extracts H2–H6 headings, normalized lowercase", () => {
    const content = "# Title\n## Section One\n### SubSection\n#### Deep\nText";
    const headings = extractHeadings(content);
    expect(headings.has("section one")).toBe(true);
    expect(headings.has("subsection")).toBe(true);
    expect(headings.has("deep")).toBe(true);
    expect(headings.has("title")).toBe(false); // H1 not extracted
  });

  it("returns empty set for no headings", () => {
    expect(extractHeadings("plain text only").size).toBe(0);
  });
});

describe("deduplicateByHeading", () => {
  it("returns instructions unchanged when managed rules are empty", () => {
    const instructions = "## Foo\nContent";
    expect(deduplicateByHeading(instructions, "")).toBe(instructions);
    expect(deduplicateByHeading(instructions, "  \n  ")).toBe(instructions);
  });

  it("removes sections whose heading appears in managed rules", () => {
    const instructions = [
      "## Keep This",
      "keep content",
      "",
      "## Duplicate",
      "should be removed",
      "",
      "## Also Keep",
      "more content",
    ].join("\n");
    const managedRules = "## Duplicate\nmanaged version";

    const result = deduplicateByHeading(instructions, managedRules);
    expect(result).toContain("## Keep This");
    expect(result).toContain("## Also Keep");
    expect(result).not.toContain("should be removed");
  });

  it("is case-insensitive when matching headings", () => {
    const instructions = "## My Section\nContent here";
    const managedRules = "## my section\nother content";

    const result = deduplicateByHeading(instructions, managedRules);
    expect(result).not.toContain("Content here");
  });
});

describe("mergeInstructionsWithManagedSection", () => {
  it("wraps instructions in markers when no existing file", () => {
    const result = mergeInstructionsWithManagedSection("Hello", undefined);
    expect(result).toContain("<!-- agentbrew:instructions:start -->");
    expect(result).toContain("Hello");
    expect(result).toContain("<!-- agentbrew:instructions:end -->");
  });

  it("replaces instructions between existing markers", () => {
    const existing = [
      "<!-- agentbrew:instructions:start -->",
      "old content",
      "<!-- agentbrew:instructions:end -->",
    ].join("\n");

    const result = mergeInstructionsWithManagedSection("new content", existing);
    expect(result).toContain("new content");
    expect(result).not.toContain("old content");
  });

  it("preserves content outside instruction markers", () => {
    const existing = [
      "User content before",
      "",
      "<!-- agentbrew:instructions:start -->",
      "old template",
      "<!-- agentbrew:instructions:end -->",
      "",
      "User content after",
    ].join("\n");

    const result = mergeInstructionsWithManagedSection("new template", existing);
    expect(result).toContain("User content before");
    expect(result).toContain("User content after");
    expect(result).toContain("new template");
    expect(result).not.toContain("old template");
  });

  it("prepends instructions to user-only content (no markers, no template)", () => {
    const existing = "My custom rules\n\nMore content";
    const result = mergeInstructionsWithManagedSection("Template content", existing);
    expect(result).toContain("<!-- agentbrew:instructions:start -->");
    expect(result).toContain("Template content");
    expect(result).toContain("My custom rules");
  });

  it("preserves managed rules section from existing file", () => {
    const existing = [
      "<!-- agentbrew:instructions:start -->",
      "old template",
      "<!-- agentbrew:instructions:end -->",
      "",
      "<!-- agentbrew:start -->",
      "managed rules content",
      "<!-- agentbrew:end -->",
    ].join("\n");

    const result = mergeInstructionsWithManagedSection("new template", existing);
    expect(result).toContain("<!-- agentbrew:start -->");
    expect(result).toContain("managed rules content");
    expect(result).toContain("<!-- agentbrew:end -->");
  });
});

describe("isInstructionsUpToDate", () => {
  it("returns true when deployed matches new marker format", () => {
    const deployed = [
      "<!-- agentbrew:instructions:start -->",
      "Instructions content",
      "<!-- agentbrew:instructions:end -->",
    ].join("\n");

    expect(isInstructionsUpToDate(deployed, "Instructions content")).toBe(true);
  });

  it("returns false when deployed content differs", () => {
    const deployed = [
      "<!-- agentbrew:instructions:start -->",
      "Old content",
      "<!-- agentbrew:instructions:end -->",
    ].join("\n");

    expect(isInstructionsUpToDate(deployed, "New content")).toBe(false);
  });

  it("returns true for legacy format (content starts with template)", () => {
    const deployed = "Template content\n\nUser additions";
    expect(isInstructionsUpToDate(deployed, "Template content")).toBe(true);
  });

  it("returns false when legacy content does not match", () => {
    expect(isInstructionsUpToDate("Something else", "Template content")).toBe(false);
  });

  it("returns true when deployed omits template headings that are deduplicated against managed rules", () => {
    // Template has two H2s; one is duplicated in managed rules, so sync strips it before writing.
    // Deployed file therefore has only the non-duplicate template section in the instructions block.
    const template = ["## Shared Rule", "", "shared body", "", "## Template Only", "", "template body"].join("\n");
    const deployed = [
      "<!-- agentbrew:instructions:start -->",
      "## Template Only",
      "",
      "template body",
      "<!-- agentbrew:instructions:end -->",
      "",
      "<!-- agentbrew:start -->",
      "## Shared Rule",
      "",
      "managed-side content",
      "<!-- agentbrew:end -->",
    ].join("\n");

    expect(isInstructionsUpToDate(deployed, template)).toBe(true);
  });

  it("returns false when deployed is missing a non-duplicate template section", () => {
    // Same template; deployed dropped a section that was NOT a duplicate — real drift.
    const template = ["## Shared Rule", "", "shared body", "", "## Template Only", "", "template body"].join("\n");
    const deployed = [
      "<!-- agentbrew:instructions:start -->",
      "## Something Else",
      "",
      "stale body",
      "<!-- agentbrew:instructions:end -->",
      "",
      "<!-- agentbrew:start -->",
      "## Shared Rule",
      "",
      "managed-side content",
      "<!-- agentbrew:end -->",
    ].join("\n");

    expect(isInstructionsUpToDate(deployed, template)).toBe(false);
  });
});
