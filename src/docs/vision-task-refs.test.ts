import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Verifier helpers — extracted in PR #729 so VISION.md, COMPETITION.md, the
// deep-dive doc, and root-level CHANGELOG/AGENTS/README citations of TASKS.md
// task IDs all run through one drift detector. Inlined into the test file
// because they have no production caller — every consumer is the test below.
// See git history for the original `src/docs/vision-task-refs.ts` standalone
// file (deleted alongside this inlining for a 213 src-LOC shrink).
// ─────────────────────────────────────────────────────────────────────────────

const taskIdPattern = "[a-z][a-z0-9-]*[a-z0-9]";

/**
 * Extracts task IDs referenced in `docs/VISION.md` via the `[`<id>`](../TASKS.md)`
 * pattern that appears in every "Tracked by" column and inline reference. Pure
 * function so the unit tests can exercise corner cases without filesystem I/O.
 */
function extractVisionTaskIds(markdown: string): string[] {
  const ids = new Set<string>();
  const bracketed = new RegExp(`\\[\`(${taskIdPattern})\`\\]\\(\\.\\.\\/TASKS\\.md\\)`, "gu");
  for (const match of markdown.matchAll(bracketed)) {
    ids.add(match[1]);
  }
  return [...ids].sort();
}

/**
 * Extracts task IDs referenced in any markdown doc via a markdown link whose
 * target ends with `TASKS.md`. Matches both formats:
 *   - `[`<id>`](path/TASKS.md)` — VISION.md/competition tier-table style
 *   - `[<prose `<id>` prose>](path/TASKS.md)` — deep-dive doc inline citations
 *
 * Filters to kebab-case tokens containing at least one dash so single-word
 * backticks like `npx`, `bridle`, `skills` aren't misread as task IDs.
 */
