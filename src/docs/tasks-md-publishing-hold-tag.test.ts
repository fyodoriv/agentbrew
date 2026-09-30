import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Splits a TASKS.md document into one block per task. A task block starts
 * at a `- [ ]` (or `- [x]`) line and runs through every metadata line that
 * follows (lines beginning with at least two spaces) until the next task
 * boundary (blank-line-then-`-` or another `- [ ]`).
 *
 * Block boundaries are deterministic: any line that does NOT start with
 * whitespace ends the current block. This matches how the rest of the
 * tasks.md tooling splits the file.
 */
function splitIntoTaskBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    const isTaskStart = /^- \[[ x]\]/u.test(line);
    if (isTaskStart) {
      if (current) blocks.push(current.join("\n"));
      current = [line];
      continue;
    }
    if (current === null) continue;
    // Continue the current block as long as the line is part of the task
    // body. Metadata lines start with whitespace; a blank line is also
    // valid inside a multi-paragraph Details block. A non-indented,
    // non-empty line that isn't a task start ends the block.
    if (line === "" || line.startsWith(" ") || line.startsWith("\t")) {
      current.push(line);
      continue;
    }
    blocks.push(current.join("\n"));
    current = null;
  }

  if (current) blocks.push(current.join("\n"));
  return blocks;
}

/**
 * Returns true when the block contains a `**Publishing hold**` mention
 * inside its `**Details**:` prose. Case-sensitive — the literal phrasing
 * is what every existing task uses.
 */
function hasPublishingHoldProse(block: string): boolean {
  return block.includes("**Publishing hold**");
}

/** Returns true when the block has a `**Human-approval-required**:` field with a non-empty reason. */
function hasHumanApprovalRequiredField(block: string): boolean {
  const match = block.match(/^\s*\*\*Human-approval-required\*\*:\s*(.+?)\s*$/mu);
  if (!match) return false;
  const value = match[1].trim();
  return value.length > 0;
}

/** Pull the `**ID**: <id>` from a task block for human-readable error messages. */
function extractTaskId(block: string): string | null {
  const match = block.match(/^\s*\*\*ID\*\*:\s*([a-z][a-z0-9-]*[a-z0-9])\s*$/mu);
  return match ? match[1] : null;
}

