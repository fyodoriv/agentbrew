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

- [ ] The fast gate passes in a Linux cloud session, so cloud agents can trust it
  - **ID**: gate-green-in-linux-cloud
  - **Blocked**: needs-owner — the owner chose a Claude cloud session for the Linux run (2026-10-22) instead of Docker Desktop on the Mac. Agents cannot start one from a Remote Control session; the app starts new sessions only from a message typed in the desktop app. Unblock: in the desktop app, ask to "start the Linux gate cloud session for agentbrew" (repo fyodoriv/agentbrew, branch main), then run `npm run verify` there and fix each failing step listed in Details.
  - **Tags**: gate, tests, cloud
  - **Details**: Fixed on 2026-10-20 (fyodoriv/agentbrew#292): the `hook-large-input-pipefail` fixture (jq now reads
    the 300 KB body with `--rawfile`; Linux caps one argument at 128 KB) and the `instructions-sync` "readFileSync
    throws" test (root ignores `chmod 000`; a directory now stands in for the file). `npm run verify:changed`
    passes in the cloud up to `playwright-install`, which the cloud network blocks (`cdn.playwright.dev`; a
    Chromium is preinstalled at `/opt/pw-browsers`). The full `npx vitest run` still has 15 failures that also
    fail on `main` in the cloud. Three causes: root ignores file modes (`lint.test.ts` unreadable cases,
    `manifest.test.ts`, `skills-sync.test.ts` symlink warning), macOS-only paths (`integration-infra.test.ts`
    LaunchAgent and .zshrc, `mcp-sync-carveout-matrix.test.ts` copilot path, `integration.test.ts` sync
    convergence and prune), and missing tools (`git-filter-repo`, Copier, storybook, sqlite backup, worktree-deps
    cloning).
  - **Files**: `scripts/verify.sh` (playwright step), the test files named in Details
  - **Output**: code
  - **Acceptance**: `npm run verify` passes on `main` in a Linux cloud container (root user, no Playwright CDN), and still passes on the Mac.
  - **Hypothesis**: Both failures are test-harness assumptions about macOS, not product bugs; each takes a small test-only fix.
  - **Measurement**: `npm run verify:changed` on `main` in a cloud session (pass/fail per step)
  - **Success**: 0 failing steps in the cloud and on the Mac
  - **Pivot**: a failure is a real product bug on Linux → fix the product code and add a Linux case to the test
  - **Anchor**: found while shipping fyodoriv/agentbrew#287 on 2026-10-19 (AGENTS.md rule 11: scout while you work)

- [ ] Skip `npm ci` when the lockfile is unchanged
  - **ID**: speed-up-npm-ci
  - **Tags**: perf, agents
  - **Details**: The 2026-10-20 checkup time review: `npm ci` costs 4m15s/day (31x in 10 sessions, p95 5m02s). Most runs reinstall an unchanged lockfile in a fresh worktree.
  - **Files**: `scripts/worktree-deps.sh`, `AGENTS.md`
  - **Output**: code
  - **Acceptance**: the `npm ci` line in the 7-day agent time review is under the Success threshold.
  - **Hypothesis**: reusing `node_modules` when `package-lock.json` is unchanged (or `npm ci --prefer-offline --no-audit --no-fund`) cuts the cost from 4m15s/day to under 1 min/day.
  - **Measurement**: `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (the agentbrew `npm ci` line), 7 days after the change lands.
  - **Success**: under 1 min/day.
  - **Pivot**: still over 3 min/day after 7 days -> drop this approach and profile the step with the perf-review skill.
  - **Anchor**: tooling-checkup agent time review 2026-10-20; Forsgren, Humble, Kim 2018 (lead time); perf-review skill known fixes.
  - **Blocked**: needs-time — 2026-10-22: `scripts/worktree-deps.sh` skips `npm ci` when `package-lock.json` is unchanged since its last install, runs `npm ci --prefer-offline --no-audit --no-fund` otherwise, and AGENTS.md now names it as the install command (PR feat/speed-up-npm-ci). Local run on the `npm ci` path: re-run 14.4–16.6 s → 0.02 s; a fresh install stays 9–11 s with a warm cache. 7-day baseline before the change: 4m59s/day (38x in 11 sessions, p95 5m02s). Measure on or after 2026-10-29 with `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (the agentbrew `npm ci` line; add the `bash worktree-deps.sh` line, where installs move), then close or pivot.

