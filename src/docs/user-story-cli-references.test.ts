/**
 * Pinned invariant: every `agentbrew <subcommand>` reference in
 * `docs/user-stories/*.md`, `docs/VISION.md`, and `README.md` resolves to
 * a registered command that is NOT marked `hidden:true`.
 *
 * Why: VISION.md "Output quality is UX" and "Every error message tells
 * the user what to do next" presume the docs match the CLI. The recent
 * stale-CLI-ref PRs (#943 `mcp-subcommand`, #944 validator-package-name,
 * #945 category-lint, #946 the deleted bare-flag form of status, #947
 * `--pull` duplication, #949 duplicate `mcp sync`) all share the same root
 * cause: an example was
 * written, the underlying CLI changed, the doc was never re-tested. The
 * `cli-removed-commands.test.ts` sibling catches references to *deleted*
 * commands. This test catches the inverse: documented commands that are
 * still registered but marked `hidden:true`, so a user reading the user
 * story types it, sees nothing in `agentbrew --help`, and assumes the
 * feature was removed (the lock-down for the gaslighting pattern that
 * surfaced in `lock-command-discoverability-vs-user-story`).
 *
 * Scope: only **fenced** code blocks (\`\`\`bash / \`\`\`sh / \`\`\`shell /
 * unfenced \`\`\`) are scanned. Inline backtick references like
 * \`agentbrew classify <repo-path>\` in narrative prose are excluded —
 * they're explanatory references, not instructions a user is expected
 * to copy-paste verbatim.
 *
 * Skip patterns:
 * - Strikethrough lines (`~~agentbrew foo~~` — historical references in
 *   VISION.md's "shipped — being removed" section)
 * - Lines with `<` followed by alphanumerics that look like placeholders
 *   (`<TAB>`, `<name>`, `<subcommand>`) — those aren't literal commands
 * - Lines with the `cli-removed-commands-allowlist:` marker (the same
 *   escape hatch the sibling test uses)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProgram, HELP_COMMAND_GROUPS } from "../cli.js";

interface CliRef {
  file: string;
  line: number;
  subcommand: string;
  rawLine: string;
}

/**
 * Walk the markdown content and yield every `agentbrew <subcommand>`
 * reference that appears inside a fenced code block. Skips strikethroughs,
 * placeholder-bearing lines, and explicit allowlist comments.
 */
function findFencedCliRefs(content: string, file: string): CliRef[] {
  const refs: CliRef[] = [];
  const lines = content.split("\n");
  let inFence = false;
  let fenceStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track fence boundaries (``` opens or closes a code block).
    if (trimmed.startsWith("```")) {
      if (!inFence) {
        inFence = true;
        fenceStart = i;
      } else {
        inFence = false;
      }
      continue;
    }

    if (!inFence) continue;
    if (line.includes("cli-removed-commands-allowlist:")) continue;
    if (line.includes("~~")) continue;

    // Strip leading shell prompt (`$ agentbrew foo` → `agentbrew foo`).
    const promptStripped = trimmed.replace(/^\$\s+/, "");

    // Match `agentbrew <subcommand>` at the start of the (post-prompt) line.
    // Subcommand is the first whitespace-delimited token after `agentbrew`.
    const match = /^agentbrew\s+([a-z][a-z0-9-]*)\b/.exec(promptStripped);
    if (!match) continue;
    const subcommand = match[1];

    // Skip lines with placeholder syntax that signals "this isn't a literal
    // command" (`<TAB>`, `<name>`, `<x>`). The match itself only captures the
    // subcommand token, so this guard targets the rest of the line.
    const remainder = promptStripped.slice(match[0].length);
    if (/<[A-Za-z]/.test(remainder) && !remainder.includes("<repo-path>")) {
      // `<repo-path>` is a documented argument shape (US/README); other
      // placeholders like `<TAB>` are tutorial annotations.
      const isOnlyArgPlaceholder = /^\s*<[a-z][a-z-]*>(\s|$)/.test(remainder);
      if (!isOnlyArgPlaceholder) continue;
    }

    refs.push({ file, line: i + 1, subcommand, rawLine: trimmed });
    void fenceStart; // referenced for future debug; silence unused warning
  }

  return refs;
}

