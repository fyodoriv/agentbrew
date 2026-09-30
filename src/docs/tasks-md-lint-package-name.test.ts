import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Drift class: `npx <pkg>` references in user-facing surfaces must use
 * the canonical npm package name, not the bin name.
 *
 * Background: the [tasks.md](https://tasks.md) project publishes its
 * validator as the scoped npm package `@tasks-md/lint` (the bin name
 * is `tasks-lint`). The unscoped invocation 404s on the registry —
 * the bare bin name is unpublished. PR #944 fixed two surfaces that
 * previously recommended the broken invocation:
 *
 *   - `templates/AGENTS.md` — deployed verbatim by `agentbrew sync` to
 *     every agent's instruction file (`~/.claude/CLAUDE.md`,
 *     `~/.codeium/windsurf/memories/global_rules.md`,
 *     `~/.config/devin/AGENTS.md`, `~/.codex/AGENTS.md`,
 *     `~/.gemini/GEMINI.md`, `~/.augment/guidelines.md`). Every
 *     agentbrew user reads this on every prompt.
 *   - `src/catalog.yaml` — the `tasks-md-spec` rule set installed via
 *     `agentbrew install tasks-md-spec`. Lands the same prose into
 *     `~/.config/agentbrew/shared-rules.md` and propagates from there.
 *
 * Per AGENTS.md "Feedback Loop Guardrails": when the same drift class
 * could recur (a future rename, a new agent skill copying the wrong
 * snippet), encode the canonical reference as a deterministic test so
 * the regression class can't reach a published artifact.
 *
 * Sources of truth:
 * - https://www.npmjs.com/package/@tasks-md/lint — the published
 *   package providing the bin.
 * - The wider scope set is enforced by `cli-removed-commands.test.ts`
 *   (a sibling drift class for renamed agentbrew CLI subcommands).
 *
 * Scope (mirrors `cli-removed-commands.test.ts` after PR #943
 * broadened it from a 2-file lockdown to a category lint):
 * - `src`, `skill-plugins`, `real-e2e` — all source / fixture code.
 * - `templates` — `templates/AGENTS.md` is deployed verbatim by
 *   `agentbrew sync` to every agent's instruction file.
 * - `docs` — picks up authoritative cross-repo references like
 *   `docs/agent-guide-baseline.md`. Noisy research subdirs are
 *   re-excluded below so this expansion doesn't drag in history.
 * - top-level `README.md` and `AGENTS.md` — the user-facing canonical
 *   surfaces.
 *
 * Files / directories deliberately excluded:
 * - CHANGELOG.md — documents the fix history, may legitimately mention
 *   the bare bin name in context.
 * - docs/competition/, docs/audits/, docs/proposals/, docs/research/
 *   — research and audit notes that legitimately quote bug reports
 *   and historical drift; locking these down would force noisy
 *   allowlist comments throughout the research corpus.
 *
 * Escape hatch: a line containing `tasks-md-lint-package-name-allowlist:`
 * is skipped (e.g. for a legitimate prose mention of the bin name
 * inside a quoted bug report or historical commit reference).
 *
 * Self-reference avoidance: this test file MUST NOT contain the
 * literal stale pattern in any line that the scanner would read.
 * Test fixtures and assertion messages either (a) build the literal
 * via runtime string concat (`npx ${"tasks-lint"}`), or (b) tag the
 * line with the allowlist token. Following the precedent set by
 * `cli-removed-commands.test.ts`.
 */

const STALE_PATTERN = /\bnpx(?:\s+--?[\w-]+)*\s+tasks-lint\b/;
const CANONICAL_PACKAGE = "@tasks-md/lint";
const ALLOWLIST_TOKEN = "tasks-md-lint-package-name-allowlist:";
// Build the broken invocation prefix at runtime so the literal pattern
// `npx <bare-bin-name>` doesn't appear in this file's source — which
// would otherwise trip the integration scan above. Used only by the
// regex-shape tests below.
const BARE_BIN_NAME = `tasks${"-lint"}`;

/**
 * Scan a single file for stale `npx <bare-bin-name>` references. Lines
 * containing the allowlist comment are skipped (escape hatch for
 * legitimate historical references).
 */
