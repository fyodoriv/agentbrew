---
schema: vision-v1
version: 1
last_reviewed: 2026-05-27
primary_agents:
  # The "main use case" agent set. Every sync surface that exists for ANY
  # agent must work for ALL of these. Auto-repair every 30 minutes verifies
  # parity. If you are adding a sync feature and it only works for Claude
  # Code, it's not done — extend it to Cursor / Windsurf / Devin / Codex
  # before merge. See G4 and G6 below.
  - claude-code
  - cursor
  - windsurf
  - devin
  - codex
goals:
  - id: G1
    name: Curate, not host
    description: agentbrew references skills in their source repos; it never duplicates content. Tier 1 = "every developer benefits".
  - id: G2
    name: Generic by default, extensible via team overlays
    description: Public catalog stays org-agnostic. org-specific tools live in overlay repos loaded via `agentbrew team set`.
  - id: G3
    name: One sync command does everything
    description: `agentbrew sync` is the single entry point. Never asks the user to run two commands.
  - id: G4
    name: Every agent from a single source of truth
    description: One Agentfile.yaml drives Claude Code, Cursor, Windsurf, Devin, Codex, OpenCode, Kiro, Amp, Goose, Cline, Roo Code, and every other agent in `agents.yaml`.
  - id: G5
    name: Drift detection + auto-repair
    description: `agentbrew fix` runs every 30 minutes via launchagent. State and MCP runtime health are verifiable; config corruption and common MCP regressions are detectable and automatically corrected.
  - id: G6
    name: Full automatic parity across primary agents
    description: |
      Every sync surface (skills, MCP servers, rules, commands, agent definitions,
      hooks, instructions) deploys to every primary agent in
      `src/sync/per-agent-features.matrix.test.ts` (Claude Code, Cursor, Windsurf, Devin,
      Codex) without manual intervention, every 30 minutes via the
      auto-repair launchagent. "Works for Claude Code only" is a regression; gaps
      against any primary agent get filed as P0 tasks. The full matrix is enforced
      by `src/sync/per-agent-features.matrix.test.ts`; new sync surfaces must extend
      that test before merge.
non_goals:
  - id: NG1
    name: Not a per-agent config UI
    description: Don't write to ~/.claude/, ~/.cursor/, etc. directly. agentbrew owns those paths.
  - id: NG2
    name: Not a skill author
    description: Skills live in their source repos. agentbrew indexes them, never forks them.
  - id: NG3
    name: No bespoke support for low-priority agents
    description: |
      Agents named in the user's `excludeAgents:` Agentfile field get marked `detected: false`
      and skip every sync path. Per-agent branches, per-agent tests, per-agent skill variants,
      and per-agent rule files for excluded agents are out of scope. Current local exclusions
      (in `~/.config/agentbrew/Agentfile.yaml`): Amp, Augment, Kiro, OpenCode. The `agents.yaml`
      catalog still LISTS them so a future user can opt them back in by removing the entry from
      their excludeAgents list — agentbrew itself stays generic.
---

# Vision

**One CLI that curates, syncs, and self-heals AI coding agent config across every tool on a machine.** Generic by default; extensible via team overlays for any org.

```bash
npm install -g agentbrew
agentbrew                    # auto-init, auto-sync — done

agentbrew team set <overlay-url>   # optional — layer on your company's curated set
```

## Who it's for

**Primary user: any developer using AI coding agents.** Install once, configure once, and every agent on the machine gets the same skills, MCP servers, rules, commands, hooks, and agent definitions. The catalog ships with public, generic recommendations that benefit any developer.