/** Return absolute paths for every doc the invariant checks. */
function getTargetFiles(): string[] {
  const repoRoot = resolve(import.meta.dirname, "..", "..");
  const targets: string[] = [];

  // README.md and docs/VISION.md
  for (const rel of ["README.md", "docs/VISION.md"]) {
    const full = join(repoRoot, rel);
    if (existsSync(full)) targets.push(full);
  }

  // docs/user-stories/*.md
  const userStoriesDir = join(repoRoot, "docs", "user-stories");
  if (existsSync(userStoriesDir)) {
    for (const entry of readdirSync(userStoriesDir)) {
      if (!entry.endsWith(".md")) continue;
      targets.push(join(userStoriesDir, entry));
    }
  }

  return targets;
}

/** Build the set of registered command names along with their hidden flag. */
function buildCommandIndex(): Map<string, { hidden: boolean }> {
  const program = buildProgram();
  const index = new Map<string, { hidden: boolean }>();
  for (const cmd of program.commands) {
    const hidden = Boolean((cmd as unknown as { _hidden?: boolean })._hidden);
    index.set(cmd.name(), { hidden });
  }
  return index;
}

describe("user-story / VISION / README CLI references", () => {
  it("every documented `agentbrew <subcommand>` resolves to a non-hidden command", () => {
    const index = buildCommandIndex();
    const targets = getTargetFiles();
    const issues: string[] = [];

    for (const file of targets) {
      const content = readFileSync(file, "utf-8");
      const refs = findFencedCliRefs(content, file);
      for (const ref of refs) {
        const cmd = index.get(ref.subcommand);
        if (!cmd) {
          issues.push(
            `${ref.file}:${ref.line} — \`agentbrew ${ref.subcommand}\` is documented but not registered. ` +
              `Either rewrite the doc or register the command. Line: \`${ref.rawLine}\``,
          );
          continue;
        }
        if (cmd.hidden) {
          issues.push(
            `${ref.file}:${ref.line} — \`agentbrew ${ref.subcommand}\` is documented but registered with \`hidden:true\`. ` +
              `Drop \`hidden:true\` and add the command to \`HELP_COMMAND_GROUPS\` in \`src/cli.ts\` (or rewrite the doc to not reference it). ` +
              `Line: \`${ref.rawLine}\``,
          );
        }
      }
    }

    expect(
      issues,
      `User-story / VISION / README docs reference hidden or unregistered commands:\n${issues.join("\n")}`,
    ).toEqual([]);
  });

  it("every `HELP_COMMAND_GROUPS` Advanced entry is referenced in at least one user-story / VISION / README doc", () => {
    // Inverse guardrail: if we add a command to the Advanced group, it
    // should be there because docs use it. This catches the orphan case
    // where a command stays in HELP_COMMAND_GROUPS after its docs were
    // rewritten — in that situation, drop it from HELP_COMMAND_GROUPS
    // and back to `hidden:true` (or delete it entirely).
    const advanced = HELP_COMMAND_GROUPS.find((g) => g.title === "Advanced");
    if (!advanced) return; // No Advanced group — vacuously true.

    const targets = getTargetFiles();
    const allRefs: string[] = [];
    for (const file of targets) {
      const content = readFileSync(file, "utf-8");
      for (const ref of findFencedCliRefs(content, file)) {
        allRefs.push(ref.subcommand);
      }
    }
    const referenced = new Set(allRefs);

    const orphans = advanced.names.filter((name) => !referenced.has(name));
    expect(
      orphans,
      `Commands in HELP_COMMAND_GROUPS Advanced group are not referenced in any user-story / VISION / README fenced block: ${orphans.join(", ")}. ` +
        `Either add documentation referencing them, drop them from the Advanced group (back to \`hidden:true\`), or delete the command.`,
    ).toEqual([]);
  });
});
