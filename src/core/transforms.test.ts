import TOML from "@iarna/toml";
import { describe, expect, it } from "vitest";
import { resolveTransform } from "./transforms.js";

// All transform/frontmatter helpers ride through `resolveTransform("<key>")(content)`
// so the tests pin the public API surface that callers (src/core/agents.ts via
// agents.yaml's `commandTransform: cursor|gemini` field) actually use.
// Same shape as PR #919 / #921 / #922 / #923: helpers stayed alive only because
// tests imported them directly.

const SAMPLE_COMMAND = `---
description: Start the Minsky server
---

# Minsky — Server Management

## 1. Check if server is running

<!-- turbo -->
\`\`\`bash
curl -sf http://localhost:9746/api/v1/health
\`\`\`
`;

// resolveTransform("...") returns a CommandTransform | undefined; tests assume
// the well-known keys ("cursor", "gemini") are wired and unwrap accordingly.
function gemini(content: string): string {
  const transform = resolveTransform("gemini");
  if (!transform) throw new Error("resolveTransform('gemini') returned undefined");
  return transform(content);
}

describe("resolveTransform('gemini') — frontmatter & format edge cases", () => {
  it("converts markdown with frontmatter to TOML", () => {
    const result = gemini(SAMPLE_COMMAND);
    expect(result).toContain('description = "Start the Minsky server"');
    expect(result).toContain('prompt = """');
    expect(result).toContain('"""');
    expect(result).not.toContain("---");
  });

  it("strips markdown headings", () => {
    const result = gemini(SAMPLE_COMMAND);
    expect(result).not.toMatch(/^#/m);
    expect(result).toContain("Minsky — Server Management");
    expect(result).toContain("1. Check if server is running");
  });

  it("strips HTML comments including turbo annotations", () => {
    const result = gemini(SAMPLE_COMMAND);
    expect(result).not.toContain("<!-- turbo -->");
    expect(result).not.toContain("<!--");
  });

  it("strips fenced code block markers but keeps content", () => {
    const result = gemini(SAMPLE_COMMAND);
    expect(result).not.toContain("```bash");
    expect(result).not.toContain("```");
    expect(result).toContain("curl -sf http://localhost:9746/api/v1/health");
  });

  it("handles content without frontmatter (stripFrontmatter no-op)", () => {
    const content = "# Simple\n\nSome text.\n";
    const result = gemini(content);
    expect(result).toContain('description = ""');
    expect(result).toContain("Some text.");
  });

  it("escapes quotes in description", () => {
    const content = `---
description: Say "hello" world
---

# Test
`;
    const result = gemini(content);
    expect(result).toContain('description = "Say \\"hello\\" world"');
  });

  it("collapses excessive newlines", () => {
    const content = `---
description: Test
---

# Title


<!-- turbo -->

\`\`\`bash
echo hi
\`\`\`



## Next
`;
    const result = gemini(content);
    // Should not have more than 2 consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("multi-field frontmatter still extracts the description (extractFrontmatterField regex covers non-first fields)", () => {
    // Pins the regex's ability to find the `description:` field even when
    // it isn't the first line in the frontmatter block. Forward-looking
    // guardrail: if extractFrontmatterField is replaced with a simpler
    // first-line-only parser, this test fails.
    const content = `---
tags: [a, b]
description: My command
version: 2
---

# Title
`;
    const result = gemini(content);
    expect(result).toContain('description = "My command"');
  });
});

describe("resolveTransform", () => {
  it("resolves cursor transform to a callable function", () => {
    const transform = resolveTransform("cursor");
    expect(typeof transform).toBe("function");
    expect(transform?.("---\ndescription: Run\n---\n\n# Run\n\n<!-- turbo -->")).toBe("\n# Run\n\n// turbo");
  });

  it("resolves gemini transform to a callable function", () => {
    const transform = resolveTransform("gemini");
    expect(typeof transform).toBe("function");
  });

  it("returns undefined for unknown key", () => {
    expect(resolveTransform("unknown")).toBeUndefined();
  });

  it("returns undefined for undefined key", () => {
    expect(resolveTransform(undefined)).toBeUndefined();
  });
});

// ─── Gemini TOML round-trip ──────────────────────────────────────────────
//
// Existing 'resolveTransform("gemini")' tests above use `.toContain(...)`
// string matching on the output, which catches the COMMON happy path but
// would miss a transform regression that produces output that looks
// roughly TOML-shaped (greppable for `description =` + `prompt =`) but
// is actually syntactically invalid — e.g. an unescaped triple-quote in
// the body breaking the multi-line string close, or a literal newline in
// the description string. The downstream consumer is the Gemini CLI which
// parses the file as real TOML; if the parser rejects it, the command
// silently fails to register.
//
// These tests parse the output with @iarna/toml (an actual TOML 1.0
// parser, already in deps as the catalog file format) and assert (a) the
// parse succeeds, (b) the resulting JS object has the expected keys with
// the expected values. Covers 3+ edge cases per the task body's spec:
// multi-line descriptions, special chars, empty args (= empty body),
// quotes-in-description, triple-quote-in-body.
//
// Surfaced by P2 task `gemini-cli-commandtransform-test` (audit 2026-05-25).

interface GeminiCommand {
  description: string;
  prompt: string;
}

function parseGemini(content: string): GeminiCommand {
  const transformed = gemini(content);
  const parsed = TOML.parse(transformed) as Record<string, unknown>;
  // Both keys must be present and string-typed
  if (typeof parsed.description !== "string") {
    throw new Error(
      `Round-trip failed: 'description' is not a string in parsed TOML. Got: ${typeof parsed.description}. Raw: ${transformed}`,
    );
  }
  if (typeof parsed.prompt !== "string") {
    throw new Error(
      `Round-trip failed: 'prompt' is not a string in parsed TOML. Got: ${typeof parsed.prompt}. Raw: ${transformed}`,
    );
  }
  return { description: parsed.description, prompt: parsed.prompt };
}

describe("resolveTransform('gemini') — TOML round-trip", () => {
  it("standard SAMPLE_COMMAND round-trips through real TOML parser", () => {
    const parsed = parseGemini(SAMPLE_COMMAND);
    expect(parsed.description).toBe("Start the Minsky server");
    // Body should contain the section title (markdown # stripped) and the
    // bash command, but NOT the fence markers or html-comment turbo annotation
    expect(parsed.prompt).toContain("Minsky — Server Management");
    expect(parsed.prompt).toContain("curl -sf http://localhost:9746/api/v1/health");
    expect(parsed.prompt).not.toContain("```");
    expect(parsed.prompt).not.toContain("<!--");
  });

  it("description with double quotes survives parse (escape correctness)", () => {
    const content = `---
description: Say "hello" world
---

# Test
`;
    const parsed = parseGemini(content);
    // The string the parser yields must contain the LITERAL quotes,
    // not the escaped form (\")
    expect(parsed.description).toBe('Say "hello" world');
  });

  it("empty body produces parsable TOML with empty-or-trimmed prompt", () => {
    const content = `---
description: Empty body command
---
`;
    const parsed = parseGemini(content);
    expect(parsed.description).toBe("Empty body command");
    expect(parsed.prompt.trim()).toBe("");
  });

  it("missing frontmatter description renders as empty string, parser accepts", () => {
    const content = "# No frontmatter at all\n\nJust a body.\n";
    const parsed = parseGemini(content);
    expect(parsed.description).toBe("");
    expect(parsed.prompt).toContain("Just a body.");
    // Markdown heading is stripped per the transform's contract
    expect(parsed.prompt).not.toMatch(/^#/m);
  });

  it("multi-line body with special chars survives round-trip", () => {
    const content = `---
description: Multi-line test
---

# Title

Line one with special chars: <>&'

Line two with backslashes: \\path\\to\\file

Line three.
`;
    const parsed = parseGemini(content);
    expect(parsed.description).toBe("Multi-line test");
    expect(parsed.prompt).toContain("Line one with special chars: <>&'");
    expect(parsed.prompt).toContain("Line two with backslashes: \\path\\to\\file");
    expect(parsed.prompt).toContain("Line three.");
  });

  it("triple-quote in body is escaped — multi-line delimiter isn't broken", () => {
    // If the body contains a literal `"""`, an unescaped pass-through would
    // prematurely close the multi-line string and corrupt the TOML.
    const content = `---
description: Triple-quote test
---

# Title

Use Python's triple quote for multi-line: """text""".
`;
    const parsed = parseGemini(content);
    expect(parsed.description).toBe("Triple-quote test");
    // The literal triple-quote survives the round-trip as quote chars in
    // the resulting body string (the parser unescapes \" sequences).
    expect(parsed.prompt).toContain('"""text"""');
  });

  it("multi-field frontmatter — only description reaches TOML, other fields drop", () => {
    // The transform extracts ONLY `description` from frontmatter. Other
    // fields (tags, version) MUST NOT leak into the TOML output as
    // top-level keys — the Gemini CLI only knows description + prompt.
    const content = `---
tags: [a, b]
description: My command
version: 2
priority: high
---

# Title

Body.
`;
    const transformed = gemini(content);
    const parsed = TOML.parse(transformed) as Record<string, unknown>;
    expect(parsed.description).toBe("My command");
    expect(parsed.prompt).toContain("Body.");
    // Negative assertions: foreign frontmatter keys must NOT appear
    expect(parsed.tags).toBeUndefined();
    expect(parsed.version).toBeUndefined();
    expect(parsed.priority).toBeUndefined();
  });
});