describe("splitIntoTaskBlocks", () => {
  it("splits a synthetic TASKS.md into one block per task", () => {
    const md = [
      "# Tasks",
      "",
      "## P0",
      "",
      "- [ ] First task",
      "  **ID**: first-task",
      "  **Tags**: foo",
      "",
      "- [ ] Second task",
      "  **ID**: second-task",
      "  **Tags**: bar",
      "",
      "## P1",
      "",
      "- [ ] Third task",
      "  **ID**: third-task",
    ].join("\n");
    const blocks = splitIntoTaskBlocks(md);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("first-task");
    expect(blocks[1]).toContain("second-task");
    expect(blocks[2]).toContain("third-task");
  });

  it("handles tasks with multi-paragraph Details blocks", () => {
    const md = [
      "- [ ] First task",
      "  **ID**: first-task",
      "  **Details**: First paragraph.",
      "    Second paragraph still in Details.",
      "",
      "    Third paragraph after a blank line.",
      "  **Acceptance**: passes.",
      "",
      "- [ ] Second task",
      "  **ID**: second-task",
    ].join("\n");
    const blocks = splitIntoTaskBlocks(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("Third paragraph after a blank line");
    expect(blocks[0]).toContain("Acceptance");
    expect(blocks[1]).toContain("second-task");
    expect(blocks[1]).not.toContain("Acceptance");
  });
});

describe("hasPublishingHoldProse", () => {
  it("returns true when **Publishing hold** appears anywhere in the block", () => {
    const block = "- [ ] Task\n  **Details**: **Publishing hold**: some context.\n  **ID**: foo";
    expect(hasPublishingHoldProse(block)).toBe(true);
  });

  it("returns false when the block does not mention Publishing hold", () => {
    const block = "- [ ] Task\n  **Details**: routine task.\n  **ID**: foo";
    expect(hasPublishingHoldProse(block)).toBe(false);
  });

  it("is case-sensitive — `publishing hold` (lower) does NOT match", () => {
    const block = "- [ ] Task\n  **Details**: there's a publishing hold concern.\n  **ID**: foo";
    expect(hasPublishingHoldProse(block)).toBe(false);
  });
});

describe("hasHumanApprovalRequiredField", () => {
  it("matches the canonical metadata-line format", () => {
    const block = "- [ ] Task\n  **ID**: foo\n  **Human-approval-required**: external-pr";
    expect(hasHumanApprovalRequiredField(block)).toBe(true);
  });

  it("matches comma-separated multi-value reasons", () => {
    const block = "- [ ] Task\n  **ID**: foo\n  **Human-approval-required**: external-issue, external-pr";
    expect(hasHumanApprovalRequiredField(block)).toBe(true);
  });

  it("returns false when the reason is empty whitespace", () => {
    const block = "- [ ] Task\n  **ID**: foo\n  **Human-approval-required**:    ";
    expect(hasHumanApprovalRequiredField(block)).toBe(false);
  });

  it("returns false when the field is absent", () => {
    const block = "- [ ] Task\n  **ID**: foo\n  **Acceptance**: passes.";
    expect(hasHumanApprovalRequiredField(block)).toBe(false);
  });
});

describe("TASKS.md publishing-hold tag enforcement — integration", () => {
  it("every task whose Details mentions `Publishing hold` has a `**Human-approval-required**:` field with a non-empty reason", () => {
    // This is the lint rule from the task body: every Publishing-hold
    // task MUST carry the machine-readable filter field. Without this
    // pairing, autonomous runs that filter on `--no-publishing` (or
    // equivalent) waste claim slots picking up tasks they can't ship.
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const tasksMd = readFileSync(resolve(repoRoot, "TASKS.md"), "utf-8");
    const blocks = splitIntoTaskBlocks(tasksMd);

    const violations: string[] = [];
    for (const block of blocks) {
      if (!hasPublishingHoldProse(block)) continue;
      if (hasHumanApprovalRequiredField(block)) continue;
      const id = extractTaskId(block) ?? "<no ID>";
      violations.push(id);
    }

    expect(
      violations,
      [
        "Every task whose Details mentions `**Publishing hold**` must also",
        "have a `**Human-approval-required**:` field with a non-empty reason",
        "string (e.g. `external-pr`, `external-issue`, `cross-repo-push`,",
        "`monitoring-only`, or comma-separated combinations).",
        "",
        "Tasks missing the field:",
        ...violations.map((v) => `  - ${v}`),
        "",
        "Add the field immediately after `**Acceptance**:` in each block.",
        "Keep the prose `Publishing hold:` paragraph in `**Details**:` —",
        "it remains the human-readable explanation. The new field is",
        "purely for machine filtering by the next-task workflow.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("synthetic regression: a Publishing-hold task without the field fails the same check", () => {
    // Pin the failure mode so a future refactor can't silently weaken
    // the validator.
    const md = [
      "- [ ] Task that publishes",
      "  **ID**: needs-the-field",
      "  **Details**: **Publishing hold**: gates external publishing.",
      "  **Acceptance**: ships.",
    ].join("\n");
    const blocks = splitIntoTaskBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(hasPublishingHoldProse(blocks[0])).toBe(true);
    expect(hasHumanApprovalRequiredField(blocks[0])).toBe(false);
  });

  it("synthetic regression: a Publishing-hold task WITH the field passes", () => {
    const md = [
      "- [ ] Task that publishes",
      "  **ID**: has-the-field",
      "  **Details**: **Publishing hold**: gates external publishing.",
      "  **Acceptance**: ships.",
      "  **Human-approval-required**: external-pr",
    ].join("\n");
    const blocks = splitIntoTaskBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(hasPublishingHoldProse(blocks[0])).toBe(true);
    expect(hasHumanApprovalRequiredField(blocks[0])).toBe(true);
  });
});
