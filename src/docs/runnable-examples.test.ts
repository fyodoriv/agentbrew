/**
 * Unit tests for the runnable-examples harness (parent task
 * `harden-readme-user-story-runnable-examples`, all 4 sub-tasks shipped):
 *   1. Foundation (parser + parse-validation runner) — primitives below.
 *   2. README.md walk — `describe("README.md runnable examples", ...)`.
 *   3. user-stories 01–13 walk — `describe("docs/user-stories 01–13 ...")`.
 *   4. user-stories 14–27 walk — `describe("docs/user-stories 14–27 ...")`.
 *
 * The first half of the file uses in-memory markdown fixtures to pin the
 * harness primitives. The second half drives the harness against the
 * actual project docs so a stale CLI example fails the suite the same
 * way an in-tree compile error would.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Block the cli.ts `preSubcommand` hook from calling the real motd helper,
// which would read `~/.config/agentbrew/state.yaml` during the test. The
// harness must stay side-effect-free.
vi.mock("../motd.js", () => ({ printMotd: vi.fn() }));

import type { AgentbrewCommandLine, FencedBlock, ValidationResult } from "./runnable-examples.js";
import {
  extractAgentbrewCommandLines,
  parseFencedBlocks,
  tokenizeShellLine,
  validateAgentbrewCommand,
} from "./runnable-examples.js";

/**
 * Walk a single doc, validate every `agentbrew ...` line in every
 * runnable fenced block, and return the violations as user-readable
 * strings. The format mirrors `cli-removed-commands.test.ts` so future
 * doc-walk tests stay grep-able.
 */
async function collectRunnableExampleViolations(
  filePath: string,
  displayName: string,
): Promise<{ violations: string[]; runnableLines: number; skippedBlocks: number }> {
  const markdown = readFileSync(filePath, "utf-8");
  const blocks = parseFencedBlocks(markdown);

  const violations: string[] = [];
  let runnableLines = 0;
  let skippedBlocks = 0;

  for (const block of blocks) {
    if (!block.runnable) {
      skippedBlocks += 1;
      continue;
    }
    for (const line of extractAgentbrewCommandLines(block)) {
      runnableLines += 1;
      const result = await validateAgentbrewCommand(line.argv);
      if (!result.ok) {
        violations.push(
          `${displayName}:${line.lineNumber} — \`${line.raw}\` failed: ${result.error}. ` +
            `Either fix the example or annotate the surrounding block with ` +
            `\`<!-- runnable: false reason="..." -->\`.`,
        );
      }
    }
  }

  return { violations, runnableLines, skippedBlocks };
}

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Return absolute paths for `docs/user-stories/<prefix>-*.md` files where
 * `<prefix>` is a 1- or 2-digit integer in the inclusive range
 * `[startInclusive, endInclusive]`. Sorted by prefix so the failure
 * message is stable across runs. Skips files whose prefix doesn't parse
 * (e.g. a future `README.md` slipped into the directory).
 */
function listUserStories(startInclusive: number, endInclusive: number): string[] {
  const dir = resolve(REPO_ROOT, "docs", "user-stories");
  const matches: Array<{ prefix: number; path: string }> = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const prefixMatch = /^(\d+)-/u.exec(name);
    if (!prefixMatch) continue;
    const prefix = Number.parseInt(prefixMatch[1] ?? "", 10);
    if (Number.isNaN(prefix)) continue;
    if (prefix < startInclusive || prefix > endInclusive) continue;
    matches.push({ prefix, path: join(dir, name) });
  }
  return matches.sort((a, b) => a.prefix - b.prefix).map((m) => m.path);
}

