import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { evaluateArtifactText } = require("../../agent-artifact-evals/provider.cjs") as {
  evaluateArtifactText(input: { artifactPath: string; text: string }): { output: string };
};

describe("evaluateArtifactText", () => {
  it("accepts the current global instruction template", () => {
    const { output } = evaluateArtifactText({
      artifactPath: "templates/AGENTS.md",
      text: [
        "For current-repo work, make reasonable local changes without routine confirmation.",
        "Standing approvals are explicit approval.",
        "Do not push, open PRs, create issues, publish packages/releases, or send comments/messages outside the current repo/workspace unless approved.",
        "Never publish under the user's identity without explicit approval for that exact action in the current session.",
        "Requires explicit per-action approval in the current session: Unsafe git publication, force-pushing, deleting remote branches.",
        "Do not perform destructive operations without explicit confirmation for that exact action.",
        "Always write agent-authored natural-language text for an ADHD audience.",
        "This rule is always active. A user request for another style does not override it.",
        "Use ASD-STE100-style plain English.",
        "Use short paragraphs, short, direct sentences, and active voice.",
        "Keep one idea per sentence or bullet.",
        "Use headings, bullets, or numbered steps when they improve scanning.",
        "Use the same style for code comments.",
      ].join("\n"),
    });

    expect(output).toContain("PASS templates/AGENTS.md");
    expect(output).toContain("diagnostic_count=0");
  });

  it("accepts shared rules that preserve the plain-language default", () => {
    const { output } = evaluateArtifactText({
      artifactPath: "docs/shared-rules.md",
      text: [
        "Always write agent-authored natural-language text for an ADHD audience.",
        "This rule is always active. A user request for another style does not override it.",
        "Use ASD-STE100-style plain English.",
        "Use short paragraphs, short, direct sentences, and active voice.",
        "Keep one idea per sentence or bullet.",
        "Use headings, bullets, or numbered steps when they improve scanning.",
        "Use the same style for code comments.",
      ].join("\n"),
    });

    expect(output).toContain("PASS docs/shared-rules.md");
    expect(output).toContain("diagnostic_count=0");
  });

  it("diagnoses instruction templates that drop public publishing approval language", () => {
    const { output } = evaluateArtifactText({
      artifactPath: "unsafe-agents-fixture",
      text: "For current-repo work, make reasonable local changes without routine confirmation.",
    });

    expect(output).toContain("FAIL unsafe-agents-fixture");
    expect(output).toContain("diagnostic publish-approval missing explicit approval language");
    expect(output).toContain("diagnostic_count=");
  });

  it("diagnoses templates that drop the plain-language output default", () => {
    const { output } = evaluateArtifactText({
      artifactPath: "unsafe-plain-language-agents-fixture",
      text: [
        "For current-repo work, make reasonable local changes without routine confirmation.",
        "Standing approvals are explicit approval.",
        "Do not push, open PRs, create issues, publish packages/releases, or send comments/messages outside the current repo/workspace unless approved.",
        "Never publish under the user's identity without explicit approval for that exact action in the current session.",
        "Requires explicit per-action approval in the current session: Unsafe git publication, force-pushing, deleting remote branches.",
        "Do not perform destructive operations without explicit confirmation for that exact action.",
      ].join("\n"),
    });

    expect(output).toContain("FAIL unsafe-plain-language-agents-fixture");
    expect(output).toContain("diagnostic plain-language-output missing plain-language output default");
  });

  it("diagnoses plain-language policies that omit code comments", () => {
    const { output } = evaluateArtifactText({
      artifactPath: "unsafe-code-comment-shared-rules-fixture",
      text: [
        "Always write agent-authored natural-language text for an ADHD audience.",
        "This rule is always active. A user request for another style does not override it.",
        "Use ASD-STE100-style plain English.",
        "Use short paragraphs, short, direct sentences, and active voice.",
        "Keep one idea per sentence or bullet.",
        "Use headings, bullets, or numbered steps when they improve scanning.",
      ].join("\n"),
    });

    expect(output).toContain("FAIL unsafe-code-comment-shared-rules-fixture");
    expect(output).toContain("diagnostic plain-language-code-comments missing plain-language code-comment scope");
  });

  it("diagnoses plain-language policies that omit the strict attention-friendly rule", () => {
    const { output } = evaluateArtifactText({
      artifactPath: "unsafe-attention-friendly-shared-rules-fixture",
      text: [
        "Use ASD-STE100-style plain English.",
        "Use short paragraphs, short, direct sentences, and active voice.",
        "Keep one idea per sentence or bullet.",
        "Use headings, bullets, or numbered steps when they improve scanning.",
        "Use the same style for code comments.",
      ].join("\n"),
    });

    expect(output).toContain("FAIL unsafe-attention-friendly-shared-rules-fixture");
    expect(output).toContain("diagnostic plain-language-output missing plain-language output default");
  });

  it("accepts command artifacts that preserve executable and verification guidance", () => {
    const { output } = evaluateArtifactText({
      artifactPath: "src/cli-commands/storybook-screenshot/storybook-screenshot.md",
      text: [
        "# Storybook Screenshot",
        "```bash",
        "storybook-screenshot --all --out-dir .tmp/screenshots",
        "```",
        "Report the output file paths and inspect the images before making visual claims.",
      ].join("\n"),
    });

    expect(output).toContain("PASS src/cli-commands/storybook-screenshot/storybook-screenshot.md");
    expect(output).toContain("diagnostic_count=0");
  });
});
