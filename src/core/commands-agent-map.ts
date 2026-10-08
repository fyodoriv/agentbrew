/**
 * Agent-name reconciliation between agentbrew and block/ai-rules for the
 * **commands** sync surface.
 *
 * Sibling of `agent-name-map.ts` (skills CLI), `mcp-agent-map.ts` (mcpm),
 * and `rules-agent-map.ts` (ai-rules rules). Slice 1 of the
 * `delegate-commands-to-ai-rules` task — see TASKS.md and
 * [the ai-rules commands-and-skills doc](https://raw.githubusercontent.com/block/ai-rules/main/docs/commands-and-skills.md).
 *
 * ai-rules supports commands generation for AMP, Claude Code, Cursor, and
 * Firebender. agentbrew's commands-capable agents are claude-code, cursor,
 * gemini-cli, claude-desktop, and opencode. The intersection
 * after rename is claude-code and cursor; the rest stay native because
 * ai-rules' commands-and-skills surface does not cover them today.
 *
 * Differences from the sibling rules map:
 *   - Rename pairs: `claude-code` → `claude`. (No gemini/kilo/roo renames
 *     because gemini-cli is a carve-out for commands and kilo/roo aren't in
 *     ai-rules' commands list at all.)
 *   - AGENTBREW_ONLY_COMMANDS_AGENTS carve-outs: gemini-cli
 *     (`.toml` output format ai-rules doesn't generate), claude-desktop
 *     (covered transitively by claude-code via `readsFrom`), opencode (not
 *     in ai-rules' supported commands list).
 *   - 0 free-capability gains today: amp + firebender would be free gains
 *     once `commandsDir` is added to their `agents.yaml` entries, but
 *     that's slice 5's optional expansion — not slice 1's scope.
 *
 * Why a separate file (not extending the existing maps): each delegation
 * has its own rename / carve-out shape; sharing would force a "which-tool"
 * parameter into every helper and bloat the surface. Separate files keep
 * each delegation easy to delete when one delegation closes.
 *
 * Decision (2026-04-27): keep agentbrew's names as our public API and
 * translate on the delegation boundary. Same posture as the other three
 * maps.
 *
 * Sources:
 *   - agentbrew canonical: `src/core/agents.yaml` filtered to entries with
 *     `commandsDir`.
 *   - ai-rules canonical:
 *     [docs/commands-and-skills.md](https://raw.githubusercontent.com/block/ai-rules/main/docs/commands-and-skills.md)
 *     (amp, claude, cursor, firebender) at v1.6.0.
 */

/** Agentbrew canonical name → ai-rules canonical name. */
export const AGENTBREW_TO_AI_RULES_COMMANDS: Readonly<Record<string, string>> = Object.freeze({
  "claude-code": "claude",
});

/** Ai-rules canonical name → agentbrew canonical name (reverse map). */
export const AI_RULES_COMMANDS_TO_AGENTBREW: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(AGENTBREW_TO_AI_RULES_COMMANDS).map(([a, r]) => [r, a])),
);

/**
 * Per-agent rationale for staying on the native commands sync instead of
 * delegating to ai-rules. Acceptance criterion (e) of the parent task
 * `delegate-commands-to-ai-rules` requires that "every surviving native
 * code path has a named carve-out reason in a comment." Exposing the
 * rationale as a Record (rather than burying it in a comment block) lets
 * future code surface the reason in a user-facing warning, drift-report
 * explanation, or migration plan without re-deriving it from prose docs.
 *
 * Each entry must be a single sentence the user can read in a CLI warning
 * — verbose enough to be informative, short enough to fit on one line.
 *
 * The carve-outs split into three categories:
 *   - **Format / transform mismatch**: `gemini-cli` writes
 *     `.toml` files via the `gemini` transform; `opencode` writes plain `.md` but isn't in ai-rules' commands
 *     supported list. ai-rules can't generate these formats, so these
 *     stay native unless ai-rules grows the corresponding transforms
 *     upstream.
 *   - **Transitive carve-out**: `claude-desktop` shares
 *     `~/.claude/commands` with `claude-code` via agentbrew's `readsFrom`
 *     mechanism in `agents.yaml`. The claude-code intersection covers it
 *     transitively, so the dispatcher routes claude-desktop to the native
 *     path while the actual file write happens once via claude-code's
 *     delegated path.
 */