describe("parseFencedBlocks", () => {
  it("returns an empty array when the markdown has no fenced shell blocks", () => {
    const markdown = "# Heading\n\nSome prose with no fences.\n";
    expect(parseFencedBlocks(markdown)).toEqual([]);
  });

  it("captures every ```bash / ```sh / ```shell block with line numbers and content", () => {
    const markdown = [
      "intro",
      "",
      "```bash",
      "agentbrew status",
      "```",
      "",
      "```sh",
      "agentbrew sync",
      "```",
      "",
      "```shell",
      "agentbrew lint",
      "```",
      "",
    ].join("\n");

    const blocks = parseFencedBlocks(markdown);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({
      language: "bash",
      startLine: 3,
      endLine: 5,
      content: "agentbrew status",
      runnable: true,
    });
    expect(blocks[1]).toMatchObject({ language: "sh", content: "agentbrew sync", runnable: true });
    expect(blocks[2]).toMatchObject({ language: "shell", content: "agentbrew lint", runnable: true });
  });

  it("ignores fences for non-shell languages (typescript, json, yaml, etc.)", () => {
    const markdown = [
      "```typescript",
      "const x = 1;",
      "```",
      "",
      "```json",
      '{ "name": "test" }',
      "```",
      "",
      "```yaml",
      "key: value",
      "```",
    ].join("\n");

    expect(parseFencedBlocks(markdown)).toEqual([]);
  });

  it("ignores unfenced ``` blocks (no language tag) — those are usually output examples, not commands", () => {
    const markdown = ["```", "$ agentbrew", "  ✓ claude-code", "```", ""].join("\n");
    expect(parseFencedBlocks(markdown)).toEqual([]);
  });

  it("captures the runnable: false annotation directly above a fence", () => {
    const markdown = [
      '<!-- runnable: false reason="interactive prompts" -->',
      "```bash",
      "agentbrew setup",
      "```",
      "",
    ].join("\n");

    const blocks = parseFencedBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ runnable: false, reason: "interactive prompts" });
  });

  it("captures the runnable: false annotation when separated by optional blank lines", () => {
    const markdown = [
      '<!-- runnable: false reason="network call" -->',
      "",
      "",
      "```bash",
      "agentbrew install vercel-labs/agent-skills",
      "```",
      "",
    ].join("\n");

    const blocks = parseFencedBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ runnable: false, reason: "network call" });
  });

  it("treats blocks with no annotation (or annotation too far above) as runnable", () => {
    const markdown = [
      '<!-- runnable: false reason="too far above" -->',
      "",
      "",
      "",
      "intervening line",
      "```bash",
      "agentbrew status",
      "```",
      "",
    ].join("\n");

    const blocks = parseFencedBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ runnable: true });
    expect(blocks[0]?.reason).toBeUndefined();
  });

  it("captures runnable: false with no reason attribute", () => {
    const markdown = ["<!-- runnable: false -->", "```bash", "agentbrew foo", "```", ""].join("\n");

    const blocks = parseFencedBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ runnable: false });
    expect(blocks[0]?.reason).toBeUndefined();
  });

  it("does not crash on an unmatched opening fence (skips the malformed opener and keeps scanning)", () => {
    const markdown = ["```bash", "agentbrew status", "(no closing fence)", "", "```bash", "agentbrew sync", "```"].join(
      "\n",
    );

    // The first opener is malformed (its content runs into the next ```bash
    // opener before any closing ```). The parser skips it and continues, so
    // only the well-formed second block is returned.
    const blocks = parseFencedBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ content: "agentbrew sync", startLine: 5, endLine: 7 });
  });

  it("returns no blocks when the only fence opener is unmatched at end-of-file", () => {
    const markdown = ["```bash", "agentbrew status", ""].join("\n");
    expect(parseFencedBlocks(markdown)).toEqual([]);
  });
});

describe("tokenizeShellLine", () => {
  it("splits on whitespace for plain words", () => {
    expect(tokenizeShellLine("agentbrew install commit")).toEqual(["agentbrew", "install", "commit"]);
  });

  it("preserves quoted strings as a single token", () => {
    expect(tokenizeShellLine('agentbrew install --search "hello world"')).toEqual([
      "agentbrew",
      "install",
      "--search",
      "hello world",
    ]);
  });

  it("handles single-quoted strings", () => {
    expect(tokenizeShellLine("agentbrew install --search 'foo bar'")).toEqual([
      "agentbrew",
      "install",
      "--search",
      "foo bar",
    ]);
  });

  it("returns an empty array for an empty line", () => {
    expect(tokenizeShellLine("")).toEqual([]);
  });

  it("unescapes backslash-escapes inside double-quoted strings", () => {
    expect(tokenizeShellLine('agentbrew --note "say \\"hi\\""')).toEqual(["agentbrew", "--note", 'say "hi"']);
  });
});

/** Build a `FencedBlock` fixture for `extractAgentbrewCommandLines` tests. */
function block(content: string, startLine = 1): FencedBlock {
  return {
    language: "bash",
    startLine,
    endLine: startLine + 2,
    content,
    runnable: true,
  };
}

