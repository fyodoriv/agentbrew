# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- **Mirror tooling** — removed the mirror-push, parity, staleness, and
  branch-prune scripts and related skills. Private emails are now blocked at
  push time, never rewritten.

### Fixed

- **Drift repair leaves the memory daemon PATH alone** — the LaunchAgent PATH
  check no longer flags `com.agentbrew.mcp-memory` for missing Node, and
  `agentbrew fix` no longer rewrites it. The rewrite and the memory installer
  undid each other and restarted the daemon on every sync.
- **Truthful auto-repair status** — `agentbrew status` no longer says
  auto-repair is `active` because a scheduler file exists. It now checks the
  loaded job, its last exit code, its program path, and its last run time. It
  reports `not running`, `disabled`, `broken`, `stale`, `failing`,
  `not run yet`, or `unverified` when auto-repair is not working, with the fix
  command. `status --json` adds an `autoRepair` field.
- **Truthful auto-sync install** — `agentbrew auto-sync install` no longer
  says the LaunchAgent is loaded because `launchctl load` exited 0. It checks
  `launchctl print` and says when launchd has the job disabled.

### Added

- **Shared-memory hardening** — project-memory sync now skips unchanged stores,
  supports explicit `--force` recovery, records collision-resistant hashed
  source tags, writes atomic metadata evidence, and captures bounded
  non-content SessionEnd scheduling receipts. Full doctor reports project-sync
  drift as an advisory, and `memory transport-report` adds read-only
  loopback/session/Origin/auth/timeout/primary-agent evidence before a future
  transport security migration.
- **Strict attention-friendly language** — AgentBrew now deploys an always-active
  ASD-STE100-style writing rule for all agent-authored natural-language output,
  including user-facing text and code comments, through shared rules,
  instruction templates, and supported per-file rules. The rule requires
  answer-first, short, scan-friendly output for an ADHD audience without asking
  agents to add comments to clear code.
- **Product-doc / Jira reconciliation protocol** — `task-command-center` now requires every Google Doc + docs PR/Jira refresh to read all source comments and children, preserve cited immutable product contracts separately from dynamic engineering guidance, use Jira fields/comments for transient state, and verify every destination after writes. Includes pressure evals and contract coverage.
- **Focused Jira task scope** — task-command-center now avoids Jira UI metadata
  and PR state in descriptions, respects a requested single PR boundary, and
  treats end-to-end coverage as opt-in.
- **learn-project verification gate** — Phase 5c runs a pre-quiz grounding pass: re-answer each question from vault notes only, discard/regenerate ungrounded questions, verify note claims against cited staged spans (Chain-of-Verification / RAGAS-faithfulness). Eval scenario 9 + contract tests.
- **learn-project mastery threshold + interleave** — concepts flip 🟢 only after two corrects (incl. one applied/analysis), within-session retention re-test after spacing, and interleaved cross-section mode once basics are green. Eval scenario 10 + contract tests.
- **learn-project applied/transfer tasks** — locate-owner, where-to-add, trace-the-bug, blast-radius graded against staged repos after mastery threshold. Eval scenario 11 + contract tests.
- **learn-project source freshness** — `stage-learn-sources` v3 records per-source `contentHash`, skips unchanged inputs on re-run, and exposes `manifest.freshness.changed` / `unchanged` for stale-vault detection. Unit tests + SKILL.md Phase 1/4.
- **Mermaid maps** — concept map per section + architecture diagram for codebase/mixed runs, embedded in vault MOC. Eval scenario 12 + contract tests.
- **learn-project user guide** — [`docs/learn-project.md`](docs/learn-project.md): prerequisites, quick starts, pipeline, StudyVault layout, pedagogy, troubleshooting; `skill-plugins/dev/learn-project/README.md` points maintainers to SKILL + evals.
- **learn-project quiz-fix loop** — Phase 5c Verification Log artifact, practice-file audit loop, eval #20 + contract tests.
- **learn-project upstream PR drafts** — `docs/learn-project-tutor-upstream-pr-drafts/` ready-to-paste bodies for tutor-skills contribution (publish gated).

