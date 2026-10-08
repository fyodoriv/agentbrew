/**
 * Subprocess wrapper that delegates per-agent rules generation to
 * `block/ai-rules` and returns the per-agent generated content.
 *
 * Slice 2 of `delegate-rules-to-ai-rules` (TASKS.md). Sibling of the
 * skills-CLI `delegateRemoteSkill` (`src/add-source.ts`) and the mcpm
 * delegation slice 2 (still pending). The boundary helper lives next to
 * `rules-sync.ts` because the only caller is `syncRules`; if a second
 * caller appears the file moves to `src/core/`.
 *
 * **Wrapper-around-output approach** (parent task, slice 2 plan):
 *   1. Create a temp dir.
 *   2. Write agentbrew's shared rules into `<tmp>/ai-rules/agentbrew.md`.
 *   3. Run `ai-rules generate --agents <list>` in the temp dir.
 *   4. Read the per-agent output file (resolving the symlink ai-rules
 *      drops at `<tmp>/<AGENT_FILE>`) and return content keyed by the
 *      agentbrew-canonical agent name.
 *   5. The caller writes that content INSIDE agentbrew's managed-section
 *      markers in the agent's actual rulesFile (e.g. ~/.claude/CLAUDE.md).
 *
 * Why temp-dir + read-back rather than letting ai-rules write directly to
 * the agent's home: ai-rules writes a symlink (one file per agent) and
 * does not honour an existing managed-section marker pair. agentbrew
 * needs to preserve user-authored content above/below the markers, so
 * the wrapper reads ai-rules' output and merges it into the live file
 * via {@link replaceManagedSection} from `rules-sync.ts`.
 *
 * Failure mode: if `ai-rules` is missing (ENOENT) or the subprocess
 * fails for any reason (proxy / sandbox / corrupt source), the helper
 * logs a `logSkipped` and returns an empty Map. The caller is required
 * to fall back to the native rules-sync path so users without
 * `ai-rules` installed are NOT broken — slice 2 is additive, not
 * replacement.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorMessage } from "../core/errors.js";
import { logSkipped } from "../core/logger.js";
import { buildAiRulesAgentList, fromAiRulesAgent } from "../core/rules-agent-map.js";

/** Resolve the ai-rules binary at call time so tests can swap it via env.
 *  Production reads `ai-rules` from PATH; tests override via
 *  `AGENTBREW_AI_RULES_BIN` to point at a fake script or a known-bad path. */
function aiRulesBin(): string {
  return process.env.AGENTBREW_AI_RULES_BIN ?? "ai-rules";
}

/**
 * Per-agent output filename ai-rules writes a symlink to. Source:
 * `ai-rules generate --agents <name>` output drop, captured 2026-04-27.
 *
 * Multiple agents share `AGENTS.md` because ai-rules treats them as
 * universal-format consumers (codex, cursor, amp, etc.). Slice 2 only
 * exercises `claude` (CLAUDE.md), but the full table lives here so
 * slice 3 can broaden without touching this file.
 */
const AI_RULES_AGENT_FILE: Readonly<Record<string, string>> = Object.freeze({
  claude: "CLAUDE.md",
  cursor: "AGENTS.md",
  codex: "AGENTS.md",
  gemini: "GEMINI.md",
  amp: "AGENTS.md",
  cline: "AGENTS.md",
  copilot: "AGENTS.md",
  firebender: "AGENTS.md",
  goose: "AGENTS.md",
  kilocode: "AGENTS.md",
  roo: "AGENTS.md",
});

interface DelegateRulesGenerateOptions {
  /** Agentbrew agent names to generate for, or `"all"` for the wildcard mode. */
  agents: readonly string[] | "all";
  /** Verbatim content of `~/.config/agentbrew/shared-rules.md`. */
  sharedRules: string;
  /**
   * Override the temp-dir root. Tests set this to a deterministic path so
   * the cleanup assertion can verify the dir is gone afterwards.
   */
  tmpRoot?: string;
}

/**
 * Run `ai-rules generate` against agentbrew's shared rules in a temp dir
 * and return per-agent generated content keyed by **agentbrew-canonical**
 * agent name (e.g. `claude-code`, not ai-rules' `claude`).
 *
 * Pure caller responsibility:
 *   - Wrap content in agentbrew's managed-section markers.
 *   - Route carve-outs (`augment`, `claude-desktop`)
 *     to the native rules-sync path. {@link buildAiRulesAgentList}
 *     filters them; the caller checks {@link AGENTBREW_ONLY_RULES_AGENTS}
 *     directly if it needs to log the rationale.
 *
 * Returns an empty Map when:
 *   - `agents` is empty after filtering (everything was a carve-out);
 *   - the `ai-rules` binary is not on PATH;
 *   - the subprocess exits non-zero.
 *
 * @example
 *   const content = delegateRulesGenerate({
 *     agents: ["claude-code"],
 *     sharedRules: "# Style\nUse strict mode.\n",
 *   });
 *   content.get("claude-code"); // "# agentbrew\n\n# Style\nUse strict mode.\n"
 */
export function delegateRulesGenerate(opts: DelegateRulesGenerateOptions): Map<string, string> {
  const { agents: input, sharedRules, tmpRoot } = opts;
  const { agents: aiRulesAgents } = buildAiRulesAgentList(input);
  if (aiRulesAgents.length === 0) return new Map();
  // Wildcard mode (`"all"`) is reserved for slice 3+. Slice 2's canary
  // call site always passes an explicit agent list, so refusing the
  // wildcard here keeps the slice-2 surface small and unambiguous.
  if (aiRulesAgents.length === 1 && aiRulesAgents[0] === "*") return new Map();

  const root = mkdtempSync(join(tmpRoot ?? tmpdir(), "agentbrew-rules-"));
  try {
    const aiRulesDir = join(root, "ai-rules");
    mkdirSync(aiRulesDir, { recursive: true });
    // Filename → ai-rules' generated section header. `agentbrew.md`
    // produces `# agentbrew` as the leading H1, which becomes part of
    // the managed-section content. Slice 4 (deletion) revisits the
    // header noise once the native path is gone.
    writeFileSync(join(aiRulesDir, "agentbrew.md"), sharedRules, "utf-8");

    const bin = aiRulesBin();
    try {
      execFileSync(bin, ["generate", "--agents", aiRulesAgents.join(",")], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      });
    } catch (e) {
      logSkipped(`sync/rules-delegate/execFileSync(${bin})`, e);
      return new Map();
    }

    const result = new Map<string, string>();
    for (const aiRulesAgent of aiRulesAgents) {
      const fileName = AI_RULES_AGENT_FILE[aiRulesAgent];
      if (!fileName) continue;
      const symlinkPath = join(root, fileName);
      if (!existsSync(symlinkPath)) continue;
      try {
        const content = readFileSync(realpathSync(symlinkPath), "utf-8");
        result.set(fromAiRulesAgent(aiRulesAgent), content);
      } catch (e) {
        logSkipped(`sync/rules-delegate/readFileSync(${fileName}): ${errorMessage(e)}`, e);
      }
    }
    return result;
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (e) {
      // Cleanup failure is non-fatal — temp dirs get reaped eventually.
      logSkipped("sync/rules-delegate/cleanup", e);
    }
  }
}