describe("extractAgentbrewCommandLines", () => {
  it("returns the agentbrew command lines from a block, ignoring non-agentbrew lines", () => {
    const fixture = block(["# install everything", "agentbrew status", "echo done", "agentbrew sync"].join("\n"), 10);

    const lines: AgentbrewCommandLine[] = extractAgentbrewCommandLines(fixture);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ argv: ["agentbrew", "status"], lineNumber: 12 });
    expect(lines[1]).toMatchObject({ argv: ["agentbrew", "sync"], lineNumber: 14 });
  });

  it("strips a leading `$ ` shell prompt", () => {
    const lines = extractAgentbrewCommandLines(block("$ agentbrew status"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ argv: ["agentbrew", "status"] });
  });

  it("strips trailing inline comments (` # comment`)", () => {
    const lines = extractAgentbrewCommandLines(block("agentbrew status # check current state"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ argv: ["agentbrew", "status"] });
  });

  it("skips lines with placeholder syntax `<NAME>` / `<name>`", () => {
    const lines = extractAgentbrewCommandLines(
      block(["agentbrew install <name>", "agentbrew install commit", "agentbrew --opt <FLAG>"].join("\n")),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ argv: ["agentbrew", "install", "commit"] });
  });

  it("returns nothing for a block with no agentbrew lines", () => {
    expect(extractAgentbrewCommandLines(block("echo hello\nls -la\nexport KEY=value"))).toEqual([]);
  });
});

describe("validateAgentbrewCommand", () => {
  it("returns ok for a registered top-level command (`agentbrew status`)", async () => {
    const result: ValidationResult = await validateAgentbrewCommand(["agentbrew", "status"]);
    expect(result.ok).toBe(true);
  });

  it("returns ok for a registered subcommand with valid args (`agentbrew catalog --search foo`)", async () => {
    const result = await validateAgentbrewCommand(["agentbrew", "catalog", "--search", "foo"]);
    expect(result.ok).toBe(true);
  });

  it("returns ok for `agentbrew --help` (commander throws helpDisplayed but it's not a real error)", async () => {
    const result = await validateAgentbrewCommand(["agentbrew", "--help"]);
    expect(result.ok).toBe(true);
  });

  it("returns ok for `agentbrew --version`", async () => {
    const result = await validateAgentbrewCommand(["agentbrew", "--version"]);
    expect(result.ok).toBe(true);
  });

  it("returns ok for bare `agentbrew` (no subcommand — the default action handles it)", async () => {
    const result = await validateAgentbrewCommand(["agentbrew"]);
    expect(result.ok).toBe(true);
  });

  it("returns ok and skips validation when argv does not start with `agentbrew`", async () => {
    const result = await validateAgentbrewCommand(["echo", "hello"]);
    expect(result.ok).toBe(true);
  });

  it("returns not-ok for an unknown subcommand", async () => {
    const result = await validateAgentbrewCommand(["agentbrew", "totally-bogus-command"]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown command|bogus-command/iu);
  });

  it("returns not-ok for an unknown option on a registered subcommand", async () => {
    const result = await validateAgentbrewCommand(["agentbrew", "status", "--definitely-not-a-real-flag"]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown option|--definitely-not-a-real-flag/iu);
  });
});

describe("README.md runnable examples", () => {
  // Walk the canonical user-facing entry point. Every `agentbrew ...` line
  // in a ```bash / ```sh / ```shell block must either parse cleanly through
  // commander or sit under a `<!-- runnable: false reason="..." -->`
  // annotation. The recent stale-CLI-ref PRs (#943 `mcp-subcommand`, #944  // cli-removed-commands-allowlist: PR-history-reference, not a literal command
  // validator-package-name, #945 category-lint, #946 deleted bare-flag,    // cli-removed-commands-allowlist: PR-history-reference, not a literal command
  // #947 `--pull` duplication) all started as a stale README example —     // cli-removed-commands-allowlist: PR-history-reference, not a literal command
  // pinning the README to the live CLI shape catches the next instance at
  // commit time, not at user-report time.
  //
  // Per-test timeout (5s) doubles as the budget guard for acceptance
  // criterion (d) — if a future README walk gets slow, the test fails
  // instead of silently inflating the suite.
  it("every fenced agentbrew example parses through commander or carries `runnable: false`", async () => {
    const path = resolve(REPO_ROOT, "README.md");
    const { violations, runnableLines } = await collectRunnableExampleViolations(path, "README.md");
    expect(violations, ["Stale CLI examples in README.md:", ...violations].join("\n")).toEqual([]);
    // Sanity rail: a future README that strips every fenced shell block
    // would make the assertion above trivially true. Pin a non-zero
    // floor so silent regressions in coverage fail the test instead of
    // passing it. Pin a generous numeric floor (10 today) so modest doc
    // shrinkage still leaves meaningful harness coverage.
    expect(runnableLines).toBeGreaterThanOrEqual(10);
  }, 5000);
});

