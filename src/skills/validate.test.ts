import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock("../state.js", () => ({
  loadState: vi.fn(),
}));

vi.mock("../sync/skills-sync.js", () => ({
  getSkillSources: vi.fn(),
}));

import { existsSync, readFileSync } from "node:fs";
import { getSkillSources } from "../sync/skills-sync.js";
import {
  validateAllSkills,
  validateBody,
  validateCrossReferences,
  validateDirectoryName,
  validateEvals,
  validateFrontmatter,
  validateSkill,
} from "./validate.js";

const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockGetSkillSources = vi.mocked(getSkillSources);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── validateDirectoryName ────────────────────────────────────────────────────

describe("validateDirectoryName", () => {
  it("accepts valid names", () => {
    expect(validateDirectoryName("commit")).toEqual([]);
    expect(validateDirectoryName("pr-fix")).toEqual([]);
    expect(validateDirectoryName("a")).toEqual([]);
    expect(validateDirectoryName("my-skill-123")).toEqual([]);
  });

  it("rejects empty name", () => {
    const issues = validateDirectoryName("");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("empty");
  });

  it("rejects names exceeding max length", () => {
    const long = "a".repeat(65);
    const issues = validateDirectoryName(long);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("64");
  });

  it("rejects uppercase names", () => {
    const issues = validateDirectoryName("MySkill");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("lowercase");
  });

  it("rejects names starting with numbers", () => {
    const issues = validateDirectoryName("123-skill");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });

  it("rejects names with underscores", () => {
    const issues = validateDirectoryName("my_skill");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });

  it("rejects names with spaces", () => {
    const issues = validateDirectoryName("my skill");
    expect(issues).toHaveLength(1);
  });
});

// ── validateFrontmatter ──────────────────────────────────────────────────────

