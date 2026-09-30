import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Allowed values for the `**Output**:` metadata field in TASKS.md /
 * RECURRING.md task blocks. The next-task workflow filters by output
 * shape (e.g. a `--code-and-infra-only` marathon run keeps `code`,
 * `mixed`, `measurement` and skips `docs` / `audit-report`).
 */
const ALLOWED_OUTPUTS = new Set<string>(["code", "docs", "mixed", "audit-report", "measurement"]);

/**
 * Allowed values for the `**Cadence**:` metadata field in RECURRING.md
 * task blocks. Calendar-driven cadences plus the `next:` form for a
 * specific date.
 */
const ALLOWED_CADENCES = new Set<string>(["quarterly", "monthly", "weekly", "bi-weekly"]);

/**
 * Splits a tasks-md document into one block per task. Same boundary
 * detection as `tasks-md-publishing-hold-tag.test.ts` — a task block
 * starts at `- [ ]` and ends when a non-indented, non-empty, non-task-
 * start line appears.
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

/** Pull the `**ID**: <id>` from a task block for human-readable error messages. */
function extractTaskId(block: string): string | null {
  const match = block.match(/^\s*\*\*ID\*\*:\s*([a-z][a-z0-9-]*[a-z0-9])\s*$/mu);
  return match ? match[1] : null;
}

/** Returns the value of `**Output**: <value>` if present, else null. */
function extractOutput(block: string): string | null {
  const match = block.match(/^\s*\*\*Output\*\*:\s*(.+?)\s*$/mu);
  return match ? match[1].trim() : null;
}

/** Returns the value of `**Cadence**: <value>` if present, else null. */
function extractCadence(block: string): string | null {
  const match = block.match(/^\s*\*\*Cadence\*\*:\s*(.+?)\s*$/mu);
  return match ? match[1].trim() : null;
}

describe("ALLOWED_OUTPUTS", () => {
  it("contains the canonical 5 output shapes", () => {
    expect([...ALLOWED_OUTPUTS].sort()).toEqual(["audit-report", "code", "docs", "measurement", "mixed"]);
  });
});

describe("ALLOWED_CADENCES", () => {
  it("contains the canonical 4 cadence values (plus `next: <date>` form)", () => {
    expect([...ALLOWED_CADENCES].sort()).toEqual(["bi-weekly", "monthly", "quarterly", "weekly"]);
  });
});

describe("extractOutput", () => {
  it("matches the canonical metadata-line format", () => {
    expect(extractOutput("- [ ] Task\n  **Output**: docs")).toBe("docs");
  });

  it("returns null when the field is absent", () => {
    expect(extractOutput("- [ ] Task\n  **ID**: foo")).toBeNull();
  });
});

describe("extractCadence", () => {
  it("matches the canonical cadence values", () => {
    expect(extractCadence("- [ ] Task\n  **Cadence**: quarterly")).toBe("quarterly");
    expect(extractCadence("- [ ] Task\n  **Cadence**: weekly")).toBe("weekly");
  });

  it("matches the `next: <date>` form", () => {
    expect(extractCadence("- [ ] Task\n  **Cadence**: next: 2026-07-01")).toBe("next: 2026-07-01");
  });

  it("returns null when the field is absent", () => {
    expect(extractCadence("- [ ] Task\n  **ID**: foo")).toBeNull();
  });
});

