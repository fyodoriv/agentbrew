/**
 * Foundation for the README + user-stories runnable-examples harness.
 *
 * The recent stale-CLI-ref PRs (#943 `mcp-subcommand`, #944 validator-package-name,
 * #945 category-lint, #946 `--no-fix`, #947 `--pull` duplication) all share a // cli-removed-commands-allowlist: PR-history-reference, not a literal command
 * root cause: an example was written, the underlying CLI changed, the doc was
 * never re-tested. The sibling `src/docs/user-story-cli-references.test.ts`
 * catches references to the wrong **subcommand**; this module extends that
 * coverage to the **whole command line** by parse-validating each documented
 * `agentbrew ...` example through commander.
 *
 * Strategy: parse-validation only. We rebuild the program graph with
 * {@link buildProgram}, neutralize every action handler with a no-op, then call
 * `parseAsync` with `exitOverride()`. Commander's argument / option validation
 * fires (unknown subcommand, unknown options, missing required args, wrong
 * arity), but the actions themselves never run — no filesystem writes, no
 * network calls, no real state mutation. That keeps the harness fast and
 * side-effect-free, which is the precondition for running it inside `npm run
 * verify` on every commit.
 *
 * Sub-task 1 of `harden-readme-user-story-runnable-examples` (P1)
 * lands the parser + validator + unit tests. Subsequent sub-tasks plug
 * `validateAgentbrewCommand` into walks of `README.md` and
 * `docs/user-stories/*.md`.
 */

import type { Command } from "commander";

import { buildProgram } from "../cli.js";

/** Languages we treat as runnable shell blocks. Anything else is skipped. */
const SHELL_LANGUAGES: ReadonlySet<string> = new Set(["bash", "sh", "shell"]);

/** `<!-- runnable: false reason="..." -->` annotation directly above a fenced block. */
const RUNNABLE_FALSE_RE = /<!--\s*runnable:\s*false\s*(?:reason\s*=\s*"([^"]*)")?\s*-->/u;

/** Detect `<NAME>` / `<name>` placeholder syntax inside a token. */
const PLACEHOLDER_RE = /<[A-Za-z]/u;

/**
 * A fenced shell code block discovered in a markdown document.
 *
 * @property language    Fence language (`bash`, `sh`, `shell`).
 * @property startLine   1-based line number of the opening fence.
 * @property endLine     1-based line number of the closing fence.
 * @property content     Lines between the fences, joined with `\n` (no fences).
 * @property runnable    `false` if the block was preceded by an explicit
 *                       `<!-- runnable: false -->` annotation; `true` otherwise.
 * @property reason      Optional reason captured from
 *                       `<!-- runnable: false reason="..." -->`.
 */
export interface FencedBlock {
  language: string;
  startLine: number;
  endLine: number;
  content: string;
  runnable: boolean;
  reason?: string;
}

/**
 * A single `agentbrew ...` command line extracted from a fenced block.
 *
 * @property blockStart  1-based line number of the opening fence the line came from.
 * @property lineNumber  1-based line number of this line inside the doc.
 * @property raw         The line as written, with leading `$ ` prompt stripped.
 * @property argv        Tokenized argv, e.g. `["agentbrew", "status"]`.
 */
export interface AgentbrewCommandLine {
  blockStart: number;
  lineNumber: number;
  raw: string;
  argv: string[];
}

/** Result of parse-validating a single `agentbrew ...` line through commander. */
export interface ValidationResult {
  ok: boolean;
  /** Commander's error message when `ok === false`. */
  error?: string;
}

/**
 * Walk a markdown document and return every fenced shell block with metadata.
 *
 * The parser is intentionally simple: it tracks fence openings (` ```bash `,
 * ` ```sh `, ` ```shell `, or ` ``` ` followed by a language tag we recognize)
 * and looks at the preceding (non-blank) line for a `<!-- runnable: false -->`
 * annotation. Up to 2 blank lines may separate the annotation from the fence
 * so authors can keep markdown readable.
 */