describe("validateFrontmatter", () => {
  it("accepts valid frontmatter", () => {
    const content = `---
name: commit
description: >
  Commits changes following conventional commits format.
  Don't use for PRs (use pr).
---

## Steps
`;
    const issues = validateFrontmatter(content, "commit");
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("errors on missing frontmatter", () => {
    const issues = validateFrontmatter("# Just content", "skill");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("Missing YAML frontmatter");
  });

  it("errors on invalid YAML", () => {
    const content = `---
invalid: yaml: {{
---

Content
`;
    const issues = validateFrontmatter(content, "skill");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("Invalid YAML");
  });

  it("errors on missing name", () => {
    const content = `---
description: A skill description that is long enough.
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const nameErrors = issues.filter((i) => i.field === "name");
    expect(nameErrors).toHaveLength(1);
    expect(nameErrors[0].severity).toBe("error");
  });

  it("errors on missing description", () => {
    const content = `---
name: my-skill
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const descErrors = issues.filter((i) => i.field === "description");
    expect(descErrors).toHaveLength(1);
    expect(descErrors[0].severity).toBe("error");
  });

  it("warns when name does not match directory", () => {
    const content = `---
name: wrong-name
description: A description that is long enough to pass validation checks.
---

Content
`;
    const issues = validateFrontmatter(content, "actual-dir");
    const nameWarnings = issues.filter((i) => i.field === "name" && i.severity === "warning");
    expect(nameWarnings).toHaveLength(1);
    expect(nameWarnings[0].message).toContain("wrong-name");
    expect(nameWarnings[0].message).toContain("actual-dir");
  });

  it("warns on short description", () => {
    const content = `---
name: my-skill
description: Too short
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const descWarnings = issues.filter((i) => i.field === "description" && i.severity === "warning");
    expect(descWarnings).toHaveLength(1);
    expect(descWarnings[0].message).toContain("short");
  });

  it("info when missing don't-use guidance", () => {
    const content = `---
name: my-skill
description: A description that is long enough to validate but lacks guidance.
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const infoIssues = issues.filter((i) => i.field === "description" && i.severity === "info");
    expect(infoIssues).toHaveLength(1);
    expect(infoIssues[0].message).toContain("Don't use");
  });

  it("no info when description has don't-use guidance", () => {
    const content = `---
name: my-skill
description: >
  Does something useful. Don't use for other things.
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const infoIssues = issues.filter((i) => i.field === "description" && i.severity === "info");
    expect(infoIssues).toHaveLength(0);
  });

  it("warns on unknown frontmatter fields", () => {
    const content = `---
name: my-skill
description: A long enough description for validation. Don't use elsewhere.
custom-field: something
another: value
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const unknownWarnings = issues.filter((i) => i.severity === "warning");
    expect(unknownWarnings).toHaveLength(2);
    expect(unknownWarnings[0].message).toContain("custom-field");
    expect(unknownWarnings[1].message).toContain("another");
  });

  it("errors on wrong type for disable-model-invocation", () => {
    const content = `---
name: my-skill
description: A long enough description for validation. Don't use elsewhere.
disable-model-invocation: "yes"
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const typeErrors = issues.filter((i) => i.field === "disable-model-invocation");
    expect(typeErrors).toHaveLength(1);
    expect(typeErrors[0].severity).toBe("error");
  });

  it("accepts string form for allowed-tools (Claude Code spec allows both array and comma-separated string)", () => {
    // Claude Code accepts `allowed-tools: "Bash(agent-browser:*), Bash(foo)"`
    // as a string and splits on commas internally. Anthropic's own skill
    // examples (superpowers, etc.) use the string form. Rejecting it created
    // false-positive drift on every valid skill written this way.
    const content = `---
name: my-skill
description: A long enough description for validation. Don't use elsewhere.
allowed-tools: "Bash(agent-browser:*), Bash(npx agent-browser:*)"
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const typeErrors = issues.filter((i) => i.field === "allowed-tools");
    expect(typeErrors).toHaveLength(0);
  });

  it("errors on wrong non-string, non-array type for allowed-tools", () => {
    // Boolean, number, object are still wrong types.
    const content = `---
name: my-skill
description: A long enough description for validation. Don't use elsewhere.
allowed-tools: 42
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const typeErrors = issues.filter((i) => i.field === "allowed-tools");
    expect(typeErrors).toHaveLength(1);
    expect(typeErrors[0].severity).toBe("error");
    expect(typeErrors[0].message).toContain("array or a comma-separated string");
  });

  it("accepts all known frontmatter fields with correct types", () => {
    const content = `---
name: my-skill
description: A long enough description for validation. Don't use elsewhere.
disable-model-invocation: true
user-invocable: false
allowed-tools:
  - Read
  - Write
model: claude-3.5-sonnet
context:
  - codebase
agent:
  - claude
argument-hint: "<branch-name>"
hooks:
  on-start: echo hello
capabilities:
  - name: testing
    description: Run tests
    default: true
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("errors on null frontmatter", () => {
    const content = `---
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });
});

// ── validateBody ─────────────────────────────────────────────────────────────

describe("validateBody", () => {
  it("accepts body with headings", () => {
    const content = `---
name: test
---

## Steps

1. Do something.
`;
    const issues = validateBody(content);
    expect(issues).toHaveLength(0);
  });

  it("errors on empty body", () => {
    const content = `---
name: test
---

`;
    const issues = validateBody(content);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("no body content");
  });

  it("warns on body without headings", () => {
    const content = `---
name: test
---

Just some plain text without any headings or structure.
`;
    const issues = validateBody(content);
    const warnings = issues.filter((i) => i.severity === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("no headings");
  });

  it("accepts body with h1 heading", () => {
    const content = `---
name: test
---

# Main heading

Content here.
`;
    expect(validateBody(content)).toHaveLength(0);
  });

  it("accepts body with h3 heading", () => {
    const content = `---
name: test
---

### Sub heading

Content here.
`;
    expect(validateBody(content)).toHaveLength(0);
  });

  it("handles content without frontmatter", () => {
    const content = "Just plain text without frontmatter or headings.";
    const issues = validateBody(content);
    const warnings = issues.filter((i) => i.severity === "warning");
    expect(warnings).toHaveLength(1);
  });
});

// ── validateCrossReferences ──────────────────────────────────────────────────

describe("validateCrossReferences", () => {
  const allSkills = new Set(["commit", "review", "plan", "debug", "pr", "pr-fix"]);

  it("finds no issues when all references exist", () => {
    const content = `Don't use for creating PRs (use pr) or pushing (use commit).`;
    const issues = validateCrossReferences(content, allSkills, "my-skill");
    expect(issues).toHaveLength(0);
  });

  it("reports missing referenced skills", () => {
    const content = `Use refactor for restructuring. Don't use for deployment (use deploy).`;
    const issues = validateCrossReferences(content, allSkills, "my-skill");
    const missing = issues.filter((i) => i.message.includes("deploy"));
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe("info");
  });

  it("ignores self-references", () => {
    const content = "Use my-skill when you need to do this.";
    const issues = validateCrossReferences(content, allSkills, "my-skill");
    expect(issues).toHaveLength(0);
  });

  it("ignores generic words", () => {
    const content = "Use it for this and that with caution.";
    const issues = validateCrossReferences(content, allSkills, "my-skill");
    expect(issues).toHaveLength(0);
  });

  it("handles backtick-quoted skill names", () => {
    const content = "Don't use for reviews (use `review`) or commits (use `nonexistent`).";
    const issues = validateCrossReferences(content, allSkills, "my-skill");
    const missing = issues.filter((i) => i.message.includes("nonexistent"));
    expect(missing).toHaveLength(1);
  });
});

// ── validateSkill ────────────────────────────────────────────────────────────

describe("validateSkill", () => {
  const allSkills = new Set(["commit", "review"]);

  it("validates a well-formed skill", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`---
name: commit
description: >
  Commits changes following conventional commits format.
  Don't use for creating PRs (use pr).
---

## Steps

1. Do something.
`);

    const result = validateSkill("/skills/commit", "dev", allSkills);
    expect(result.valid).toBe(true);
    expect(result.name).toBe("commit");
  });

  it("reports missing SKILL.md", () => {
    mockExistsSync.mockReturnValue(false);

    const result = validateSkill("/skills/commit", "dev", allSkills);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("SKILL.md not found"))).toBe(true);
  });

  it("reports unreadable SKILL.md", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    const result = validateSkill("/skills/commit", "dev", allSkills);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("Cannot read"))).toBe(true);
  });

  it("collects issues from all validators", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`---
name: wrong
---

No headings here just text.
`);

    const result = validateSkill("/skills/commit", "dev", allSkills);
    // Should have: name mismatch warning, missing description error, no headings warning
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
    expect(result.valid).toBe(false); // missing description is an error
  });

  it("validates directory name", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`---
name: my-skill
description: A valid description that is long enough. Don't use elsewhere.
---

## Steps
`);

    const result = validateSkill("/skills/MySkill", "dev", allSkills);
    // Invalid dir name (uppercase)
    expect(result.issues.some((i) => i.field === "directory")).toBe(true);
  });
});