function extractDocTaskRefs(markdown: string): string[] {
  const ids = new Set<string>();
  const linkRe = /\[((?:[^\]\\]|\\.)+)\]\(([^)]*TASKS\.md(?:#[^)]*)?)\)/gu;
  // Require at least one dash to filter out single-word backticks (npx, bridle, ...).
  const taskIdRe = /`([a-z][a-z0-9]*-[a-z0-9-]*[a-z0-9])`/gu;
  for (const match of markdown.matchAll(linkRe)) {
    const linkText = match[1];
    for (const tokenMatch of linkText.matchAll(taskIdRe)) {
      ids.add(tokenMatch[1]);
    }
  }
  return [...ids].sort();
}

/**
 * Extracts task IDs declared in `TASKS.md` — every `**ID**: <id>` metadata
 * line. Mirrors the format the next-task workflow already greps for.
 */
function extractTasksMdIds(markdown: string): string[] {
  const ids = new Set<string>();
  // TASKS.md uses sub-bullet metadata: `  - **ID**: foo` (see next-task workflow).
  const idLine = new RegExp(`^\\s*(?:-\\s+)?\\*\\*ID\\*\\*:\\s*(${taskIdPattern})\\s*$`, "gmu");
  for (const match of markdown.matchAll(idLine)) {
    ids.add(match[1]);
  }
  return [...ids].sort();
}

/**
 * Extracts task IDs cited in **prose** (not inside markdown links) on lines
 * that mention TASKS.md. This catches the `see TASKS.md (\`id1\`, \`id2\`)`
 * and "the \`id\` task in TASKS.md" patterns that {@link extractDocTaskRefs}
 * misses because they aren't formatted as markdown links.
 *
 * Uses precise context patterns to avoid false positives like Rust crate
 * names (`harness-locate`, `skills-locate`) that happen to share a line with
 * TASKS.md but aren't task references. Requires at least one dash in the
 * candidate ID for the same reason.
 *
 * Patterns matched (each must be in adjacency to a TASKS.md mention):
 *   - `(\`<id>\` ... TASKS.md ...)` — parenthetical containing both
 *   - `TASKS.md (\`<id>\`, \`<id2>\`, ...)` — backtick ID list following TASKS.md (not `(tag …)` metadata)
 *   - `TASKS.md \`<id>\`` / ``\`TASKS.md\` \`<id>\`` — direct adjacency
 *   - `\`<id>\` task in TASKS.md` — preceding adjacency with "task" keyword
 */
function extractInlineTaskRefs(markdown: string): string[] {
  const ids = new Set<string>();
  const dashedIdPattern = "[a-z][a-z0-9]*-[a-z0-9-]*[a-z0-9]";
  const idTokenRe = new RegExp(`\`(${dashedIdPattern})\``, "gu");

  // Pattern A: parenthetical group that contains TASKS.md AND backticked IDs.
  //   Example: "the single follow-up task (`<id>` in TASKS.md)".
  for (const match of markdown.matchAll(/\(([^()]*?TASKS\.md[^()]*?)\)/gu)) {
    for (const idMatch of match[1].matchAll(idTokenRe)) {
      ids.add(idMatch[1]);
    }
  }

  // Pattern B: TASKS.md (or `TASKS.md`) followed by a parenthetical of IDs.
  //   Example: "see TASKS.md (`<id1>`, `<id2>`, `<id3>`)".
  //   Skips metadata parens like "(tag `landscape-2026-07-06`)" — only lists
  //   that open with a backticked token are task references.
  for (const match of markdown.matchAll(/`?TASKS\.md`?\s*\(([^()]+)\)/gu)) {
    const inner = match[1].trim();
    if (/^tag\b/i.test(inner) || !inner.startsWith("`")) {
      continue;
    }
    for (const idMatch of match[1].matchAll(idTokenRe)) {
      ids.add(idMatch[1]);
    }
  }

  // Pattern C: TASKS.md (or `TASKS.md`) directly followed by a backticked ID.
  //   Example: "See TASKS.md `<id>`." or "see `TASKS.md` `<id>`".
  const adjacent = new RegExp(`\`?TASKS\\.md\`?\\s+\`(${dashedIdPattern})\``, "gu");
  for (const match of markdown.matchAll(adjacent)) {
    ids.add(match[1]);
  }

  // Pattern D: backticked ID followed by "task in TASKS.md".
  //   Example: "the `<id>` task in TASKS.md".
  const taskSuffix = new RegExp(`\`(${dashedIdPattern})\`\\s+task\\s+in\\s+TASKS\\.md`, "gu");
  for (const match of markdown.matchAll(taskSuffix)) {
    ids.add(match[1]);
  }

  // Pattern E: backticked ID followed by "in TASKS.md" (no "task" keyword).
  //   Example: "see `<id>` in TASKS.md", "from `<id>` in TASKS.md:".
  //   This is the most common prose form in source-code comments referencing
  //   shipped or in-flight tasks (e.g. "Rationale (see `<id>` in TASKS.md):").
  const inSuffix = new RegExp(`\`(${dashedIdPattern})\`\\s+in\\s+TASKS\\.md`, "gu");
  for (const match of markdown.matchAll(inSuffix)) {
    ids.add(match[1]);
  }

  return [...ids].sort();
}

/**
 * Combines IDs from TASKS.md and (optionally) RECURRING.md into one set.
 * RECURRING.md is the sibling file that holds calendar-driven recurring
 * work — references to its task IDs are valid the same way TASKS.md ones
 * are. Callers without a RECURRING.md just pass the empty string.
 */
function unionTaskIds(tasksMdMarkdown: string, recurringMdMarkdown: string): Set<string> {
  return new Set([...extractTasksMdIds(tasksMdMarkdown), ...extractTasksMdIds(recurringMdMarkdown)]);
}

/**
 * Returns task IDs cited in VISION.md that no longer appear in TASKS.md
 * (or RECURRING.md). Each entry signals that VISION.md is advertising a
 * planned task that has either shipped (and was removed) or was renamed
 * without VISION.md being updated.
 */
function findStaleVisionTaskRefs(visionMarkdown: string, tasksMdMarkdown: string, recurringMdMarkdown = ""): string[] {
  const visionIds = new Set(extractVisionTaskIds(visionMarkdown));
  const valid = unionTaskIds(tasksMdMarkdown, recurringMdMarkdown);
  return [...visionIds].filter((id) => !valid.has(id)).sort();
}

/**
 * Returns task IDs cited via markdown links OR prose adjacency in
 * `docMarkdown` that no longer appear in `tasksMdMarkdown` (or
 * `recurringMdMarkdown`). Generalized version of {@link findStaleVisionTaskRefs}
 * for COMPETITION.md and the deep-dive doc — combines {@link extractDocTaskRefs}
 * (link form) with {@link extractInlineTaskRefs} (prose form) so prose-style
 * stale refs fail loudly in CI instead of silently rotting.
 */
function findStaleDocTaskRefs(docMarkdown: string, tasksMdMarkdown: string, recurringMdMarkdown = ""): string[] {
  const docIds = new Set([...extractDocTaskRefs(docMarkdown), ...extractInlineTaskRefs(docMarkdown)]);
  const valid = unionTaskIds(tasksMdMarkdown, recurringMdMarkdown);
  return [...docIds].filter((id) => !valid.has(id)).sort();
}

/** Read a file if it exists; otherwise return the empty string (no recurring file in this repo, OK). */
function readIfExists(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Throws when VISION.md cites task IDs that are not present in TASKS.md
 * (or RECURRING.md, when that file exists). Used by the regression test
 * that runs against the real docs in this repo.
 */
function verifyVisionTaskRefs(visionPath: string, tasksMdPath: string, recurringMdPath?: string): void {
  const vision = readFileSync(visionPath, "utf-8");
  const tasks = readFileSync(tasksMdPath, "utf-8");
  const recurring = recurringMdPath ? readIfExists(recurringMdPath) : "";
  const stale = findStaleVisionTaskRefs(vision, tasks, recurring);
  if (stale.length === 0) {
    return;
  }
  throw new Error(
    [
      `${visionPath} cites task IDs that no longer exist in ${tasksMdPath}${recurringMdPath ? ` or ${recurringMdPath}` : ""}:`,
      ...stale.map((id) => `  - ${id}`),
      "Either restore the task, drop the VISION.md reference, or move the",
      "row to a 'Shipped' section if the work has landed.",
    ].join("\n"),
  );
}

/**
 * Throws when any markdown doc cites task IDs (via a link to TASKS.md) that
 * no longer exist in TASKS.md (or RECURRING.md, when that file exists).
 * Used by the regression test against COMPETITION.md, the deep-dive doc,
 * and the competition folder README.
 */
function verifyDocTaskRefs(docPath: string, tasksMdPath: string, recurringMdPath?: string): void {
  const doc = readFileSync(docPath, "utf-8");
  const tasks = readFileSync(tasksMdPath, "utf-8");
  const recurring = recurringMdPath ? readIfExists(recurringMdPath) : "";
  const stale = findStaleDocTaskRefs(doc, tasks, recurring);
  if (stale.length === 0) {
    return;
  }
  throw new Error(
    [
      `${docPath} cites task IDs that no longer exist in ${tasksMdPath}${recurringMdPath ? ` or ${recurringMdPath}` : ""}:`,
      ...stale.map((id) => `  - ${id}`),
      "Either restore the task, drop the reference, or rename the citation",
      "if the task ID changed.",
    ].join("\n"),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("extractVisionTaskIds", () => {
  it("extracts every [`<id>`](../TASKS.md) reference, deduplicated and sorted", () => {
    const markdown = [
      "Tracked by [`zeta-task`](../TASKS.md).",
      "Also see [`alpha-task`](../TASKS.md) and [`zeta-task`](../TASKS.md).",
    ].join("\n");
    expect(extractVisionTaskIds(markdown)).toEqual(["alpha-task", "zeta-task"]);
  });

  it("returns an empty list when no bracketed task references appear", () => {
    expect(extractVisionTaskIds("No task references here. `inline-id` does not count.")).toEqual([]);
  });

  it("ignores bracketed links that point somewhere other than ../TASKS.md", () => {
    const markdown = "[`task-id`](../docs/elsewhere.md) is a link to a different file.";
    expect(extractVisionTaskIds(markdown)).toEqual([]);
  });
});

describe("extractDocTaskRefs", () => {
  it("extracts kebab-case task IDs from inline link text where the target is TASKS.md", () => {
    const markdown = [
      "See [TASKS.md `delegate-skill-install-to-skills-cli` task](../../TASKS.md).",
      "Tracked in [`alpha-beta-gamma`](../TASKS.md).",
    ].join("\n");
    expect(extractDocTaskRefs(markdown)).toEqual(["alpha-beta-gamma", "delegate-skill-install-to-skills-cli"]);
  });

  it("ignores single-word backtick tokens like `npx` or `bridle` (no dash)", () => {
    const markdown = "See [the `bridle` tool and `npx` invocation](../TASKS.md).";
    expect(extractDocTaskRefs(markdown)).toEqual([]);
  });

  it("ignores backtick tokens outside markdown links to TASKS.md", () => {
    const markdown = "Plain mention `not-a-task-link` in prose.";
    expect(extractDocTaskRefs(markdown)).toEqual([]);
  });

  it("handles links with anchors like (../TASKS.md#section)", () => {
    const markdown = "See [`my-task`](../TASKS.md#some-anchor).";
    expect(extractDocTaskRefs(markdown)).toEqual(["my-task"]);
  });
});

describe("extractInlineTaskRefs", () => {
  it("captures IDs in a parenthetical that follows a TASKS.md mention", () => {
    const markdown = "see TASKS.md (`absorb-foo-bar`, `absorb-baz-qux`, `audit-zip-zap`).";
    expect(extractInlineTaskRefs(markdown)).toEqual(["absorb-baz-qux", "absorb-foo-bar", "audit-zip-zap"]);
  });

  it("captures IDs inside a parenthetical that contains TASKS.md", () => {
    const markdown = "the single follow-up task (`delegate-skill-foo` in TASKS.md).";
    expect(extractInlineTaskRefs(markdown)).toEqual(["delegate-skill-foo"]);
  });

  it("captures the ID directly adjacent to TASKS.md", () => {
    const markdown = "See TASKS.md `my-task-id`.";
    expect(extractInlineTaskRefs(markdown)).toEqual(["my-task-id"]);
  });

  it("captures the ID with backticked TASKS.md adjacency", () => {
    const markdown = "See `TASKS.md` `my-task-id`.";
    expect(extractInlineTaskRefs(markdown)).toEqual(["my-task-id"]);
  });

  it("captures the ID preceding `task in TASKS.md`", () => {
    const markdown = "Fixes live under the `status-numbers-self-consistent` task in TASKS.md.";
    expect(extractInlineTaskRefs(markdown)).toEqual(["status-numbers-self-consistent"]);
  });

  it("captures the ID preceding `in TASKS.md` (no `task` keyword)", () => {
    // This is the common form in source-code comments referencing shipped tasks.
    const markdown = "Per `state-schema-migration-helper` in TASKS.md: encode shape once.";
    expect(extractInlineTaskRefs(markdown)).toEqual(["state-schema-migration-helper"]);
  });

  it("ignores backticked tokens that aren't adjacent to TASKS.md", () => {
    // Crate names in an unrelated parenthetical should not be flagged even though TASKS.md is on the same line.
    const markdown =
      "3 crates (`bridle` + `harness-locate` + `skills-locate`). Absorb 3 ideas — see TASKS.md (`absorb-foo`, `audit-bar-baz`).";
    expect(extractInlineTaskRefs(markdown)).toEqual(["absorb-foo", "audit-bar-baz"]);
  });

  it("ignores single-word backticks (no dash)", () => {
    const markdown = "see TASKS.md (`bridle`, `npx`).";
    expect(extractInlineTaskRefs(markdown)).toEqual([]);
  });

  it("returns an empty list when TASKS.md is absent", () => {
    expect(extractInlineTaskRefs("the `my-task-id` is just prose without TASKS_md mention.")).toEqual([]);
  });

  it("ignores TASKS.md (tag `id`) metadata parens — not task ID lists", () => {
    const markdown =
      "Tracked by the landscape review P0 tasks in TASKS.md (tag `landscape-2026-07-06`). Also see TASKS.md (`absorb-foo`, `audit-bar-baz`).";
    expect(extractInlineTaskRefs(markdown)).toEqual(["absorb-foo", "audit-bar-baz"]);
  });
});

describe("extractTasksMdIds", () => {
  it("extracts every **ID**: <id> metadata line, deduplicated and sorted", () => {
    const markdown = ["  **ID**: foo-bar", "  **ID**: baz-qux", "  **ID**: foo-bar"].join("\n");
    expect(extractTasksMdIds(markdown)).toEqual(["baz-qux", "foo-bar"]);
  });

  it("extracts **ID** from TASKS.md sub-bullet metadata lines", () => {
    const markdown = ["- [ ] Do the thing", "  - **ID**: delete-generic-skills-point-to-upstream-repos"].join("\n");
    expect(extractTasksMdIds(markdown)).toEqual(["delete-generic-skills-point-to-upstream-repos"]);
  });
});

describe("findStaleVisionTaskRefs", () => {
  it("flags VISION.md task IDs missing from TASKS.md", () => {
    const vision = "[`shipped-task`](../TASKS.md) and [`active-task`](../TASKS.md)";
    const tasks = "  **ID**: active-task";
    expect(findStaleVisionTaskRefs(vision, tasks)).toEqual(["shipped-task"]);
  });

  it("returns an empty list when every reference resolves", () => {
    const vision = "[`task-a`](../TASKS.md)";
    const tasks = ["  **ID**: task-a", "  **ID**: task-b"].join("\n");
    expect(findStaleVisionTaskRefs(vision, tasks)).toEqual([]);
  });
});

describe("findStaleDocTaskRefs", () => {
  it("flags task IDs cited in COMPETITION.md style links that don't exist in TASKS.md", () => {
    const doc = [
      "See [TASKS.md `ghost-task` and `live-task`](../../TASKS.md).",
      "Also [`renamed-task`](../../TASKS.md).",
    ].join("\n");
    const tasks = ["  **ID**: live-task"].join("\n");
    expect(findStaleDocTaskRefs(doc, tasks)).toEqual(["ghost-task", "renamed-task"]);
  });
});

describe("verifyVisionTaskRefs — integration", () => {
  it("passes against the real docs/VISION.md + TASKS.md in this repo", () => {
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    expect(() =>
      verifyVisionTaskRefs(
        join(repoRoot, "docs", "VISION.md"),
        join(repoRoot, "TASKS.md"),
        join(repoRoot, "RECURRING.md"),
      ),
    ).not.toThrow();
  });

  it("throws with a clear error when a synthetic ghost task reference is injected", () => {
    const directory = mkdtempSync(join(tmpdir(), "vision-task-refs-"));
    const visionPath = join(directory, "VISION.md");
    const tasksPath = join(directory, "TASKS.md");
    writeFileSync(visionPath, "Tracked by [`ghost-task-id`](../TASKS.md).", "utf8");
    writeFileSync(tasksPath, "  **ID**: real-task-id\n", "utf8");
    expect(() => verifyVisionTaskRefs(visionPath, tasksPath)).toThrowError(/ghost-task-id/u);
  });
});

/**
 * Recursively collect files under `dir` whose name matches a predicate.
 * Used by the integration tests below to scan the entire `docs/` tree (for
 * markdown drift) and the `src/` tree (for production source-code comments)
 * without requiring per-file maintenance. New files that cite task IDs are
 * automatically covered.
 */
function collectFiles(dir: string, accept: (entry: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectFiles(full, accept));
    } else if (accept(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("verifyDocTaskRefs — integration", () => {
  it("passes against every markdown doc under docs/ — auto-discovers new docs", () => {
    // Walks all `*.md` under docs/ and runs the verifier on each. Catches
    // stale task ID refs (link or prose form) regardless of which file
    // introduces them, so new docs that mention task IDs get coverage
    // without per-file test maintenance. Replaces the per-file expects
    // for COMPETITION.md, the deep-dive, the competition README, and the
    // user-stories doc — all are covered automatically now.
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const tasksMd = join(repoRoot, "TASKS.md");
    const recurringMd = join(repoRoot, "RECURRING.md");
    const docsDir = join(repoRoot, "docs");
    const docFiles = collectFiles(docsDir, (entry) => entry.endsWith(".md"));
    expect(docFiles.length).toBeGreaterThan(0);
    for (const docPath of docFiles) {
      expect(() => verifyDocTaskRefs(docPath, tasksMd, recurringMd), `stale task refs in ${docPath}`).not.toThrow();
    }
  });

  it("passes against root-level docs that cite TASKS.md task IDs (CHANGELOG, AGENTS, README)", () => {
    // CHANGELOG.md frequently references shipped tasks by ID; AGENTS.md
    // and README.md both link to TASKS.md and could carry stale prose
    // refs. Same drift class as the docs/ walk — covers the root-level
    // markdown that the docs/ walk doesn't reach.
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const tasksMd = join(repoRoot, "TASKS.md");
    const recurringMd = join(repoRoot, "RECURRING.md");
    const rootDocs = ["CHANGELOG.md", "AGENTS.md", "README.md"]
      .map((name) => join(repoRoot, name))
      .filter((path) => statSync(path).isFile());
    expect(rootDocs.length).toBeGreaterThan(0);
    for (const docPath of rootDocs) {
      expect(() => verifyDocTaskRefs(docPath, tasksMd, recurringMd), `stale task refs in ${docPath}`).not.toThrow();
    }
  });

  it("passes against every production source file under src/ — catches stale task refs in code comments", () => {
    // Source-code comments often cite TASKS.md task IDs as rationale for a
    // change ("Per `<id>` in TASKS.md: ..."). When the underlying task
    // ships and is removed from TASKS.md, the comment silently rots.
    // Walking src/**/*.ts (excluding *.test.ts) closes the same drift class
    // the doc walk closes for markdown — using the same extractor and the
    // same TASKS.md authoritative-list source.
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const tasksMd = join(repoRoot, "TASKS.md");
    const recurringMd = join(repoRoot, "RECURRING.md");
    const srcDir = join(repoRoot, "src");
    const srcFiles = collectFiles(srcDir, (entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"));
    expect(srcFiles.length).toBeGreaterThan(0);
    for (const srcPath of srcFiles) {
      expect(() => verifyDocTaskRefs(srcPath, tasksMd, recurringMd), `stale task refs in ${srcPath}`).not.toThrow();
    }
  });

  it("throws with a clear error when a doc cites a renamed task ID via an inline link", () => {
    const directory = mkdtempSync(join(tmpdir(), "doc-task-refs-"));
    const docPath = join(directory, "DEEP_DIVE.md");
    const tasksPath = join(directory, "TASKS.md");
    writeFileSync(docPath, "See [TASKS.md `old-name-of-task`](../../TASKS.md).", "utf8");
    writeFileSync(tasksPath, "  **ID**: new-name-of-task\n", "utf8");
    expect(() => verifyDocTaskRefs(docPath, tasksPath)).toThrowError(/old-name-of-task/u);
  });

  it("throws with a clear error when a doc cites a stale task ID via prose adjacency", () => {
    const directory = mkdtempSync(join(tmpdir(), "doc-task-refs-prose-"));
    const docPath = join(directory, "GUIDE.md");
    const tasksPath = join(directory, "TASKS.md");
    writeFileSync(docPath, "See TASKS.md `removed-task` for details.", "utf8");
    writeFileSync(tasksPath, "  **ID**: still-here\n", "utf8");
    expect(() => verifyDocTaskRefs(docPath, tasksPath)).toThrowError(/removed-task/u);
  });
});