- [ ] Make `npx biome` fast in the inner loop
  - **ID**: speed-up-npx-biome
  - **Tags**: perf, agents
  - **Details**: The 2026-10-20 checkup time review: `npx biome` costs 3m58s/day (24x in 5 sessions, p95 6m14s; slowest single call 10m02s). Likely cause: npx resolving the package or checking the whole tree instead of changed files.
  - **Files**: `package.json`, `AGENTS.md`
  - **Output**: code
  - **Acceptance**: the `npx biome` line in the 7-day agent time review is under the Success threshold.
  - **Hypothesis**: calling the local `node_modules/.bin/biome` on changed files only cuts the cost from 3m58s/day to under 1 min/day.
  - **Measurement**: `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (the agentbrew `npx biome` line), 7 days after the change lands.
  - **Success**: under 1 min/day.
  - **Pivot**: still over 3 min/day after 7 days -> drop this approach and profile the step with the perf-review skill.
  - **Anchor**: tooling-checkup agent time review 2026-10-20; Forsgren, Humble, Kim 2018 (lead time); perf-review skill known fixes.
  - **Blocked**: needs-time — 2026-10-22: `npm run lint:changed` (`scripts/lint-changed.sh`) runs the local `node_modules/.bin/biome` on changed files only, and AGENTS.md names it as the lint command (PR feat/speed-up-npx-biome). Local run: `npx biome check src scripts` 1.3–1.5 s → `npm run lint:changed` 0.6–0.8 s (one changed file). So Biome itself is not the slow part: the review keys a compound command on its first heavy command, so `npx biome … && npx vitest …` lines carry the test time. 7-day baseline before the change: 4m19s/day (29x in 6 sessions, p95 6m14s). Measure on or after 2026-10-29 with `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (the agentbrew `npx biome` line plus the `npm run lint:changed` line); if their sum stays over 3 min/day, the chained test runs belong to `speed-up-agentbrew-test-loop`, then close or pivot.

- [ ] Speed up `worktree-deps.sh`
  - **ID**: speed-up-bash-worktree-deps-sh
  - **Tags**: perf, agents
  - **Details**: The 2026-10-20 checkup time review: `bash worktree-deps.sh` costs 3m44s/day (24x in 4 sessions, p95 5m31s).
  - **Files**: `scripts/worktree-deps.sh`
  - **Output**: code
  - **Acceptance**: the `bash worktree-deps.sh` line in the 7-day agent time review is under the Success threshold.
  - **Hypothesis**: linking or cloning `node_modules` from the primary checkout when the lockfile matches cuts the cost from 3m44s/day to under 1 min/day.
  - **Measurement**: `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (the agentbrew `bash worktree-deps.sh` line), 7 days after the change lands.
  - **Success**: under 1 min/day.
  - **Pivot**: still over 3 min/day after 7 days -> drop this approach and profile the step with the perf-review skill.
  - **Anchor**: tooling-checkup agent time review 2026-10-20; Forsgren, Humble, Kim 2018 (lead time); perf-review skill known fixes.
  - **Blocked**: needs-time — 2026-10-22: one clonefile(2) call replaces `cp -cR`, and a re-run with an unchanged lockfile keeps `node_modules` (PR feat/speed-up-bash-worktree-deps-sh). Local run: fresh worktree 11.7–13.3 s → 1.2 s, re-run 16.3–18.9 s → 0.07 s. 7-day baseline before the change: 6m52s/day (35x in 6 sessions, p95 6m31s). Measure on or after 2026-10-29 with `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (the agentbrew `bash worktree-deps.sh` line), then close or pivot.