describe("TASKS.md output / cadence schema enforcement — integration", () => {
  it("no task in TASKS.md has a `**Cadence**:` field — those belong in RECURRING.md", () => {
    // The validator's first invariant from the move-recurring-and-research-
    // tasks-out-of-active-queue task. Cadence-tagged work is calendar-
    // driven and lives in RECURRING.md so the next-task workflow doesn't
    // burn claim slots on tasks that aren't due.
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const tasksMd = readFileSync(resolve(repoRoot, "TASKS.md"), "utf-8");
    const blocks = splitIntoTaskBlocks(tasksMd);

    const violations: string[] = [];
    for (const block of blocks) {
      const cadence = extractCadence(block);
      if (cadence === null) continue;
      const id = extractTaskId(block) ?? "<no ID>";
      violations.push(`${id} (cadence: ${cadence})`);
    }

    expect(
      violations,
      [
        "Tasks with `**Cadence**:` must live in `RECURRING.md`, not `TASKS.md`.",
        "",
        "Move these task blocks from TASKS.md to RECURRING.md (with the same body):",
        ...violations.map((v) => `  - ${v}`),
        "",
        "RECURRING.md is a sibling of TASKS.md. The next-task workflow",
        "consults both files but skips recurring tasks unless their cadence",
        "window has opened.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("every task in TASKS.md whose `**Output**:` is set uses an allowed value", () => {
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const tasksMd = readFileSync(resolve(repoRoot, "TASKS.md"), "utf-8");
    const blocks = splitIntoTaskBlocks(tasksMd);

    const violations: string[] = [];
    for (const block of blocks) {
      const output = extractOutput(block);
      if (output === null) continue;
      if (ALLOWED_OUTPUTS.has(output)) continue;
      const id = extractTaskId(block) ?? "<no ID>";
      violations.push(`${id} (got: '${output}')`);
    }

    expect(
      violations,
      [
        "Every task with `**Output**:` must use one of the allowed values:",
        `  ${[...ALLOWED_OUTPUTS].sort().join(", ")}`,
        "",
        "Tasks with invalid output values:",
        ...violations.map((v) => `  - ${v}`),
      ].join("\n"),
    ).toEqual([]);
  });
});

describe("RECURRING.md schema — integration", () => {
  it("RECURRING.md exists at the repo root", () => {
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    expect(existsSync(resolve(repoRoot, "RECURRING.md"))).toBe(true);
  });

  it("every task in RECURRING.md has a `**Cadence**:` field with an allowed value", () => {
    // RECURRING.md's contract: every task here is calendar-driven, so
    // every task must declare its cadence.
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const recurringPath = resolve(repoRoot, "RECURRING.md");
    if (!existsSync(recurringPath)) return; // covered by the existence test above
    const recurring = readFileSync(recurringPath, "utf-8");
    const blocks = splitIntoTaskBlocks(recurring);

    const missing: string[] = [];
    const invalid: string[] = [];
    for (const block of blocks) {
      const cadence = extractCadence(block);
      const id = extractTaskId(block) ?? "<no ID>";
      if (cadence === null) {
        missing.push(id);
        continue;
      }
      const isAllowedKeyword = ALLOWED_CADENCES.has(cadence);
      const isNextForm = /^next:\s*\d{4}-\d{2}-\d{2}$/u.test(cadence);
      if (!(isAllowedKeyword || isNextForm)) {
        invalid.push(`${id} (got: '${cadence}')`);
      }
    }

    expect(
      [...missing.map((id) => `missing-cadence: ${id}`), ...invalid.map((v) => `invalid-cadence: ${v}`)],
      [
        "Every task in RECURRING.md must have a `**Cadence**:` field.",
        "Allowed values:",
        `  ${[...ALLOWED_CADENCES].sort().join(", ")}, or 'next: YYYY-MM-DD' for a specific date`,
        "",
        "Tasks needing fixes:",
        ...missing.map((id) => `  - ${id} — missing **Cadence**: field`),
        ...invalid.map((v) => `  - ${v} — value not in allowed set`),
      ].join("\n"),
    ).toEqual([]);
  });

  it("every task in RECURRING.md has an `**Output**:` field with an allowed value", () => {
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const recurringPath = resolve(repoRoot, "RECURRING.md");
    if (!existsSync(recurringPath)) return;
    const recurring = readFileSync(recurringPath, "utf-8");
    const blocks = splitIntoTaskBlocks(recurring);

    const violations: string[] = [];
    for (const block of blocks) {
      const output = extractOutput(block);
      const id = extractTaskId(block) ?? "<no ID>";
      if (output === null) {
        violations.push(`missing-output: ${id}`);
        continue;
      }
      if (!ALLOWED_OUTPUTS.has(output)) {
        violations.push(`invalid-output: ${id} (got: '${output}')`);
      }
    }

    expect(
      violations,
      [
        "Every task in RECURRING.md must have an `**Output**:` field with an allowed value.",
        `Allowed values: ${[...ALLOWED_OUTPUTS].sort().join(", ")}`,
        "",
        "Tasks needing fixes:",
        ...violations.map((v) => `  - ${v}`),
      ].join("\n"),
    ).toEqual([]);
  });
});

describe("synthetic regressions", () => {
  it("a task with `**Cadence**:` in TASKS.md fails the no-cadence-in-tasks-md check", () => {
    const md = ["- [ ] Task", "  **ID**: needs-recurring", "  **Cadence**: weekly"].join("\n");
    const blocks = splitIntoTaskBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(extractCadence(blocks[0])).toBe("weekly");
  });

  it("an unknown Output value fails the allowed-set check", () => {
    const md = ["- [ ] Task", "  **ID**: bad-output", "  **Output**: novel-shape"].join("\n");
    const blocks = splitIntoTaskBlocks(md);
    expect(extractOutput(blocks[0])).toBe("novel-shape");
    expect(ALLOWED_OUTPUTS.has("novel-shape")).toBe(false);
  });
});
