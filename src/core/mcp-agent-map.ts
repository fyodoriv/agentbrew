/**
 * Agent-name reconciliation between agentbrew and mcpm.sh.
 *
 * Sibling of `agent-name-map.ts` (which covers skills CLI). Slice 1 of the
 * `delegate-mcp-to-mcpm` task — see TASKS.md and
 * `docs/competition/mcpm-sh-vs-agentbrew.md` § Client coverage.
 *
 * Both tools cover an overlap of MCP clients, but with two differences from
 * the skills CLI map:
 *   - Different rename pairs: `codex` → `codex-cli`, `goose` → `goose-cli`
 *     (no `copilot`/`kiro`/`roo-code` renames here — those are skills-CLI-only).
 *   - Different carve-out set: see {@link AGENTBREW_ONLY_MCP_AGENTS} and
 *     {@link AGENTBREW_ONLY_MCP_RATIONALE} (adapter contribute candidates
 *     `opencode`, `kiro`, `amp` stay native until upstream PRs land; hard
 *     product-context carve-outs include `overlay-desktop`, `copilot`).
 *
 * Why a separate file (not extending `agent-name-map.ts`): each delegation
 * has its own rename/carve-out shape; sharing would force a "which-tool"
 * parameter into every helper and bloat the surface. Separate files keep
 * each delegation easy to delete when one delegation closes.
 *
 * Decision (2026-04-27): keep agentbrew's names as our public API and
 * translate on the delegation boundary. Same posture as the skills CLI map.
 *
 * Sources:
 *   - agentbrew canonical: `src/core/agents.yaml` filtered to `mcpConfig*` fields
 *   - mcpm canonical: `mcpm client ls` (see competition deep-dive snapshot)
 *
 * See `docs/competition/mcpm-sh-vs-agentbrew.md` § Client coverage for the
 * full diff.
 */

/** Agentbrew canonical name → mcpm canonical name (see {@link AGENTBREW_TO_MCPM}). */
export const AGENTBREW_TO_MCPM: Readonly<Record<string, string>> = Object.freeze({
  codex: "codex-cli",
  goose: "goose-cli",
});

/**
 * Per-agent rationale for staying on the native MCP installer instead of
 * delegating to mcpm. Acceptance criterion (e) of the parent task
 * `delegate-mcp-to-mcpm` requires that "every surviving native code path
 * has a named carve-out reason in a comment." Exposing the rationale as a
 * Record (rather than burying it in a comment block) lets future code
 * surface the reason in a user-facing warning, drift-report explanation, or
 * migration plan without re-deriving it from prose docs.
 *
 * Each entry must be a single sentence the user can read in a CLI warning
 * — verbose enough to be informative, short enough to fit on one line.
 *
 * Re-evaluate as upstream PRs land. Small-adapter contribute candidates
 * (`opencode`, `kiro`, `amp`) come off this map when upstream adapters land.
 * Hard product-context carve-out (`copilot`) likely stays forever —
 * a VS Code product surface that won't go upstream.
 * (organization's overlay-desktop is an overlay agent, not core.)
 */
export const AGENTBREW_ONLY_MCP_RATIONALE: Readonly<Record<string, string>> = Object.freeze({
  // NOTE: product-specific overlay agents (e.g. the organization Developer Desktop
  // App's overlay-desktop, provided by the agentbrew-acme team overlay) are
  // also native carve-outs, but their rationale lives in the overlay — core no
  // longer enumerates them. They're native simply by not being in
  // MCP_INTERSECTION_AGENTS below.

  // copilot: agentbrew writes ~/Library/.../Code/User/settings.json with
  // an `mcp.servers` key (the VS Code main settings file). mcpm's `vscode`
  // client writes the modern dedicated `~/Library/.../Code/User/mcp.json`
  // file. They cover different surfaces of the same product. Either
  // contribute upstream as a settings.json variant of mcpm.vscode, or keep
  // native. TBD in slice 6 of `delegate-mcp-to-mcpm`.
  copilot: "agentbrew writes VS Code settings.json mcp.servers key; mcpm's vscode client uses dedicated mcp.json.",

  // opencode: small adapter contribute candidate in mcpm Python. Slice 6
  // of `delegate-mcp-to-mcpm` files an upstream adapter PR. Until it
  // lands, opencode stays native.
  opencode: "Not in mcpm's client list; small adapter contribute candidate (slice 6 of delegate-mcp-to-mcpm).",

  // kiro: small adapter, same shape as opencode. Note this is a different
  // "kiro" than the skills CLI rename — for skills CLI, agentbrew's `kiro`
  // maps to skills CLI's `kiro-cli`; for mcpm, agentbrew's `kiro` is a
  // carve-out (mcpm has no Kiro client at all). Symmetric shape, different
  // semantics across skills CLI vs mcpm.
  kiro: "Not in mcpm's client list; small adapter contribute candidate (slice 6 of delegate-mcp-to-mcpm).",

  // amp: small adapter, same shape as opencode. Sourcegraph Amp's MCP
  // config lives at `~/.config/amp/settings.json` under an `amp.mcpServers`
  // key.
  amp: "Not in mcpm's client list; small adapter contribute candidate (slice 6 of delegate-mcp-to-mcpm).",

  // cursor: moved from intersection to carve-out. mcpm's `mcpm client edit
  // cursor` writes `mcpm_<name>` wrapper entries (command: mcpm, args: [run,
  // <name>]) into ~/.cursor/mcp.json. Cursor lists those in the MCP UI but
  // does NOT expose them to its agent tool layer (CallMcpTool only sees
  // direct-command entries). Native sync writes the resolved command/args
  // directly, matching the entries Cursor's agent layer actually surfaces.
  cursor:
    "mcpm's `mcpm run` wrapper entries aren't surfaced to Cursor's agent tool layer. Native sync writes direct commands.",
});