- [ ] Make the agentbrew test loop fast: `verify:changed`, `npx vitest`, `verify`
  - **ID**: speed-up-agentbrew-test-loop
  - **Tags**: perf, agents
  - **Details**: The 2026-10-21 checkup time review (7 days): `npm run verify:changed` costs 12m22s/day (38x in 9 sessions, p95 7m15s), `npx vitest` 12m01s/day (114x in 15 sessions, p95 4m49s), and `npm run verify` 8m49s/day (55x in 14 sessions, p95 4m40s). Together about 33 min/day, the largest agentbrew cost. Agents run whole gates or whole suites while they iterate. Separate from `speed-up-npm-ci` and `speed-up-npx-biome`, which cover installs and lint.
  - **Files**: `package.json`, `scripts/`, `AGENTS.md`, `docs/agent-perf.md`
  - **Output**: code
  - **Acceptance**: the `verify:changed`, `npx vitest`, and `verify` lines in the 7-day agent time review add up to less than the Success threshold.
  - **Hypothesis**: steering the inner loop to `vitest related <changed files>` and making `verify:changed` skip steps whose inputs did not change cuts their combined cost from about 33 min/day to under 15 min/day.
  - **Measurement**: `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (sum of the agentbrew `npm run verify:changed`, `npx vitest`, and `npm run verify` lines), 7 days after the change lands.
  - **Success**: under 15 min/day combined.
  - **Pivot**: still over 25 min/day after 7 days -> profile per step with the perf-review skill and drop this approach.
  - **Anchor**: tooling-checkup agent time review 2026-10-21; Forsgren, Humble, Kim 2018 (lead time); perf-review skill known fixes.
  - **Blocked**: needs-time — 2026-10-22: `verify:changed` now runs `tsc`, `lint:changed`, and `vitest related` on a code diff instead of the whole `npm run verify`; the full gate keys the hook fixtures on the files they run and shares its step cache across worktrees; AGENTS.md points the inner loop at `npm test` (PR feat/speed-up-agentbrew-test-loop). Measured split of the 7 days before (perf log joined to the commands): about half of the `verify:changed` time was code diffs that ran the full gate, and most `npx vitest` time was whole folders and `new-project-contract.test.ts`. Local runs: a one-file `src/` diff 9m52s (old path, the full gate, load ~90) → 30 s (load 77); hook fixtures 128 s → 0.7 s cached in a second worktree. 7-day baseline before the change: 39m32s/day (`npx vitest` 15m36s, `verify:changed` 15m07s, `verify` 8m49s). Measure on or after 2026-10-29 with `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (sum of the agentbrew `npm run verify:changed`, `npx vitest`, and `npm run verify` lines), then close or pivot.

- [ ] Make `new-project-contract.test.ts` cost under 20 s
  - **ID**: speed-up-new-project-contract-test
  - **Tags**: perf, agents
  - **Details**: Found while timing the test loop (2026-10-22). `src/skills/new-project-contract.test.ts` took 81 s at load 38, the slowest test file in the suite, and it runs in every full gate. Agents also ran it on its own 9 times in 7 days (median 61 s). The time goes to real scaffolds: "brings a template fix into an older repo" 16 s, the three Copier comparisons 7–8 s each, and the three scaffold-and-score cases 4–6 s each.
  - **Files**: `src/skills/new-project-contract.test.ts`, `skill-plugins/workflow/new-project/scripts/`
  - **Output**: code
  - **Acceptance**: the file runs in under 20 s on the owner's Mac at a load under 10, with the same checks.
  - **Hypothesis**: scaffolding once per profile and sharing it across the cases cuts the file from 81 s to under 20 s, and the full gate by about a minute.
  - **Measurement**: `npx vitest run src/skills/new-project-contract.test.ts --reporter=json --outputFile=<file>`, file duration.
  - **Success**: the file takes under 20 s and keeps all its assertions.
  - **Pivot**: if the cases cannot share a scaffold, move the Copier cases to a real-e2e scenario and keep the copy-fallback cases in the unit suite.
  - **Anchor**: test-loop timing in the speed-up-agentbrew-test-loop PR (2026-10-22); Forsgren, Humble, Kim 2018 (fast feedback).

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

