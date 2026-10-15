import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { evaluatePlainLanguage, SURFACES } = require("../../agent-artifact-evals/plain-language.cjs") as {
  evaluatePlainLanguage(input: { artifactPath: string; surface: string; text: string }): {
    status: "PASS" | "FAIL";
    diagnostics: Array<{ id: string }>;
    output: string;
  };
  SURFACES: string[];
};

function ids(surface: string, text: string): string[] {
  return evaluatePlainLanguage({ artifactPath: "fixture", surface, text }).diagnostics.map((d) => d.id);
}

describe("evaluatePlainLanguage", () => {
  it("covers chat, docs, PR, code-comment, and skill-wrapper surfaces", () => {
    expect(SURFACES).toEqual(["chat", "docs", "pr", "code-comment", "skill-wrapper"]);
  });

  it("passes short, active, answer-first chat output", () => {
    expect(ids("chat", "The build fails on a missing import.\n\n- Fix: add the import.")).toEqual([]);
  });

  it("flags a filler opener in chat and names the rule gap", () => {
    const result = evaluatePlainLanguage({ artifactPath: "fixture", surface: "chat", text: "Sure! The build fails." });
    expect(result.status).toBe("FAIL");
    expect(result.output).toContain('diagnostic answer-not-first rule="put the answer first"');
  });

  it("flags a sentence longer than 25 words", () => {
    const long = `${Array.from({ length: 30 }, () => "word").join(" ")}.`;
    expect(ids("docs", long)).toContain("long-sentence");
  });

  it("flags passive voice above one sentence in five", () => {
    expect(ids("docs", "The file is written. The rule is loaded. Sync runs.")).toContain("passive-voice");
  });

  it("flags a prose paragraph with more than four sentences, but not a bullet list", () => {
    expect(ids("docs", "One. Two. Three. Four. Five.")).toContain("long-paragraph");
    expect(ids("docs", "- One.\n- Two.\n- Three.\n- Four.\n- Five.")).not.toContain("long-paragraph");
  });

  it("requires a PR body to open with ## Summary", () => {
    expect(ids("pr", "This PR fixes it.\n\n## Details")).toContain("pr-summary-not-first");
    expect(ids("pr", "## Summary\n\nSync drops a key. This PR keeps it.")).toEqual([]);
  });

  it("checks only comments on the code-comment surface", () => {
    const code =
      "// Skip null overrides.\nconst veryLongVariableNameThatIsNotProse = computeSomethingWithManyArguments(a, b, c, d);";
    expect(ids("code-comment", code)).toEqual([]);
    expect(ids("code-comment", "// a\n// b\n// c\n// d\nrun();")).toContain("long-comment");
  });

  it("ignores skill frontmatter and fenced code", () => {
    const skill = `---\nname: x\ndescription: ${"long ".repeat(40)}\n---\n\n# X\n\nRun the check.\n\n\`\`\`bash\n${"echo ".repeat(40)}\n\`\`\``;
    expect(ids("skill-wrapper", skill)).toEqual([]);
  });

  it("rejects an unknown surface", () => {
    expect(() => evaluatePlainLanguage({ artifactPath: "fixture", surface: "email", text: "" })).toThrow(/unknown/);
  });
});
