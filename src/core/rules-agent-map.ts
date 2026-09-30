/**
 * Agent-name reconciliation between agentbrew and block/ai-rules.
 *
 * Sibling of `agent-name-map.ts` (skills CLI) and `mcp-agent-map.ts` (mcpm).
 * Slice 1 of the `delegate-rules-to-ai-rules` task — see TASKS.md and
 * `docs/competition/block-ai-rules-vs-agentbrew.md` § Agent coverage.
 *
 * ai-rules and agentbrew support different rules-capable agent sets.
 * Differences from the skills CLI and mcpm maps:
 *   - Rename pairs: `claude-code` → `claude`, `gemini-cli` → `gemini`,
 *     `kilo` → `kilocode`, `roo-code` → `roo`.
 *   - Hard carve-outs: {@link AGENTBREW_ONLY_RULES_AGENTS} (see
 *     {@link AGENTBREW_ONLY_RULES_RATIONALE}).
 *   - Additional rules-capable agents delegate through ai-rules without being
 *     carve-outs — see `CANARY_DELEGATED_AGENTS` in `rules-sync.ts` and the
 *     matrix in `rules-sync-carveout-matrix.test.ts`.
 *
 * Why a separate file (not extending the other agent-name maps): each
 * delegation has its own rename/carve-out shape; sharing would force a
 * "which-tool" parameter into every helper and bloat the surface. Separate
 * files keep each delegation easy to delete when one delegation closes.
 *
 * Decision (2026-04-27): keep agentbrew's names as our public API and
 * translate on the delegation boundary. Same posture as the other two maps.
 *
 * Sources:
 *   - agentbrew canonical: `src/core/agents.yaml` filtered to entries with
 *     `rulesFile` or `rulesDir`
 *   - ai-rules canonical: `ai-rules list-agents` v1.6.0 2026-04-27
 *
 * See `docs/competition/block-ai-rules-vs-agentbrew.md` § Agent coverage
 * for the full diff.
 */

/** Agentbrew canonical name → ai-rules canonical name. */
export const AGENTBREW_TO_AI_RULES: Readonly<Record<string, string>> = Object.freeze({
  "claude-code": "claude",
  "gemini-cli": "gemini",
  kilo: "kilocode",
  "roo-code": "roo",
});

/** Ai-rules canonical name → agentbrew canonical name (reverse map). */
export const AI_RULES_TO_AGENTBREW: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(AGENTBREW_TO_AI_RULES).map(([a, r]) => [r, a])),
);

/**
 * Per-agent rationale for staying on the native rules sync instead of
 * delegating to ai-rules. Acceptance criterion (e) of the parent task
 * `delegate-rules-to-ai-rules` requires that "every surviving native code
 * path has a named carve-out reason in a comment." Exposing the rationale
 * as a Record (rather than burying it in a comment block) lets future code
 * surface the reason in a user-facing warning, drift-report explanation,
 * or migration plan without re-deriving it from prose docs.
 *
 * Each entry must be a single sentence the user can read in a CLI warning
 * — verbose enough to be informative, short enough to fit on one line.
 *
 * The carve-outs are likely to stay forever:
 *   - `windsurf`: not in ai-rules' supported list and unlikely to land
 *     given Codeium's separate ecosystem.
 *   - `augment`: not in ai-rules' supported list. Possible upstream PR if
 *     adoption justifies it; until then, native carve-out.
 *   - `devin`: Cognition product carve-out parallel to mcpm.
 *
 * `claude-desktop` is NOT a carve-out — it shares `~/.claude/CLAUDE.md`
 * with `claude-code` via agentbrew's `readsFrom` mechanism in agents.yaml,
 * so the claude-code intersection covers it transitively.
 */
export const AGENTBREW_ONLY_RULES_RATIONALE: Readonly<Record<string, string>> = Object.freeze({
  // windsurf: not in ai-rules' supported list. agentbrew writes both
  // ~/.codeium/windsurf/memories/global_rules.md (rulesFile) and
  // ~/.windsurf/rules/*.md (rulesDir). Likely upstream-blocked because
  // Windsurf/Codeium has its own separate ecosystem and integration story.
  windsurf: "Not in ai-rules' supported list; Codeium/Windsurf has a separate ecosystem.",

  // augment: not in ai-rules' supported list. agentbrew writes
  // ~/.augment/guidelines.md. Possible upstream PR if adoption justifies
  // it; until then, native carve-out.
  augment: "Not in ai-rules' supported list; possible upstream PR if adoption justifies.",

  // devin: agentbrew's devin entry is a Cognition product, not on
  // ai-rules' roadmap. Parallel to the mcpm devin carve-out.
  // Permanent carve-out; the most-plausible upstream
  // addition would be a Devin entry in ai-rules, tracked as a candidate
  // upstream issue (publishing requires explicit per-action approval per
  // the file-level TASKS.md publishing policy).
  devin: "Cognition product not on ai-rules' roadmap; parallel to mcpm devin carve-out.",

  // claude-desktop: shares ~/.claude/CLAUDE.md with claude-code via
  // agentbrew's `readsFrom` mechanism in agents.yaml. The claude-code
  // intersection covers it transitively, so the rules-translation layer
  // doesn't need to know about it — but the dispatcher does, because
  // calling `ai-rules generate --agents claude` writes to one path and
  // we need to ensure claude-desktop's `~/.claude/CLAUDE.md` (same
  // file) gets the managed-section wrap. Treated as a carve-out at the
  // delegation boundary; the actual file write happens once via
  // claude-code's path.
  "claude-desktop": "Shares ~/.claude/CLAUDE.md with claude-code via readsFrom; ai-rules conflates them under claude.",
});

