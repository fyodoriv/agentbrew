# Tasks

<!-- policy: Run tests before every commit. Never skip CI checks.
             `npm run verify` must pass before every commit (AGENTS.md rule #1).
     policy: Maintain 95%+ coverage on statements, functions, and lines. Branch coverage target is 95%.
     policy: Prefer fixing root causes over symptoms — add regression tests for every bug fix.
     policy: Tickets are prompts — write outcome-shaped tasks, not implementation-shaped issues.
             Describe the product outcome in 2 lines. Let the agent figure out subtasks.
             Break into smaller initiatives, not smaller issues. Include context that matters.
             (https://dheer.co/tickets-are-prompts/)
     policy: Branches MUST match the naming pattern enforced by the
             global pre-commit hook (`~/apps/dotfiles/git-hooks/pre-commit`):
             `type/TICKET-description` OR `type/description` where `type` is one
             of `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`,
             `hotfix`, or `release/*`. Example: `chore/delete-team-command`.
             `main`, `master`, `develop` are always allowed; anything else is
             rejected at commit time. Agents creating branches from this queue
             MUST pick a branch name matching that pattern before the first
             commit lands. A ticket suffix is optional (AGENTS.md rule #12).
     policy: Commit message format (enforced by `~/apps/dotfiles/git-hooks/commit-msg`):
             `type: description` with the first line ≤72 characters. Add a
             ticket suffix only when a real ticket exists.
     policy: PUBLISHING REQUIRES EXPLICIT PER-ACTION APPROVAL (no exceptions).
             Any step that would publish, send, or broadcast to a destination OUTSIDE
             `fyodoriv/agentbrew` is blocked until the user explicitly
             approves THAT SPECIFIC publish action IN THE CURRENT SESSION. Covered:
             * `npm publish`, `gh release create`, any public-registry upload
             * Creating, commenting on, or reviewing a PR or issue at any external
               repo — public (vercel-labs/skills, mcpm.sh, block/ai-rules, caliber,
               bridle, warden, react-doctor, etc.) or private (any repo
               owned by another org or team)
             * Posting a Slack / Teams message, sending an email, triggering a
               notification workflow
             * Creating, commenting on, or transitioning a Jira ticket
             * Pushing to any public GitHub remote (github.com/*) other than
               `fyodoriv/agentbrew` itself
             * Registering agentbrew on `skills.sh` or any public catalog / directory
             Research, reading, monitoring, local testing, and drafting PR bodies or
             comment text are NOT publishing and may proceed without prior approval.
             The final submit / send / publish / push step is. Approval to CLAIM a
             task (e.g. "pick up contribute-engage-pr-630-skills-status") is NOT
             approval to PUBLISH the PR; the publish step needs fresh approval at
             the moment of publishing. Approvals do not carry across sessions.
             Agents MUST pause and ask "I'm about to <specific publish action> on
             <specific target> — okay to proceed?" immediately before the action
             runs. If the answer is ambiguous, default to BLOCKED. This policy
             applies INDEPENDENTLY of P0-P3 priority. Global context: the External
             Communication Ban in the global agent instructions (and agentbrew's
             AGENTS.md) covers the same ground; this TASKS.md policy exists as
             defense in depth at the queue level where agents pick up work. -->

<!-- Strategic direction: Delegate → Contribute → Absorb (only the rejected residue).
     See docs/VISION.md § "Delegate, contribute, absorb — in that order" for the full rules.
     1. Delegate immediately to upstream when they cover 80%+ of our need — skills CLI for skills,
        mcpm.sh for MCP, block/ai-rules for rules. With one user today (see VISION.md § "Today's
        user base"), friction measurement collapses to ~1 hour of dev-machine testing, not 1 day
        of production-parity checks. Rip native code; if it works locally, ship; if not, revert
        the same commit. No "just in case" fallbacks, no deprecated flags.
     2. Contribute the missing 20% upstream with a 90-day engagement window. Silence = rejection.
     3. Absorb only what upstream explicitly rejects or ignores for 90 days.
     Breaking changes are free today — no deprecation windows, no migration paths, no backwards
     compat. When a command / flag / subsystem is removed, it's gone in the same commit. This
     suspension ends the day the user base grows past one. Until then, every CHANGELOG entry
     notes breaking changes but doesn't defer them.
     Permanent agentbrew scope (no upstream home): commands / hooks / instructions sync,
     multi-surface drift detection, auto-repair scheduler, multi-surface Agentfile, and the
     ~100 LOC of team-overlay detect-and-register-one-source-repo glue.
     Team skills live in ONE dedicated repo per overlay;
     agentbrew detects + registers, does not host per-skill pointers in catalog-overlay.yaml.
     Before ANY new-feature PR, answer: "Why is this in agentbrew instead of upstream?" Valid
     answers: (a) dev-machine test proved upstream is blocked, (b) upstream rejected or ignored
     90+ days, (c) team-overlay detection / registration glue, (d) multi-surface glue. Everything else
     must be contributed, not built here.
     Codebase: ~23K non-test source lines; target ~3–5K as the minimum-viable orchestrator
     (docs/competition/vercel-skills-cli-vs-agentbrew.md § "Minimum viable agentbrew"). -->

<!-- Priority semantics — what each level MEANS, not just a queue of tickets.
     P0 — Strategic alignment with upstream. Every P0 task (a) deletes a feature,
          (b) delegates a subsystem to an upstream tool (skills CLI, mcpm.sh,
          block/ai-rules, a team skills repo), or (c) absorbs a feature from
          upstream that closes a known gap (e.g. `--copy` fallback, plugin
          manifest discovery, per-skill / per-agent granularity). Absorption
          tasks add code, but they close strategic gaps called out in
          docs/competition/vercel-skills-cli-vs-agentbrew.md § "What skills
          CLI has that agentbrew doesn't" — so they earn the priority slot.
          (d) raises the correctness, safety, or pedagogy of a Bucket-1
          agentbrew-hosted builtin skill (one with NO upstream home, e.g.
          learn-project) to a documented domain best practice, closing a
          named quality gap. Category (d) is the ONE P0 slot that adds a
          net-new feature to agentbrew's own surface, and it is bounded:
          enhancements to a skill that HAS an upstream home (e.g. tutor-setup /
          tutor in bevibing/tutor-skills) are contributed upstream, not built
          here (VISION "Delegate, contribute, absorb"), and only the
          orchestration / staging / selection glue stays agentbrew's per the
          permanent-scope list. Amended 2026-07-08 (learn-project pedagogy
          gap review).
          Absorption tasks blocked by an active delegation task are marked
          with `**Blocked by**:` so they become no-ops if the delegation lands
          first. End state: a thinner agentbrew sitting on top of upstream
          tools, with every upstream-parity feature either delegated or
          absorbed (never both).
     P1 — Correctness and clarity. Bug fixes, simplifications already paid for
          by the P0 deletions, aligning the code to the user stories,
          refreshing competition research when an external tool's trajectory
          could flip a P0 verdict, and documentation/clarity work where drift
          between code and docs costs the user. **All competitor deep-dives
          are P1 regardless of star count or immediate strategic relevance.**
          Even a 0-star competitor can reveal an absorbable idea, a
          dissolution trigger, or a reason to update the fatal-gap list.
          Parking them in P3 (intentionally blocked) was wrong — they are
          actionable research that feeds VISION.md's delegate-contribute-
          absorb strategy, and they belong in the active queue.
     P2 — Life improvements. Ergonomic polish, personal tooling decisions, and
          recurring strategic reviews that don't block any user outcome but
          pay off over quarters.
     P3 — Intentionally blocked. Do NOT claim or start a P3 task without
          explicit user permission, even if P0–P2 are empty. /next-task and
          the audit cascade MUST surface "all higher priorities empty — P3 is
          blocked" and stop. P3 holds (a) upstream contributions where we're
          waiting on maintainers (the 90-day window runs in the background,
          not as work queued here) and (b) speculative future features
          superseded by the delegate-first strategy. See the section policy
          comment under `## P3` for the strict pickup rule. -->

<!-- Recurring tasks live in `RECURRING.md` (sibling of this file), not here.
     Anything with a `**Cadence**:` field belongs there. The next-task
     workflow consults both files but skips a recurring task unless its
     cadence window has opened (`now() >= last-fired + cadence` or
     `now() >= next`). The validator in
     `src/docs/tasks-md-output-cadence.test.ts` enforces (a) no Cadence
     field appears in this file and (b) every Output value here is in the
     allowed set (`code`, `docs`, `mixed`, `audit-report`, `measurement`).
     The Output field is the schema autonomous runs filter on — a marathon
     limited to `--code-and-infra-only` skips pure-`docs` and `audit-report`
     tasks before claiming. -->

## P0

<!-- Added 2026-07-06 from the agentic-tooling landscape review (canvas:
     canvases/agentic-tooling-vs-agentbrew.canvas.tsx). Four moves that push
     agentbrew further into pure orchestration: two delegations that shrink the
     connector catalog, two content registrations that pull best-in-class MCP /
     skills in through the curator model (zero source LOC). Recurring "scan the
     landscape" + "watch Cursor Marketplace / Runlayer" folded into the existing
     RECURRING.md watch-lists (re-research-stale-competitors, quarterly-
     dissolution-reeval) instead of a duplicate task. -->

<!-- Phase 1 (hooks-phase-1-cat-a-deterministic) COMPLETE 2026-06 — all 26 Cat A
     hooks shipped with scripts + manifest entries + per-hook fixture tests, and
     the production decision log (scripts/hook-observation.sh) confirms every one
     fired its enforcing verdict ≥1 time over a >7-day window. Removed per the
     tasks.md "completed tasks are deleted" rule; history is in git + PR. The
     observation gate that proved acceptance now lives in scripts/hook-observation.sh
     and is the precondition check Phase 3 re-runs before decommissioning rules. -->

## P1

- [ ] Agents wait on events, not polling loops
  - **ID**: nudge-polling-loops-to-blocking-waits
  - **Tags**: hooks, perf, agents
  - **Details**: The 2026-10-18 `/tooling-checkup` time review found `until <arg>` polling loops as the top recurring step across all projects: 5.8 h in 7 days, 52 calls, p95 10m00s, 49m41s/day. The opt-in hook `poll-loop-hint` now ships (see `docs/agent-perf.md` "Poll-loop hint"). What is left: turn it on for the owner's Mac in the dotfiles hooks overlay, then measure after 7 days.
  - **Files**: `docs/agent-perf.md`, `hooks/checks/poll-loop-hint.sh`
  - **Output**: code
  - **Acceptance**: the hook is on for this Mac through the dotfiles hooks overlay, and the 7-day time review is recorded here.
  - **Hypothesis**: a hint at call time moves agents to event waits; `until <arg>` cost drops from 49m41s/day to under 10 min/day.
  - **Measurement**: `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (the `until <arg>` overall line), 7 days after the hook is on.
  - **Success**: under 10 min/day, with no rise in `until` calls that time out.
  - **Pivot**: still over 30 min/day after 7 days -> make the hook block loops with `sleep` under 30 s, or drop the hint and file a skill change instead.
  - **Anchor**: tooling-checkup agent time review 2026-10-18; Forsgren, Humble, Kim 2018 (lead time); perf-review skill known fixes.
  - **Blocked**: needs-time — 2026-10-18: the hook is on for the owner's Mac (dotfiles #160 owner overlay, `agentbrew sync` done; it fired live on a test loop). Measure on or after 2026-10-25 with `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (the `until <arg>` overall line), then close or pivot.

## P2

- [ ] The installer says which Node version it found and how to upgrade it
  - **ID**: install-node-version-message
  - **Tags**: install, new-users, ux
  - **Details**: With Node 18 installed (Volta), `scripts/install.sh plan` printed "Node.js 20 or newer is missing", so the person looks for a missing install instead of an old one. Print the found version and the fix for the version manager in use (`volta install node@22`, `fnm install 22`, `nvm install 22`, or `brew install node`).
  - **Files**: `scripts/install.sh`, `INSTALL.md`
  - **Output**: code
  - **Acceptance**: with Node 18 on PATH, `install.sh plan` prints "Node.js 18 found; 20.11+ needed" and one upgrade command that matches the detected manager.
  - **Hypothesis**: first-run installs that stop at the Node check and need a second attempt drop to zero in the install e2e.
  - **Measurement**: `npm run test:install-e2e` with a Node 18 fixture.
  - **Success**: the message names the found version and a working command.
  - **Pivot**: if detection is fragile, print the version and the nodejs.org link only.
  - **Anchor**: first install on a Mac new to the tools, 2026-10-18 (agentbrew recommended set + dotfiles core).

- [ ] Tests never read or write the real `~/.config/agentbrew`, `~/.claude`, or the repo tree
  - **ID**: tests-isolated-home
  - **Tags**: tests, safety
  - **Details**: After an install on the same Mac, the real `manifest.json` held test fixture names (`new-server`, `existing`), `vitest run` left untracked `context/chatgpt.md` and `context/claude-desktop.md` in the repo, and several tests fail only on a Mac that already has agentbrew (integration commands lifecycle and clean-slate sync, sanitize-history, storybook smoke, install-other not-found, mcp probe env). Give every test a temp `HOME` and output dir by default (vitest setup file), and fail a test that touches the real paths.
  - **Files**: `vitest.config.ts`, a vitest setup file, the tests above
  - **Output**: code
  - **Acceptance**: running `npm run test:all` twice on a Mac with agentbrew installed leaves `~/.config/agentbrew`, `~/.claude*` and `git status` unchanged, and all tests pass.
  - **Hypothesis**: tests that depend on the developer's own machine go to zero.
  - **Measurement**: checksum of the real config dirs before/after `npm run test:all`; `git status --porcelain`.
  - **Success**: no change and no failures.
  - **Pivot**: if a global setup file breaks real-e2e, scope it to unit tests.
  - **Anchor**: first install on a Mac new to the tools, 2026-10-18 (agentbrew recommended set + dotfiles core).

- [ ] The install plan lists every behaviour change the recommended set makes
  - **ID**: install-plan-discloses-behaviour
  - **Tags**: install, new-users, safety, ux
  - **Details**: The recommended set changes how Claude Code behaves beyond adding skills: 21 hooks, a goal contract that blocks edits after `/goal` until it is written (`goal-contract-before-edit`), a retro before stop, ~6 KB of always-loaded CLAUDE.md text, and (unless `claudePermissions: keep`) prompts off. `install.sh plan` shows none of these, and `install.sh run` has no flag for `claudePermissions: keep`. List them in `plan`, add `--keep-claude-permissions` (seeds state.yaml before init), and ask it as INSTALL.md question 4.
  - **Files**: `scripts/install.sh`, `INSTALL.md`, `src/init.ts`
  - **Output**: code
  - **Acceptance**: `install.sh plan` prints the hook count, the `/goal` behaviour, the CLAUDE.md size and the permission default; `install.sh run --yes --keep-claude-permissions` leaves `permissions.defaultMode` unset.
  - **Hypothesis**: people surprised by changed Claude behaviour after install go to zero.
  - **Measurement**: install e2e asserts on plan text and settings.json.
  - **Success**: both assertions pass.
  - **Pivot**: if the list gets long, link to one generated doc instead.
  - **Anchor**: first install on a Mac new to the tools, 2026-10-18 (agentbrew recommended set + dotfiles core).

- [ ] Merging hooks into settings.json keeps existing commands byte-for-byte
  - **ID**: hooks-merge-preserves-text
  - **Tags**: hooks, sync
  - **Details**: When sync rewrites `~/.claude/settings.json`, the person's own hook commands come back re-escaped (a literal newline in a printf string became `\n`). It still works, but backups and diffs show changes the person did not make.
  - **Files**: `src/sync/hooks-sync.ts`
  - **Output**: code
  - **Acceptance**: a settings.json with a user hook containing a newline is unchanged byte-for-byte after `agentbrew sync` (apart from managed keys).
  - **Hypothesis**: unexplained diffs in user hooks after sync go to zero.
  - **Measurement**: unit test round-trip.
  - **Success**: the round-trip test passes.
  - **Pivot**: if JSON re-serialisation can't keep it, document it and keep the semantic check.
  - **Anchor**: first install on a Mac new to the tools, 2026-10-18 (agentbrew recommended set + dotfiles core).

- [ ] Make the official MCP Registry the default catalog lookup when it reaches 1.0
  - **ID**: flip-catalog-to-registry-first-at-ga
  - **Tags**: delegate, mcp, catalog, upstream
  - **Blocked**: needs-external-action — registry API still v0 (checked 2026-10-15: `/v0/servers` and `/v0.1/servers` return 200, `/v1/servers` returns 404; server build 1.8.1 still serves only the v0 API).
  - **Details**: `AGENTBREW_MCP_REGISTRY=1` turns on the read-only registry resolver (`src/adapters/mcp-registry.ts`). It stays opt-in because the registry API is still `v0`. When `registry.modelcontextprotocol.io` ships a stable 1.0/GA API, turn the lookup on by default (keep the local catalog override and the offline fallback), and move hand-curated public MCP pointers out of `src/catalog.yaml` where the registry has them.
  - **Files**: src/adapters/mcp-registry.ts, src/catalog/install.ts, src/catalog.yaml, README.md, docs/competition/official-mcp-registry-vs-agentbrew.md
  - **Acceptance**: with no env var set, `agentbrew install <registry-only server>` resolves from the registry; catalog entries still win; offline still falls back with one warning.
  - **Hypothesis**: a stable registry lets agentbrew stop curating public MCP pointers by hand, so hand-maintained `mcp_servers` entries in `src/catalog.yaml` drop for every server the registry covers.
  - **Success**: the lookup is on by default and the public catalog MCP entries that the registry covers are removed from `src/catalog.yaml`.
  - **Pivot**: if the registry stays `v0` or its data misses install metadata the catalog needs, keep the flag opt-in and close this task with the reason.
  - **Measurement**: the registry API version at `https://registry.modelcontextprotocol.io/`, and `yq '.mcp_servers | length' src/catalog.yaml` before and after.
  - **Anchor**: docs/competition/official-mcp-registry-vs-agentbrew.md; VISION G1 (curate, not host).

<!-- Nested catalog skill install shipped 2026-06-11 (fix/nested-skill-cache-lookup:
     copySkillFromCache/findSkillDirInCache deep-scan resolves anthropics/trailofbits/ext-apps plugin layouts.
     Closes sync --pull "not found in source" for build-mcp-server, semgrep, create-mcp-app, etc. -->

- [ ] Restore agentbrew release automation and npm authentication
  - **ID**: restore-agentbrew-release-automation
  - **Tags**: release, github-actions, npm, human-blocked
  - **Hypothesis**: one owner-run publish brings npm `latest`, the git tag, and `package.json` to the same version (version drift goes to 0).
  - **Measurement**: `npm view agentbrew version`, `node -p "require('./package.json').version"`, and `git describe --tags --abbrev=0`.
  - **Pivot**: if the publish fails on auth again, write a reviewed manual release path and close the automation part.
  - **Anchor**: `docs/human-blocked-actions/agentbrew-release-auth-2026-07-20.md`.
  - **Details**: The Auto-release workflow did not run after the merged delivery. `github.com/fyodoriv/agentbrew` is now the only canonical home, and GitHub Actions is disabled there. The documented manual fallback was blocked by `npm whoami` returning `ENEEDAUTH`. The workflow already has a `workflow_dispatch` fallback. Release stays blocked until Actions is enabled on `fyodoriv/agentbrew` (or a reviewed manual release path exists) and npm credentials are available. See `docs/human-blocked-actions/agentbrew-release-auth-2026-07-20.md`.
  - **Files**: `.github/workflows/auto-publish.yml`, `scripts/publish-latest.sh`, `docs/human-blocked-actions/agentbrew-release-auth-2026-07-20.md`
  - **Acceptance**: The owner runs `npm run publish:latest` in a real terminal (browser 2FA needs a TTY); afterwards the git tag, npm `latest`, and `package.json` version match. GitHub Actions stays off, so no workflow step is required.
  - **Blocked**: needs-owner-tty — npm publish needs the owner's browser 2FA in a real terminal; agents cannot run it.

## P3

- [ ] Workspace-aware `agentbrew sync` — discover and process per-repo Agentfiles across **one or more workspaces** on one host
  - **ID**: workspace-aware-sync
  - **Tags**: architecture, agentfile, workspace, multi-repo, multi-workspace, curator-not-host
  - **Hypothesis**: one `agentbrew sync` applies every per-repo Agentfile in the declared workspaces, so manual `sync --agentfile` runs drop from one per repo to zero.
  - **Measurement**: `fd -g Agentfile.yaml ~/apps -d 3 | wc -l` (repos that need a manual run today) before and after.
  - **Pivot**: if only one workspace still has per-repo Agentfiles at the next review, close this task as not needed.
  - **Anchor**: tasks.md `workspace-mode-nested-repos`; the 2026-10-16 re-check note below.
  - **Details**: Companion to `tasksmd/tasks.md` task `workspace-mode-nested-repos` (filed 2026-05-12 PR upstream). Operators frequently have **multiple** workspace folders on the same host — the operator at 2026-05-12 has 5 workspaces under `~/apps/` (`tooling`, `acme`, `learning`, `_inventory`, `docs`), several containing their own per-repo `Agentfile.yaml`. Today `agentbrew sync` takes either no Agentfile (uses global `~/.config/agentbrew/Agentfile.yaml`) or an explicit `--agentfile <path>` flag — both single-Agentfile shapes. There's no first-class way to compose one global manifest + N workspaces × M per-repo manifests.

    The operator's mental model is "I have these workspaces; agentbrew should know what every repo in every workspace wants and reconcile that into the target agent configs." Today that requires running `agentbrew sync --agentfile <path>` once per repo across N workspaces — friction that scales with workspace count × repo count.

    **Outcome-shaped** (multi-workspace, N=1 is just a degenerate case):

    1. Operator runs `agentbrew sync` (no flag) — if `workspaceRoots:` is declared in the global Agentfile, agentbrew iterates **every declared workspace** and processes every per-repo Agentfile within each. If no workspaces are declared, behaviour is unchanged (single-Agentfile, backwards compat).
    2. Explicit scoping: `agentbrew sync --workspaces ~/apps/tooling,~/apps/acme` (comma list) OR `agentbrew sync --workspace-name tooling` (config-name lookup, mirrors the `tasks` CLI's flag shape from the foundation task).
    3. `agentbrew status` reports per-workspace, per-repo: discovered Agentfiles, declared sources, deployed targets, collision warnings.
    4. Skills/commands/rules/MCPs are namespaced by `<workspace>::<repo>` so collisions across workspaces (two repos declaring the same MCP from different versions, etc.) surface as actionable diagnostics rather than silent last-write-wins.

    Implementation hints (not load-bearing):
    - Adds `workspaceRoots: [<path1>, <path2>, ...]` to the global `Agentfile.yaml` schema (plural; single-workspace setups declare a 1-element list). Schema validation rejects mixed `workspaceRoot:` (singular) + `workspaceRoots:` (plural).
    - Adds `--workspaces <path1,path2,...>` (plural, comma-separated) + `--workspace-name <name>` flags on `sync`, `status`, `lint`, `health`. The singular `--workspace <path>` flag is shorthand for a 1-element list (kept for ergonomics).
    - Reads the same `~/.config/tasks-md/workspaces.yaml` config the `tasks` CLI uses (foundation task) — so adding a workspace via `tasks workspaces add` automatically picks it up here. Don't reinvent the discovery layer.
    - Reuses the `.tasks-md-workspace` sentinel from `tasksmd/tasks.md`.
    - If command sources land later: in multi-workspace mode, every workspace × every repo's `commandSources:` declaration aggregates.
    - Composes with `catalog-minsky-observer-skill` (sibling P1 above): once Minsky has a catalog entry, the per-repo Agentfile in `~/apps/tooling/minsky/` declares it via `skills: [minsky-observer]` instead of `skillSources: [...]`, and the workspace-sync picks it up like any other.
  - **Files**: `src/cli.ts` (workspace + workspaces + workspace-name flags + Agentfile-discovery), `src/sync/skills-sync.ts`, `src/sync/command-sync.ts`, `src/sync/rules-sync.ts`, `src/sync/mcp-sync.ts` (all extended to handle the merged-from-N-workspaces-×-M-Agentfiles input), `src/health.ts` (per-workspace + per-repo health rollup), `src/core/workspaces.ts` (new — reads `~/.config/tasks-md/workspaces.yaml`), `templates/AGENTS.md` (multi-workspace docs), `docs/VISION.md` (multi-workspace as a first-class concept), tests.
  - **Acceptance**: (a) `agentbrew sync --workspaces ~/apps/tooling,~/apps/acme` exits 0 + deploys every per-repo Agentfile's declarations across both workspaces; (b) per-workspace × per-repo sources are namespaced (collision reports `<workspace>::<repo>` for both sides); (c) `agentbrew status` lists discovered Agentfiles + deployed targets, grouped by workspace; (d) multi-workspace mode is backwards-compatible (zero workspaces declared → single-Agentfile behaviour unchanged); (e) reads `~/.config/tasks-md/workspaces.yaml` if present (shared with the `tasks` CLI); (f) tests cover the cross-workspace merge-conflict path.
  - **Re-checked 2026-10-16**: on this machine only `~/apps/tooling` holds per-repo `Agentfile.yaml` files (5 repos); no other `~/apps/*` folder has one, and `~/.config/tasks-md/workspaces.json` does not exist. The tasks CLI now ships `tasks workspaces` with that JSON file (not `workspaces.yaml`), so read that path. Applying a per-repo Agentfile writes into the one global state, so the merge and collision rules need a design before code. Parked by a goal run after its 45-minute cap; pick it up only when a second workspace with per-repo Agentfiles exists.
  - **Surfaced-by**: Operator multi-workspace setup at `~/apps/` containing 5 workspaces (`tooling`, `acme`, `learning`, `_inventory`, `docs`) as of 2026-05-12. Foundation task in `tasksmd/tasks.md` (workspace-mode-nested-repos) ships the spec + parser + shared config-file surface; this task closes the agentbrew side.

- [ ] Drop the basic-ftp override once get-uri accepts a patched range
  - **ID**: scout-basic-ftp-override-removal
  - **Tags**: scout, dependencies, security
  - **Hypothesis**: once `get-uri` accepts a patched `basic-ftp`, removing the override drops one pinned transitive dependency with no new audit finding.
  - **Measurement**: `npm view get-uri dependencies.basic-ftp` and `npm audit --json | jq '.vulnerabilities["basic-ftp"]'`.
  - **Pivot**: if `get-uri` has not widened its range by the next quarterly review, keep the pin and close this task with that reason.
  - **Anchor**: the `basic-ftp` 5.x denial-of-service advisory; dependency audit 2026-10-16.
  - **Details**: `package.json` pins `basic-ftp` to 6.2.3 through `overrides` because `get-uri@8` asks for `^5.3.1`, and 5.x has an open denial-of-service advisory. Remove the override when `get-uri` (via `promptfoo` > `proxy-agent`) widens its range to a patched release, so the pin stops hiding upstream drift.
  - **Files**: package.json, package-lock.json
  - **Acceptance**: (1) the `basic-ftp` entry is gone from `overrides`; (2) `npm audit` stays free of high findings from `basic-ftp`.
  - **Blocked**: upstream — re-checked 2026-10-16: `get-uri` 8.0.1 (latest) still depends on `basic-ftp` `^5.3.1`; the override keeps 6.2.3.

- [ ] (Publish-only step) File the staged upstream issue at `neiii/bridle` (upstream relocated 2026-05-02 from `superwall/bridle`) noting `harness-locate` uses singular `skill/` and `command/` for OpenCode but the official OpenCode docs use plural.
  - **ID**: bridle-opencode-path-issue
  - **Tags**: upstream-contribution, bridle, scout, blocked-explicit-permission, publish-only
  - **Hypothesis**: filing the staged issue gets the OpenCode singular and plural path mismatch fixed or closed upstream, so the next path audit stops flagging it.
  - **Measurement**: `gh issue list --repo neiii/bridle --state all --search opencode` (state of the filed issue).
  - **Pivot**: no maintainer response within 90 days: drop the task (VISION 90-day rule).
  - **Anchor**: `docs/audits/harness-locate-cross-check.md`; VISION "delegate, contribute, absorb".
  - **Details**: Surfaced from the 2026-04-26 `audit-harness-locate-paths` audit (see [`docs/audits/harness-locate-cross-check.md`](docs/audits/harness-locate-cross-check.md)). Bridle's `harness-locate::opencode` returns `~/.config/opencode/skill/` (singular) and `~/.config/opencode/command/` (singular). Per [OpenCode docs](https://opencode.ai/docs/skills) (2026-04-26), the actual paths are plural: `~/.config/opencode/skills/<name>/SKILL.md` and `~/.config/opencode/commands/<name>.md`.

    **Draft staged 2026-04-26 (PR #814)** in [`docs/audits/bridle-opencode-issue-draft.md`](docs/audits/bridle-opencode-issue-draft.md). The draft includes the title, body, source-code line references (`opencode.rs:41-46` for `commands_dir`, `opencode.rs:73-78` for `skills_dir`), suggested diff, and a filing checklist for the publish step.

    - **Publishing hold**: posting the issue at `neiii/bridle` is a public-write action under the file-level publishing policy and requires explicit per-action approval at the moment of filing. The draft is ready (URL/branch references corrected after the 2026-05-02 upstream relocation); the only remaining step is `gh issue create` once approved.

    Outcome: a short, factual issue body referencing both OpenCode doc URLs and the two specific Bridle source-code lines. If accepted upstream: a Bridle patch lands; agentbrew users on `harness-locate`-backed tooling see correct paths. If rejected: closes a future-noise channel for next-session audits.

    Scope when approved: ~5 minutes — read the draft, confirm line ranges still match Bridle's `master` branch on `neiii/bridle`, run `gh issue create --repo neiii/bridle ...`, paste the URL into the audit report's "Scout output" section.

    Publishing scope: cross-org (Bridle is `neiii/bridle` on github.com — relocated 2026-05-02 from `superwall/bridle`). REQUIRES EXPLICIT PER-ACTION USER APPROVAL.
  - **Files**: [`docs/audits/bridle-opencode-issue-draft.md`](docs/audits/bridle-opencode-issue-draft.md) (the staged draft); when filed, [`docs/audits/harness-locate-cross-check.md`](docs/audits/harness-locate-cross-check.md) gets the issue URL appended under "Scout output".
  - **Acceptance**: ~~(a) the issue draft is recorded in the commit body or a sibling `docs/audits/bridle-opencode-issue-draft.md`~~ DONE 2026-04-26 (PR #814 — draft staged at `docs/audits/bridle-opencode-issue-draft.md`); (b) post-approval, the issue is filed and the URL recorded in the audit report's "scout output" section; (c) if Bridle merges a fix, the audit reportgets a one-line update.
  - **Output**: docs
  - **Human-approval-required**: external-issue
  - **Blocked**: needs-user-approval — posting the upstream `neiii/bridle` issue is a public write and requires explicit current-session approval for that exact action.
  - **Research**: 2026-05-02 — upstream target refresh.
    `superwall/bridle` no longer resolves through GitHub, but GitHub repo search finds the Bridle harness project at `neiii/bridle` (`https://github.com/neiii/bridle`, default branch `master`). The current `crates/harness-locate/src/harness/opencode.rs` still documents and joins singular `command`/`skill` at the OpenCode command/skill helpers, and an all-state issue search on `neiii/bridle` for the OpenCode plural/singular terms returned no existing issue. Before the approved publish step, update the draft's target repo and line links from `superwall/bridle`/`main` to `neiii/bridle`/`master`, then file there if the user approves that exact public write.

    2026-05-02 (later) — draft prep shipped. `docs/audits/bridle-opencode-issue-draft.md` and `docs/audits/harness-locate-cross-check.md` now point at `neiii/bridle@master`, the `gh issue create` invocation targets `neiii/bridle`, and a re-fetch of `crates/harness-locate/src/harness/opencode.rs` from `neiii/bridle@master` confirmed the singular `"skill"` / `"command"` joins still exist at the documented line ranges (43-45 / 75-77; function blocks 41-46 / 73-78). The draft is now publish-ready end-to-end; the only remaining step is the still-blocked `gh issue create` at `neiii/bridle`.

    2026-10-16 — re-checked: `neiii/bridle@master` (last push 2026-08-15, not archived) still joins singular `"command"` / `"skill"` at `opencode.rs` lines 43-45 / 75-77, and no issue on the topic exists. The staged draft is still accurate; the only step left is the approved `gh issue create`.
  - **Last-enriched**: 2026-10-16

<!-- P3 is intentionally blocked — see the "Priority semantics" comment at the top of this file
     for the full rule. /next-task MUST NOT claim P3 without explicit user permission. -->

- [ ] Propose managed-section marker convention as an ecosystem-wide spec (upstream contribution).
  - **ID**: ecosystem-contrib-managed-section-convention
  - **Tags**: ecosystem, contribution, standards
  - **Hypothesis**: one upstream PR that links the marker spec gets at least one more tool to use the shared format, so marker collisions between tools stay at zero.
  - **Measurement**: the upstream PR state (`gh pr view <url> --json state`) and the tools listed as using the format in `docs/specs/managed-section-markers.md`.
  - **Pivot**: no response within 90 days: keep the spec local and close the task.
  - **Anchor**: `docs/specs/managed-section-markers.md`.
  - **Details**: **Publishing hold**: the final publish step (filing the PR, posting the comment, sending any external message) is a SEPARATE approval from approval to claim or research — it requires explicit per-action user approval in the session that performs it, per the file-level publishing policy. Drafting PR text and comment bodies locally is fine; the `gh pr create` / `gh issue comment` / `gh pr review` action itself is blocked until approved.
    Multiple tools now write to the same agent config files (CLAUDE.md, AGENTS.md, `.cursor/rules/`). Without a shared convention, they collide. agentbrew uses `<!-- agentbrew:start -->` / `<!-- agentbrew:end -->`. Caliber uses `<!-- caliber:managed:<name> -->` / `<!-- /caliber:managed:<name> -->`. React Doctor writes directly without markers. No standard exists.
    File a lightweight spec proposal — a gist or small repo — documenting: (a) marker format (`<!-- <tool-name>:managed:<section-name> -->`), (b) ownership semantics (only the owning tool may modify content inside its markers; other tools must preserve the block verbatim), (c) marker placement (top-level sections in markdown, can contain valid markdown), (d) nesting (disallowed — markers must be section-siblings, not nested), (e) test patterns (regex + examples). Link from agentbrew's VISION.md and file a drive-by PR on Caliber / Warden / React Doctor repos linking to the spec with a one-sentence "we'd like to align on this marker convention."
    This is low-priority, low-investment, ecosystem-hygiene work. Skip if Caliber or another tool beats us to it — the goal is alignment, not authorship.
  - **Files**: `docs/specs/managed-section-markers.md` (new) or a gist / standalone repo, upstream PRs to Caliber / other tools.
  - **Acceptance**: (a) spec document exists with the 5 sections above; (b) VISION.md links to it; (c) at least one upstream PR filed linking to the spec — accept the result whether merged or not (author goodwill + visibility matters more than the merge).
  - **Research**: 2026-10-16 — (a) and (b) are done: the spec is [`docs/specs/managed-section-markers.md`](docs/specs/managed-section-markers.md) and VISION.md links it. Caliber already uses `<!-- caliber:managed:<section> -->`, the proposed format. The first upstream ask is staged in [`docs/audits/managed-section-markers-upstream-draft.md`](docs/audits/managed-section-markers-upstream-draft.md); only (c), the approved `gh issue create` on `caliber-ai-org/ai-setup`, remains.
  - **Human-approval-required**: external-pr

- [ ] Trust-building PRs on vercel-labs/skills from the drafts staged in `fyodoriv/skills`
  - **ID**: contribute-trust-building-pr-skills-cli
  - **Tags**: upstream-contribution, skills-cli, blocked-explicit-permission, bug-fix
  - **Hypothesis**: landing the staged fixes upstream builds maintainer trust, so larger delegation asks get reviewed; at least one PR merges.
  - **Measurement**: `gh pr list --repo vercel-labs/skills --author fyodoriv --state merged --json number --jq length`.
  - **Pivot**: no merge within 90 days of filing: stop filing and keep the fixes local where agentbrew needs them.
  - **Anchor**: `docs/competition/vercel-skills-cli-vs-agentbrew.md` § Contribution roadmap.
  - **Details**: **Publishing hold**: the final publish step (filing the PR, posting the comment, sending any external message) is a SEPARATE approval from approval to claim or research — it requires explicit per-action user approval in the session that performs it, per the file-level publishing policy. Drafting PR text and comment bodies locally is fine; the `gh pr create` / `gh issue comment` / `gh pr review` action itself is blocked until approved.
    **DO NOT claim this task without explicit user approval** (P3 policy).

    Source: [docs/competition/vercel-skills-cli-vs-agentbrew.md § "Contribution roadmap"](../docs/competition/vercel-skills-cli-vs-agentbrew.md#contribution-roadmap--priority-ordered) + [§ Fork draft inventory (2026-04-24)](../docs/competition/vercel-skills-cli-vs-agentbrew.md#fork-draft-inventory-2026-04-24).

    **Current state (2026-10-15)**: draft PRs stay staged in [`fyodoriv/skills`](https://github.com/fyodoriv/skills/pulls). Targets closed upstream since 2026-04 were dropped from the list below (#808, #960, #982, #561, #523/#328); #969 and #915 are closed and #971 was merged. Re-check each target's state before promoting it.

    - fork#1 + fork#4 — two alternative approaches to [#806](https://github.com/vercel-labs/skills/issues/806) (hash verification mismatch). Pick one for upstream.
    - fork#2 — [#781](https://github.com/vercel-labs/skills/issues/781) (Windows line endings in hash)
    - fork#5 — [#1005](https://github.com/vercel-labs/skills/issues/1005) (subpath stripped from lock write-back)
    - fork#6 — [#1001](https://github.com/vercel-labs/skills/issues/1001) (suppress ASCII banner in `find`)
    - fork#7 — [#999](https://github.com/vercel-labs/skills/issues/999) (well-known URL truncated in lock)
    - fork#8 — [#954](https://github.com/vercel-labs/skills/issues/954) (`skills check` should be read-only)
    - fork#11 — [#1010](https://github.com/vercel-labs/skills/issues/1010) error-UX half (`spawn git ENOENT` → actionable install hint)
    - fork#12 — [#941](https://github.com/vercel-labs/skills/issues/941) (Windows execPath with spaces — silent update failure)
    - fork#13 — [#916](https://github.com/vercel-labs/skills/issues/916) (`update -p -y` creates `skills/` at project root)
    - fork#14 — [#953](https://github.com/vercel-labs/skills/issues/953) (binary file corruption from well-known endpoints)
    - fork#15 — [#886](https://github.com/vercel-labs/skills/issues/886) (data-loss: `add ./.agents/skills` deletes source SKILL.md when source overlaps canonical)
    - fork#16 — [#793](https://github.com/vercel-labs/skills/issues/793) (`-yg` combined short flags silently dropped — same class as closed #195)
    - fork#17 — [#666](https://github.com/vercel-labs/skills/issues/666) (`experimental_install` fails for well-known sources — local lock loses URL scheme)
    - fork#18 — [#745](https://github.com/vercel-labs/skills/issues/745) (`-g -y -a <agent>` silently flips to copy mode, skips canonical `~/.agents/skills/`)
    - fork#20 — [#840](https://github.com/vercel-labs/skills/issues/840) (`skills update` swallows subprocess stderr — every Windows failure shows just `✗ Failed to update <skill>` with no diagnostic info, even at `--verbose`/`DEBUG=1`) — NEW 2026-04-24 night #5
    - fork#22 — [#985](https://github.com/vercel-labs/skills/issues/985) + [#949](https://github.com/vercel-labs/skills/issues/949) (well-known v0.2.0 discovery schema rejected by `WellKnownProvider.isValidSkillEntry`; `mockaton.com` and `createos.nodeops.network` both publish valid v0.2.0 indexes per Cloudflare RFC 0.2 spec and existing users see "No skills found at this URL" — adds schema-aware dispatch with SHA-256 digest verification per spec §Integrity and Verification, lands `type: "skill-md"` half, skips `type: "archive"` half with a console warning naming the skill; archive half tracked as follow-up requiring tar/zip extraction with §Archive Safety defenses) — NEW 2026-04-24 night #6

    When upstream submission is approved: promote in priority order — fork#15 first (data-loss bug, highest user impact), fork#21 (corporate-blocker; users literally cannot use the CLI without disabling it; backward-compat opt-out), fork#22 (every v0.2.0 well-known endpoint blocked, real users hitting #985 + #949 today, new upstream tests, no breaking change for v0.1.0 consumers — workaround does not exist for v0.2.0-only servers), fork#20 (diagnostic enabler; unblocks self-diagnosis for #840 reporters and any future silent-failure thread), fork#17 (data-recovery bug, breaks `experimental_install` end-to-end for well-known sources, fully backward-compat), fork#18 (data-correctness: silent copy mode skips canonical dir; pure-helper test coverage), fork#19 (collaboration-correctness: local-source paths leak into checked-in lock; backward-compat), fork#6 (smallest, zero controversy), fork#16 (POSIX-standard parser fix, upstream tests, zero behavior change for non-combined invocations), then fork#12 + fork#13 (mechanical fixes with strong tests), then fork#9 + fork#10 + fork#11 (small, user-reported, mechanical fixes), then fork#14 (binary-files; high impact, well-tested), then fork#7 + fork#17 + fork#19 (lock-file source-shape preservation bundle, plausibly one upstream PR), fork#5 (lock-file subpath, similar territory), then fork#2 (Windows compat), then fork#3, then fork#8, then fork#4 (or fork#1, whichever the user picks for #806). Every upstream PR description cites agentbrew's contribution roadmap so reviewers see the pattern. Bug #806 is a hash verification mismatch that blocks PR #630's lockfile-vs-disk check — landing it accelerates the drift-detection landing we care about most.

    **Future-batch draft candidates** (reviewed 2026-04-24 night but not pursued; stage in fork only after user review of the current 22):

    | Upstream issue | Shape | Why deferred |
    |---|---|---|
    | [#974](https://github.com/vercel-labs/skills/issues/974) | `-g` combined with `-a` overrides symlinking | Spans 20+ `installGlobally` call sites in `src/add.ts`; not a drive-by. |
    | [#1010](https://github.com/vercel-labs/skills/issues/1010) (allowlist half) | Blob fast path is org-allowlisted | Policy change, not mechanical. Ask upstream in the issue which they'd accept. Error-UX half already covered by fork#11. |
    | [#997](https://github.com/vercel-labs/skills/issues/997) | `npx skills update` fails for self-hosted GitLab | Needs a real self-hosted GitLab instance to reproduce. |
    | [#923](https://github.com/vercel-labs/skills/issues/923) | `skills update` reports success without updating contents | Triage-needed: bug shape unclear; need a reliable repro before drafting. |
    | [#537](https://github.com/vercel-labs/skills/issues/537) | Global install leaves agent skill dir missing for non-universal agents (`~/.cursor/skills/`) | `isUniversalAgent` is decided by project skillsDir but applied to global installs; needs a `isGlobalUniversal` distinction with broader testing. Not drive-by. |
    | [#225](https://github.com/vercel-labs/skills/issues/225) | Incorrect agents detected during `list`/`remove` (OpenClaw attributed to skills in `.agents/skills/`) | Detection logic conflates project and global skillsDirs. PR #965 partially addresses one symlink subcase. Whole class needs deeper refactor. |
    | [#870](https://github.com/vercel-labs/skills/issues/870) | Can't Interrupt Git Clone (Ctrl+C ignored) | SIGINT handling through @clack/prompts and simple-git is non-trivial; not a drive-by. |

    Items no longer candidates: #983 (npx-side bug, not skills-CLI); #977 (duplicate of #808 / fork#3); #960 (now fork#9); #982 (now fork#10); #1010 error-UX half (now fork#11); #941 (now fork#12); #916 (now fork#13); #953 (now fork#14); #886 (now fork#15); #793 (now fork#16); #666 (now fork#17); #745 (now fork#18); #561 (now fork#19); #840 (now fork#20); #523 + #328 (now fork#21); #985 + #949 (now fork#22).

    If any target issue is already fixed by the time the task is picked up: skip it and pick another bug from the open-issues list, preferring any that unblock PR #630 or appear in agentbrew user reports. Use the pattern already established in fork#1–#22 — failing test then minimal fix, ≤250 LOC where possible (helper-extracted with bounded behavior, like fork#20's 20-line/240-char output cap, often warrants a slightly larger LOC budget). For larger surface like fork#22 (v0.2.0 schema; 1,033 LOC including new upstream tests across multiple upstream files), the budget is justified when the fix unblocks an entire class of broken endpoints AND ships with a pure-helper module that lets a follow-up PR (e.g. archive support) reuse the validation/digest logic without re-litigating it.
  - **Files**: upstream PR at vercel-labs/skills (no agentbrew files); document the outcome in `docs/competition/vercel-skills-cli-vs-agentbrew.md` § "Upstream receptivity" once filed.
  - **Acceptance**: (a) one or more PRs promoted from `fyodoriv/skills` to `vercel-labs/skills:main` with a failing regression test and the minimal fix, scope ≤100 LOC each (or ≤250 LOC for the binary-files / data-loss classes with full test coverage); (b) the PR description cites agentbrew's contribution roadmap and the drift-detection dependency where applicable; (c) outcome (merged / stuck / rejected) is documented in `docs/competition/vercel-skills-cli-vs-agentbrew.md` § "Upstream receptivity"; (d) subsequent contribution tasks reference the merged PRs as trust-established context.
  - **Research**: 2026-10-16 — every target issue in the list above (#806, #781, #1005, #1001, #999, #954, #1010, #941, #916, #953, #886, #793, #666, #745, #840, #985, #949) is still open upstream, and `fyodoriv/skills` has 22 open draft PRs. Nothing to drop; the only step left is the owner-approved upstream PR.
  - **Human-approval-required**: external-pr

- [ ] RFC comment on vercel-labs/skills [issue #268](https://github.com/vercel-labs/skills/issues/268) + [issue #455](https://github.com/vercel-labs/skills/issues/455) — user-created skill preservation classifier.
  - **ID**: contribute-rfc-comment-issues-268-455-user-safety-classifier
  - **Tags**: upstream-contribution, skills-cli, blocked-explicit-permission, data-safety
  - **Hypothesis**: an RFC comment with agentbrew's classifier taxonomy shapes the upstream fix, so the merged fix preserves user-created skills.
  - **Measurement**: `gh issue view 268 --repo vercel-labs/skills --json state,comments`.
  - **Pivot**: if issue #268 closes without a preservation fix, keep agentbrew's own classifier and close this task.
  - **Anchor**: `docs/competition/vercel-skills-cli-vs-agentbrew.md` § Feature 7.
  - **Details**: **Publishing hold**: the final publish step (filing the PR, posting the comment, sending any external message) is a SEPARATE approval from approval to claim or research — it requires explicit per-action user approval in the session that performs it, per the file-level publishing policy. Drafting PR text and comment bodies locally is fine; the `gh pr create` / `gh issue comment` / `gh pr review` action itself is blocked until approved.
    **DO NOT claim this task without explicit user approval** (P3 policy).
    Source: [docs/competition/vercel-skills-cli-vs-agentbrew.md § "Feature 7: User-created skill preservation"](../docs/competition/vercel-skills-cli-vs-agentbrew.md#7-user-created-skill-preservation--4-competing-bug-fix-prs-in-flight) and [Contribution roadmap row 3](../docs/competition/vercel-skills-cli-vs-agentbrew.md#contribution-roadmap--priority-ordered). Research (2026-04-19) found the user-safety direction has **4 competing bug-fix PRs already open** ([#609](https://github.com/vercel-labs/skills/pull/609), [#611](https://github.com/vercel-labs/skills/pull/611), [#869](https://github.com/vercel-labs/skills/pull/869), [#944](https://github.com/vercel-labs/skills/pull/944)) plus related bug reports ([#268](https://github.com/vercel-labs/skills/issues/268), [#455](https://github.com/vercel-labs/skills/issues/455), [#606](https://github.com/vercel-labs/skills/issues/606)). Filing a 5th implementation hurts: the queue is saturated and maintainers haven't merged any of them yet. The right move is RFC input on the design, not another competing PR.
    Outcome when unblocked: (a) post agentbrew's 5-case `cleanEntry()` classifier taxonomy as a comment on [issue #268](https://github.com/vercel-labs/skills/issues/268) (the foundational issue) to inform how maintainers architect the eventual fix — managed symlink / broken symlink / user symlink to valid non-managed path / user directory without `.agentbrew-managed` sentinel / user directory with sentinel; (b) cross-post a short summary on [issue #455](https://github.com/vercel-labs/skills/issues/455) tying the agentbrew taxonomy to skills CLI's `preserve-local` mode request; (c) include the specific invariant: *"The user's own files are preserved forever; `--prune`, auto-repair, and sync all treat user-created directories as sacrosanct"*; (d) link to [`src/sync/skills-sync.ts` `cleanEntry`](../src/sync/skills-sync.ts) for the implementation reference; (e) explicitly say agentbrew is NOT filing a PR, so maintainers know this is design input not queue-noise.
    If any of the 4 open PRs merges with the classifier design, close this task — the contribution has landed. If none merge and the queue grows further (a 5th community PR appears), escalate by commenting on issue #268 asking Andrew Qu / Elliot Liu for architectural direction on which PR they'd be willing to review.
  - **Files**: upstream issues at vercel-labs/skills (no agentbrew files).
  - **Acceptance**: (a) a substantive RFC-style comment is posted on BOTH #268 and #455 with the 5-case taxonomy and the invariant statement; (b) the comment links to the exact `src/sync/skills-sync.ts` `cleanEntry` reference and explicitly states "not filing a PR"; (c) if any of the 4 open PRs (#609, #611, #869, #944) subsequently merges with a classifier design, close this task with a link to the merge in the commit message; (d) if the queue stays stuck for another 4 weeks post-comment, the escalation comment on #268 asking for architectural direction is posted.
  - **Research**: 2026-10-16 — #268, #455, #606, #609, and #611 are still open; #869 merged but only preserves dotfiles in copied skills; #944 closed. No classifier has landed. Both comment texts are staged in [`docs/audits/skills-cli-268-455-rfc-comment-draft.md`](docs/audits/skills-cli-268-455-rfc-comment-draft.md) with the posting steps; the only remaining step is the approved `gh issue comment`.
  - **Human-approval-required**: external-issue

- [ ] `agentbrew setup opencode` writes a model and provider shape current opencode accepts
  - **ID**: opencode-bootstrap-config-shape
  - **Tags**: opencode, bootstrap, models, scout
  - **Details**: `writeOpencodeProviderConfig` (`src/mcp/opencode-bootstrap.ts`) writes `model: { big, small }` and `provider: { ollama: { url } }`. Current opencode docs describe `model` and `small_model` as `provider/model` strings, and a custom provider as `provider.<id>` with `npm`, `options.baseURL`, and `models`. opencode's config schema rejects unknown keys, so this bootstrap may leave an invalid config. Found while closing `unify-opencode-bootstrap-model-with-default-model` (2026-10-16). Check the schema at https://opencode.ai/config.json first.
  - **Research**: 2026-10-16 — the live schema (https://opencode.ai/config.json) confirms the bug: `model` must be a `provider/model` string or `{ providerID, model, variant? }` with `additionalProperties: false`, so `{ big, small }` is invalid. `small_model` is a deprecated string. `provider` is deprecated in favour of `providers` (`Config.ProviderEncoded`); a custom provider takes `npm`, `options.baseURL`, and `models`. Write `model: "ollama/<tag>"` and a `providers.ollama` block, then validate against the schema in the test.
  - **Files**: `src/mcp/opencode-bootstrap.ts`, its test
  - **Acceptance**: the written `model`, `small_model`, and `provider` keys validate against the opencode config schema; a test pins the shape.
  - **Hypothesis**: the bootstrap writes an old shape; fixing it makes a fresh `agentbrew setup opencode` produce a config opencode loads.
  - **Measurement**: validate the written `opencode.json` against https://opencode.ai/config.json with a JSON schema validator in a test fixture.
  - **Success**: 0 schema errors.
  - **Pivot**: if the current shape still validates, close this task with the schema evidence.
  - **Anchor**: opencode config docs (https://opencode.ai/docs/config/), models and providers pages.

- [ ] `agentbrew catalog` can order catalog skills by their public skills.sh install count
  - **ID**: catalog-browse-skills-sh-install-counts
  - **Tags**: catalog, ux, delegation
  - **Details**: Follow-up of `catalog-install-popularity-signal` (decision: [`docs/decisions/catalog-install-popularity-signal.md`](docs/decisions/catalog-install-popularity-signal.md)). The skills.sh search API (`GET https://skills.sh/api/search?q=<name>&limit=<n>`) returns an `installs` count per skill. Read it for catalog skills only, behind a `--sort installs` option on `agentbrew catalog`, with a short timeout and an offline fallback to the editorial order. Send only the search text; no user data. MCP servers and rules keep the editorial tiers.
  - **Files**: `src/catalog/browse.ts`, `src/commands/cli-catalog.ts`, their tests, README "Install a skill or MCP server"
  - **Acceptance**: `agentbrew catalog --skills --sort installs` lists catalog skills by skills.sh installs, highest first; a test with a stubbed fetch covers the order, a timeout, and a skill skills.sh does not know.
  - **Hypothesis**: an ecosystem-wide install count shows which catalog skills people actually use, which a one-machine log cannot.
  - **Measurement**: `agentbrew catalog --skills --sort installs --json | jq '.[0:5] | map(.installs)'` returns descending numbers.
  - **Success**: the top of the `--sort installs` list shows non-zero install counts, highest first.
  - **Pivot**: if the skills.sh API changes shape or rate-limits browse, drop the option and keep the editorial order.
  - **Anchor**: VISION.md "Delegate, contribute, absorb"; skills.sh public search API.
