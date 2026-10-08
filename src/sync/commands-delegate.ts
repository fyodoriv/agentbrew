/**
 * Subprocess wrapper that delegates per-agent **commands** generation to
 * `block/ai-rules` and returns the per-agent generated content.
 *
 * Slice 2 of `delegate-commands-to-ai-rules` (TASKS.md). Sibling of
 * `rules-delegate.ts` — same shape, different surface. The boundary helper
 * lives next to `command-sync.ts` because the only caller is `syncCommands`;
 * if a second caller appears the file moves to `src/core/`.
 *
 * **Wrapper-around-output approach** (parent task, slice 2 plan):
 *   1. Create a temp dir.
 *   2. Write the user's source commands into `<tmp>/ai-rules/commands/<name>.md`.
 *   3. Run `ai-rules generate --agents <list>` in the temp dir.
 *   4. Read each per-agent command file from `<tmp>/.<aiAgent>/commands/ai-rules/<name>.md`
 *      (resolving the symlink ai-rules drops there) and return content
 *      keyed first by agentbrew-canonical agent name, then by filename.
 *   5. The caller writes that content into the agent's actual `commandsDir`
 *      (e.g. `~/.claude/commands/<name>.md`).
 *
 * Why temp-dir + read-back rather than letting ai-rules write directly to
 * the agent's home: ai-rules drops files in `.<agent>/commands/ai-rules/`
 * inside the cwd. agentbrew already owns `~/.claude/commands/<name>.md`
 * (no `ai-rules/` subdirectory) plus the manifest hashing for user-edit
 * detection (`isUserModified`). Reading ai-rules' output and routing it
 * through agentbrew's existing write path preserves both the layout AND
 * the user-edit guard — slice 2 is additive, not replacement.
 *
 * Failure mode: if `ai-rules` is missing (ENOENT) or the subprocess
 * fails for any reason (proxy / sandbox / corrupt source), the helper
 * logs a `logSkipped` and returns an empty Map. The caller is required
 * to fall back to the native command-sync path so users without
 * `ai-rules` installed are NOT broken — slice 2 is additive, not
 * replacement (slice 4 will harden the contract once delegation is
 * wired across all canary agents).
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAiRulesCommandsAgentList, fromAiRulesCommandsAgent } from "../core/commands-agent-map.js";
import { errorMessage } from "../core/errors.js";
import { logSkipped } from "../core/logger.js";

/** Resolve the ai-rules binary at call time so tests can swap it via env.
 *  Production reads `ai-rules` from PATH; tests override via
 *  `AGENTBREW_AI_RULES_BIN` (shared with rules-delegate.ts) to point at a
 *  fake script or a known-bad path. */
function aiRulesBin(): string {
  return process.env.AGENTBREW_AI_RULES_BIN ?? "ai-rules";
}

/**
 * Per-agent commands output directory ai-rules writes inside the cwd.
 * Source: `ai-rules generate --agents <name>` output drop, captured
 * 2026-04-27 against ai-rules v1.6.0 (and cross-checked with the
 * upstream [docs/commands-and-skills.md](https://raw.githubusercontent.com/block/ai-rules/main/docs/commands-and-skills.md)).
 *
 * Each entry maps an ai-rules canonical agent name to two pieces:
 *   - `dir`: the directory ai-rules generates files into, relative to the
 *     run cwd.
 *   - `suffix`: an optional filename suffix ai-rules appends (only AMP and
 *     Firebender today). For these agents `foo.md` becomes
 *     `foo-ai-rules.md` (or `.mdc` for Firebender). Slice 2 only exercises
 *     `claude` (no suffix), but the full table lives here so slice 3 can
 *     broaden without touching this file.
 */
const AI_RULES_COMMANDS_PATH: Readonly<Record<string, { dir: string; suffix: string; ext: string }>> = Object.freeze({
  claude: { dir: ".claude/commands/ai-rules", suffix: "", ext: ".md" },
  cursor: { dir: ".cursor/commands/ai-rules", suffix: "", ext: ".md" },
  amp: { dir: ".agents/commands", suffix: "-ai-rules", ext: ".md" },
  firebender: { dir: ".firebender/commands", suffix: "-ai-rules", ext: ".mdc" },
});