### Added

- **Practice-file quality** — audit tutor-setup practice files (~30% recall cap), short concept labels, live MOC Weak Areas, rendering-vs-delivery Exam Trap (eval #19); quiz-fix loop guidance (eval #20).

### Fixed

- **`sync --pull` records its result** — the engine re-sync now runs every
  engine even when one fails, writes the sync log, and sets a failing exit
  code on errors. `agentbrew status` shows the real "Last Sync" time after a
  pull instead of the previous plain `sync`.
- **Closed desktop apps are not MCP failures** — a refused connection to a
  loopback MCP URL (WebStorm, Figma desktop) now probes as
  `skipped_local_app_offline` with "nothing is listening on host:port", so
  `agentbrew status` stops reporting it as failing for weeks. Other fetch
  errors keep their socket code, for example `fetch failed (ECONNREFUSED)`.
- **Memory daemon no longer restarts from worktree or test shells** — the
  daemon LaunchAgent PATH now holds only the uvx directory and system
  directories. Before, it copied the caller's Node directory and
  `DOTFILES_DIR`, so running agentbrew from another shell rewrote the plist
  and restarted the daemon. Cursor then marked `memory` as failed and did not
  reconnect.
- **Chezmoi worktree LaunchAgent repair** — resolve Dotfiles from
  `DOTFILES_DIR` or its managed environment file before guessing a checkout,
  and accept Dotfiles' secure shim-first prefix so `agentbrew fix` does not
  rewrite a valid active worktree PATH.
- **Stale `insecure-defaults` catalog pointer** — removed the Trail of Bits
  entry because the upstream repository now exposes that plugin without an
  installable `SKILL.md`, which caused `sync --pull` to report it as missing.
- **npm executable entrypoint** — invoking the installed `agentbrew` symlink now resolves to the compiled CLI and executes normally instead of silently exiting before command parsing.
- **Shared memory cold-start and protocol reliability** — the managed LaunchAgent now enables behavioral bootstrap, re-enables the required daemon while respecting intentionally disabled maintenance, sync idempotently reconciles and waits for readiness, doctor verifies `get_bootstrap_profile`, and the pinned 11.7 MCP client uses the service's actual tag/store/update/delete schemas.
- **vision-task-refs** — `extractTasksMdIds` now parses TASKS.md sub-bullet `  - **ID**:` metadata lines; VISION.md no longer backtick-tags as faux task IDs.
- **vision-task-refs Pattern B** — skip `(tag …)` metadata parens after TASKS.md; only backtick-open ID lists count as task references.

### Changed

- **Semantic memory defaults** — the `memory` catalog entry now uses local `mcp-memory-service[sqlite]` hybrid retrieval, and sync reconciles exact mcpm definitions so same-name backend or transport changes cannot remain stale.
- **Windsurf MCP path** — native sync now targets Windsurf's active `~/.codeium/windsurf/mcp_config.json` file.
- **Shrink — delete upstream-duplicate dev skills** — Removed in-repo copies of generic engineering skills (`debug`, `tdd`, `plan`, `jira`, etc.) that already exist in Superpowers, Anthropic, and fyodoriv source repos. `skill-plugins/dev/` shrank accordingly; catalog entries repoint to upstream (`page-zero-errors` → `fyodoriv/page-zero-errors`). Contract tests for deleted skills removed; remaining agentbrew skills reference upstream replacements.
- **Skill source deduplication** — Moved remaining local workflow skills to `fyodoriv/dev-skills`, switched methodology entries to maintained upstream implementations, and folded `autoresearch` into `iterate`. AgentBrew now retains only agentbrew-owned built-ins and catalog pointers.

### Added
- Catalog entry for **Composio Connect MCP** (`agentbrew install composio`) — single HTTP endpoint at `connect.composio.dev/mcp` with consumer-key setup wizard; replaces per-vendor Notion and Atlassian MCP catalog entries (Gmail, Slack, Linear, HubSpot, Jira, etc. connect via Composio OAuth).
- Catalog sources and skill pointers for **Compound Engineering** (`EveryInc/compound-engineering-plugin`) and **gstack** (`garrytan/gstack` sprint-pipeline skills). Confirmed **obra/superpowers** remains the indexed process-discipline source. All three register via `agentbrew install <source>` and deploy selected skills on `sync` — pointers only, no content copied in-repo.
- Catalog entry for **Sourcegraph MCP** (`agentbrew install sourcegraph`) — HTTP transport to `/.api/mcp` with access-token setup wizard for instance URL + `SOURCEGRAPH_ACCESS_TOKEN`. Confirmed **Context7** remains the recommended stdio docs MCP (`agentbrew install context7`) for all agents.

### Changed
- **Instructions sync** collapses onto the agents.md standard: deploy once to `~/.config/agentbrew/AGENTS.md`, symlink every detected agent whose `rulesFile` is `AGENTS.md`, keep copy+merge only for proprietary instruction filenames (`CLAUDE.md`, `global_rules.md`, `guidelines.md`, `GEMINI.md`) and ChatGPT/Claude Desktop context paste files. Removed unused `extractSharedInstructions`. Net shrink in `instructions-content.ts` (~7 LOC); `instructions-sync.ts` +~120 LOC for canonical/symlink orchestration (replaces N per-agent full writes). (`prefer-reuse-over-reinvent`, `verify-vision-trace`, `competitor-spot-check`, `detect-task-backend`, `write-vision`) as permanent Bucket-1 built-ins in `skill-plugins/dev/README.md` and VISION.md's "Curator, not host" enumeration.
- Recommended catalog rule bodies for project-context loading, PR vision trace, and agent attribution are compact enough to keep post-`sync --pull` deployed instruction files under the 40k-character budget.
- `agentbrew sync` now treats tracked skill sources as indexes, not deployment
  sets: only names recorded in `state.sources[].skillsInstalled` are
  symlinked. Legacy/manual `skillSourceDirs` outside tracked source paths still
  deploy as explicit opt-in directories, and stale symlinks from previously
  over-deployed source skills are pruned on the next sync.

### Removed
- **BREAKING:** Per-vendor SaaS connector MCP catalog entries **`notion`** and **`atlassian`** — use `agentbrew install composio` + `agentbrew setup composio` for Notion, Jira, Linear, HubSpot, Gmail, and 1,000+ other apps through Composio Connect.

### Fixed
- **LaunchAgent auto-repair** invokes `node` + `dist/cli.js` explicitly in `ProgramArguments` instead of a npm-global `agentbrew` symlink with a `#!/usr/bin/env node` shebang — fixes `env: node: No such file or directory` exit 127 on fnm hosts where launchd could not resolve the shebang even with a correct PATH.
- Agentfile rules merge now strips subsection/paragraph blocks already present in
  `shared-rules.md` before writing the managed overlay block, preventing ~800–1k
  token duplicate Pull/fetch subsections on re-apply.
- Agentfile/state `memory` MCP entries using `uvx --from mcp-memory-service` migrate
  to the lightweight `npx @modelcontextprotocol/server-memory` server, fixing
  `init_timeout` probe failures when pymilvus/milvus-lite are not installed.
- `agentbrew commands list` now includes Agentfile-declared `commands:`
  source directories alongside `~/.config/agentbrew/commands`, matching the
  command sync pipeline instead of undercounting configured commands.
- Agentfile `rules:` application is now marker-managed and idempotent instead
  of appending stale copies after wording changes. `agentbrew lint`,
  `agentbrew status`, and `agentbrew status --fix` now detect and repair
  repeated `shared-rules.md` blocks; `agentbrew rules dedupe` exposes the same
  cleanup as an explicit command.
- The generated instruction template is compact again, keeping always-loaded
  agent files under the 40k-character budget while preserving the safety
  guardrails covered by regression tests.

### Removed
- **BREAKING:** Hidden `agentbrew skills status` subcommand removed (2026-05-03,
  `simplify-hidden-skills-status-command`). It printed the same per-agent +
  per-source skill counts already shown by the visible
  `agentbrew status --verbose` (which calls `printVerboseSkillsSection()` in
  `src/status.ts`). Tail of the `simplify-hidden-status-commands` family —
  follows the deletions of `instructions status` and `hooks list`
  (`delete-instructions-and-hooks`). The `skills` subcommand
  registration in `src/commands/cli-sync-subcommands.ts` shrank, the dedicated
  `skillsSyncStatus()` entry-point and its two private helpers
  (`printTargetSkillStatus`, `collectTargetEntries`) were deleted from
  `src/sync/skills-sync.ts`, and the four-test `describe("skillsSyncStatus")`
  block was removed from `src/sync/skills-sync.test.ts`. Code/doc references
  to the deleted command are caught by the `skills status` entry now in
  `src/docs/cli-removed-commands.test.ts`. Migration: anywhere you ran
  `agentbrew skills status`, run `agentbrew status --verbose` instead.
- **BREAKING:** Hidden `agentbrew instructions` and `agentbrew hooks`
  namespaces removed (2026-05-03, `delete-instructions-and-hooks`).
  Both shipped a single subcommand each (`instructions status`, `hooks list`)
  and both were thin wrappers over functions already exposed by
  `agentbrew status --verbose` — `printVerboseInstructionsSection()` for the
  per-agent freshness signal, and the verbose status output plus the
  Agentfile `hooks:` block for the hook inventory + deployment. Per the focus
  instruction "delete hidden CLI surface that has no distinct user problem"
  the dedicated helpers (`instructionsSyncStatus()` in
  `src/sync/instructions-sync.ts` and `listHooks()` in
  `src/sync/hooks-sync.ts`), their direct test coverage, and the
  registrations + mocks in `cli-sync-subcommands.{ts,test.ts}` were all
  deleted in one commit. Users who want the deployment-status snapshot run
  `agentbrew status --verbose`. Future stale references in code,
  skill-plugins, docs, real-e2e, and templates are caught by the
  `instructions status` and `hooks list` entries now in
  `src/docs/cli-removed-commands.test.ts` `REMOVED_COMMANDS`.
- **BREAKING:** Hidden `agentbrew skills init <name>` subcommand removed
  (2026-05-03, `delete-skills-init`). The upstream `npx skills init
  [name]` (vercel-labs/skills) scaffolds the same SKILL.md + frontmatter
  shape, so per VISION.md "Delegate to upstream when 80%+ of need is covered"
  the local copy is gone. Net codebase shrink: ~240 LOC across the
  92-line `src/skills/init-skill.ts`, the 139-line `init-skill.test.ts`, plus
  the registration + tests in `cli-sync-subcommands.{ts,test.ts}`. Future
  stale references are caught by the `skills init` entry now in
  `src/docs/cli-removed-commands.test.ts` `REMOVED_COMMANDS`. Users who
  scaffold new skills run `npx skills init my-skill` instead.
- **BREAKING:** Hidden `agentbrew mcp sync` subcommand removed (2026-05-03
  hidden-CLI audit, parent task `simplify-cli-surface-audit-hidden-commands`).
  It was a bare-bones wrapper over `syncMcpServers()` with zero documentation
  references and zero `--dry-run` / `--verbose` / `--no-prune` flag support.
  Users who want to sync only MCP servers run `agentbrew sync --only mcp`,
  which calls the same orchestrator through the full sync pipeline. The
  cross-client batch **orchestrator** (`syncMcpServers` in
  `src/sync/mcp-sync.ts`) stays — that's still agentbrew's value-add. Only
  the duplicate CLI surface was deleted. The audit reviewed the other 11
  remaining hidden commands (`completions`, `classify`, `rules`, `commands`,
  `agents`, `instructions`, `skills`, `hooks`, `fix`, `mcp` namespace,
  `hook`, `auto-sync`) and concluded each solves a distinct user problem
  documented in user-stories or skill-plugins, or is a programmatic API
  for downstream tools (`classify`) / schedulers (`fix`); they stay in the
  Advanced help group.
- **BREAKING:** Legacy `.agentbrew.yaml` per-project format and `agentbrew mcp
  project` subcommand family (`init`, `sync`, `status`) removed. Per-project
  MCP servers now flow through the standard `Agentfile.yaml` `mcp:` block at
  the repo root — same target paths (`.cursor/mcp.json`, `.mcp.json`,
  `.windsurf/mcp.json`) via `applyAgentfile()`, one declarative format.
  Existing `.agentbrew.yaml` files in cwd print a one-time deprecation hint
  and are otherwise ignored. Migration: rename to `Agentfile.yaml` (or merge
  the `mcpServers:` block into your existing Agentfile's `mcp:` block) — same
  fields, no schema work.
- **BREAKING:** `agentbrew team` command family
  (`team init|set|unset|show|sync|check`) removed, along with
  `agentbrew rules list|import|export` (which only made sense
  alongside it), `state.teamConfig`, the team layer in
  `rules-sync` / `mcp-sync`, the legacy `.agentbrew-team.yaml`
  format, and the `docs/rfc-team-config-v2.md` RFC. Teams now share
  configuration via the dotfiles + git pattern documented in the
  README — clone the team's Agentfile-bearing repo, symlink its
  `Agentfile.yaml` to `~/.config/agentbrew/Agentfile.yaml`, run
  `agentbrew sync`. Updates flow through `git pull && agentbrew sync`,
  drift verification through `agentbrew status --ci`. Existing users
  with `state.teamConfig` set see a one-time migration hint on the
  next `init`/`sync` and the field is dropped on the next state save
  (no data loss — MCP servers, sources, and rules previously applied
  by `team sync` are already persisted in the rest of the state).
- **BREAKING:** `agentbrew mcp profile create/list/activate/deactivate/delete`
  removed. Per-context server sets belong in a per-project `Agentfile.yaml`
  `mcp:` block, which already scopes servers to the current directory.
  Global filtering that outlives a repo-scoped Agentfile should run through
  `mcpm.sh` (the canonical Python MCP manager) — see VISION.md
  "Delegate, contribute, absorb". Existing state.yaml files with
  `mcpProfiles` or `activeProfile` set load cleanly and drop those fields
  on next save.
- **BREAKING:** `agentbrew log` and six hidden `<namespace> sync` aliases
  removed:
  - `agentbrew log` — run `tail -n 20 ~/.local/share/agentbrew/logs/auto-sync.log`
    instead.
  - `agentbrew rules sync`, `agentbrew commands sync`, `agentbrew agents sync`,
    `agentbrew instructions sync`, `agentbrew skills sync`,
    `agentbrew hooks sync` — all one-line wrappers over the same function
    `agentbrew sync --only <name>` already calls. The top-level spelling
    also supports `--dry-run`.

  The non-sync subcommands under each namespace (`rules init`, `commands list`,
  `agents init`, `agents add-source`, `instructions status`, `skills status`,
  `skills init`, `hooks list`, etc.) stay — they serve unique purposes and
  have no top-level equivalent.

  The `agentbrew sync --only` help string was also corrected to enumerate
  the module names actually produced by `buildSyncModules()`: `mcp`,
  `project-mcp`, `rules`, `commands`, `agents`, `skills`, `hooks`,
  `instructions`.
- **BREAKING:** `agentbrew status --usage` and `agentbrew clean --unused` removed,
  along with the `src/usage.ts` module that powered them. The analytics were
  unreliable by construction:
  - **Skills (`atime`-based):** `collectSkillUsage` read each SKILL.md's `atimeMs`
    and marked the skill "never used" when `atime <= birthtime`. On macOS SSDs
    (and any other filesystem mounted with `noatime` or `relatime`, which is the
    default on most modern systems), `atime` never gets updated — so every skill
    always appeared "never used."
  - **MCP (`mtime`-based):** `collectMcpUsage` used the agent config file's
    `mtime`, but `agentbrew sync` rewrites that file on every run. "Last used"
    literally meant "last time agentbrew wrote the file," not "last agent use."
  - **`clean --unused`** then offered to delete items >30 days old by default —
    a data-integrity footgun on top of wrong data.

  A user who wants to trim unused skills + MCP servers runs `agentbrew status`
  and decides what they don't want, then `agentbrew remove <name>` for each.
  Rebuilding accurate "last used" telemetry would require agents to call back
  into agentbrew on every skill/server invocation — no agent does that today.
- **BREAKING:** Six hidden deprecated aliases removed. All had descriptions that
  literally said "use X instead". Commander's "did you mean" suggestion now
  surfaces the canonical command on unknown-command errors.

  | Removed | Replacement |
  |---|---|
  | `agentbrew add <source>` | `agentbrew install <source>` |
  | `agentbrew update` | `agentbrew sync --pull` |
  | `agentbrew doctor` | `agentbrew status --fix` |
  | `agentbrew check` | `agentbrew status --fix` (or `--ci` for CI) |
  | `agentbrew clean <name>` | `agentbrew remove <name>` |
  | `agentbrew rollback` | `agentbrew sync --rollback` |

  If you had a CI workflow running `agentbrew check --ci`, update it to
  `agentbrew status --ci`. All other replacements are drop-in.
- `agentbrew browse` removed (hidden command, not a breaking change).
  The TUI was a partial duplicate of `agentbrew catalog` — both loaded
  the same catalog — but its "toggle" metaphor was broken: unchecking
  an installed item just printed "run `agentbrew remove <name>` manually"
  instead of actually removing anything. Users who want an interactive
  browser now run `agentbrew catalog` (which supports `--search`, `--json`,
  `--markdown`), then `agentbrew install <name>` / `agentbrew remove <name>`
  for the actual install/remove. If demand for a two-way toggle UI returns
  later, it will live under `catalog` — no second command.
- **BREAKING:** `agentbrew mcp share` removed. The SSE bridge + `localtunnel`
  tunnel shipped but was unusable to browser-based MCP clients due to a
  hardcoded CORS origin check (every non-localhost `Origin` header got a
  403 response), had no README documentation, and no real-e2e coverage.
  To expose a local MCP server, run `mcpm run <name>` (the `agentbrew mcp
  run` wrapper itself was later deleted in slice 5b on 2026-04-27) and then
  tunnel the port with `ngrok http <port>`, `cloudflared tunnel --url
  http://localhost:<port>`, `serveo`, or `ssh -R` — all of these ship
  better auth and dashboards than `localtunnel`. See docs/VISION.md
  "What We're NOT Building"; cleanup landed in PR #692.
- **BREAKING:** Six imperative MCP subcommands and the top-level
  `agentbrew run` deleted in slices 5a-5c of `delegate-mcp-to-mcpm`
  (2026-04-27, total **−2,632 LOC** net):
  - `agentbrew mcp install <name>` (use `agentbrew install <name>` for the
    catalog-curated path or `mcpm install <name>` for raw registry resolution).
  - `agentbrew mcp search <query>` (use `mcpm search <query>` directly).
  - `agentbrew mcp info <name>` (use `mcpm info <name>` directly).
  - `agentbrew mcp run <name>` (use `mcpm run <name>` directly).
  - `agentbrew mcp health <name>` (use `mcpm doctor` for global probing or
    `mcpm inspect <name>` for per-server debugging).
  - `agentbrew mcp list` (use `mcpm ls` for richer per-client status).
  - `agentbrew mcp remove <name>` (use `agentbrew remove <name>` top-level —
    auto-detects type, removes from agentbrew state, AND bridges to mcpm
    for the MCPM intersection clients per PR #858).
  - `agentbrew run <name>` (top-level wrapper deleted alongside `mcp run`
    in PR #851 — slice 5b).
  See `docs/competition/mcpm-sh-vs-agentbrew.md` § "Command surface
  dissolution map" for the per-row Status column with PR refs.
- Internal docs, skill plugins, and references (open-source readiness)

### Added
- Catalog → mcpm bridge for the MCPM intersection clients (cursor, claude-code,
  codex, claude-desktop, cline, windsurf, gemini-cli, goose, roo-code).
  `agentbrew install <name>` from the catalog now runs `mcpm install` +
  `mcpm client edit --add-server` per intersection client, so users see
  the server in their actual config files (not just agentbrew state).
  Carve-out-only setups (devin/overlay-desktop/copilot/opencode/kiro/amp)
  short-circuit and stay on the native sync path. PR #857.
- Remove → mcpm bridge for the same MCPM intersection clients.
  `agentbrew remove <name>` now runs `mcpm client edit --remove-server`
  per intersection client + `mcpm uninstall <name> --force` for global
  cleanup, so removing an MCP server cleans every client's config — not
  just agentbrew state. The native `pruneServerFromAgents` path still
  handles carve-outs. PR #858.
- Sync → mcpm bridge for state-driven additions in the same MCPM intersection
  client set. `agentbrew sync` now bridges every server in
  `state.mcpServers` to mcpm via `mcpm install` + `mcpm client edit`
  whenever the intersection clients (cursor, claude-code, codex, etc.)
  are detected. Closes the regression where a hand-edit to
  `state.yaml` or an `Agentfile.yaml mcp:` import landed in agentbrew
  state but never reached the actual client config files. The bridge
  honors latency by reading `~/.config/mcpm/servers.json` once per
  sync — every server already known to mcpm short-circuits, so a
  steady-state `agentbrew sync` pays zero subprocess tax. Failures are
  non-fatal and the carve-out native sync path runs independently.
  Closes slice 2 of `bridge-mcp-sync-to-mcpm-for-intersection`.
- `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1)
- `SECURITY.md` (vulnerability reporting policy)
- "The problem" section in README explaining the use case
- `isGitHubEnterprise()` helper for generic GHE detection

### Fixed
- Sync-runner tests making real network calls (14 failures → 0)
- Unused `vi` import lint warning in env-vars test

### Changed
- GHE detection generalized from hardcoded `github.example.com` to any enterprise host
- Package.json repository URL updated to `github.com/fyodoriv/agentbrew`

## [0.2.1] - 2026-04-05

### Added
- GITHUB_TOKEN resolution via `gh auth token` fallback for literal-format agents
- Experimental marker for skills-only agent definitions
- Shell hook for project detection (`agentbrew hook install --shell`)
- Agentfile support — declarative manifest (`Agentfile.yaml`) for agent config
- `agentbrew install --git` for MCP servers from git repos
- `agentbrew sync --pull` to fetch latest from sources before deploying
- `agentbrew sync --rollback` to restore from pre-sync snapshot
- `agentbrew lint` for config validation (exit 1 on errors)
- `agentbrew export/import` for portable config bundles
- `agentbrew team set/sync/check` for shared team baselines
- Expanded curated catalog (skills, MCP servers, and rule sets — see `src/catalog.yaml`)
- Support for every agent in the README agent matrix including Copilot, Kiro, Amp, Overlay Desktop
- Background drift detection and auto-repair every 30 minutes
- Lock file with SHA pinning for skill sources

[Unreleased]: https://github.com/fyodoriv/agentbrew/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/fyodoriv/agentbrew/releases/tag/v0.2.1