function findStaleNpxRefs(filePath: string): Array<{ line: number; text: string }> {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const findings: Array<{ line: number; text: string }> = [];
  content.split("\n").forEach((line, index) => {
    if (line.includes(ALLOWLIST_TOKEN)) return;
    if (STALE_PATTERN.test(line)) {
      findings.push({ line: index + 1, text: line.trim() });
    }
  });
  return findings;
}

/**
 * Recursively walk a directory and yield files matching the predicate.
 * Skips node_modules, dist, .git, coverage, and the test fixture caches.
 */
function* walkFiles(dir: string, accept: (relPath: string) => boolean, repoRoot: string): Generator<string> {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git" || entry === "coverage") continue;
    const full = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      yield* walkFiles(full, accept, repoRoot);
    } else {
      const rel = relative(repoRoot, full);
      if (accept(rel)) {
        yield full;
      }
    }
  }
}

const TARGET_EXTENSIONS = [".ts", ".yaml", ".yml", ".md"];
const EXCLUDED_FILES = new Set([
  // CHANGELOG documents the fix history (PR #944 entry mentions the bare bin name).
  "CHANGELOG.md",
]);
const EXCLUDED_DIR_PREFIXES = ["docs/competition/", "docs/audits/", "docs/proposals/", "docs/research/"];

function isInScope(relPath: string): boolean {
  if (EXCLUDED_FILES.has(relPath)) return false;
  if (EXCLUDED_DIR_PREFIXES.some((prefix) => relPath.startsWith(prefix))) return false;
  if (relPath.endsWith(".test.ts.snap")) return false;
  return TARGET_EXTENSIONS.some((ext) => relPath.endsWith(ext));
}

const SCAN_ROOTS = ["src", "skill-plugins", "docs", "real-e2e", "templates"];
const TOP_LEVEL_FILES = ["README.md", "AGENTS.md"];

function getRepoRoot(): string {
  return resolve(import.meta.dirname, "..", "..");
}