interface DelegateCommandsGenerateOptions {
  /** Agentbrew agent names to generate for, or `"all"` for the wildcard mode. */
  agents: readonly string[] | "all";
  /** The user's source commands keyed by source filename (e.g. `commit.md`). */
  sourceCommands: ReadonlyArray<{ filename: string; content: string }>;
  /**
   * Override the temp-dir root. Tests set this to a deterministic path so
   * the cleanup assertion can verify the dir is gone afterwards.
   */
  tmpRoot?: string;
}

/**
 * Run `ai-rules generate` against the user's commands in a temp dir and
 * return per-agent generated command content keyed by **agentbrew-canonical**
 * agent name (e.g. `claude-code`, not ai-rules' `claude`). The inner Map
 * is keyed by source filename (`hello.md`), not by ai-rules' suffixed
 * output filename — the caller already knows the source filename and
 * doesn't need to know ai-rules' rename convention.
 *
 * Pure caller responsibility:
 *   - Apply any agent-specific transform agentbrew expects on the content
 *     (claude/cursor are identity today, so the delegated content matches
 *     the native output byte-for-byte for the slice 2 canary).
 *   - Route carve-outs (`gemini-cli`, `claude-desktop`,
 *     `opencode`) to the native command-sync path.
 *     {@link buildAiRulesCommandsAgentList} filters them; the caller checks
 *     {@link AGENTBREW_ONLY_COMMANDS_AGENTS} directly if it needs to log
 *     the rationale.
 *
 * Returns an empty Map when:
 *   - `agents` is empty after filtering (everything was a carve-out);
 *   - the `ai-rules` binary is not on PATH;
 *   - the subprocess exits non-zero;
 *   - `sourceCommands` is empty (nothing to delegate).
 *
 * @example
 *   const content = delegateCommandsGenerate({
 *     agents: ["claude-code"],
 *     sourceCommands: [{ filename: "hello.md", content: "# Hello\n\nA test\n" }],
 *   });
 *   content.get("claude-code")?.get("hello.md"); // "# Hello\n\nA test\n"
 */
export function delegateCommandsGenerate(opts: DelegateCommandsGenerateOptions): Map<string, Map<string, string>> {
  const { agents: input, sourceCommands, tmpRoot } = opts;
  if (sourceCommands.length === 0) return new Map();
  const { agents: aiRulesAgents } = buildAiRulesCommandsAgentList(input);
  if (aiRulesAgents.length === 0) return new Map();
  // Wildcard mode (`"all"`) is reserved for slice 3+. Slice 2's canary
  // call site always passes an explicit agent list, so refusing the
  // wildcard here keeps the slice-2 surface small and unambiguous.
  if (aiRulesAgents.length === 1 && aiRulesAgents[0] === "*") return new Map();

  const root = mkdtempSync(join(tmpRoot ?? tmpdir(), "agentbrew-commands-"));
  try {
    writeSourceCommandsToTempDir(root, sourceCommands);
    if (!runAiRulesGenerate(root, aiRulesAgents)) return new Map();
    return collectPerAgentResults(root, aiRulesAgents, sourceCommands);
  } finally {
    cleanupTempDir(root);
  }
}

/** Write source commands into `<root>/ai-rules/commands/<name>.md`
 *  before invoking ai-rules. Extracted for cognitive-complexity. */
function writeSourceCommandsToTempDir(
  root: string,
  sourceCommands: ReadonlyArray<{ filename: string; content: string }>,
): void {
  const commandsDir = join(root, "ai-rules", "commands");
  mkdirSync(commandsDir, { recursive: true });
  for (const cmd of sourceCommands) {
    writeFileSync(join(commandsDir, cmd.filename), cmd.content, "utf-8");
  }
}

/** Run `ai-rules generate --agents <list>` in the temp dir. Returns
 *  `true` on success, `false` on subprocess failure (binary missing /
 *  non-zero exit / timeout). The caller must check the return value
 *  before reading output files. */
