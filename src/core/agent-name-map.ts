/**
 * Agent-name reconciliation between agentbrew and skills CLI.
 *
 * Most supported agents overlap, but rename pairs in {@link AGENTBREW_TO_SKILLS_CLI} use different canonical names
 * for the same agent. When agentbrew delegates install to
 * `npx skills add ... --agent <name>`, the dispatcher must translate
 * agentbrew's name to the skills-CLI name or the subprocess silently skips
 * those agents.
 *
 * Decision (2026-04-24): keep agentbrew's names as our public API (already
 * stamped into `agents.yaml`, state.yaml, and user commands) and translate
 * on the delegation boundary. No breaking change for users.
 *
 * Sibling reverse map (skills CLI → agentbrew) is rarely needed but included
 * for completeness so downstream drift detection can reconcile either direction.
 *
 * Sources:
 *   - agentbrew canonical: `src/core/agents.yaml`
 *   - skills CLI canonical: https://raw.githubusercontent.com/vercel-labs/skills/main/src/types.ts
 *     (the `AgentType` union)
 *
 * See `docs/competition/vercel-skills-cli-vs-agentbrew.md` § Parity diff for
 * the full rename/carve-out breakdown.
 */

/** Agentbrew canonical name → skills CLI canonical name (see {@link AGENTBREW_TO_SKILLS_CLI}). */
export const AGENTBREW_TO_SKILLS_CLI: Readonly<Record<string, string>> = Object.freeze({
  copilot: "github-copilot",
  kiro: "kiro-cli",
  "roo-code": "roo",
});

/**
 * Per-agent rationale for staying on the native installer instead of
 * delegating to skills CLI. Slice 6 of `delegate-skill-install-to-skills-cli`
 * (TASKS.md): the parent task's Acceptance criterion (d) requires that
 * "every surviving native code path has a named carve-out reason in a
 * comment." Exposing the rationale as a Record (rather than burying it in
 * a comment block) lets future code surface the reason in a user-facing
 * warning, drift-report explanation, or migration plan without re-deriving
 * it from prose docs.
 *
 * Each entry must be a single sentence the user can read in a CLI warning
 * — verbose enough to be informative, short enough to fit on one line.
 *
 * Re-evaluate quarterly via `quarterly-dissolution-reeval` (TASKS.md). If
 * skills CLI absorbs an entry's underlying need (e.g. lands a
 * `readsFrom`-equivalent for `claude-desktop`), the entry comes off this map
 * AND out of the Set in the same commit, and the corresponding native code path
 * is deleted.
 */
export const AGENTBREW_ONLY_AGENTS_RATIONALE: Readonly<Record<string, string>> = Object.freeze({
  // claude-desktop: shares ~/.claude/skills with claude-code via agentbrew's
  // `readsFrom` mechanism (src/core/agents.yaml). Skills CLI conflates the two
  // under the `claude-code` target, so adding `--agent claude-desktop` would
  // either duplicate symlinks or return "unknown agent" — neither is correct.
  // Likely resolved upstream when skills CLI grows a `readsFrom`-equivalent;
  // for now agentbrew's native sync handles deployment while skills CLI's
  // claude-code install populates the shared directory.
  "claude-desktop":
    "Shares ~/.claude/skills with claude-code via readsFrom; skills CLI conflates them under claude-code.",

  // qodo: added to agentbrew's agents.yaml via PR #3. Verified against the live
  // vercel-labs/skills/main src/types.ts
  // AgentType union — qodo is NOT present there. Status uncertain: could
  // be an upstream gap we should contribute (file PR at vercel-labs/skills
  // adding qodo to AgentType), or qodo may have a different canonical name
  // in skills CLI. Until reconciled, route to native and re-evaluate at
  // the next quarterly sweep (quarterly-dissolution-reeval). If qodo lands
  // upstream with a different canonical name, this entry moves to
  // AGENTBREW_TO_SKILLS_CLI (renames) and out of here; if upstream stays
  // silent for 90 days, file a contribution PR per the delegate→contribute→
  // absorb policy.
  qodo: "Added to agentbrew's agents.yaml but not yet present in skills CLI's AgentType union; pending upstream reconciliation.",
});