// ── validateEvals ────────────────────────────────────────────────────────────

describe("validateEvals", () => {
  const threeChecks = ["check one", "check two", "check three"];
  function validEval(id: number): Record<string, unknown> {
    return { id, prompt: "a realistic user prompt", expectations: threeChecks };
  }
  function evalsJson(evals: unknown): string {
    return JSON.stringify({ skill_name: "demo", evals });
  }

  it("accepts evals using the expectations field (Anthropic-native)", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(evalsJson([validEval(1), validEval(2), validEval(3)]));
    expect(validateEvals("/skills/demo")).toEqual([]);
  });

  it("accepts evals using the assertions field (agentskills.io)", () => {
    mockExistsSync.mockReturnValue(true);
    const withAssertions = (id: number) => ({ id, prompt: "p", assertions: threeChecks });
    mockReadFileSync.mockReturnValue(evalsJson([withAssertions(1), withAssertions(2), withAssertions(3)]));
    expect(validateEvals("/skills/demo")).toEqual([]);
  });

  it("errors when evals/evals.json is missing", () => {
    mockExistsSync.mockReturnValue(false);
    const issues = validateEvals("/skills/demo");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("Missing evals/evals.json");
  });

  it("errors on invalid JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{ not valid json");
    const issues = validateEvals("/skills/demo");
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("Invalid JSON");
  });

  it("errors when the evals key is not an array", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ skill_name: "demo" }));
    const issues = validateEvals("/skills/demo");
    expect(issues[0].message).toContain("'evals' array");
  });

  it("errors when fewer than 3 evals", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(evalsJson([validEval(1), validEval(2)]));
    const issues = validateEvals("/skills/demo");
    expect(issues.some((i) => i.severity === "error" && i.message.includes("minimum 3"))).toBe(true);
  });

  it("errors when an eval has fewer than 3 checks", () => {
    mockExistsSync.mockReturnValue(true);
    const weak = { id: 1, prompt: "p", expectations: ["only one"] };
    mockReadFileSync.mockReturnValue(evalsJson([weak, validEval(2), validEval(3)]));
    const issues = validateEvals("/skills/demo");
    expect(issues.some((i) => i.message.includes("eval[0]") && i.message.includes("found 1"))).toBe(true);
  });

  it("errors when an eval has neither expectations nor assertions", () => {
    mockExistsSync.mockReturnValue(true);
    const none = { id: 1, prompt: "p" };
    mockReadFileSync.mockReturnValue(evalsJson([none, validEval(2), validEval(3)]));
    const issues = validateEvals("/skills/demo");
    expect(issues.some((i) => i.message.includes("found 0"))).toBe(true);
  });

  it("errors when a prompt is empty", () => {
    mockExistsSync.mockReturnValue(true);
    const noPrompt = { id: 1, prompt: "   ", expectations: threeChecks };
    mockReadFileSync.mockReturnValue(evalsJson([noPrompt, validEval(2), validEval(3)]));
    const issues = validateEvals("/skills/demo");
    expect(issues.some((i) => i.message.includes("non-empty 'prompt'"))).toBe(true);
  });
});