export function parseFencedBlocks(markdown: string): FencedBlock[] {
  const lines = markdown.split("\n");
  const blocks: FencedBlock[] = [];

  let cursor = 0;
  while (cursor < lines.length) {
    const language = matchShellFenceOpen(lines[cursor] ?? "");
    if (language === undefined) {
      cursor += 1;
      continue;
    }

    const close = findClosingFence(lines, cursor + 1);
    if (close === undefined) {
      // Unmatched or interleaved fences — skip this opening and resume scanning
      // from the next line.
      cursor += 1;
      continue;
    }

    const annotation = findRunnableAnnotation(lines, cursor);
    blocks.push({
      language,
      startLine: cursor + 1,
      endLine: close + 1,
      content: lines.slice(cursor + 1, close).join("\n"),
      runnable: annotation.runnable,
      reason: annotation.reason,
    });
    cursor = close + 1;
  }

  return blocks;
}

/**
 * If the line opens a shell fence (` ```bash `, ` ```sh `, ` ```shell `),
 * return the language tag. Otherwise return `undefined`.
 */
function matchShellFenceOpen(line: string): string | undefined {
  const fenceOpen = /^```(\w*)\s*$/u.exec(line);
  if (!fenceOpen) return undefined;
  const language = fenceOpen[1] ?? "";
  return SHELL_LANGUAGES.has(language) ? language : undefined;
}

/**
 * Search downward for the line index of the closing ``` fence. Returns
 * `undefined` when the opener is unmatched or another opener appears before
 * any close.
 */
function findClosingFence(lines: readonly string[], start: number): number | undefined {
  let i = start;
  while (i < lines.length) {
    const candidate = (lines[i] ?? "").trim();
    if (candidate === "```") return i;
    if (/^```\w+/u.test(candidate)) return undefined;
    i += 1;
  }
  return undefined;
}

/**
 * Look upward from a fence-open line for a `<!-- runnable: false -->` comment,
 * skipping optional blank lines of separation (see lookback loop below). Returns `{ runnable: true }` if
 * no annotation is found (the default — every block is runnable unless
 * explicitly opted out).
 */
function findRunnableAnnotation(
  lines: readonly string[],
  fenceLineIndex: number,
): { runnable: boolean; reason?: string } {
  let lookback = 1;
  while (lookback <= 3 && fenceLineIndex - lookback >= 0) {
    const candidate = (lines[fenceLineIndex - lookback] ?? "").trim();
    if (candidate === "") {
      lookback += 1;
      continue;
    }
    const match = RUNNABLE_FALSE_RE.exec(candidate);
    if (match) {
      return { runnable: false, reason: match[1] };
    }
    return { runnable: true };
  }
  return { runnable: true };
}

/**
 * Tokenize a single shell line into argv, honoring single- and double-quoted
 * substrings. Does **not** support backticks, `$(...)`, `&&`, or pipes — lines
 * that need those constructs should be marked `runnable: false`.
 */
export function tokenizeShellLine(line: string): string[] {
  const tokens: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/gu;
  for (const match of line.matchAll(re)) {
    if (match[1] !== undefined) {
      tokens.push(match[1].replace(/\\(.)/gu, "$1"));
    } else if (match[2] !== undefined) {
      tokens.push(match[2]);
    } else if (match[3] !== undefined) {
      tokens.push(match[3]);
    }
  }
  return tokens;
}

/**
 * Extract `agentbrew ...` lines from a fenced block. Strips a leading
 * `$ ` shell prompt, skips comments and blank lines, and skips lines whose
 * argv contains `<NAME>`-style placeholder syntax (those are doc examples,
 * not literal commands).
 */
export function extractAgentbrewCommandLines(block: FencedBlock): AgentbrewCommandLine[] {
  const out: AgentbrewCommandLine[] = [];
  const blockLines = block.content.split("\n");

  blockLines.forEach((rawLine, offset) => {
    const stripped = rawLine.replace(/^\s*\$\s+/u, "").trim();
    if (stripped === "" || stripped.startsWith("#")) return;

    // Strip trailing inline comment (after a hash preceded by whitespace).
    const commentStart = stripped.search(/\s#\s/u);
    const commandText = commentStart === -1 ? stripped : stripped.slice(0, commentStart).trim();
    if (!/^agentbrew\b/u.test(commandText)) return;

    const argv = tokenizeShellLine(commandText);
    if (argv.length === 0) return;

    // Skip placeholder-bearing examples — `<repo>`, `<TAB>`, etc. are
    // documentation marks, not literal arguments. Inline backtick references
    // in narrative prose are filtered upstream because we only iterate
    // fenced-block content here.
    if (argv.slice(1).some((token) => PLACEHOLDER_RE.test(token))) return;

    out.push({
      blockStart: block.startLine,
      // +1 for the opening fence line itself.
      lineNumber: block.startLine + 1 + offset,
      raw: rawLine.trim(),
      argv,
    });
  });

  return out;
}

/**
 * Recursively replace every action handler in the command tree with a no-op,
 * apply `exitOverride()` so commander throws instead of calling `process.exit`,
 * and silence per-command output. Together these let `parseAsync` run
 * commander's argument / option validation without any side effects.
 */
function neutralizeProgram(cmd: Command): void {
  cmd.exitOverride();
  cmd.action(async () => {
    /* no-op — we only want commander's parse validation, not the real action */
  });
  cmd.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
    outputError: () => {},
  });
  for (const sub of cmd.commands) neutralizeProgram(sub);
}

/**
 * Collect every registered subcommand name (and alias) on the program. Used
 * to detect unknown subcommands before delegating to commander, because the
 * real CLI installs a default action that swallows unknown commands with a
 * "did you mean ...?" suggestion (see `handleUnknownCommand` in
 * `src/commands/cli-install.ts`). Once we neutralize the default action, that
 * helpful suggestion path goes silent — so we look the subcommand up directly.
 */
function collectSubcommandNames(program: Command): Set<string> {
  const names = new Set<string>();
  for (const sub of program.commands) {
    names.add(sub.name());
    for (const alias of sub.aliases()) names.add(alias);
  }
  return names;
}

/**
 * Validate that an `agentbrew ...` argv parses cleanly through commander.
 *
 * Returns `ok: true` for:
 *  - argv that doesn't start with `agentbrew` (the caller already filtered
 *    these out, but this guard keeps the function safe to call directly)
 *  - bare `agentbrew` (no subcommand — the default action handles it)
 *  - any commander outcome that isn't a real parse error (`--help`,
 *    `--version`, normal completion).
 *
 * Returns `ok: false` with the error message for:
 *  - unknown subcommand
 *  - unknown options
 *  - missing required argument
 *  - wrong arg arity on a subcommand
 */
export async function validateAgentbrewCommand(argv: readonly string[]): Promise<ValidationResult> {
  if (argv.length === 0 || argv[0] !== "agentbrew") {
    return { ok: true };
  }

  // Detect unknown subcommands manually. Commander would normally fall
  // through to the program's default action (which swallows the unknown
  // command with a suggestion) instead of throwing. The first non-option
  // argument is treated as the subcommand candidate; bare `agentbrew` and
  // option-only invocations skip this check and go straight to parseAsync.
  const subcmdCandidate = argv[1];
  if (subcmdCandidate && !subcmdCandidate.startsWith("-")) {
    const program = buildProgram();
    const knownSubcmds = collectSubcommandNames(program);
    if (!knownSubcmds.has(subcmdCandidate)) {
      return { ok: false, error: `unknown command '${subcmdCandidate}'` };
    }
  }

  const program = buildProgram();
  neutralizeProgram(program);

  try {
    await program.parseAsync(["node", "agentbrew", ...argv.slice(1)]);
    return { ok: true };
  } catch (err: unknown) {
    return classifyCommanderError(err);
  }
}

/**
 * Translate a thrown commander error into a {@link ValidationResult}. Help and
 * version exits aren't real errors — commander just throws to short-circuit
 * the parse; we treat them as `ok: true`.
 */
function classifyCommanderError(err: unknown): ValidationResult {
  if (!(err instanceof Error)) {
    return { ok: false, error: String(err) };
  }
  const code = (err as { code?: string }).code;
  if (code === "commander.help" || code === "commander.helpDisplayed" || code === "commander.version") {
    return { ok: true };
  }
  return { ok: false, error: err.message };
}