export const AGENTBREW_ONLY_COMMANDS_RATIONALE: Readonly<Record<string, string>> = Object.freeze({
  // gemini-cli: agentbrew writes ~/.gemini/commands/<name>.toml via the
  // `gemini` transform (different file extension AND different frontmatter
  // shape). ai-rules doesn't generate Gemini-format commands. Possible
  // upstream PR if adoption justifies it; until then, native carve-out.
  "gemini-cli":
    "ai-rules doesn't generate Gemini .toml commands; agentbrew's gemini transform writes a Gemini-specific shape.",

  // claude-desktop: shares ~/.claude/commands with claude-code via
  // agentbrew's `readsFrom` mechanism in agents.yaml. The claude-code
  // intersection covers it transitively. Treated as a carve-out at the
  // delegation boundary; the actual file write happens once via
  // claude-code's path.
  "claude-desktop": "Shares ~/.claude/commands with claude-code via readsFrom; ai-rules conflates them under claude.",

  // opencode: agentbrew writes ~/.config/opencode/commands as plain .md
  // files (no transform). OpenCode isn't in ai-rules' commands supported
  // list. Possible upstream PR if adoption justifies it; until then,
  // native carve-out.
  opencode: "Not in ai-rules' commands supported list; possible upstream PR if adoption justifies.",
});

/**
 * Agents that agentbrew has but ai-rules does not cover for commands. When
 * delegating these, the dispatcher must fall back to the native installer —
 * ai-rules has no equivalent commands generation. Each entry's rationale
 * lives in {@link AGENTBREW_ONLY_COMMANDS_RATIONALE}; the Set is derived
 * from that Record's keys so adding a new carve-out to the Set without a
 * documented reason is a type-system / test-suite error, not a silent
 * drift.
 */
export const AGENTBREW_ONLY_COMMANDS_AGENTS: ReadonlySet<string> = new Set(
  Object.keys(AGENTBREW_ONLY_COMMANDS_RATIONALE),
);

/**
 * Translate an agentbrew agent name to the name ai-rules expects on the
 * `--agents <name>` flag for the commands generation surface. Returns:
 *   - the same name if it's in the strict intersection (`cursor`) — pass-through
 *   - the remapped name for entries in {@link AGENTBREW_TO_AI_RULES}
 *   - null for the carve-outs (gemini-cli,
 *     claude-desktop, opencode) — caller should route to native installer
 *
 * Unknown names (not in any list) return the name unchanged — caller is
 * responsible for detecting "unknown" if strict validation is needed.
 */
export function toAiRulesCommandsAgent(agentbrewName: string): string | null {
  if (AGENTBREW_ONLY_COMMANDS_AGENTS.has(agentbrewName)) return null;
  return AGENTBREW_TO_AI_RULES_COMMANDS[agentbrewName] ?? agentbrewName;
}

/**
 * Translate an ai-rules commands agent name back to agentbrew's canonical
 * name. Used for drift reconciliation — when a user runs `ai-rules generate`
 * directly and agentbrew needs to record the result in state.yaml, the
 * agent name must be stored in agentbrew's vocabulary.
 *
 * Returns the same name if no rename applies.
 */
export function fromAiRulesCommandsAgent(aiRulesName: string): string {
  return AI_RULES_COMMANDS_TO_AGENTBREW[aiRulesName] ?? aiRulesName;
}

/**
 * Build the agent list for an `ai-rules generate --agents <list>`
 * subprocess invocation targeting the commands generation surface,
 * translating agentbrew agent names to ai-rules canonical names along the
 * way and filtering out `AGENTBREW_ONLY_COMMANDS_AGENTS` that ai-rules doesn't cover
 * for commands.
 *
 * Same shape as {@link buildAiRulesAgentList} from the rules delegation
 * (returns a deduplicated list the caller composes into the right CLI
 * flag form). Different intersection though — commands covers far fewer agents
 * than rules.
 *
 * Pure function — no side effects, no I/O. The caller decides what to do
 * with the carve-outs (run native, log, or refuse).
 *
 * @example
 *   buildAiRulesCommandsAgentList("all")
 *   // → { agents: ["*"], carveOuts: [] }
 *
 *   buildAiRulesCommandsAgentList(["claude-code", "cursor"])
 *   // → { agents: ["claude", "cursor"], carveOuts: [] }
 *
 *   buildAiRulesCommandsAgentList(["claude-code", "gemini-cli"])
 *   // → { agents: ["claude"], carveOuts: ["gemini-cli"] }
 */
export function buildAiRulesCommandsAgentList(agentbrewAgents: readonly string[] | "all"): {
  agents: string[];
  carveOuts: string[];
} {
  if (agentbrewAgents === "all") {
    return { agents: ["*"], carveOuts: [] };
  }
  const agents: string[] = [];
  const carveOuts: string[] = [];
  for (const agentbrewName of agentbrewAgents) {
    const aiRulesName = toAiRulesCommandsAgent(agentbrewName);
    if (aiRulesName === null) {
      carveOuts.push(agentbrewName);
      continue;
    }
    agents.push(aiRulesName);
  }
  return { agents, carveOuts };
}