- [ ] Propose a first-run check for the built-in /loop skill
  - **ID**: propose-loop-skill-first-run-dedupe
  - **Tags**: retro, third-party-skill, loop, watch-issues
  - **Details**: Retro of the 2026-10-22 tooling goal. The built-in Claude Code `/loop` skill (third party, not editable here) says "run the parsed prompt now" in dynamic mode. When `/loop /watch-issues` starts right after the agent already ran a watch pass this turn, that re-runs the same pass and can dispatch duplicate workers. The run skipped the re-run by judgment. Proposed upstream change (feedback to Anthropic): in dynamic mode, skip the immediate run when the same prompt already ran earlier in this turn, and say so in the confirmation. Until then, `watch-issues` SKILL.md can note it.
  - **Files**: none in this repo (upstream feedback); optional one line in `skill-plugins/workflow/watch-issues/SKILL.md`
  - **Output**: docs
  - **Acceptance**: the feedback is sent through the Claude Code feedback channel by the owner, or watch-issues documents the workaround.
  - **Hypothesis**: a first-run check removes duplicate passes when /loop starts right after a manual pass: duplicates 1 per loop start to 0.
  - **Measurement**: watch pass log (pass start times) on the next 3 loop starts.
  - **Success**: 0 duplicate passes in 3 starts.
  - **Pivot**: duplicates never happen in practice -> close as not needed.
  - **Anchor**: tooling goal retro 2026-10-22; run-goal Phase 6 (third-party skills get a task with the proposed change).

- [ ] Propose the comfort budget to the third-party frontend-design skill
  - **ID**: frontend-design-comfort-budget
  - **Tags**: skills, design, third-party
  - **Details**: `frontend-design` (anthropics/claude-plugins-official) drives creative direction but says nothing about comfort: touch targets of at least 44 px, text of at least 14 px, contrast-checked accents in both themes, a home view that opens on what needs the user, and capped lists. On sidequest (2026-10-22) those rules took audit findings from 60 to 0, cut taps per everyday job by a third, and won a blind comparison on 16 of 17 screens. They now live in our own `ui-ux-rankings` (`references/comfort-patterns.md`), which `docs/shared-rules.md` loads for all UI work. Propose a short "comfort floor" section upstream, with this data, through the `report-upstream` skill.
  - **Files**: none in this repo (upstream proposal); `skill-plugins/workflow/ui-ux-rankings/references/comfort-patterns.md` is the source text
  - **Output**: docs
  - **Acceptance**: the upstream issue or PR is filed after the owner approves the exact text, or this task records why it was not filed.
  - **Hypothesis**: with a comfort floor in frontend-design, a fresh UI built with it alone has no touch target under 44 px and no text under 14 px on a phone.
  - **Measurement**: `rankings.cjs all` on a page built by a fresh agent with only frontend-design loaded.
  - **Success**: no touch target under 44 px and no text under 14 px.
  - **Pivot**: if upstream declines, keep it in ui-ux-rankings only and close this task.
  - **Anchor**: WCAG 2.2 SC 2.5.8 (target size); sidequest PR #9 measurements.