// ── validateAllSkills ────────────────────────────────────────────────────────

describe("validateAllSkills", () => {
  it("validates all skills from all sources", () => {
    mockGetSkillSources.mockReturnValue([
      {
        label: "dev",
        path: "/skills",
        scanner: () => ["/skills/commit", "/skills/review"],
      },
    ]);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path) => {
      const name = String(path).split("/").slice(-2, -1)[0];
      return `---
name: ${name}
description: >
  A long enough description for ${name}. Don't use elsewhere.
---

## Steps

1. Do something.
`;
    });

    const summary = validateAllSkills();
    expect(summary.total).toBe(2);
    expect(summary.valid).toBe(2);
    expect(summary.withErrors).toBe(0);
  });

  it("deduplicates skills by name", () => {
    mockGetSkillSources.mockReturnValue([
      {
        label: "user",
        path: "/user-skills",
        scanner: () => ["/user-skills/commit"],
      },
      {
        label: "builtin",
        path: "/builtin-skills",
        scanner: () => ["/builtin-skills/commit"],
      },
    ]);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`---
name: commit
description: A long enough description for commit. Don't use elsewhere.
---

## Steps
`);

    const summary = validateAllSkills();
    expect(summary.total).toBe(1); // deduplicated
  });

  it("counts errors and warnings", () => {
    mockGetSkillSources.mockReturnValue([
      {
        label: "dev",
        path: "/skills",
        scanner: () => ["/skills/good", "/skills/bad"],
      },
    ]);
    mockExistsSync.mockImplementation((path) => {
      if (String(path).includes("bad")) return false;
      return true;
    });
    mockReadFileSync.mockReturnValue(`---
name: good
description: A long enough description for good skill. Don't use elsewhere.
---

## Steps
`);

    const summary = validateAllSkills();
    expect(summary.total).toBe(2);
    expect(summary.valid).toBe(1);
    expect(summary.withErrors).toBe(1);
  });
});

// ── validateFrontmatter — remaining type-check branches ──────────────────────