/**
 * Agents that agentbrew has but skills CLI does not. When delegating these,
 * the dispatcher must fall back to the native installer — skills CLI has no
 * equivalent target. Each entry's rationale lives in
 * {@link AGENTBREW_ONLY_AGENTS_RATIONALE} (slice 6 of
 * `delegate-skill-install-to-skills-cli`); the Set is derived from that
 * Record's keys so adding a new carve-out to the Set without a documented
 * reason is a type-system / test-suite error, not a silent drift.
 */
export const AGENTBREW_ONLY_AGENTS: ReadonlySet<string> = new Set(Object.keys(AGENTBREW_ONLY_AGENTS_RATIONALE));

/**
 * Translate an agentbrew agent name to the name skills CLI expects on the
 * `--agent` flag. Returns:
 *   - the same name if it's in the shared agent intersection (pass-through)
 *   - the remapped name for entries in {@link AGENTBREW_TO_SKILLS_CLI}
 *   - null for {@link AGENTBREW_ONLY_AGENTS} (caller should route to native)
 *
 * Unknown names (not in any list) return the name unchanged — caller is
 * responsible for detecting "unknown" if strict validation is needed.
 */
export function toSkillsCliAgent(agentbrewName: string): string | null {
  if (AGENTBREW_ONLY_AGENTS.has(agentbrewName)) return null;
  return AGENTBREW_TO_SKILLS_CLI[agentbrewName] ?? agentbrewName;
}

/**
 * Build the `--agent` flag list for an `npx skills add` subprocess invocation,
 * translating agentbrew agent names to skills-CLI canonical names along the
 * way and filtering out carve-out agents that skills CLI doesn't cover.
 *
 * Two modes:
 *   - `"all"` — emits the wildcard form `["--agent", "*"]`. This preserves
 *     the historical {@link delegateRemoteSkill} behaviour where every
 *     detected agent gets the skill. No carve-outs are reported because the
 *     wildcard is opaque to the dispatcher.
 *   - `string[]` — emits one `--agent <name>` pair per supported agent in
 *     the input. The rename pairs (`copilot` → `github-copilot`,
 *     `kiro` → `kiro-cli`, `roo-code` → `roo`) translate on the boundary so
 *     skills CLI sees its own canonical vocabulary. Carve-out agents
 *     (e.g. `claude-desktop`) are skipped and reported in the returned `carveOuts`
 *     array — the caller is responsible for routing it to the native installer.
 *
 * Pure function — no side effects, no I/O. The caller decides what to do
 * with the carve-outs (run native, log, or refuse).
 *
 * @example
 *   buildSkillsCliAgentArgs("all")
 *   // → { args: ["--agent", "*"], carveOuts: [] }
 *
 *   buildSkillsCliAgentArgs(["copilot", "claude-code"])
 *   // → { args: ["--agent", "github-copilot", "--agent", "claude-code"],
 *   //     carveOuts: [] }
 *
 *   buildSkillsCliAgentArgs(["claude-desktop", "kiro", "copilot"])
 *   // → { args: ["--agent", "kiro-cli"],
 *   //     carveOuts: ["claude-desktop"] }
 */
export function buildSkillsCliAgentArgs(agentbrewAgents: readonly string[] | "all"): {
  args: string[];
  carveOuts: string[];
} {
  if (agentbrewAgents === "all") {
    return { args: ["--agent", "*"], carveOuts: [] };
  }
  const args: string[] = [];
  const carveOuts: string[] = [];
  for (const agentbrewName of agentbrewAgents) {
    const skillsCliName = toSkillsCliAgent(agentbrewName);
    if (skillsCliName === null) {
      carveOuts.push(agentbrewName);
      continue;
    }
    args.push("--agent", skillsCliName);
  }
  return { args, carveOuts };
}