describe("docs/user-stories 01–13 runnable examples", () => {
  // Walks the first half of the user-stories corpus (01–13, with 09
  // intentionally absent — the file was deleted in an earlier user-story
  // re-shuffle). Each user story is the canonical "how do I do X with
  // agentbrew" doc, and CI was finding stale CLI references in this
  // corpus through `cli-removed-commands.test.ts` long after the renames
  // shipped. This walk catches the broader class — not just deleted
  // command names but any flag, arg shape, or option that doesn't parse.
  //
  // The probe that produced this walk surfaced two stale `--check`
  // references in 13-update-skills.md (a flag that never landed). Both
  // were rewritten to use `--dry-run`, which is the canonical equivalent
  // already documented in the same file.
  //
  // Per-test timeout (10s) lets the walk grow to ~12 docs without
  // tripping; today's pass validates the current example line budget in <500ms.
  it("every fenced agentbrew example parses through commander or carries `runnable: false`", async () => {
    const paths = listUserStories(1, 13);
    expect(paths.length, "expected at least 10 user-story docs in 01–13 range").toBeGreaterThanOrEqual(10);
    const allViolations: string[] = [];
    let totalRunnable = 0;
    for (const path of paths) {
      const displayName = `docs/user-stories/${path.split("/").pop() ?? path}`;
      const { violations, runnableLines } = await collectRunnableExampleViolations(path, displayName);
      allViolations.push(...violations);
      totalRunnable += runnableLines;
    }
    expect(allViolations, ["Stale CLI examples in docs/user-stories/01–13:", ...allViolations].join("\n")).toEqual([]);
    // Floor guard: prevents a silent regression where a future docs
    // rewrite empties out every fenced shell block. Pin a generous numeric
    // floor (30 today) so modest doc shrinkage still leaves harness coverage.
    expect(totalRunnable).toBeGreaterThanOrEqual(30);
  }, 10000);
});

describe("docs/user-stories 14–27 runnable examples", () => {
  // Walks the second half of the user-stories corpus (14–27). Same
  // contract as the 01–13 walk above: every `agentbrew ...` line in a
  // ```bash / ```sh / ```shell block must either parse cleanly through
  // commander or carry `<!-- runnable: false reason="..." -->`.
  //
  // The probe that produced this walk validated every fenced agentbrew
  // example across 14 docs (14-recommended-changes through 27-organization-
  // overlay) with zero violations — the back half of the user-stories
  // corpus was already aligned with the live CLI. Adding the walk now
  // pins that alignment so the next stale reference fails CI instead of
  // shipping. With this walk landed, the parent task
  // `harden-readme-user-story-runnable-examples` is fully shipped:
  // every fenced shell block in README.md and docs/user-stories/*.md is
  // either harness-validated or carries an explicit `runnable: false`.
  //
  // Per-test timeout (10s) lets the walk grow to ~16 docs without
  // tripping; today's pass validates the current example line budget in <500ms.
  it("every fenced agentbrew example parses through commander or carries `runnable: false`", async () => {
    const paths = listUserStories(14, 27);
    expect(paths.length, "expected at least 12 user-story docs in 14–27 range").toBeGreaterThanOrEqual(12);
    const allViolations: string[] = [];
    let totalRunnable = 0;
    for (const path of paths) {
      const displayName = `docs/user-stories/${path.split("/").pop() ?? path}`;
      const { violations, runnableLines } = await collectRunnableExampleViolations(path, displayName);
      allViolations.push(...violations);
      totalRunnable += runnableLines;
    }
    expect(allViolations, ["Stale CLI examples in docs/user-stories/14–27:", ...allViolations].join("\n")).toEqual([]);
    // Floor guard: generous numeric floor (40 today) so modest doc shrinkage
    // still leaves harness coverage. Same rationale as the 01–13 walk floor.
    expect(totalRunnable).toBeGreaterThanOrEqual(40);
  }, 10000);
});
