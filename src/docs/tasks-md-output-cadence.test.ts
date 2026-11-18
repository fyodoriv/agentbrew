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
 * detection follows the tasks.md checkbox grammar. A non-indented,
 * non-empty line closes the current block.
 */
function splitIntoTaskBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    const isTaskStart = /^-\s+\[[\sx]?\]\s+(.+)$/u.test(line);
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
  const match = block.match(/^[ \t]{2,3}-[ \t]+\*\*ID\*\*:[ \t]*([a-z0-9]+(?:-[a-z0-9]+)*)[ \t\r]*$/mu);
  return match ? match[1] : null;
}

/** Returns the value of `**Output**: <value>` if present, else null. */
function extractOutput(block: string): string | null {
  const match = block.match(/^\s*(?:-\s+)?\*\*Output\*\*:\s*(.+?)\s*$/mu);
  return match ? match[1].trim() : null;
}

/** Returns the value of `**Cadence**: <value>` if present, else null. */
function extractCadence(block: string): string | null {
  const match = block.match(/^\s*(?:-\s+)?\*\*Cadence\*\*:\s*(.+?)\s*$/mu);
  return match ? match[1].trim() : null;
}

function missingRequiredFields(block: string): string[] {
  const missing = [];
  if (!extractTaskId(block)) missing.push("ID");
  if (!/^[ \t]{2,3}-[ \t]+\*\*Success\*\*:[ \t]*\S/mu.test(block)) missing.push("Success");
  return missing;
}

describe("TASKS.md required fields", () => {
  it("requires Success even when Acceptance is present", () => {
    const task = "- [ ] Task\n  - **ID**: sample-task\n  - **Acceptance**: The check passes.";
    expect(missingRequiredFields(task)).toEqual(["Success"]);
  });

  it("requires ID even when Success is present", () => {
    const task = "- [ ] Task\n  - **Success**: All checks pass.";
    expect(missingRequiredFields(task)).toEqual(["ID"]);
  });

  it("requires Success at the task metadata level", () => {
    const task = "- [ ] Task\n  - **ID**: sample-task\n  - **Details**: Notes\n    - **Success**: An example.";
    expect(missingRequiredFields(task)).toEqual(["Success"]);
  });

  it("requires ID at the task metadata level", () => {
    const task = "- [ ] Task\n  - **Success**: All checks pass.\n  - **Details**: Notes\n    - **ID**: nested-example";
    expect(missingRequiredFields(task)).toEqual(["ID"]);
  });

  it("handles supported checkbox spacing and metadata indentation", () => {
    const queue = "# Tasks\n\n## P1\n-  [ ] Missing fields\n- [] Complete\n   - **ID**: 1\n   - **Success**: One pass.";
    expect(splitIntoTaskBlocks(queue).map(missingRequiredFields)).toEqual([["ID", "Success"], []]);
  });

  it("requires both fields on every queued task", () => {
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const tasks = readFileSync(resolve(repoRoot, "TASKS.md"), "utf8");
    const violations = splitIntoTaskBlocks(tasks).flatMap((block) => {
      const missing = missingRequiredFields(block);
      return missing.length ? [`${block.split("\n")[0]} is missing ${missing.join(", ")}`] : [];
    });
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

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
