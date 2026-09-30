import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Drift class: stale CLI command references in code comments, user-facing
 * error messages, README, user stories, and skill plugins.
 *
 * Background: agentbrew has renamed several CLI commands (CHANGELOG.md
 * lines 43-95). Each rename leaves a long tail of stale references in
 * code comments, error hints, and skill prose that quietly mis-teach
 * the next reader. Earlier audit cascades caught chunks of the drift —
 * 375973f7 covered the user-stories + `agentbrew-add-command` skill,
 * 2e433a4 (PR #941) covered 8 top-level renames across `src/**`,
 * `README.md`, and other skills, and 5f8b3a4 (PR #942) added the six
 * `<namespace> sync` and `log`-suffix patterns. Each pass missed a
 * different subset, so this file's `REMOVED_COMMANDS` table grows
 * whenever a new rename slice lands. The slice-5a–5c rename of seven
 * `mcp <verb>` subcommands (PR #851/#852/#857/#858, see CHANGELOG.md
 * lines 114-127) was the next gap — covered here.
 *
 * Per AGENTS.md "Feedback Loop Guardrails": when the same drift class
 * recurs, encode it as a test, not another fix-the-instance commit.
 * This file makes the *category* the lint, not each specific instance.
 *
 * Sources of truth:
 * - CHANGELOG.md table (lines 86-91): the original rename list
 * - CHANGELOG.md line 95: legacy `browse` → `catalog`
 * - CHANGELOG.md lines 43-50: legacy `log` removed (replaced by
 *   `tail -n 20 ~/.local/share/agentbrew/logs/auto-sync.log`) and the
 *   six `<namespace> sync` aliases removed in favor of
 *   `sync --only <namespace>`. The non-sync subcommands under each
 *   namespace (`rules init`, `commands list`, etc.) stay.
 * - CHANGELOG.md lines 114-127: slice-5a–5c removed seven `mcp <verb>`
 *   subcommands — `mcp install` (use `agentbrew install` for the catalog
 *   path or `mcpm install` for raw registry resolution), `mcp search`
 *   (use `mcpm search`), `mcp info` (use `mcpm info`), `mcp run` (use
 *   `mcpm run`), `mcp health` (use `mcpm doctor` / `mcpm inspect`),
 *   `mcp list` (use `mcpm ls`), `mcp remove` (use `agentbrew remove`).
 * - PR #182 (e30f77e2): legacy `sources` was removed; the
 *   functionality lives behind `agentbrew catalog --sources`.
 *
 * Scope:
 * - `src`, `skill-plugins`, `real-e2e` — all source / fixture code.
 * - `templates` — `templates/AGENTS.md` is deployed verbatim by
 *   `agentbrew sync` to every agent's instruction file (CLAUDE.md,
 *   Codex AGENTS.md, Windsurf memories, etc.) and `templates/
 *   github-actions-check.yml` is a CI workflow users copy verbatim.
 *   A stale ref here would propagate to every user's machine.
 * - `docs` (broadened from `docs/user-stories`) — picks up the
 *   authoritative cross-repo references like
 *   `docs/agent-guide-baseline.md` (linked from every other repo's
 *   AGENTS.md) and operational runbooks like
 *   `docs/oss-publish-mirror-runbook.md`. Noisy research subdirs are
 *   re-excluded below so this expansion doesn't drag in history.
 * - top-level `README.md` and `AGENTS.md` — the user-facing canonical
 *   surfaces.
 *
 * Files / directories deliberately excluded:
 * - CHANGELOG.md — documents the rename history, must mention old names
 * - docs/VISION.md — "Shipped — being removed" log uses strikethrough
 * - docs/COMPETITION.md, docs/competition-snapshot.json — research
 *   notes describing how the agentbrew CLI worked at a point in time;
 *   updating these is low value and would churn the snapshot data.
 * - docs/competition/, docs/audits/, docs/proposals/, docs/research/
 *   — research and audit notes that legitimately reference removed
 *   commands when documenting history; locking these down would force
 *   noisy allowlist comments throughout the research corpus.
 *
 * Patterns intentionally NOT in REMOVED_COMMANDS:
 * - Top-level `agentbrew run` (deleted alongside `mcp run` in PR #851,
 *   slice 5b). The simple pattern `\bagentbrew run\b` would match
 *   `agentbrew run-time` or any future `agentbrew run-X` subcommand
 *   coined down the line — a stricter pattern would be premature
 *   defense for a command nobody is re-introducing. The two legitimate
 *   references (CHANGELOG.md and docs/competition/mcpm-sh-vs-agentbrew.md)
 *   are already in EXCLUDED_FILES / EXCLUDED_DIR_PREFIXES below, so the
 *   omission costs the lint nothing today. If a fresh stale `agentbrew
 *   run` reference appears in scope, add the pattern with a stricter
 *   shape (e.g. `\bagentbrew run(?![\w-])`) and update this note.
 */

interface RemovedCommand {
  name: string;
  pattern: RegExp;
  replacement: string;
}

const REMOVED_COMMANDS: ReadonlyArray<RemovedCommand> = [
  { name: "add", pattern: /\bagentbrew add\b/g, replacement: "agentbrew install" },
  { name: "browse", pattern: /\bagentbrew browse\b/g, replacement: "agentbrew catalog" },
  { name: "update", pattern: /\bagentbrew update\b/g, replacement: "agentbrew sync --pull" },
  { name: "doctor", pattern: /\bagentbrew doctor\b/g, replacement: "agentbrew status --fix" },
  { name: "check", pattern: /\bagentbrew check\b/g, replacement: "agentbrew status --fix" },
  { name: "rollback", pattern: /\bagentbrew rollback\b/g, replacement: "agentbrew sync --rollback" },
  { name: "clean", pattern: /\bagentbrew clean\b/g, replacement: "agentbrew remove" },
  { name: "sources", pattern: /\bagentbrew sources\b/g, replacement: "agentbrew catalog --sources" },
  {
    name: "log",
    pattern: /\bagentbrew log\b/g,
    replacement: "tail -n 20 ~/.local/share/agentbrew/logs/auto-sync.log",
  },
  { name: "rules sync", pattern: /\bagentbrew rules sync\b/g, replacement: "agentbrew sync --only rules" },
  { name: "commands sync", pattern: /\bagentbrew commands sync\b/g, replacement: "agentbrew sync --only commands" },
  { name: "agents sync", pattern: /\bagentbrew agents sync\b/g, replacement: "agentbrew sync --only agents" },
  {
    name: "instructions sync",
    pattern: /\bagentbrew instructions sync\b/g,
    replacement: "agentbrew sync --only instructions",
  },
  { name: "skills sync", pattern: /\bagentbrew skills sync\b/g, replacement: "agentbrew sync --only skills" },
  { name: "hooks sync", pattern: /\bagentbrew hooks sync\b/g, replacement: "agentbrew sync --only hooks" },
  // Slice-5a–5c removed the seven `agentbrew mcp <verb>` subcommands (CHANGELOG.md
  // lines 114-127). The replacement column captures the canonical command users
  // should run today; non-canonical historical references in JSDoc, test
  // comments, and skill plugins must carry an inline `cli-removed-commands-allowlist:`
  // comment per the escape-hatch convention.
  {
    name: "mcp install",
    pattern: /\bagentbrew mcp install\b/g,
    replacement: "agentbrew install (catalog) or mcpm install (raw registry)",
  },
  { name: "mcp search", pattern: /\bagentbrew mcp search\b/g, replacement: "mcpm search" },
  { name: "mcp info", pattern: /\bagentbrew mcp info\b/g, replacement: "mcpm info" },
  { name: "mcp run", pattern: /\bagentbrew mcp run\b/g, replacement: "mcpm run" },
  {
    name: "mcp health",
    pattern: /\bagentbrew mcp health\b/g,
    replacement: "mcpm doctor (global) or mcpm inspect (per-server)",
  },
  { name: "mcp list", pattern: /\bagentbrew mcp list\b/g, replacement: "mcpm ls" },
  { name: "mcp remove", pattern: /\bagentbrew mcp remove\b/g, replacement: "agentbrew remove" },
  // 2026-05-03 hidden-CLI audit (`simplify-cli-surface-audit-hidden-commands`):
  // `mcp sync` was a bare-bones wrapper over `syncMcpServers()` with zero
  // documentation references. The visible `agentbrew sync --only mcp` runs the
  // same module through the full pipeline (--dry-run / --verbose / --no-prune).
  { name: "mcp sync", pattern: /\bagentbrew mcp sync\b/g, replacement: "agentbrew sync --only mcp" },
  // 2026-05-03 delete-skills-init: the hidden `skills init <name>`     // cli-removed-commands-allowlist: own-table-entry
  // compatibility subcommand was deleted. It scaffolded a SKILL.md +            // cli-removed-commands-allowlist: own-table-entry
  // frontmatter. The upstream `npx skills init [name]` (vercel-labs/skills)     // cli-removed-commands-allowlist: own-table-entry
  // covers the same ground; per VISION.md "Delegate when 80%+ of need is        // cli-removed-commands-allowlist: own-table-entry
  // covered" the local copy was removed alongside the 92-LOC                    // cli-removed-commands-allowlist: own-table-entry
  // `src/skills/init-skill.ts` and its 139-LOC test file.                       // cli-removed-commands-allowlist: own-table-entry
  { name: "skills init", pattern: /\bagentbrew skills init\b/g, replacement: "npx skills init (skills CLI upstream)" }, // cli-removed-commands-allowlist: own-table-entry
  // 2026-05-03 delete-instructions-and-hooks: the entire hidden        // cli-removed-commands-allowlist: own-table-entry
  // `instructions` and `hooks` namespaces were removed. Both single subcommands // cli-removed-commands-allowlist: own-table-entry
  // (`instructions status`, `hooks list`) were thin wrappers over functions     // cli-removed-commands-allowlist: own-table-entry
  // already exposed by `agentbrew status --verbose` (via                        // cli-removed-commands-allowlist: own-table-entry
  // `printVerboseInstructionsSection()` and the equivalent hooks section), so   // cli-removed-commands-allowlist: own-table-entry
  // per the focus instruction "delete hidden CLI surface that has no distinct   // cli-removed-commands-allowlist: own-table-entry
  // user problem" the namespaces and their backing helpers                      // cli-removed-commands-allowlist: own-table-entry
  // (`instructionsSyncStatus`, `listHooks`) were removed in one commit.         // cli-removed-commands-allowlist: own-table-entry
  {
    name: "instructions status",
    pattern: /\bagentbrew instructions status\b/g, // cli-removed-commands-allowlist: own-table-entry
    replacement: "agentbrew status --verbose (printVerboseInstructionsSection)",
  },
  {
    name: "hooks list",
    pattern: /\bagentbrew hooks list\b/g, // cli-removed-commands-allowlist: own-table-entry
    replacement: "agentbrew status --verbose (deployment) + Agentfile.yaml `hooks:` block (configuration)",
  },
  // 2026-05-03 (`simplify-hidden-skills-status-command`): `skills status` was
  // a hidden helper that printed the same per-agent + per-source skill counts
  // already shown by the visible `agentbrew status --verbose`. Tail of the
  // `simplify-hidden-status-commands` family (after `instructions status` and
  // `hooks list` deletions). Net codebase shrink: ~165 LOC including tests.
  {
    name: "skills status",
    pattern: /\bagentbrew skills status\b/g,
    replacement: "agentbrew status --verbose",
  },
  // PR #162 absorbed the `check` subcommand into `status --fix` and PR  // cli-removed-commands-allowlist: own-table-entry
  // #694 deleted the `check` alias entirely. The bare-flag form of      // cli-removed-commands-allowlist: own-table-entry
  // `--no-fix` that lived on the deprecated subcommand was never        // cli-removed-commands-allowlist: own-table-entry
  // migrated — current `agentbrew status` exposes only `--verbose`,     // cli-removed-commands-allowlist: own-table-entry
  // `--json`, `--fix`, and `--ci`. Default behavior (no flags) already  // cli-removed-commands-allowlist: own-table-entry
  // reports drift without repairing, so the canonical replacement for   // cli-removed-commands-allowlist: own-table-entry
  // "I want to see drift without fixing" is plain `agentbrew status`    // cli-removed-commands-allowlist: own-table-entry
  // (or `--ci` for CI gates). The pattern below is built via runtime    // cli-removed-commands-allowlist: own-table-entry
  // string concat so the literal flag does not appear in this source    // cli-removed-commands-allowlist: own-table-entry
  // line — same self-reference-avoidance trick as the synthetic         // cli-removed-commands-allowlist: own-table-entry
  // tests below.                                                        // cli-removed-commands-allowlist: own-table-entry
  {
    name: `status -${"-no-fix"}`,
    pattern: new RegExp(`-${"-no-fix"}\\b`, "g"),
    replacement: "agentbrew status (default reports drift without repairing) or agentbrew status --ci (CI gates)", // cli-removed-commands-allowlist: own-table-entry
  },
];

/**
 * Scan a single file for stale CLI references. Lines containing a
 * `cli-removed-commands-allowlist:` comment are skipped (escape hatch
 * for legitimate historical references).
 */
function findRemovedCommandUses(
  filePath: string,
): Array<{ line: number; text: string; command: string; replacement: string }> {
  const findings: Array<{ line: number; text: string; command: string; replacement: string }> = [];
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return findings;
  }
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    if (line.includes("cli-removed-commands-allowlist:")) return;
    for (const cmd of REMOVED_COMMANDS) {
      cmd.pattern.lastIndex = 0;
      if (cmd.pattern.test(line)) {
        findings.push({ line: index + 1, text: line.trim(), command: cmd.name, replacement: cmd.replacement });
      }
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
  "CHANGELOG.md",
  "docs/VISION.md",
  "docs/COMPETITION.md",
  "docs/competition-snapshot.json",
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

describe("CLI command rename drift — locked-down references", () => {
  it("README and user-facing top-level docs use only canonical CLI commands", () => {
    const repoRoot = getRepoRoot();
    const violations: string[] = [];
    for (const name of TOP_LEVEL_FILES) {
      const full = resolve(repoRoot, name);
      for (const finding of findRemovedCommandUses(full)) {
        violations.push(
          `${name}:${finding.line}  uses removed \`agentbrew ${finding.command}\` — replace with \`${finding.replacement}\``,
        );
      }
    }
    expect(
      violations,
      [
        "User-facing top-level docs reference CLI commands that no longer exist.",
        "Replace each with the canonical command from CHANGELOG.md.",
        "",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });

  // Walks 5 source-tree roots (`src`, `skill-plugins`, `docs`, `real-e2e`,
  // `templates`) and grep-matches every file against the REMOVED_COMMANDS
  // table. Cold-cache runs hit ~9s on a developer laptop; the default 5s
  // vitest timeout was a flake source when this test ran alone (the full
  // suite warmed file-system caches and shaved it back to ~1s, masking the
  // flake until someone ran `vitest run src/docs/cli-removed-commands.test.ts`
  // in isolation). 30s is comfortable headroom even on slow CI disks
  // without making true regressions take 30s to surface — the test still
  // returns immediately on the first violation it finds.
  it("source code, skill plugins, docs, real-e2e, and templates use only canonical CLI commands", () => {
    const repoRoot = getRepoRoot();
    const violations: string[] = [];
    for (const root of SCAN_ROOTS) {
      const rootDir = resolve(repoRoot, root);
      for (const file of walkFiles(rootDir, isInScope, repoRoot)) {
        for (const finding of findRemovedCommandUses(file)) {
          const rel = relative(repoRoot, file);
          violations.push(
            `${rel}:${finding.line}  uses removed \`agentbrew ${finding.command}\` — replace with \`${finding.replacement}\``,
          );
        }
      }
    }
    expect(
      violations,
      [
        "These files reference CLI commands that have been removed.",
        "Replace each call with the canonical command from CHANGELOG.md,",
        "or add a `cli-removed-commands-allowlist: <reason>` comment on",
        "the same line if the reference is intentional history.",
        "",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  }, 30_000);

  it("regression: high-visibility deployed/cross-repo surfaces are in scope", () => {
    // The whole point of widening SCAN_ROOTS to include `templates` and
    // the broader `docs` tree is that future stale CLI refs in these
    // files fail the lint just like a fresh stale ref in `src/`. Pin
    // that contract so a later refactor can't silently drop coverage
    // on, e.g., `templates/AGENTS.md` (deployed verbatim by
    // `agentbrew sync` to every agent's instruction file) or
    // `docs/agent-guide-baseline.md` (linked from every other repo's
    // AGENTS.md as the authoritative checklist).
    const repoRoot = getRepoRoot();
    const requiredInScope = [
      "templates/AGENTS.md",
      "templates/github-actions-check.yml",
      "docs/agent-guide-baseline.md",
      "docs/devin-marathon-hooks-example.md",
      "docs/instructions-analysis.md",
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
        "Files that MUST be scanned by the cli-removed-commands lint were skipped.",
        "Either restore them to SCAN_ROOTS / TARGET_EXTENSIONS, or remove them",
        "from this regression test if they're being deleted intentionally.",
        "",
        ...missing.map((m) => `  - ${m}`),
      ].join("\n"),
    ).toEqual([]);
  });

  it("regression: research / audit / proposal / competition subdirs stay excluded", () => {
    // Symmetric to the previous regression: history-bearing research
    // subdirs intentionally legitimately reference removed commands
    // when documenting context. If a future change drops the
    // EXCLUDED_DIR_PREFIXES guard, the lint would explode with
    // historical-noise violations. Pin the exclusion contract.
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
    expect(isInScope("docs/agent-guide-baseline.md")).toBe(true);
    expect(isInScope("docs/user-stories/01-get-started.md")).toBe(true);
  });

  it("regression: a synthetic file with a stale reference is flagged", () => {
    // Pin the detector so a future refactor can't silently weaken the
    // matcher (e.g. by skipping the legacy add token). The synthetic
    // uses the `agentbr` + `ew add` string concat so the literal
    // pattern does not appear in this test file's own source — which
    // would otherwise trip the integration scan above.
    const synthetic = `// run \`agentbr${"ew add"} user/repo\` to install\n// run \`agentbrew install user/repo\` to install`;
    const tempPath = join(getRepoRoot(), "src", "docs", "cli-removed-commands-synthetic.tmp");
    // We don't write the file — just inline-test the regex shape. The
    // findRemovedCommandUses helper takes a file path, so test the
    // pattern matrix directly here.
    const matches: string[] = [];
    for (const cmd of REMOVED_COMMANDS) {
      cmd.pattern.lastIndex = 0;
      if (cmd.pattern.test(synthetic)) matches.push(cmd.name);
    }
    expect(matches).toEqual(["add"]);
    expect(tempPath).toMatch(/cli-removed-commands-synthetic\.tmp$/);
  });

  it("regression: synthetic mcp-subcommand stale refs are flagged for each verb", () => {
    // Pin the slice-5a–5c MCP rename patterns (CHANGELOG lines 114-127)
    // so a future refactor can't silently weaken the matcher. Each
    // verb should be flagged when used standalone, and only its own
    // pattern should match (no collisions with other entries). The
    // synthetic uses string concat (`agentbr` + `ew mcp X`) so the
    // literal patterns don't appear in this test file's own source —
    // which would otherwise trip the integration scan above.
    const verbs = ["install", "search", "info", "run", "health", "list", "remove"];
    expect(verbs).toHaveLength(7);
    for (const verb of verbs) {
      const synthetic = `// run \`agentbr${`ew mcp ${verb}`} foo\` to do the thing`;
      const matches: string[] = [];
      for (const cmd of REMOVED_COMMANDS) {
        cmd.pattern.lastIndex = 0;
        if (cmd.pattern.test(synthetic)) matches.push(cmd.name);
      }
      expect(matches, `expected only \`mcp ${verb}\` to match for synthetic line "${synthetic}"`).toEqual([
        `mcp ${verb}`,
      ]);
    }
  });

  it("regression: an allowlist comment exempts the line", () => {
    const sample = "// `agentbrew add` is the legacy form. cli-removed-commands-allowlist: historical reference";
    const lines = sample.split("\n");
    const findings: string[] = [];
    lines.forEach((line) => {
      if (line.includes("cli-removed-commands-allowlist:")) return;
      for (const cmd of REMOVED_COMMANDS) {
        cmd.pattern.lastIndex = 0;
        if (cmd.pattern.test(line)) findings.push(cmd.name);
      }
    });
    expect(findings).toEqual([]);
  });

  it(`regression: a synthetic -${"-no-fix"} flag reference is flagged`, () => {
    // PR #162 absorbed `agentbrew check` into `agentbrew status --fix`     // cli-removed-commands-allowlist: own-table-entry
    // and PR #694 deleted the `check` alias. The bare-flag form was       // cli-removed-commands-allowlist: own-table-entry
    // never migrated to `status`. Pin the detector so a future refactor   // cli-removed-commands-allowlist: own-table-entry
    // can't silently weaken the matcher. The synthetic uses string concat // cli-removed-commands-allowlist: own-table-entry
    // to avoid tripping the integration scan above on this test file's   // cli-removed-commands-allowlist: own-table-entry
    // own source.                                                        // cli-removed-commands-allowlist: own-table-entry
    const synthetic = `# Use \`-${"-no-fix"}\` to check without repairing (useful in CI).`;
    const matches: string[] = [];
    for (const cmd of REMOVED_COMMANDS) {
      cmd.pattern.lastIndex = 0;
      if (cmd.pattern.test(synthetic)) matches.push(cmd.name);
    }
    expect(matches).toEqual([`status -${"-no-fix"}`]);
  });
});