/**
 * Agents that agentbrew has but mcpm does not. When delegating these,
 * the dispatcher must fall back to the native installer — mcpm has no
 * equivalent client. Each entry's rationale lives in
 * {@link AGENTBREW_ONLY_MCP_RATIONALE}; the Set is derived from that
 * Record's keys so adding a new carve-out to the Set without a documented
 * reason is a type-system / test-suite error, not a silent drift.
 */
export const AGENTBREW_ONLY_MCP_AGENTS: ReadonlySet<string> = new Set(Object.keys(AGENTBREW_ONLY_MCP_RATIONALE));

/**
 * {@link MCP_INTERSECTION_AGENTS} — every MCP-capable agent whose client
 * mcpm supports natively (post-rename). Slice 3a (PR #835) shipped this
 * Set in `src/mcp/mcp-registry.ts` (since deleted by slice 5a, PR #850)
 * for use during `mcp install` (the imperative command also deleted by
 * slice 5a); slice 4a moved it here so the sync orchestrator and the
 * drift checker can also import it for skip semantics.
 *
 * Mirrors the `CANARY_DELEGATED_AGENTS` Set in `src/sync/rules-sync.ts`
 * for the rules-to-ai-rules delegation. Same shape, different agent set.
 *
 * The carve-outs (copilot, opencode, kiro, amp) are NOT in this Set
 * — they continue to receive native sync writes per
 * `AGENTBREW_ONLY_MCP_RATIONALE`. Product-specific overlay agents (e.g.
 * overlay-desktop) are likewise native by not appearing here. The carve-out Set
 * and the intersection Set must be disjoint by construction; the test suite
 * pins this invariant in `mcp-agent-map.test.ts`.
 */
export const MCP_INTERSECTION_AGENTS: ReadonlySet<string> = new Set([
  "claude-code",
  // cursor: moved to AGENTBREW_ONLY_MCP_RATIONALE (mcpm `mcpm run` wrapper
  // entries aren't surfaced to Cursor's agent tool layer; native sync writes
  // direct commands instead)
  "claude-desktop",
  "cline",
  "gemini-cli",
  "codex",
  "goose",
  "roo-code",
]);

/**
 * Intersection clients whose MCP config file loads stdio servers only.
 * Claude Desktop rejects `{ type: "http", url }` in
 * claude_desktop_config.json ("Skipped invalid MCP server config entries")
 * and shows a startup error; it takes remote MCPs through Connectors or
 * plugins. The remote HTTPS carve-out in `syncMcpServers` skips these.
 */
export const STDIO_ONLY_MCP_AGENTS: ReadonlySet<string> = new Set(["claude-desktop"]);

/**
 * Translate an agentbrew agent name to the name mcpm expects on the
 * `mcpm client edit <client>` subcommand. Returns:
 *   - the same name if it's in {@link MCP_INTERSECTION_AGENTS} (pass-through)
 *   - the remapped name for entries in {@link AGENTBREW_TO_MCPM}
 *   - null for {@link AGENTBREW_ONLY_MCP_AGENTS} (caller should route to native installer)
 *
 * Unknown names (not in any list) return the name unchanged — caller is
 * responsible for detecting "unknown" if strict validation is needed.
 */
export function toMcpmClient(agentbrewName: string): string | null {
  if (AGENTBREW_ONLY_MCP_AGENTS.has(agentbrewName)) return null;
  return AGENTBREW_TO_MCPM[agentbrewName] ?? agentbrewName;
}

/**
 * Build the per-client list mcpm needs for an `mcpm client edit <client>`
 * dispatch sequence, translating agentbrew agent names to mcpm canonical
 * names along the way and filtering out `AGENTBREW_ONLY_MCP_AGENTS` clients that mcpm
 * doesn't cover.
 *
 * Different return shape than {@link buildSkillsCliAgentArgs} from the
 * skills CLI delegation — skills CLI's `npx skills add` accepts
 * `--agent <name>` repeated args in one subprocess call, while mcpm's
 * `mcpm install <server>` is a global step followed by per-client
 * `mcpm client edit <client>` subcommands. This helper outputs the list of
 * client names the caller will iterate over for the per-client step;
 * carve-outs go to the native installer instead.
 *
 * Pure function — no side effects, no I/O. The caller decides what to do
 * with the carve-outs (run native, log, or refuse).
 *
 * @example
 *   buildMcpmClientList("all")
 *   // → { clients: ["*"], carveOuts: [] }
 *
 *   buildMcpmClientList(["codex", "claude-code"])
 *   // → { clients: ["codex-cli", "claude-code"], carveOuts: [] }
 *
 *   buildMcpmClientList(["copilot", "goose", "overlay-desktop"])
 *   // → { clients: ["goose-cli"], carveOuts: ["copilot", "overlay-desktop"] }
 */
export function buildMcpmClientList(agentbrewAgents: readonly string[] | "all"): {
  clients: string[];
  carveOuts: string[];
} {
  if (agentbrewAgents === "all") {
    return { clients: ["*"], carveOuts: [] };
  }
  const clients: string[] = [];
  const carveOuts: string[] = [];
  for (const agentbrewName of agentbrewAgents) {
    const mcpmName = toMcpmClient(agentbrewName);
    if (mcpmName === null) {
      carveOuts.push(agentbrewName);
      continue;
    }
    clients.push(mcpmName);
  }
  return { clients, carveOuts };
}