describe("validateFrontmatter — remaining optional field type errors", () => {
  it("errors when user-invocable is not a boolean", () => {
    const content = `---
name: my-skill
description: A long enough description for validation. Don't use elsewhere.
user-invocable: "yes"
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const typeErrors = issues.filter((i) => i.field === "user-invocable");
    expect(typeErrors).toHaveLength(1);
    expect(typeErrors[0].severity).toBe("error");
    expect(typeErrors[0].message).toContain("boolean");
  });

  it("errors when context is not an array", () => {
    const content = `---
name: my-skill
description: A long enough description for validation. Don't use elsewhere.
context: "codebase"
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const typeErrors = issues.filter((i) => i.field === "context");
    expect(typeErrors).toHaveLength(1);
    expect(typeErrors[0].severity).toBe("error");
    expect(typeErrors[0].message).toContain("array");
  });

  it("errors when agent is not an array", () => {
    const content = `---
name: my-skill
description: A long enough description for validation. Don't use elsewhere.
agent: claude
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const typeErrors = issues.filter((i) => i.field === "agent");
    expect(typeErrors).toHaveLength(1);
    expect(typeErrors[0].severity).toBe("error");
    expect(typeErrors[0].message).toContain("array");
  });

  it("errors when model is not a string", () => {
    const content = `---
name: my-skill
description: A long enough description for validation. Don't use elsewhere.
model: 42
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const typeErrors = issues.filter((i) => i.field === "model");
    expect(typeErrors).toHaveLength(1);
    expect(typeErrors[0].severity).toBe("error");
    expect(typeErrors[0].message).toContain("string");
  });

  it("errors when name field is not a string", () => {
    const content = `---
name: 123
description: A long enough description for validation. Don't use elsewhere.
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const nameErrors = issues.filter((i) => i.field === "name");
    expect(nameErrors).toHaveLength(1);
    expect(nameErrors[0].severity).toBe("error");
    expect(nameErrors[0].message).toContain("string");
  });

  it("errors when description field is not a string", () => {
    const content = `---
name: my-skill
description: 42
---

Content
`;
    const issues = validateFrontmatter(content, "my-skill");
    const descErrors = issues.filter((i) => i.field === "description");
    expect(descErrors).toHaveLength(1);
    expect(descErrors[0].severity).toBe("error");
    expect(descErrors[0].message).toContain("string");
  });
});

// ── showValidationResults ────────────────────────────────────────────────────

import type { ValidationSummary } from "./validate.js";
import { showValidationResults } from "./validate.js";

function makeSummary(overrides: Partial<ValidationSummary> = {}): ValidationSummary {
  return {
    total: 0,
    valid: 0,
    withErrors: 0,
    withWarnings: 0,
    results: [],
    ...overrides,
  };
}

describe("showValidationResults", () => {
  it("shows all valid when no errors or warnings", () => {
    const summary = makeSummary({ total: 3, valid: 3, results: [] });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    showValidationResults(summary, false);
    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("3 skills valid");
    spy.mockRestore();
  });

  it("shows error and warning counts in summary line", () => {
    const summary = makeSummary({
      total: 3,
      valid: 1,
      withErrors: 1,
      withWarnings: 1,
      results: [
        { name: "good", directory: "/skills/good", sourceLabel: "dev", valid: true, issues: [] },
        {
          name: "bad",
          directory: "/skills/bad",
          sourceLabel: "dev",
          valid: false,
          issues: [{ severity: "error", message: "SKILL.md not found", field: "file" }],
        },
        {
          name: "warn",
          directory: "/skills/warn",
          sourceLabel: "dev",
          valid: true,
          issues: [{ severity: "warning", message: "Short description", field: "description" }],
        },
      ],
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    showValidationResults(summary, false);
    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("1/3 valid");
    expect(output).toContain("with errors");
    expect(output).toContain("with warnings");
    spy.mockRestore();
  });

  it("shows skill row for skills with errors", () => {
    const summary = makeSummary({
      total: 1,
      valid: 0,
      withErrors: 1,
      results: [
        {
          name: "broken",
          directory: "/skills/broken",
          sourceLabel: "dev",
          valid: false,
          issues: [{ severity: "error", message: "SKILL.md not found", field: "file" }],
        },
      ],
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    showValidationResults(summary, false);
    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("broken");
    expect(output).toContain("SKILL.md not found");
    spy.mockRestore();
  });

  it("in verbose mode shows clean skills too", () => {
    const summary = makeSummary({
      total: 1,
      valid: 1,
      results: [{ name: "clean", directory: "/skills/clean", sourceLabel: "dev", valid: true, issues: [] }],
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    showValidationResults(summary, true);
    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("clean");
    spy.mockRestore();
  });

  it("in non-verbose mode hides clean skills", () => {
    const summary = makeSummary({
      total: 1,
      valid: 1,
      results: [{ name: "silent", directory: "/skills/silent", sourceLabel: "dev", valid: true, issues: [] }],
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    showValidationResults(summary, false);
    const output = spy.mock.calls.flat().join("\n");
    expect(output).not.toContain("silent");
    spy.mockRestore();
  });

  it("filters out info issues in non-verbose mode", () => {
    const summary = makeSummary({
      total: 1,
      valid: 1,
      withWarnings: 0,
      results: [
        {
          name: "info-only",
          directory: "/skills/info-only",
          sourceLabel: "dev",
          valid: true,
          issues: [{ severity: "info", message: "Consider adding guidance", field: "description" }],
        },
      ],
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    showValidationResults(summary, false);
    const output = spy.mock.calls.flat().join("\n");
    // info-only issues are filtered out in non-verbose mode → skill appears clean
    expect(output).not.toContain("Consider adding");
    spy.mockRestore();
  });

  it("shows info issues in verbose mode", () => {
    const summary = makeSummary({
      total: 1,
      valid: 1,
      results: [
        {
          name: "info-skill",
          directory: "/skills/info-skill",
          sourceLabel: "dev",
          valid: true,
          issues: [{ severity: "info", message: "Consider adding guidance", field: "description" }],
        },
      ],
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    showValidationResults(summary, true);
    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("Consider adding guidance");
    spy.mockRestore();
  });

  it("shows plural 'errors' for multiple errors", () => {
    const summary = makeSummary({
      total: 1,
      valid: 0,
      withErrors: 1,
      results: [
        {
          name: "multi-error",
          directory: "/skills/multi-error",
          sourceLabel: "dev",
          valid: false,
          issues: [
            { severity: "error", message: "Missing name", field: "name" },
            { severity: "error", message: "Missing description", field: "description" },
          ],
        },
      ],
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    showValidationResults(summary, false);
    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("2 errors");
    spy.mockRestore();
  });

  it("shows plural 'warnings' for multiple warnings", () => {
    const summary = makeSummary({
      total: 1,
      valid: 1,
      withWarnings: 1,
      results: [
        {
          name: "multi-warn",
          directory: "/skills/multi-warn",
          sourceLabel: "dev",
          valid: true,
          issues: [
            { severity: "warning", message: "Short description", field: "description" },
            { severity: "warning", message: "Unknown field: foo", field: "foo" },
          ],
        },
      ],
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    showValidationResults(summary, false);
    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("2 warnings");
    spy.mockRestore();
  });

  it("shows issue field prefix when field is present", () => {
    const summary = makeSummary({
      total: 1,
      valid: 0,
      withErrors: 1,
      results: [
        {
          name: "field-test",
          directory: "/skills/field-test",
          sourceLabel: "dev",
          valid: false,
          issues: [{ severity: "error", message: "Missing name", field: "name" }],
        },
      ],
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    showValidationResults(summary, false);
    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("[name]");
    spy.mockRestore();
  });

  it("omits field prefix when field is absent", () => {
    const summary = makeSummary({
      total: 1,
      valid: 0,
      withErrors: 1,
      results: [
        {
          name: "no-field",
          directory: "/skills/no-field",
          sourceLabel: "dev",
          valid: false,
          issues: [{ severity: "error", message: "Some error without field" }],
        },
      ],
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    showValidationResults(summary, false);
    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("Some error without field");
    expect(output).not.toContain("[");
    spy.mockRestore();
  });
});