**Main use cases — first-class, sync-everything, no-manual-steps:** Claude Code, Cursor, Windsurf, Devin, Codex — the primary agent set pinned by `src/sync/per-agent-features.matrix.test.ts`. They represent the dominant interactive and non-interactive AI coding surfaces today. Every sync category (skills, MCP, rules, commands, agents, hooks, instructions) deploys to that set every 30 minutes via the auto-repair launchagent. A gap against any primary agent is a P0 regression — see [G6](#goals) and the matrix test for enforcement.

**Long-tail agents — best-effort, parity-where-possible:** OpenCode, Kiro, Amp, Goose, Cline, Roo Code, Gemini CLI, GitHub Copilot, plus other experimental surfaces listed in `src/core/agents.yaml`. agentbrew detects and syncs to these too, but only for the sync categories each agent supports natively. New first-party features land for the primary agent set first; long-tail support follows when each agent's underlying API permits.

**Team-extensible: any org with internal tooling.** Internal skills repos, MCP servers needing org-specific env vars, curated tool lists — wrap them in a team-overlay repo with an `Agentfile.yaml` at root. `agentbrew team set <overlay-url>` activates the layer; `team unset` reverses cleanly. agentbrew core has zero knowledge of any specific company; every overlay capability is parameterized through the `team` command. See [US 27: Team overlays](user-stories/27-team-overlay.md) for the schema and lifecycle.

**Today's user base: one.** Exactly one laptop runs agentbrew today — the author's. Pre-v1, no internal distribution, no public npm publish. **Breaking changes ship in one commit** — no deprecation windows, no migration paths, no backwards-compat scaffolding. When the user base grows past one, we reintroduce that discipline; until then, the CHANGELOG notes breakage but doesn't defer it. This is what makes the delegate-aggressively strategy below possible.

## Strategy: delegate, contribute, absorb

**The mental stance: GET, don't IMPLEMENT.** When you discover a new pattern, tool, library, idiom, or workflow, the first question is **"How do I GET this outcome?"** — not **"How do I implement this in our tool?"** The first leads to a 1-day integration with a pre-existing tool; the second leads to weeks of reimplementation that ages out of sync with upstream. The wrong question makes you the implementer. The right question makes you the integrator. (See [`skill-plugins/dev/prefer-reuse-over-reinvent/SKILL.md`](../skill-plugins/dev/prefer-reuse-over-reinvent/SKILL.md) for the operational decision-order; this section is the why.)

**Agentbrew is the residue of what the ecosystem won't absorb.** Every subsystem runs through three steps before it earns a line of maintenance:

1. **Delegate immediately.** Upstream tool does 80%+ of the job? Shell out or call its library. With one user today, "measure friction" collapses to ~1 hour of dev-machine testing: delete the native code, verify the subprocess works. If it does, ship; if it doesn't, revert. No "just in case" fallbacks, no deprecated flags.
2. **Contribute the missing 20%.** File RFCs and PRs upstream for the gaps. Engage existing community PRs instead of racing them. Every contribution has a **90-day engagement window** — silence counts as rejection.
3. **Absorb only the rejected residue.** If upstream rejects a contribution explicitly OR ignores it for 90 days, that capability becomes agentbrew's permanent scope. Everything else is temporary.

**Pair every new feature with a "Replace? Relocate?" research task.** A follow-up TASKS.md entry that revisits the build/buy decision quarterly. Candidate hosts default to: the relevant upstream project, agentbrew, dotfiles, tasks.md. This is the ratchet that prevents drift back into IMPLEMENT-mode.

**Anti-pattern**: framing a task as "implement X" without first checking "does Y already do X?" is a constitutional violation. The reviewer must reject and ask for the GET/WRAP/CONTRIBUTE evidence before ABSORB is approved.

**Practical consequence: agentbrew's codebase shrinks, not grows.** Every new-feature PR must answer *"Why is this in agentbrew instead of skills CLI / mcpm.sh / block-ai-rules / caliber?"* Valid answers: (a) delegation is blocked by a named constraint; (b) we contributed and upstream rejected/ignored 90+ days; (c) team overlay content; (d) multi-surface glue no upstream tool has.

**Applied to today's competitors:**

- **skills CLI (skill install)** — **delegation shipped, parent task closed 2026-04-28; residual sandbox / proxy / offline gate closed 2026-05-02** (slices 2–7 between 2026-04-26 and 2026-04-27, PRs #790, #804, #805, #806, #807, #808, #809, plus PR #810 for slice 7; slices 8–12 closed the `absorb-*-from-skills-cli` siblings 2026-04-27). `npx skills add` is now the primary install path for the skills-CLI intersection (see `src/core/agent-name-map.ts`); carve-outs (`claude-desktop`, `overlay-desktop`) stay native because they're not fully covered by skills CLI's target model and the cache-clone + index step that feeds the native deploy for those two is permanent ([`cloneAndIndexRemoteSource` in `src/add-source.ts`](../src/add-source.ts)). The 2026-05-02 hardware-bound measurement passed on the current enterprise macOS / Devin CLI session and on a warm offline cache; a cold offline cache fails fast as expected, matching agentbrew's native first-time remote clone requirement. The same refresh removed `devin` from the native carve-out set because skills CLI now supports it.
- **mcpm.sh (MCP sync)** — **delegation shipped 2026-04-27** (all 7 slices: 1, 2, 3a, 3b, 4a, 4b, 4c, 5a, 5b, 5c, 6a, 6b, 6c, 6d, 7), verdict **Contribute (selective delegation, split-intersection model)** ([deep-dive](competition/mcpm-sh-vs-agentbrew.md)). Strict client-intersection agents delegate to `mcpm install` / `mcpm client edit` (see `MCP_INTERSECTION_AGENTS` in `src/core/mcp-agent-map.ts`); adapters filed upstream (opencode #327, kiro #328, amp #329, plus `mcpm doctor --json` UX PR #326); hard carve-outs (devin, overlay-desktop) stay native. Net shrink ~3,489 LOC. Pure-blocker fallback: if a corporate proxy or Devin sandbox blocks Python subprocess on a real machine, verdict downgrades to Complementary in context X.
- **block/ai-rules (rules sync)** — **delegation shipped, parent task closed 2026-04-28**, verdict **Contribute (selective delegation, wrapper-around-output model)** ([deep-dive](competition/block-ai-rules-vs-agentbrew.md)). Strict intersection and free-capability rules agents delegate via `CANARY_DELEGATED_AGENTS` / `src/core/rules-agent-map.ts`; windsurf, augment, and devin carve-outs stay native. Wrapper-around-output approach preserves user data per VISION.md "Never destroy user data". Slices 1–5 + 7 shipped 2026-04-27; slice 6b filed at block/ai-rules#91 (`status --json`); residual slice 6a (`--source-dir`/`--target-dir` flags PR) lives in the standalone child [`delegate-rules-to-ai-rules-slice-6a-followup`](../TASKS.md). Net shrink ~300–350 LOC. The parent retired mirroring `delegate-mcp-to-mcpm`'s PR #906 and `delegate-skill-install-to-skills-cli`'s PR #914 retirement — substantively done, residual publish-pending work decoupled. Pure-blocker fallback: if a corporate proxy or Devin sandbox blocks the curl-installer, verdict downgrades to Complementary in context X.
- **Composio / official MCP Registry / content sources (2026-07-06 landscape review)** — the connector long tail delegates to [Composio](https://composio.dev/) (one MCP endpoint + meta-tools replaces N per-connector catalog entries); MCP pointer curation delegates to the [official MCP Registry](https://registry.modelcontextprotocol.io) as it GAs; best-in-class capability arrives as *content*, not code — Sourcegraph MCP + Context7 (code/docs context) and Superpowers / Compound Engineering / gstack (methodology skills) are referenced as catalog entries / sources, never forked. Tracked by the landscape review P0 tasks in TASKS.md (tag `landscape-2026-07-06`). Full comparison: `canvases/agentic-tooling-vs-agentbrew.canvas.tsx`.
- **Caliber / Bridle / others** — do NOT absorb features from them. If their ideas are good, contribute upstream or point users at them directly. Porting grows our surface.

**Deep competitive analysis**: [`docs/competition/vercel-skills-cli-vs-agentbrew.md`](competition/vercel-skills-cli-vs-agentbrew.md) (dissolution analysis); per-competitor verdicts: [`docs/COMPETITION.md`](COMPETITION.md#build-or-contribute--per-competitor-summary).

## Core beliefs

- **Curator, not host.** Catalog entries point to source repos. Content never gets copied into agentbrew. The narrow exception: the Bucket-1 skills in `skill-plugins/dev/` that document agentbrew itself (`agentbrew-*`, `agentfile-init`, `sync-agent-config`, `load-project-context`, `context-budget`, `cursor-token-playbook`, plus the agentbrew-process skills `prefer-reuse-over-reinvent`, `verify-vision-trace`, `competitor-spot-check`, `detect-task-backend`, `write-vision`). The generic Bucket-2 skills (debug, plan, refactor, review, commit, pr, rfc, iterate, …) were **deleted and replaced by upstream skill-repo pointers** (obra/Superpowers, Compound Engineering, gstack, Anthropic skills) in the 2026-07-06 shrink pass. New skills go to a source repo, not here. For the team overlay specifically, the canonical path is a whole-repo pointer in `catalog-overlay.yaml` → `repo_sources:` (e.g. `your-org/team-skills`). `agentbrew team set <overlay-url>` auto-registers every declared repo as a `Source` with `origin: catalog`; `agentbrew sync` soft-updates them on a 30-min TTL (matching the launchagent cadence) so overlay content stays fresh without the user thinking about it; `agentbrew team unset` removes them symmetrically. Adding a new team skill that is already in the registry requires zero agentbrew PRs — it flows through on the next sync.
- **Simple beats clever.** Strong defaults over extensive configuration. One right way over many possible ways. If a decision can be made for the user, make it.
- **Wrap, don't rewrite.** Delegate over reimplement. Delete aggressively when upstream catches up. Celebrate deletions.
- **Maintenance is the product.** Non-test source has **crossed the 30K-line "dissolution trigger"** named in the [competition doc](competition/vercel-skills-cli-vs-agentbrew.md#triggers-that-would-flip-the-decision-to-dissolve-now), so shrinking is now the priority, not optional. Near-term target ~20K after the 2026-07-06 shrink-pass P0 deletions land (delete generic skills, drop the custom SKILL.md validator, collapse instructions onto AGENTS.md, delegate MCP-sync/health/context-budget to standards — see TASKS.md landscape review tasks (tag landscape-2026-07-06); long-term target ~5–7K as the minimum-viable orchestrator ([competition doc § "Minimum viable agentbrew"](competition/vercel-skills-cli-vs-agentbrew.md#minimum-viable-agentbrew--the-orchestrator-fallback)). Shrinking the codebase is always a valid PR.
- **Auto-fix by default.** One command does everything. `agentbrew sync` repairs rules + instructions + skills + commands + MCP + hooks + agent definitions in one pass. No "next steps" footer on the happy path. Repeat runs converge silently.
- **Never destroy data you didn't create.** Manual edits to agent config survive every sync. `--prune` only touches entries agentbrew created. `sync --rollback` is always available. One violation kills adoption permanently.
- **Output quality is UX.** Quiet by default; `--verbose` opts into detail. Every error names the affected file and the command that recovers. Honest numbers — every count agrees across every printing site.
- **Easy to contribute.** Add an entry to `catalog.yaml` or `catalog-overlay.yaml`, open a PR. Never copy skill content into agentbrew — contribute to the source repo instead.
- **Per-repo classification glue** — `agentbrew classify <repo-path>` returns `solo` (single-committer over the last year) or `shared` so downstream tools (minsky, safe-admin-merge) can scale safety guards by risk surface. Override file at `~/.config/agentbrew/repo-class.yaml` wins over auto-detection.

## The essential core

The eight non-negotiable capabilities. A simplification that breaks any of these is wrong.

1. **Agent detection** — walk the machine, find every installed AI coding agent and where each stores config. [US 01](user-stories/01-get-started.md), [US 15](user-stories/15-add-new-agent.md).
2. **Cross-agent sync** — one source of truth translated into every agent's native format (JSON / TOML / YAML / symlinks / markdown-with-transforms). [US 02–06](user-stories/README.md), [US 20](user-stories/20-agent-definitions.md).
3. **Declarative Agentfile** — human-editable YAML lists MCP servers, skills, sources, rules, commands, hooks. Commit to git, `agentbrew sync` applies. [US 16](user-stories/16-agentfile-project-config.md), [US 23](user-stories/23-cross-repo-discovery.md).
4. **Install from anywhere** — catalog, npm package, git URL, local folder. Everything deploys through the same path. [US 02](user-stories/02-install-skill.md), [US 03](user-stories/03-add-mcp-server.md), [US 07](user-stories/07-add-source.md).
5. **Curated catalog** — strong defaults so first-run produces a working setup without the user choosing anything. [US 24](user-stories/24-browse-catalog.md), [US 14](user-stories/14-recommended-changes.md).
6. **Drift detection + auto-repair** — background scheduler notices agent-update breakage, manual edits that broke config, and MCP runtime failures; restores or escalates the deployed shape. The moat. [US 06](user-stories/06-drift-detection.md).
7. **Never destroy user data** — manual edits survive sync; `--prune` only touches agentbrew-created entries; every sync is rollback-able. [US 10](user-stories/10-data-safety.md), [US 12](user-stories/12-prune-safely.md), [US 26](user-stories/26-rollback.md).
8. **Honest status** — `agentbrew status` tells the truth; exit 1 on drift for CI; numbers agree across every site that prints them. [US 25](user-stories/25-status-and-health.md), [US 18](user-stories/18-lint-validate.md).

All user stories live under [`docs/user-stories/`](user-stories/README.md) — every feature must trace to one.

## What We're Building — Status

Every capability is in one of four lifecycle states. Changes of state track in [`TASKS.md`](../TASKS.md).

### Shipped and staying

In the product today and in the essential core. Not deletion candidates.

| Capability | What it does |
|---|---|
| [Zero-friction setup](user-stories/01-get-started.md) | `agentbrew` auto-initializes on first run — detects agents, installs recommended, syncs, schedules drift repair |
| [Unified multi-surface sync](user-stories/06-drift-detection.md) | One CLI manages skills + MCP + rules + commands + agent definitions + hooks + instructions |
| [Broad agent support](user-stories/15-add-new-agent.md) | Skills to every supported agent; MCP to every MCP-capable agent incl. Copilot (see README agent matrix) |
| [Self-healing config](user-stories/06-drift-detection.md) | Drift checks + MCP deep probes, auto-repair every 30 min — the moat |
| [Curated catalog](user-stories/24-browse-catalog.md) | Generic `catalog.yaml` — pointer entries only |
| [Smart install](user-stories/03-add-mcp-server.md) | `agentbrew install npx @my/pkg` auto-detects MCP server type |
| [Bidirectional sync](user-stories/11-discover-import.md) | `sync --discover` detects user-added servers; `import` propagates them |
| [Agentfile manifest](user-stories/16-agentfile-project-config.md) | Declarative YAML; `init --from-state` bootstraps from current setup |
| [Project detection](user-stories/16-agentfile-project-config.md) | Bare `agentbrew` in a project dir surfaces detected agent assets |
| [Per-file rules](user-stories/04-share-rules.md) | `~/.config/agentbrew/rules/` → Cursor and Windsurf per-file rule dirs |
| [CI integration](user-stories/25-status-and-health.md) | `agentbrew status --ci` exits 1 on drift |
| [Portable bundles](user-stories/19-export-import.md) | `agentbrew export / import` moves setup to a new machine |
| [Rollback](user-stories/26-rollback.md) | `agentbrew sync --rollback` restores from the pre-sync snapshot |
| [Shell completions + git hooks](user-stories/21-completions-hooks.md) | `agentbrew completions install`; `agentbrew hook install` for post-checkout |
| [Team overlays](user-stories/27-team-overlay.md) | `agentbrew team set <url>` activates an overlay repo's `catalog-overlay.yaml` + sources + adapters |
| [Lock file (SHA tracking)](user-stories/22-lock-reproducible.md) | `agentbrew.lock` records HEAD SHAs; audit trail, not enforced pin |

### Shipped — being removed

Work today but scheduled for deletion. One P0 `delete-*` task per row. No deprecation window (one-user reality).

| Capability | Why it's going | Tracked by |
|---|---|---|
| ~~`agentbrew team` subcommand family~~ (removed 2026-04-24) | Agentfile + git-tracked symlink replaces the whole flow. Three competing team-sharing surfaces collapse to one. | Shipped |
| ~~`agentbrew mcp share`~~ (removed 2026-04-24) | Delegated to `ngrok` / `cloudflared` / `ssh -R`. CORS check blocked browser clients; zero README mentions; zero real-e2e tests. | Shipped |
| ~~`status --usage` + `clean --unused`~~ (removed 2026-04-24) | `atime`-based telemetry was wrong on every noatime/relatime filesystem; `mtime`-based MCP tracking showed "last sync write," not "last agent use." | Shipped |
| ~~`agentbrew browse`~~ (removed 2026-04-24) | Hidden TUI duplicated `agentbrew catalog`. Unchecking an installed item printed "run agentbrew remove <name> manually" — the toggle was a lie. | Shipped |
| ~~Legacy `.agentbrew.yaml` + `mcp project`~~ (removed 2026-04-24) | Per-project Agentfile covers this with strictly more. Two formats = two merge paths. | Shipped |
| ~~`agentbrew mcp profile`~~ (removed 2026-04-24) | Per-context server sets belong in per-project Agentfile; global filters are mcpm.sh's job. | Shipped |
| ~~`agentbrew log` + six `<namespace> sync` aliases~~ (removed 2026-04-24) | `tail ~/.local/share/agentbrew/logs/auto-sync.log` and `sync --only <name>` already do this. | Shipped |
| ~~Hidden aliases: `add`, `update`, `clean`, `doctor`, `check`, `rollback`~~ (removed 2026-04-24) | Every description said "use X instead." Commander's did-you-mean suggestion replaces them. | Shipped |

### Planned

**Delegations** — replace native code with subprocess calls.

| Delegation | Upstream | Net shrink | Tracked by |
|---|---|---|---|
| Skill installation | [`npx skills`](https://github.com/vercel-labs/skills) | ~1,000–1,500 LOC shipped | All execution slices shipped 2026-04-26 to 2026-04-28 (parent task closed PR #914; slices 2–7 + 8–12 absorption-siblings landed across PRs #790, #804–#810); residual hardware-bound sandbox / proxy / offline measurement closed 2026-05-02 |
| MCP sync (selective delegation, split-intersection) | [`mcpm.sh`](https://mcpm.sh) | ~3,489 LOC shipped | All slices shipped 2026-04-27 (mcpm PRs #326–329 + agentbrew slices 1, 2, 3a, 3b, 4a, 4b, 4c, 5a, 5b, 5c, 7 — see [deep-dive](competition/mcpm-sh-vs-agentbrew.md)) |
| Rules sync (selective delegation, wrapper-around-output) | [`block/ai-rules`](https://github.com/block/ai-rules) | ~300–350 LOC shipped | All execution slices shipped 2026-04-27 (parent task closed PR #916); slice 6b upstream PR filed at block/ai-rules#91; residual slice 6a publish in [`delegate-rules-to-ai-rules-slice-6a-followup`](../TASKS.md) — see [deep-dive](competition/block-ai-rules-vs-agentbrew.md) |
| Commands sync (selective delegation, wrapper-around-output) | [`block/ai-rules`](https://github.com/block/ai-rules) | shipped 2026-04-27 | All slices shipped (PRs #885, #889, #890, #891, #892); `CANARY_DELEGATED_AGENTS` delegate, native carve-outs per `src/core/commands-agent-map.ts` — see [deep-dive](competition/block-ai-rules-vs-agentbrew.md) |

**Absorptions — all closed.** All 5 absorb-from-skills-CLI tasks have been re-evaluated as part of slices 8-12 of the now-retired `delegate-skill-install-to-skills-cli` parent task (2026-04-27): the delegated path inherits each feature from skills CLI for free; the carve-out path has narrow gaps that all resolve to "use `npx skills add` directly" or "the gap is rare enough to defer." Already shipped: agent compatibility matrix (PR #689, 2026-04-24; refreshed 2026-05-02 for Kiro hooks + new skills-only catalog entries per `src/core/agents.yaml` + Devin delegation); `--copy` fallback (slice 8 — verdict: SUBSUMED, [Gap 1](competition/vercel-skills-cli-vs-agentbrew.md#gap-1-copy-fallback)); plugin manifest discovery (slice 9 — DEFER, [Gap 2](competition/vercel-skills-cli-vs-agentbrew.md#gap-2-plugin-manifest-discovery)); `--skill` / `--agent` granularity (slice 10 — DEFER, [Gap 3](competition/vercel-skills-cli-vs-agentbrew.md#gap-3-per-skill-and-per-agent-granularity)); rich source formats (slice 11 — SUBSUMED for delegation / DEFER for carve-out, [Gap 4](competition/vercel-skills-cli-vs-agentbrew.md#gap-4-rich-source-formats)); `INSTALL_INTERNAL_SKILLS` env var (slice 12 — SUBSUMED for delegation / DEFER for carve-out, [Gap 7](competition/vercel-skills-cli-vs-agentbrew.md#gap-7-install_internal_skills-environment-variable)). With every absorption gate cleared and slices 2–12 shipped, the parent task retired 2026-04-28 (mirroring `delegate-mcp-to-mcpm`'s PR #906 retirement); the residual hardware-bound sandbox / proxy / offline measurement closed 2026-05-02.

### Not building

Hard boundaries. Out of scope unless a specific [trigger in the dissolution analysis](competition/vercel-skills-cli-vs-agentbrew.md#triggers-that-would-flip-the-decision-to-dissolve-now) fires.

- **Content hosting** — catalog entries point at source repos; legacy `skill-plugins/dev/` is migration backlog
- **Another skills.sh** — use the existing directory
- **Another MCP registry** — use MCP Community Registry, Smithery, or mcpm.sh
- **IDE extension or desktop app** — stay CLI-first
- **Framework** — no plugin API, no SDK, no extensibility tax
- **Org logic in shared paths** — overlay content lives in overlay repos; mixing breaks the boundary
- **Features nobody uses** — see the `delete-*` rows above
- **Absorbed features from competitors** — contribute to them or point users at them directly
- **Backwards compatibility (pre-v1)** — one user today; removals are one commit
- **A mirror of the team skills registry** — skills live in one dedicated repo; agentbrew registers it, not mirrors it
- **Telemetry** — no client-side telemetry; leaderboards belong to skills.sh
- **Bi-directional sync** — agentbrew is one-way (Agentfile → agent configs)
- **A daemon separate from the OS scheduler** — auto-repair uses launchd / systemd / Windows Task Scheduler

## Coexistence with other tools

Users can safely run agentbrew alongside other agent-config managers. The coexistence contract is that each tool owns its own managed-section markers and never touches content inside another tool's markers.

- **[Caliber](https://github.com/caliber-ai-org/ai-setup)** — writes `<!-- caliber:managed:X -->` sections into `CLAUDE.md` and similar files. Agentbrew writes `<!-- agentbrew:start -->` / `<!-- agentbrew:end -->` sections. The two marker conventions are disjoint and section-scoped. Running both tools in the same repo is safe as long as neither overwrites the other's managed sections. Agentbrew MUST never modify content inside a `<!-- caliber:managed:* -->` block — `src/sync/marker-utils.ts` searches for agentbrew's literal start/end strings, so Caliber markers are invisible to it. Regression test: `src/sync/marker-utils.test.ts` covers the isolation.
- **[Bridle](https://github.com/neiii/bridle)** — does whole-harness profile switching for 7 harnesses (Claude Code, Amp, Copilot CLI, Crush, Droid, Goose, OpenCode). Agentbrew syncs skills / MCP / rules across every supported agent. If a user uses both, they should set Bridle's "active" profile to a shape agentbrew maintains; Bridle's profile switches then re-copy agentbrew's content into place. No conflict because the two tools target different surfaces — Bridle switches whole-harness profiles, agentbrew updates individual skill / MCP / rule entries.
- **Settings.json hooks** — both tools register hooks with namespaced command names (`agentbrew-*` vs `caliber-*` / `bridle-*`), so hooks from different tools don't collide in the same `settings.json`.

The inverse contract is true too: other tools MUST never modify content inside agentbrew's `<!-- agentbrew:start -->` / `<!-- agentbrew:end -->` markers. We document that expectation in every README instead of enforcing it (the ecosystem is too small to warrant lockfile-style enforcement).

## Decision framework

Every new feature or change answers these in order:

1. **Org-specific?** → Must live in an overlay repo.
2. **Breaks the generic path?** → Refactor until it doesn't.
3. **Existing tool does 80%+?** → Delegate; contribute the missing 20%; document in `docs/COMPETITION.md` if we must build.
4. **Simplest implementation?** → If not, simplify.
5. **Breaks an essential-core capability?** → If yes, keep; if no, it's a deletion candidate.
6. **Knob or default?** → Prefer default.
7. **New contributor understands in 5 minutes?** → If not, simplify.
8. **New command/flag?** → Every visible command solves a distinct user problem. Merge overlapping ones, hide advanced ones.

## Success metrics

- A new engineer on a team with an overlay goes from zero to fully configured in under 2 minutes
- `agentbrew team unset` leaves a fully functional generic tool
- Overlay never touches `src/catalog.yaml` or generic shared code
- No-op `agentbrew sync` prints ≤5 lines and runs in under 2 seconds; repeat runs converge
- `agentbrew sync` alone reaches a clean state — no "next steps" footer, no manual `sync --only <module>` chaining
- `status --fix` is honest — "Fixed N" matches what actually disappears on re-run
- Every error message tells the user what to do next
- Codebase shrinks over time as upstream tools improve
- New contributor adds a catalog entry in under 10 minutes

## team overlay

On an enterprise laptop, agentbrew detects org signals (`github.example.com` in `~/.config/gh/hosts.yml`, `ORG_*` env vars, corporate npm registry) and auto-registers a dedicated team skills repo. `agentbrew team unset` disables it; the generic tool works unchanged.

**The overlay is moving to content-in-one-repo, not code-hosting-N-pointers.** The target architecture:

- **One canonical team skills repo** — an overlay points at one whole-repo source (auto-regenerated registry, validated templates, hand-curated catalog). One repo, not a scattered pointer list in `catalog-overlay.yaml`.
- **Agentbrew's overlay role shrinks to ~100 LOC of detection + registration.** Detect signal → register one source repo → let skills CLI handle the install. Agentbrew stops maintaining per-skill pointers.
- **Non-agentbrew users install team skills directly.** `npx skills add your-org/team-skills --agent '*'` — same skills, no middleware.

**Moat.** The defensible position is declarative YAML state + multi-surface sync + drift detection + auto-repair + the team overlay. No single competitor combines that full stack today.