function runAiRulesGenerate(root: string, aiRulesAgents: readonly string[]): boolean {
  const bin = aiRulesBin();
  try {
    execFileSync(bin, ["generate", "--agents", aiRulesAgents.join(",")], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    return true;
  } catch (e) {
    logSkipped(`sync/commands-delegate/execFileSync(${bin})`, e);
    return false;
  }
}

/** Walk the agent list and collect per-agent generated content from
 *  the temp dir, mapped back to agentbrew-canonical names. Skips
 *  unknown layouts and missing per-agent dirs. */
function collectPerAgentResults(
  root: string,
  aiRulesAgents: readonly string[],
  sourceCommands: ReadonlyArray<{ filename: string; content: string }>,
): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  for (const aiRulesAgent of aiRulesAgents) {
    const layout = AI_RULES_COMMANDS_PATH[aiRulesAgent];
    if (!layout) continue;
    const perAgentDir = join(root, layout.dir);
    if (!existsSync(perAgentDir)) continue;
    const perFile = readPerAgentCommands(perAgentDir, layout, sourceCommands);
    if (perFile.size > 0) {
      result.set(fromAiRulesCommandsAgent(aiRulesAgent), perFile);
    }
  }
  return result;
}

/** Best-effort temp dir cleanup. Cleanup failure is non-fatal — the
 *  OS reaps `/tmp` eventually. */
function cleanupTempDir(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch (e) {
    logSkipped("sync/commands-delegate/cleanup", e);
  }
}

/**
 * Read the command files ai-rules generated for one agent, mapping each
 * back to the agentbrew source filename (so the caller can pass the
 * content into the existing `computeCommandsDiff` keyed by source name).
 *
 * For agents with a suffix (`amp`, `firebender`), `foo.md` becomes
 * `foo-ai-rules.md`/`.mdc`; we strip the suffix on read so the returned
 * filename matches the source. Unknown files in the dir are skipped.
 */
function readPerAgentCommands(
  perAgentDir: string,
  layout: { dir: string; suffix: string; ext: string },
  sourceCommands: ReadonlyArray<{ filename: string }>,
): Map<string, string> {
  const result = new Map<string, string>();
  const sourceNames = new Set(sourceCommands.map((c) => c.filename));
  let entries: string[];
  try {
    entries = readdirSync(perAgentDir);
  } catch (e) {
    logSkipped(`sync/commands-delegate/readdir(${perAgentDir}): ${errorMessage(e)}`, e);
    return result;
  }
  for (const entry of entries) {
    const sourceFilename = mapAiRulesNameToSource(entry, layout, sourceNames);
    if (!sourceFilename) continue;
    try {
      const content = readFileSync(realpathSync(join(perAgentDir, entry)), "utf-8");
      result.set(sourceFilename, content);
    } catch (e) {
      logSkipped(`sync/commands-delegate/readFileSync(${entry}): ${errorMessage(e)}`, e);
    }
  }
  return result;
}

/**
 * Translate an ai-rules-generated filename back to the agentbrew source
 * filename. ai-rules drops files at one of two shapes:
 *   - No-suffix agents (claude/cursor): output filename === source filename
 *     (`hello.md` → `hello.md`).
 *   - Suffix agents (amp/firebender): `<name><suffix>.<ext>` →
 *     `<name>.md`. We strip the suffix and replace the extension.
 *
 * Returns `null` when the entry doesn't match any known source name. This
 * gracefully ignores ai-rules' own metadata files (e.g. `.ds_store`,
 * lockfiles, README) without surfacing them to the caller.
 */
function mapAiRulesNameToSource(
  aiRulesEntry: string,
  layout: { suffix: string; ext: string },
  sourceNames: ReadonlySet<string>,
): string | null {
  // No-suffix shape: source filename literally appears in ai-rules' output dir.
  if (layout.suffix === "") {
    return sourceNames.has(aiRulesEntry) ? aiRulesEntry : null;
  }
  // Suffix shape: `<name><suffix><ext>` → `<name>.md`. Match the suffix +
  // extension exactly and recover the source name.
  const tail = `${layout.suffix}${layout.ext}`;
  if (!aiRulesEntry.endsWith(tail)) return null;
  const stem = aiRulesEntry.slice(0, -tail.length);
  const candidate = `${stem}.md`;
  return sourceNames.has(candidate) ? candidate : null;
}