/**
 * Agents that agentbrew has but ai-rules does not. When delegating these,
 * the dispatcher must fall back to the native installer — ai-rules has no
 * equivalent agent. Each entry's rationale lives in
 * {@link AGENTBREW_ONLY_RULES_RATIONALE}; the Set is derived from that
 * Record's keys so adding a new carve-out to the Set without a documented
 * reason is a type-system / test-suite error, not a silent drift.
 */
export const AGENTBREW_ONLY_RULES_AGENTS: ReadonlySet<string> = new Set(Object.keys(AGENTBREW_ONLY_RULES_RATIONALE));

/**
 * Translate an agentbrew agent name to the name ai-rules expects on the
 * `--agents <name>` flag. Returns:
 *   - the same name if it's in the strict intersection (cursor, codex,
 *     amp, cline, copilot, firebender, goose) — pass-through
 *   - the remapped name for entries in {@link AGENTBREW_TO_AI_RULES}
 *   - null for the carve-outs (windsurf, augment, devin) — caller
 *     should route to native installer
 *
 * Unknown names (not in any list) return the name unchanged — caller is
 * responsible for detecting "unknown" if strict validation is needed.
 */
export function toAiRulesAgent(agentbrewName: string): string | null {
  if (AGENTBREW_ONLY_RULES_AGENTS.has(agentbrewName)) return null;
  return AGENTBREW_TO_AI_RULES[agentbrewName] ?? agentbrewName;
}

/**
 * Translate an ai-rules agent name back to agentbrew's canonical name.
 * Used for drift reconciliation — when a user runs `ai-rules generate`
 * directly and agentbrew needs to record the result in state.yaml, the
 * agent name must be stored in agentbrew's vocabulary.
 *
 * Returns the same name if no rename applies.
 */
export function fromAiRulesAgent(aiRulesName: string): string {
  return AI_RULES_TO_AGENTBREW[aiRulesName] ?? aiRulesName;
}

/**
 * Build the agent list for an `ai-rules generate --agents <list>`
 * subprocess invocation, translating agentbrew agent names to ai-rules
 * canonical names along the way and filtering out `AGENTBREW_ONLY_RULES_AGENTS`
 * that ai-rules doesn't cover.
 *
 * Different return shape than {@link buildSkillsCliAgentArgs} from the
 * skills CLI delegation — skills CLI's `npx skills add` accepts
 * `--agent <name>` repeated args, while ai-rules' `generate --agents`
 * accepts a comma-separated list. Same shape as
 * {@link buildMcpmClientList} from the mcpm delegation (returns a
 * deduplicated list the caller composes into the right CLI flag form).
 *
 * Pure function — no side effects, no I/O. The caller decides what to do
 * with the carve-outs (run native, log, or refuse).
 *
 * @example
 *   buildAiRulesAgentList("all")
 *   // → { agents: ["*"], carveOuts: [] }
 *
 *   buildAiRulesAgentList(["claude-code", "cursor"])
 *   // → { agents: ["claude", "cursor"], carveOuts: [] }
 *
 *   buildAiRulesAgentList(["windsurf", "claude-code", "augment", "devin"])
 *   // → { agents: ["claude"], carveOuts: ["windsurf", "augment", "devin"] }
 */
export function buildAiRulesAgentList(agentbrewAgents: readonly string[] | "all"): {
  agents: string[];
  carveOuts: string[];
} {
  if (agentbrewAgents === "all") {
    return { agents: ["*"], carveOuts: [] };
  }
  const agents: string[] = [];
  const carveOuts: string[] = [];
  for (const agentbrewName of agentbrewAgents) {
    const aiRulesName = toAiRulesAgent(agentbrewName);
    if (aiRulesName === null) {
      carveOuts.push(agentbrewName);
      continue;
    }
    agents.push(aiRulesName);
  }
  return { agents, carveOuts };
}