- [ ] Run the template-rule readers when a `templates/rules/` diff is merge-ready
  - **ID**: verify-changed-template-rule-readers
  - **Tags**: perf, gate
  - **Details**: The 2026-10-22 read probe of the full suite showed that `src/agent-bloat-lint.test.ts`, `src/sync/helper-scripts.test.ts`, `src/sync/catalog-template-rules.test.ts`, `src/integration.test.ts`, and `src/integration-essential-core.test.ts` read `templates/rules/*.mdc`. `verify:changed` calls such a diff merge-ready but runs none of them, so a broken rule template can reach `main`.
  - **Files**: `scripts/verify-changed.sh`, `src/verify-changed.test.ts`
  - **Output**: code
  - **Acceptance**: a diff that only changes one `templates/rules/*.mdc` file runs those tests in `verify:changed`.
  - **Hypothesis**: rule-template breaks caught before merge go from 0 of the readers to all of them, for about 30 s more gate time on such diffs.
  - **Measurement**: `npm run verify:changed -- --dry-run` on a branch that only edits one `templates/rules/*.mdc` file lists every reader above.
  - **Success**: every reader above is listed, and the run takes under 60 s.
  - **Pivot**: if the integration tests make the run take over 2 min, send `templates/rules/` diffs to the full gate instead.
  - **Anchor**: read probe in the verify-changed-docs-only-fast PR (2026-10-22); Forsgren, Humble, Kim 2018 (fast feedback).

- [ ] Keep `gate_ms` sampled now that worktrees share the gate cache
  - **ID**: gate-ms-with-shared-cache
  - **Tags**: perf, metrics
  - **Details**: `scripts/metrics.sh` takes `gate_ms` from full gates with no cached step. Since 2026-10-22 (speed-up-agentbrew-test-loop) worktrees share the step cache, so the hook-fixtures step is often cached and most gates drop out of the sample. `gate_ms` could then show a stub or a stale number.
  - **Files**: `scripts/metrics.sh`, `docs/metrics.md`
  - **Output**: code
  - **Acceptance**: `bash scripts/metrics.sh` prints a `gate_ms` number from the last 10 passing full gates, with cached steps counted at their last uncached time or left out by name.
  - **Hypothesis**: counting gates with cached steps keeps `gate_ms` samples at the old rate (about one per full gate) instead of near zero.
  - **Measurement**: `bash scripts/metrics.sh` and the count of gate rows it uses from `.metrics/gate-timings.jsonl` over 7 days.
  - **Success**: at least 5 samples in 7 days on the owner's Mac.
  - **Pivot**: if no fair rule fits, report `gate_ms` only from `NO_CACHE=1` runs and say so in `docs/metrics.md`.
  - **Anchor**: docs/metrics.md `gate_ms` row; Basili, Caldiera, Rombach 1994 (GQM).

- [ ] Propose an artifact-design note for goal reports with before/after screenshots
  - **ID**: artifact-design-goal-report-shots
  - **Tags**: skills, retro, third-party
  - **Details**: Retro of the 2026-10-22 sidequest UI goal. `artifact-design` is a third-party (Anthropic) skill, so the change goes upstream as a proposal, not an edit. A goal report with before/after screenshots cost three tries. Two things went wrong: Playwright `setContent` cannot load `file://` images, and full-page phone screenshots must be cropped to the device viewport (iPhone 13 = 390x664), or the fixed tab bar lands mid-image. Proposed note for the skill: "For a goal report, embed before/after screenshots as JPEG data URIs cropped to the device viewport (open the PNG itself, set width and height:auto, then clip), about 100 KB each."
  - **Files**: none in this repo (upstream proposal); `skill-plugins/workflow/run-goal/evals/evals.json` eval 99 covers the run-goal side
  - **Output**: docs
  - **Acceptance**: the proposal is sent upstream, or the note lives in a user-owned skill that wraps artifact-design.
  - **Hypothesis**: with the note, a screenshot report takes 1 try instead of 3.
  - **Measurement**: tries to a correct crop in the next goal report with screenshots (session transcript).
  - **Success**: 1 try.
  - **Pivot**: if no upstream channel takes it, add the note to run-goal's references/retro.md instead and close this task.
  - **Anchor**: run-goal retro 2026-10-22; Basili, Caldiera, Rombach 1994 (GQM).

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