describe("tasks-md validator package-name drift — locked-down references", () => {
  it("README and user-facing top-level docs use the scoped @tasks-md/lint package", () => {
    const repoRoot = getRepoRoot();
    const violations: string[] = [];
    for (const name of TOP_LEVEL_FILES) {
      const full = resolve(repoRoot, name);
      for (const finding of findStaleNpxRefs(full)) {
        violations.push(
          `${name}:${finding.line}  recommends bare bin invocation — replace with \`npx ${CANONICAL_PACKAGE}\``,
        );
      }
    }
    expect(
      violations,
      [
        `Bare bin invocation 404s on the npm registry — the unscoped name is unpublished.`,
        `Use the canonical scoped package \`${CANONICAL_PACKAGE}\` instead.`,
        "",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });

  it("source code, skill plugins, docs, real-e2e, and templates use the scoped @tasks-md/lint package", () => {
    const repoRoot = getRepoRoot();
    const violations: string[] = [];
    for (const root of SCAN_ROOTS) {
      const rootDir = resolve(repoRoot, root);
      for (const file of walkFiles(rootDir, isInScope, repoRoot)) {
        for (const finding of findStaleNpxRefs(file)) {
          const rel = relative(repoRoot, file);
          violations.push(
            `${rel}:${finding.line}  recommends bare bin invocation — replace with \`npx ${CANONICAL_PACKAGE}\``,
          );
        }
      }
    }
    expect(
      violations,
      [
        `Bare bin invocation 404s on the npm registry — the unscoped name is unpublished.`,
        `Use the canonical scoped package \`${CANONICAL_PACKAGE}\` instead, or add a`,
        `\`${ALLOWLIST_TOKEN} <reason>\` comment on the same line if the reference is`,
        `legitimate history (e.g. quoting a bug report).`,
        "",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });

  it("regression: high-visibility deployed/cross-repo surfaces are in scope", () => {
    // The whole point of widening SCAN_ROOTS to include `templates`,
    // `skill-plugins`, and the broader `docs` tree is that future stale
    // bin-name refs in these files fail the lint just like a fresh
    // stale ref in `src/`. Pin that contract so a later refactor
    // can't silently drop coverage on, e.g., `templates/AGENTS.md`
    // (deployed verbatim by `agentbrew sync` to every agent's
    // instruction file), `src/catalog.yaml` (the original
    // `tasks-md-spec` rule that PR #944 fixed), or
    // `skill-plugins/dev/design-review/SKILL.md` (a permanent built-in
    // skill that legitimately references `npx @tasks-md/lint`).
    const repoRoot = getRepoRoot();
    const requiredInScope = [
      "templates/AGENTS.md",
      "src/catalog.yaml",
      "skill-plugins/dev/load-project-context/SKILL.md",
      "docs/agent-guide-baseline.md",
    ];
    const scanned = new Set<string>();
    for (const root of SCAN_ROOTS) {
      const rootDir = resolve(repoRoot, root);
      for (const file of walkFiles(rootDir, isInScope, repoRoot)) {
        scanned.add(relative(repoRoot, file));
      }
    }
    const missing = requiredInScope.filter((rel) => !scanned.has(rel));
    expect(
      missing,
      [
        "Files that MUST be scanned by the tasks-md-lint package-name lint were skipped.",
        "Either restore them to SCAN_ROOTS / TARGET_EXTENSIONS, or remove them",
        "from this regression test if they're being deleted intentionally.",
        "",
        ...missing.map((m) => `  - ${m}`),
      ].join("\n"),
    ).toEqual([]);
  });

  it("regression: research / audit / proposal / competition subdirs stay excluded", () => {
    // Symmetric to the previous regression: history-bearing research
    // subdirs intentionally legitimately reference the bare bin name
    // when documenting bug reports or historical drift. If a future
    // change drops the EXCLUDED_DIR_PREFIXES guard, the lint would
    // explode with historical-noise violations. Pin the exclusion
    // contract.
    const sampleExcluded = [
      "docs/competition/foo.md",
      "docs/audits/bar.md",
      "docs/proposals/baz.md",
      "docs/research/qux.md",
    ];
    for (const path of sampleExcluded) {
      expect(isInScope(path), `expected ${path} to be excluded by EXCLUDED_DIR_PREFIXES`).toBe(false);
    }
    // And confirm the broadened roots actually cover the new surfaces.
    expect(isInScope("templates/AGENTS.md")).toBe(true);
    expect(isInScope("src/catalog.yaml")).toBe(true);
    expect(isInScope("skill-plugins/dev/design-review/SKILL.md")).toBe(true);
    expect(isInScope("docs/agent-guide-baseline.md")).toBe(true);
  });

  it("STALE_PATTERN matches the documented broken invocations", () => {
    // Build the literal at runtime via BARE_BIN_NAME so the file source
    // doesn't contain `npx <bare-bin-name>`.
    expect(STALE_PATTERN.test(`npx ${BARE_BIN_NAME} TASKS.md`)).toBe(true);
    expect(STALE_PATTERN.test(`npx -y ${BARE_BIN_NAME} TASKS.md`)).toBe(true);
    expect(STALE_PATTERN.test(`npx --yes ${BARE_BIN_NAME} TASKS.md`)).toBe(true);
  });

  it("STALE_PATTERN does NOT match the canonical scoped invocation", () => {
    // The fix-string contains the bin-name substring inside the scoped
    // package — guard against accidental over-matching.
    expect(STALE_PATTERN.test(`npx ${CANONICAL_PACKAGE} TASKS.md`)).toBe(false);
    expect(STALE_PATTERN.test(`npx -y ${CANONICAL_PACKAGE} TASKS.md`)).toBe(false);
  });

  it("STALE_PATTERN does not match prose mentions of the bin name", () => {
    // The bin name is legitimate documentation when referring to the
    // binary the package ships. Only `npx <bare-bin-name>` invocations
    // are wrong.
    expect(STALE_PATTERN.test(`the \`${BARE_BIN_NAME}\` binary`)).toBe(false);
    expect(STALE_PATTERN.test(`ships a \`${BARE_BIN_NAME}\` cli`)).toBe(false);
  });

  it("regression: an allowlist comment exempts the line", () => {
    // Symmetric to cli-removed-commands.test.ts allowlist behavior. A
    // line tagged with the allowlist token is ignored, which lets us
    // legitimately quote a stale invocation in a docs/audits/* bug
    // report or historical-context comment without tripping the lint.
    const sample = `// \`npx ${BARE_BIN_NAME} TASKS.md\` is the broken form. ${ALLOWLIST_TOKEN} bug report quote`;
    const lines = sample.split("\n");
    const flagged: string[] = [];
    lines.forEach((line) => {
      if (line.includes(ALLOWLIST_TOKEN)) return;
      if (STALE_PATTERN.test(line)) flagged.push(line);
    });
    expect(flagged).toEqual([]);
  });
});
