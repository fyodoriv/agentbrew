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

- [ ] Prune dropped source dirs for project Agentfiles
  - **ID**: prune-project-agentfile-source-dirs
  - **Tags**: scout, agentfile, state
  - **Details**: Scouted while shipping `prune-stale-agentfile-source-dirs`. Pruning of owned `commands:` and `agents:` dirs only runs for authoritative applies (global Agentfile and `sync --agentfile`). The project Agentfile applied from the working directory is additive, so a moved path there stays in state. Decide whether owner-scoped pruning is safe for project applies, since a repo may be checked out in several places.
  - **Files**: src/agentfile-apply.ts, src/sync-runner.ts
  - **Acceptance**: A regression test moves a `commands:` path in a project Agentfile and proves the old dir is removed, or the task is closed with a documented reason.

- [ ] Drop dead Cat B model fields from the hook decision log
  - **ID**: hook-log-decision-drop-cat-b-fields
  - **Tags**: scout, hooks, dead-code
  - **Details**: The LLM verifier tier is retired, so nothing sets `HOOK_MODEL` or `HOOK_PROMPT_VERSION` any more. `hooks/lib/log-decision.sh` still reads both and documents `model` and `promptVersion` as "Cat B only". Also confirm that `agentbrew sync` prunes stale deployed copies of the retired verifier scripts under `~/.claude/codeassist/hooks-scripts/`, and add a test if it does not.
  - **Files**: hooks/lib/log-decision.sh, src/hooks/deploy.ts
  - **Acceptance**: (1) `log-decision.sh` has no model or promptVersion handling; (2) a test shows a deploy run removes deployed scripts that no manifest entry references.

- [ ] Rules source hygiene auto-repair is covered by a fixture-backed real-e2e scenario
  - **ID**: rules-source-hygiene-real-e2e
  - **Tags**: scout, rules, drift, real-e2e
  - **Details**: Scouted while adding marker-managed Agentfile rules and `agentbrew rules dedupe`. The new source-drift path is covered by unit tests (`rules-hygiene`, `drift`, `repair`, `rules-sync`), but the full `status --fix` behavior is not covered by a sandbox scenario that exercises the CLI end-to-end. The gap matters because `npm run verify` caught one missing partial mock only in the full suite; a fixture-backed scenario would catch future wiring regressions without depending on brittle mocks.
  - **Files**: `real-e2e/scenarios/*rules*.test.ts`, `real-e2e/fixtures/**`, `src/real-e2e/scenario-fixture.ts`, `src/drift-checks/rules.ts`, `src/sync/rules-sync.ts`
  - **Acceptance**: A real-e2e scenario seeds duplicate blocks in `~/.config/agentbrew/shared-rules.md`, runs `agentbrew status --fix` (or the scenario helper equivalent), proves the source file is deduped, proves managed agent rules are redeployed from the cleaned source, then proves a second status run has no `rules-source` drift.
  - **Hypothesis**: Exercising duplicate source rules through the same CLI path users run will catch wiring regressions that isolated unit tests and mocks can miss.
  - **Success**: `npm run test:real-e2e:selected -- <rules-source-hygiene-scenario>` exits 0 and fails if `dedupeSharedRulesFile()` is no longer called before rules sync in `fix()`.
  - **Pivot**: If the existing real-e2e harness cannot mutate `shared-rules.md` safely, add an integration test under `src/integration-essential-core.test.ts` using a temporary HOME instead.
  - **Measurement**: The selected scenario reports one failing assertion before removing the `fix()` dedupe call and passes after restoring it.
  - **Anchor**: VISION.md G5 (drift detection + auto-repair), docs/user-stories/06-drift-detection.md (auto-repair only touches managed content), docs/user-stories/04-share-rules.md (one shared-rules source of truth).
- [ ] Agentfile apply tests mock the state getters with non-copy semantics
  - **ID**: agentfile-apply-test-getter-fidelity
  - **Tags**: scout, agentfile, tests
  - **Details**: Scouted while fixing `agentfile-authoritative-apply-drops-new-entries`. Many tests in `src/agentfile-apply.test.ts` stub `getStateServers` / `getStateSources` with fixed arrays that do not mirror the real shallow-copy behavior, which hid the lost-addition bug. One test returns an empty list while state holds a server. Replace the per-test stubs with a shared faithful default and keep the stub only where a test needs divergence.
  - **Files**: `src/agentfile-apply.test.ts`
  - **Acceptance**: The `vi.mock("./agentfile.js")` factory defaults the two getters to the real copy behavior, and the suite stays green.
  - **Hypothesis**: Mocks that return the same array on every call hide mutation bugs; copy-semantics mock defaults make the suite catch them.
  - **Measurement**: `npx vitest run src/agentfile-apply.test.ts`, then again with a deliberate `push()` into a getter result inside `applyAgentfile`.
  - **Pivot**: If copy-semantics defaults force rewrites of more than five unrelated tests, apply them only to new tests and note why.
  - **Anchor**: Meszaros 2007, *xUnit Test Patterns* (test double fidelity).

- [ ] Stop the authoritative Agentfile apply from pruning sources that back Agentfile skills
  - **ID**: agentfile-apply-keeps-skill-sources
  - **Tags**: scout, sync, agentfile
  - **Details**: Scouted while fixing `sync-pull-agentfile-skill-installs`. The authoritative apply drops every non-team source the Agentfile `sources:` list omits, including catalog-derived sources that back skills named in `skills:`. `sync` and `sync --pull` now re-add them by installing the skills straight after the apply. State still loses those sources briefly, and any caller that applies without the install step drops them for good.
  - **Files**: `src/agentfile-apply.ts` (mergeAgentfileSources)
  - **Acceptance**: an authoritative apply keeps a source whose installed skills the Agentfile requests. A test in `src/agentfile-apply.test.ts` pins it.
  - **Hypothesis**: Keeping sources that back Agentfile `skills:` entries stops an authoritative apply from deleting skills the user declared.
  - **Measurement**: A test in `src/agentfile-apply.test.ts`: an Agentfile lists a skill whose source is not in `sources:`; after an authoritative apply the source and skill remain.
  - **Pivot**: If apply cannot map a skill to its source, require the source in `sources:` and print a warning naming the skill instead.
  - **Anchor**: agentbrew VISION.md (the Agentfile is the declared state; sync must not remove what it declares).

- [ ] Wire the advertised `agentbrew skills validate` command to the existing skill validator
  - **ID**: wire-skills-validate-command
  - **Tags**: scout, cli, validation, correctness, skill-eval, P1
  - **Details**: While authoring the workflow/debugging eval batch on 2026-06-04, `npm run dev -- skills validate --help` showed only the `coverage` subcommand, but multiple user-facing diagnostics still tell users to run `agentbrew skills validate`: `src/drift-checks/skills.ts:104`, `src/health.ts:170`, and related tests. The validator already exists in `src/skills/validate.ts` and display code exists in `src/skills/skill-validate-display.ts`; the missing piece is CLI registration under `agentbrew skills validate`.
  - **Files**: `src/commands/cli-skills.ts`, `src/skills/validate.ts`, `src/skills/skill-validate-display.ts`, `src/drift-checks/skills.ts`, `src/health.ts`, tests under `src/skills/` or `src/commands/`.
  - **Acceptance**: `npm run dev -- skills validate --help` documents a validate subcommand; `npm run dev -- skills validate --builtins` or the chosen equivalent exits 0 on current built-ins and renders the existing validation display; diagnostics that say "Run: agentbrew skills validate" point to a command that actually exists; `npm run verify` passes.
  - **Output**: code
  - **Hypothesis**: Every printed hint should name a command that exists; today `agentbrew skills validate` is a dead end.
  - **Measurement**: `rg -n "skills validate" src` lists every hint; `npx tsx src/cli.ts skills validate --help` (or the replacement named in the hints) exits 0.
  - **Pivot**: If the validator duplicates `skills coverage`, point the hints at `skills coverage` and do not add a command (AGENTS.md rule 9).
  - **Anchor**: AGENTS.md rule 9 (keep the CLI small); Nielsen 1994, heuristic "help users recognize, diagnose, and recover from errors".

## P2

- [ ] `iterate` and `markdown-for-gdoc` SKILL.md files load no more than their baselines
  - **ID**: trim-iterate-and-markdown-for-gdoc-skills
  - **Tags**: skill-bloat, context-budget, skills
  - **Details**: The agent-bloat lint reports `skill-plugins/workflow/iterate/SKILL.md` at ~1,978 tokens (baseline 1,421) and `skill-plugins/workflow/markdown-for-gdoc/SKILL.md` at ~4,570 (baseline 2,935). Both grew when dev-skills was absorbed (#21). Until 2026-10-15 the lint passed only because an unrelated orphan block in TASKS.md contained the word `context-budget`. Move rarely-needed detail into each skill's `references/`, or re-baseline with a stated reason.
  - **Files**: `skill-plugins/workflow/iterate/SKILL.md`, `skill-plugins/workflow/markdown-for-gdoc/SKILL.md`, `docs/skill-baselines.json`
  - **Acceptance**: `npx vitest run src/agent-bloat-lint.test.ts` passes with this task removed from TASKS.md.
  - **Hypothesis**: Moving detail into `references/` cuts always-loaded skill tokens without losing behavior.
  - **Measurement**: `npx vitest run src/agent-bloat-lint.test.ts` and the skills' eval files.
  - **Pivot**: If a skill's evals fail after the move, re-baseline that skill with the reason in `docs/skill-baselines.json` instead.
  - **Anchor**: agentbrew agent-bloat lint (`src/agent-bloat-lint.ts`); Anthropic skill authoring guidance on progressive disclosure.

- [ ] A PreToolUse hook blocks cross-repo publishing without per-session approval
  - **ID**: enforce-cross-workspace-publish-hook
  - **Tags**: scout, hooks, guardrail
  - **Details**: The cross-workspace publishing rule is prose in `templates/AGENTS.md`. dotfiles `bin/gh` already blocks `gh pr create` to another repo without `AGENT_PUBLIC_WRITE_APPROVAL`, but only when the wrapper is on PATH. Add a deterministic hook that blocks, before the shell runs: `gh pr create --repo <other>`, `gh repo fork`, and `git push` to a remote outside the session's workspace roots. Model it on `no-force-push-protected`. Merges the dotfiles task `gh-cross-repo-pr-approval-hook` (2026-10-15 review).
  - **Files**: `hooks/checks/no-cross-workspace-publish.sh` (+ `.test.sh`), `hooks/manifest.yaml`, dotfiles `bin/gh` (reference only; stays as the shell backstop)
  - **Acceptance**: fixtures show each of those commands blocked outside the workspace without the approval token and allowed inside it; dotfiles `tests/gh-wrapper.bats` stays green.

- [ ] `agentbrew install --args` keeps a `-y` meant for the MCP command
  - **ID**: install-mcp-env-sanitize-strips-vars-and-y-flag
  - **Tags**: scout, mcp, install, cli
  - **Details**: `agentbrew install` registers `-y, --yes` (`src/commands/cli-install.ts`) and a variadic `-a, --args`. In `--args "--registry" "<url>" "-y" "@pkg"`, Commander binds `-y` to the top-level `--yes` and ends the variadic list, so the deployed args lose `-y` and `npx` prompts on every MCP start. The `${VAR}` half of the original report concerned Devin's literal env format; Devin support was removed on 2026-10-08, so only the `-y` half remains. README documents the `--` form as the workaround.
  - **Files**: `src/commands/cli-install.ts`, `src/commands/cli-install.test.ts`, README.md (install section)
  - **Acceptance**: `agentbrew install x --command npx --args "-y" "pkg"` either keeps `-y` in the deployed args or prints a one-line warning naming the `--` form; a parser test covers it.

- [ ] Make companion competitor watch honor repo-specific competition directory names
  - **ID**: companion-competitor-watch-competition-dir-drift
  - **Tags**: docs, skills, companion, competitor, P1
  - **Hypothesis**: Teaching the lane to discover `docs/competition/` as well as `docs/competitors/` prevents it from creating a parallel stale competitor corpus in repos like agentbrew.
  - **Success**: In a repo that has `docs/competition/` and no `docs/competitors/`, the skill refreshes or reports the existing competition corpus instead of creating a competing directory.
  - **Pivot**: If cross-repo naming is too varied for heuristics, make the competitor-doc directory a required flag or project config field.
  - **Measurement**: `grep -n "docs/competition" skill-plugins/workflow/companion-competitor-watch/SKILL.md`
  - **Anchor**: agentbrew VISION.md G1 "Curate, not host" + companion-competitor-watch SKILL.md "Identify competitors" / "Where they live".
  - **Details**: The current skill repeatedly names `docs/competitors/<NAME>.md`, but this repo's canonical competitor corpus is `docs/competition/*.md`. Running the lane as written can create a second directory and split prior art away from the docs the PR template and competitor-spot-check flow already read.
  - **Files**: `skill-plugins/workflow/companion-competitor-watch/SKILL.md`, `docs/competition/`, `TASKS.md`.
  - **Acceptance**: The skill documents how to detect `docs/competition/` vs `docs/competitors/`, its task template links to the detected directory, and a dry-run in this repo does not propose creating `docs/competitors/`.

- [ ] Clear the last dev-dependency audit finding (node-forge via promptfoo)
  - **ID**: dev-dependency-audit-findings
  - **Tags**: security, dependencies, stability
  - **Details**: `npm audit --omit=dev` is clean, so the published package is not affected. After the 2026-10-12 bump of promptfoo, vitest, and a `basic-ftp` override, the only open dev-only finding is `node-forge` (high, no patched release; reached through `promptfoo` > `jks-js`). Re-run `npm audit` when node-forge, jks-js, or promptfoo ships a fix, then bump. If promptfoo drops `jks-js`, remove the dependency path instead.
  - **Files**: package.json, package-lock.json
  - **Acceptance**: (1) `npm audit` reports no high findings; (2) `npm ci` works with npm 11; (3) lint, build, and the full test suite pass.

- [ ] Make the official MCP Registry the default catalog lookup when it reaches 1.0
  - **ID**: flip-catalog-to-registry-first-at-ga
  - **Tags**: delegate, mcp, catalog, upstream
  - **Details**: `AGENTBREW_MCP_REGISTRY=1` turns on the read-only registry resolver (`src/adapters/mcp-registry.ts`). It stays opt-in because the registry API is still `v0`. When `registry.modelcontextprotocol.io` ships a stable 1.0/GA API, turn the lookup on by default (keep the local catalog override and the offline fallback), and move hand-curated public MCP pointers out of `src/catalog.yaml` where the registry has them.
  - **Files**: src/adapters/mcp-registry.ts, src/catalog/install.ts, src/catalog.yaml, README.md, docs/competition/official-mcp-registry-vs-agentbrew.md
  - **Acceptance**: with no env var set, `agentbrew install <registry-only server>` resolves from the registry; catalog entries still win; offline still falls back with one warning.
  - **Hypothesis**: a stable registry lets agentbrew stop curating public MCP pointers by hand, so hand-maintained `mcp_servers` entries in `src/catalog.yaml` drop for every server the registry covers.
  - **Success**: the lookup is on by default and the public catalog MCP entries that the registry covers are removed from `src/catalog.yaml`.
  - **Pivot**: if the registry stays `v0` or its data misses install metadata the catalog needs, keep the flag opt-in and close this task with the reason.
  - **Measurement**: the registry API version at `https://registry.modelcontextprotocol.io/`, and `yq '.mcp_servers | length' src/catalog.yaml` before and after.
  - **Anchor**: docs/competition/official-mcp-registry-vs-agentbrew.md; VISION G1 (curate, not host).

- [ ] Make every `gh-pr-*` hook act only on a real `gh pr` command, so quoted mentions stop tripping them
  - **ID**: gh-pr-hooks-command-position
  - **Tags**: scout, hooks, false-positive
  - **Details**: `gh-pr-body-requires-docs` and `gh-pr-body-requires-validation` now match `gh pr create|edit` only in command position and read multi-line heredoc bodies. The six other `hooks/checks/gh-pr-*.sh` scripts (share the matcher through `hooks/lib/gh-pr-body-from-command.sh`) (and `env-correct-urls.sh`, `manual-test-steps-start-at-app-url.sh`) still match the words anywhere in the command, so an `echo` or a Python string that mentions them is checked as a PR. Move the command-position regex and the heredoc fallback into `hooks/lib/` and use it in every PR hook.
  - **Files**: hooks/checks/gh-pr-*.sh, hooks/lib/, their `.test.sh` fixtures
  - **Acceptance**: each PR hook passes an echoed mention and still blocks a real `cd x && GH_HOST=… gh pr create` with a bad body; fixtures cover both.
  - **Hypothesis**: false PR-hook blocks on commands that only mention `gh pr` drop to zero once every PR hook shares the command-position check.
  - **Success**: every `gh-pr-*` fixture has an "echoed mention passes" case, and all pass in `bash scripts/run-hook-fixtures.sh`.
  - **Pivot**: if a hook needs the old anywhere-match to catch a real bypass, keep that hook as is and document why.
  - **Measurement**: `bash scripts/run-hook-fixtures.sh`; the count of `bypass … not gh pr` versus `block` decisions in `~/.cache/agentbrew/hook-decisions.jsonl`.
  - **Anchor**: Google SRE book ch. 6 (alerts that fire on non-problems erode trust); agentbrew AGENTS.md rule 1.

- [ ] Show deferred-for-load heal state in the health snapshot
  - **ID**: snapshot-record-heal-deferred-for-load
  - **Tags**: scout, mcp, heal, snapshot
  - **Details**: The heal cycle now logs when it defers timeout heals under high load, but the snapshot does not record it. `agentbrew status` cannot tell a deferred timeout from a timeout that was never considered for healing. Add an optional field to the snapshot entry and show it in status.
  - **Files**: `src/mcp/heal-cycle.ts`, `src/mcp/health-snapshot.ts`, `src/mcp/health-snapshot.test.ts`
  - **Acceptance**: a deferred timeout appears in the snapshot with a deferred marker, and a test covers it.

- [ ] Give machines without a GitHub launcher a maintained GitHub MCP server
  - **ID**: github-mcp-maintained-server-without-launcher
  - **Tags**: scout, mcp, github, catalog
  - **Details**: `src/mcp/mcpm-hygiene.ts` treats `@modelcontextprotocol/server-github` as deprecated and swaps it for a local `*-github-mcp` launcher. A machine with no launcher now keeps the deprecated npm package, because swapping in a missing path broke the server everywhere. The package is archived upstream. Point the catalog `github` entry at the maintained GitHub MCP server instead, so a machine without a launcher still gets a supported server.
  - **Files**: src/catalog.yaml, src/mcp/mcpm-hygiene.ts, src/mcp/mcpm-hygiene.test.ts
  - **Acceptance**: on a machine with no launcher, `agentbrew mcp probe` passes for `github` in every agent, and the deployed entry no longer names `@modelcontextprotocol/server-github`.

- [ ] Surface Claude Desktop MCP startup failures in `agentbrew status`
  - **ID**: status-surface-claude-desktop-mcp-failures
  - **Tags**: scout, mcp, claude-desktop, status, plugins
  - **Details**: `agentbrew status` and `collectDrift` now list Claude Desktop
    startup failures (invalid config entries and failed server connects) from
    the latest Desktop start in `~/Library/Logs/Claude/main.log`, each with a
    fix path. Two parts remain. First, `agentbrew status --ci` exists, but `healthCheck` (`src/health.ts`) never calls `checkClaudeDesktopMcpDrift`, so its exit code ignores Desktop MCP failures;
    so nothing exits 1 on these failures yet; add the flag and the exit code,
    with a clean log and a missing log both exiting 0. Second, the prisma
    plugin break (`npx -y prisma mcp` resolves to a release with no `mcp`
    command) should be reported upstream so the plugin pins `prisma@7`; that
    report is a public write and needs explicit operator approval first.
  - **Files**: `src/cli.ts`, `src/status.ts`, `docs/user-stories/25-status-and-health.md`
  - **Acceptance**: `agentbrew status --ci` exits 1 when the latest Desktop
    start logged an invalid-entry or connect-failure line, and exits 0 with a
    clean or missing log.

- [ ] Measure plain-language output across managed agent surfaces
  - **ID**: measure-plain-language-output-across-managed-agents
  - **Tags**: scout, prompts, accessibility, rules, quality
  - **Details**: The new global plain-language rule has deterministic coverage
    for its presence in shared rules, the instruction template, and the
    always-applied Cursor rule. That proves deployment, not behavior. Add a
    small sampled evaluation that checks chat, documentation, PR, code-comment,
    and skill-wrapper output from each primary agent. Record whether each output
    uses plain, short, active sentences and follows the applicable
    outcome-first or code-comment brevity rule. Keep the evaluator generic and
    opt-in. Do not add a hosted scoring service.
  - **Files**: `agent-artifact-evals/`, `docs/testing-agent-artifacts.md`,
    `README.md`
  - **Acceptance**: One repeatable evaluation runs against chat,
    documentation, PR, code-comment, and skill-wrapper fixtures for Claude
    Code, Cursor, and Codex. The report identifies a failing
    output and its rule gap. `npm run verify` remains deterministic and does
    not require a live model.

- [ ] Remove stale references to deleted Jira workflow skills
  - **ID**: remove-stale-deleted-jira-skill-references
  - **Tags**: scout, skills, docs, jira, referential-integrity
  - **Details**: Scouted while adding the product-doc/Jira reconciliation protocol. The 2026-07 shrink removed `jira`, `jira-task`, and `find-jira-task`, but remaining built-in skills, plans, and global guidance still name them as callable dependencies. This violates the referential-integrity rule and can route agents to missing skills. Audit every reference, replace it with a currently installed source skill or MCP-backed workflow, and keep org-only Jira content in the team overlay.
  - **Files**: `skill-plugins/workflow/project-audit/SKILL.md`, `skill-plugins/workflow/task-command-center/evals/evals.json`, `docs/shared-rules.md` (also loads a missing `pr` skill), `docs/plans/cover-jira-skill-with-2134-tests.md`
  - **Acceptance**: Every active reference to `jira`, `jira-task`, or `find-jira-task` resolves to an installed catalog/source skill or is replaced with a valid MCP/repo workflow; historical changelog/task text remains untouched; `npm run verify` passes.

- [ ] Extract shared helpers for the skill contract tests
  - **ID**: extract-shared-2134-skill-contract-test-helpers
  - **Tags**: p2, skills, tests, deterministic-tests, scout
  - **Details**: `requireTerms`, `expectationText`, and `evalMatching` are redefined in almost every `src/skills/*-contract.test.ts` spec. Move them into one shared test helper module.
  - **Files**: src/skills/*contract.test.ts, optional src/skills/skill-contract-test-helpers.ts
  - **Acceptance**: At least two `src/skills/*-contract.test.ts` specs import the shared helper; failure messages still name the missing term or scenario.

- [ ] Users can see default-model drift in `agentbrew status` before repair
  - **ID**: model-drift-check-in-status
  - **Tags**: scout, models, drift, status
  - **Details**: `model-sync.ts` reapplies the Agentfile's `defaultModel` on every sync/auto-repair tick, but `agentbrew status` / `collectDrift()` does not report a manually flipped model as drift — the repair is silent. Add a `models` drift check so a changed model shows in the Drift summary (and counts toward `--ci` exit codes) instead of only being healed invisibly.
  - **Files**: `src/drift-checks/` (new models check), `src/health.ts`, `src/sync/model-sync.ts`
  - **Acceptance**: with `defaultModel` set and an agent's config manually flipped to another model, `agentbrew status` shows 1 drift issue naming the agent and the expected model; `agentbrew status --fix` repairs it.
  - **Output**: code

- [ ] Default-model parity for Cursor (G6 gap — no file surface today)
  - **ID**: model-default-parity-cursor
  - **Tags**: scout, models, parity, cursor
  - **Details**: The model surface ships for claude-code and codex but Cursor has no declarative surface: Cursor stores the model in app-managed account state (`~/.cursor/cli-config.json`'s `model` object is written by the app; `cursor-agent models` is account-gated) and Windsurf picks the model per-conversation in the Cascade UI with no public config file. Per VISION G6 a sync surface that skips primary agents needs a tracked gap. Follow the delegate→contribute path: file/locate upstream feature requests for a config-file default-model setting in both products, link them here, and revisit quarterly with the competitor sweep. If a surface appears, extend `modelConfig` in agents.yaml and delete the N/A comment in `per-agent-features.matrix.test.ts`.
  - **Files**: `src/core/agents.yaml`, `src/sync/per-agent-features.matrix.test.ts`, `RECURRING.md`
  - **Acceptance**: either (a) Cursor gains `modelConfig` entries backed by a documented upstream setting, or (b) upstream issue links are recorded here and the matrix-test comment cites them.
  - **Output**: code

- [ ] Add CLI parser coverage for `agentbrew install --recommended --dry-run`
  - **ID**: cli-install-recommended-dry-run-parser-coverage
  - **Tags**: scout, tests, cli, dry-run
  - **Details**: While fixing `install-recommended-dry-run-propagation`, `src/commands/cli-install.test.ts` had separate coverage for `install --recommended` and named `install <name> --dry-run`, but no assertion for the combined `install --recommended --dry-run` shape. The catalog-layer regression test now protects mutation behavior, but the CLI parser should also lock that both flags are forwarded together and autoSync stays skipped.
  - **Files**: `src/commands/cli-install.test.ts`, `src/commands/cli-install.ts`
  - **Acceptance**: A CLI test parses `["node", "test", "install", "--recommended", "--dry-run"]`, asserts `install(undefined, { recommended: true, dryRun: true, ... })`, and asserts `autoSync` is not called.
  - **Output**: code

- [ ] Enforce a fixture test per `hooks/checks/*.sh` (coverage gate)
  - **ID**: hooks-fixture-coverage-gate
  - **Tags**: scout, hooks, test-coverage, feedback-loop
  - **Details**: `scripts/run-hook-fixtures.sh` runs whatever `hooks/checks/*.test.sh` exist but nothing enforces that EVERY check script has one. Add a gate (extend `run-hook-fixtures.sh`, or a vitest in `src/oss/` / `src/sync/`) that fails when a `hooks/checks/<id>.sh` has no sibling `<id>.test.sh`. Per the feedback-loop principle (linters enforce, instructions suggest) this makes the Phase-1 discipline mechanical so a future hook can't merge testless.
  - **Files**: `scripts/run-hook-fixtures.sh` (or a new `src/sync/hooks-fixture-coverage.test.ts`)
  - **Acceptance**: adding a `hooks/checks/foo.sh` with no `foo.test.sh` fails `npm run verify`; the message names the missing fixture.

- [ ] Reconcile manifest `verdict: mutate` vs `verdict_warn` for the two attribution hooks
  - **ID**: hooks-attribution-verdict-mutate-vs-warn
  - **Tags**: scout, hooks, manifest, consistency
  - **Details**: `hooks/manifest.yaml` declares `verdict: mutate` for `gh-pr-body-attribution` and `git-strip-agent-attribution`, but both scripts actually call `verdict_warn` (exit 0 + stderr) — the real attribution rewrite happens downstream in dotfiles `bin/gh` + `git-hooks/commit-msg`, not in the hook. The manifest field is misleading. Either (a) change the manifest verdict to `warn` and document that the mutation is delegated downstream, or (b) implement real PostToolUse mutate via `verdict_mutate`. Surfaced while writing the Phase-1 fixtures (the tests assert exit 0 + stderr, matching the actual `warn` behavior).
  - **Files**: `hooks/manifest.yaml` (entries) and/or the 2 scripts; update their `.test.sh` if behavior changes.
  - **Acceptance**: the manifest `verdict` field matches the script's actual verdict function for both hooks.

- [ ] Make competitor spot-check support an explicit repo root for cwd-constrained agents
  - **ID**: competitor-spot-check-explicit-repo-root
  - **Tags**: bug, dx, pr-vision-trace, skill-quality
  - **Details**: The `competitor-spot-check` helper currently assumes the process cwd is the target repo root. In terminal sandboxes where `cd` is blocked or the shell cwd is stale, the helper can scan the wrong repo and produce an invalid PR-body prior-art line. Add an explicit repo-root option or documented invocation pattern so agents can target the intended repository deterministically.
  - **Files**: `templates/scripts/competitor-spot-check.sh`, `skill-plugins/dev/competitor-spot-check/SKILL.md`, `src/sync/helper-scripts-behavior.test.ts`
  - **Acceptance**: An agent can invoke the spot check for a repo by absolute path without changing shell cwd; the skill docs show the explicit-root form; a regression test or documented smoke case covers scanning a non-cwd repo.

<!-- Nested catalog skill install shipped 2026-06-11 (fix/nested-skill-cache-lookup:
     copySkillFromCache/findSkillDirInCache deep-scan resolves anthropics/trailofbits/ext-apps plugin layouts.
     Closes sync --pull "not found in source" for build-mcp-server, semgrep, create-mcp-app, etc. -->

- [ ] Check test-first at commit time: behavior changes ship with a test diff
  - **ID**: adopt-rule-3-doc-first-discipline
  - **Tags**: scout, rules, tests
  - **Details**: The doc-first half already runs: `npm run lint:rules` uses Minsky's `check-rule-3-doc-first.mjs` (`src/adapters/rule-lint.minsky.ts`). The test-first half has no check. Add one that runs in `npm run verify` (GitHub Actions is off): a diff that changes `src/**` non-test files must also change a test file, or carry a `Test exemption: <reason>` line in the commit message.
  - **Files**: `scripts/check-rule-3-test-first.mjs` (new), `package.json` (verify), `src/adapters/rule-lint.ts`
  - **Acceptance**: `npm run verify` fails on a branch that changes `src/foo.ts` with no test diff and no exemption line, and passes with either.

- [ ] Extend skill validator to accept verified Claude Code frontmatter fields (effort, shell, when_to_use)
  - **ID**: skill-validator-claude-effort-shell-fields
  - **Tags**: scout, skill-validator, claude-frontmatter, docs/research/claude-code-undocumented-config.md
  - **Details**: The skill validator in `src/skills/validate.ts` currently flags `effort`, `shell`, and `when_to_use` as "unknown frontmatter fields". Binary verification against Claude Code 2.1.138 confirms these are real fields: `effort` (low/medium/high/max), `shell` (for shell-specific skills), and `when_to_use` are present in the embedded string literals. Extend the validator's frontmatter schema to accept these fields as valid instead of emitting warnings.
  - **Files**: `src/skills/validate.ts`, `src/skills/validate.test.ts`
  - **Acceptance**: `agentbrew skills validate` on a skill with `effort: medium`, `shell: true`, or `when_to_use: ...` passes without "unknown field" warnings.

- [ ] Preserve Agentfile hook targeting and verified Claude Code control fields
  - **ID**: agentfile-hooks-async-rewake-control-fields
  - **Tags**: scout, agentfile, hooks, claude-frontmatter, docs/research/claude-code-undocumented-config.md
  - **Details**: The `ManagedHook` and `ClaudeHookItem` types in the Agentfile schema currently drop the verified Claude Code hook control fields: `async`, `asyncRewake`, `once`, `if`, `statusMessage`. Binary verification confirms these are real fields in Claude Code 2.1.138: `asyncRewake` runs in background but exits 2 wakes the model and blocks; `once` fires once then auto-removes. `AgentfileHookEntry` has no `agents` field, so a machine manifest cannot scope lifecycle hooks to compatible agents. Preserve both the control fields and `agents` through parse, merge, state, and native sync.
  - **Files**: `src/agentfile.ts`, `src/types.ts`, `src/sync/hooks-sync.ts`, `src/agentfile.test.ts`, `src/sync/hooks-sync.test.ts`
  - **Acceptance**: An Agentfile with `hooks: [{ agents: [claude-code], asyncRewake: true, once: true }]` parses and syncs without type errors or dropped fields, and other detected hook targets do not receive that entry.

- [ ] Restore agentbrew release automation and npm authentication
  - **ID**: restore-agentbrew-release-automation
  - **Tags**: release, github-actions, npm, human-blocked
  - **Details**: The Auto-release workflow did not run after the merged delivery. `github.com/fyodoriv/agentbrew` is now the only canonical home, and GitHub Actions is disabled there. The documented manual fallback was blocked by `npm whoami` returning `ENEEDAUTH`. The workflow already has a `workflow_dispatch` fallback. Release stays blocked until Actions is enabled on `fyodoriv/agentbrew` (or a reviewed manual release path exists) and npm credentials are available. See `docs/human-blocked-actions/agentbrew-release-auth-2026-07-20.md`.
  - **Files**: `.github/workflows/auto-publish.yml`, `scripts/publish-latest.sh`, `docs/human-blocked-actions/agentbrew-release-auth-2026-07-20.md`
  - **Acceptance**: The owner runs `npm run publish:latest` in a real terminal (browser 2FA needs a TTY); afterwards the git tag, npm `latest`, and `package.json` version match. GitHub Actions stays off, so no workflow step is required.
  - **Blocked**: needs-owner-tty — npm publish needs the owner's browser 2FA in a real terminal; agents cannot run it.

- [ ] Pin each Mode 1 browser session to its own tab, so agents that share one Chrome stop driving each other's tabs
  - **ID**: agent-browser-cdp-tab-hijack-prevention
  - **Tags**: scout, agent-browser, mode-1, browser-rules, devx
  - **Details**: Two agents attached to the same purpose Chrome over CDP can act on each other's tabs. On 2026-05-21 one agent ran `snapshot` and got the page that another agent had just opened, because every `--cdp` client acted on Chrome's active tab. This task stayed blocked because the fix had to land in `vercel-labs/agent-browser`. Upstream has since shipped it: `agent-browser --pin-tab` (or `AGENT_BROWSER_PIN_TAB=1`) binds a session to its own tab, and commands fail with `tab_gone` instead of falling back to another tab (checked on agent-browser 0.39.0, which ships `--pin-tab`). The Mode 1 snippet in `templates/rules/browser-tasks.mdc` still runs `connect`, `tab new`, and `open` without a pin, so agents do not use the fix. Add `--pin-tab` and a stable per-agent `--session` to the Mode 1 snippet, add the same one-line rule to `docs/shared-rules.md` § "Browser and web UI work", and prove that two concurrent sessions stay on their own tabs.
  - **Files**: `templates/rules/browser-tasks.mdc`, `docs/shared-rules.md`, and any rules-sync test that pins the snippet text
  - **Acceptance**: The Mode 1 snippet pins its session with `--pin-tab`. Two parallel shells attached to the same CDP port each `open` a different URL, and each `get url` returns its own target.
  - **Hypothesis**: Pinning each Mode 1 session to its own tab removes cross-agent tab hijacks on a shared purpose Chrome.
  - **Success**: 10 of 10 paired runs of two concurrent pinned sessions show no cross-contamination.
  - **Pivot**: If `--pin-tab` does not hold under concurrent `connect`, use one Chrome per purpose per agent instead and record why.
  - **Measurement**: `grep -c -- '--pin-tab' templates/rules/browser-tasks.mdc` reads 1 or more, and a two-shell script that opens `https://example.com` and `https://example.org` on one CDP port gets a matching `get url` in each shell in 10 of 10 runs.
  - **Anchor**: VISION.md § "Strategy: delegate, contribute, absorb" (upstream shipped the fix, so adopt it); Chrome DevTools Protocol `Target.attachToTarget`.
  - **Output**: docs

- [ ] Make `grind` and `sweep` honor the task-backend contract, so an issues-backed repo never gets a TASKS.md back
  - **ID**: ghi-repoint-core-task-skills
  - **Tags**: github-issues-task-backend, skills, grind, sweep
  - **Details**: agentbrew owns the task-backend contract: `src/core/task-backend.ts`, the `detect-task-backend` skill, and `src/integrations/gh-issues.ts`. Most consumers already branch on it: `next-task` (tasks.md repo), `project-audit`, `to-issues`, the `companion-*` skills, and `load-project-context`. The two loop skills in `skill-plugins/workflow/` do not. `grind/SKILL.md` and `sweep/SKILL.md` mention the backend 0 times; `grind` says "Every commit must correspond to a TASKS.md task", and `sweep` drains every finding into `TASKS.md` P3. In a repo that declares `task_backend: github-issues`, they would recreate TASKS.md, which `templates/AGENTS.md` § "Task backend" forbids. Add a first "Detect the task backend" step to both that uses `detect-task-backend`. For `github-issues`: list and claim with `gh issue` (self-assign), file findings with `gh issue create`, and complete with `Closes #N` in the PR. Keep the TASKS.md path unchanged. Both skills now live in `skill-plugins/workflow/` (moved from the former dev-skills repository on 2026-10-07), so the edit lands here.
  - **Files**: `skill-plugins/workflow/grind/SKILL.md`, `skill-plugins/workflow/sweep/SKILL.md`, and their evals
  - **Acceptance**: Both skills document the backend branch. In an issues-backed fixture repo, both file findings as issues and never create TASKS.md. The TASKS.md path behaves as before.
  - **Hypothesis**: A backend-detection step in `grind` and `sweep` stops them from writing TASKS.md in issues-backed repos, so the TASKS.md files they create there drop to 0.
  - **Success**: Both SKILL.md files branch on the backend, and an issues-backed fixture run creates 0 TASKS.md files.
  - **Pivot**: If no agentbrew catalog entry or overlay installs either skill within 90 days, retire both from `skill-plugins/workflow/` instead of re-pointing them.
  - **Measurement**: `grep -l -E 'task_backend|github-issues|detect-task-backend' skill-plugins/workflow/grind/SKILL.md skill-plugins/workflow/sweep/SKILL.md | wc -l` reads 2 (baseline 0, copied verbatim from dev-skills `c539be1`).
  - **Anchor**: `templates/AGENTS.md` § "Task backend"; GitHub docs "Linking a pull request to an issue" (closing keywords).
  - **Output**: docs

## P3

- [ ] Document pressure-eval conventions for skill contract tests
  - **ID**: document-2134-pressure-eval-conventions
  - **Tags**: docs, skills, evals
  - **Details**: Skill eval pressure cases (wrong-tool routing, read-only boundaries, approval gates, refusal of fabrication) are only discoverable by reading each spec. Add a short convention section to `docs/testing-agent-artifacts.md` with examples drawn from the existing specs (detect-task-backend, competitor-spot-check, learn-project, agentbrew-status).
  - **Files**: `docs/testing-agent-artifacts.md`
  - **Acceptance**: the doc names the common pressure-case categories, and each category links to one existing eval in `skill-plugins/**/evals/evals.json`.

- [ ] Extend the dash-pattern hook lint to rg, variable, and unquoted patterns
  - **ID**: hooks-dashdash-lint-coverage
  - **Tags**: scout, hooks, bug-class, robustness
  - **Details**: The `lint-security.sh` check added with `hooks-grep-dashdash-pattern` flags only a quoted literal that starts with `-` after `grep`. It does not see `rg` calls, patterns held in variables, or unquoted patterns. Audit showed none exist today, so this guards future drift only. Consider a ShellCheck rule or a small wrapper before adding more regex.
  - **Files**: `scripts/lint-security.sh`
  - **Acceptance**: A fixture hook script using each missed form fails the lint, and the current hook scripts still pass it.

- [ ] Make catalog MCP pin policy data-driven instead of source-hardcoded
  - **ID**: catalog-mcp-pin-policy-data-driven
  - **Tags**: scout, mcp, catalog, config-drift
  - **Details**: The `tasks-mcp@latest` production failure is now guarded by a catalog-pin sweep, but the package-name mapping lives in source as a narrow allowlist. Move the policy into catalog metadata once another MCP package needs the same treatment so drift detection can reconcile future pinned npm servers without a code change.
  - **Files**: `src/catalog.yaml`, `src/catalog/types.ts`, `src/mcp/catalog-pin-sweep.ts`
  - **Acceptance**: at least one MCP server can declare its npm package identity and pinned-version behavior in catalog data; `sweepCatalogPins()` consumes that metadata without a source-level server allowlist.

- [ ] Show preserved catalog rule blocks in `agentbrew status`
  - **ID**: status-reports-preserved-catalog-rules
  - **Tags**: scout, rules, status, p3
  - **Details**: Refresh now keeps edited or unrecorded catalog rule blocks and only warns during `install --recommended` and `sync`. `agentbrew status` does not list them, so a stale kept block stays invisible until the next install run.
  - **Files**: `src/status.ts`, `src/catalog/install.ts`
  - **Acceptance**: `status --verbose` lists installed catalog rule blocks whose body differs from `src/catalog.yaml`, marked kept or refreshable; a test covers both.

- [ ] Workspace-aware `agentbrew sync` — discover and process per-repo Agentfiles across **one or more workspaces** on one host
  - **ID**: workspace-aware-sync
  - **Tags**: architecture, agentfile, workspace, multi-repo, multi-workspace, curator-not-host
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
  - **Surfaced-by**: Operator multi-workspace setup at `~/apps/` containing 5 workspaces (`tooling`, `acme`, `learning`, `_inventory`, `docs`) as of 2026-05-12. Foundation task in `tasksmd/tasks.md` (workspace-mode-nested-repos) ships the spec + parser + shared config-file surface; this task closes the agentbrew side.

- [ ] Catalog entry for the Minsky observer skill — `agentbrew install minsky-observer` resolves
  - **ID**: catalog-minsky-observer-skill
  - **Tags**: catalog, minsky, observer, curator-not-host
  - **Details**: Surfaced by Minsky's observer-plugin distribution work (PR #493, merged 2026-05-12). The skill lives at `fyodoriv/minsky` under `skill-plugins/observer/minsky/SKILL.md`. Today operators install it by cloning the Minsky repo, running `distribution/install-observer.sh`, then running `agentbrew sync --agentfile ~/apps/tooling/minsky/Agentfile.yaml`. That's three manual steps per machine.

    Per `docs/VISION.md` ("Curator, not host") and `src/catalog.yaml`'s header comment, the right answer is a single `catalog.yaml` entry pointing at the upstream repo, so the operator runs `agentbrew install minsky-observer` and the resolution + symlinking + agent-fan-out is handled by the existing skill-source pipeline.

    Implementation hints (not load-bearing):
    - Add an entry under `skills:` in `src/catalog.yaml` with `name: minsky-observer`, `source: github:fyodoriv/minsky/skill-plugins/observer`, `description: "Observer protocol for the Minsky autonomous runner — watches the loop, safe-heals bounded failures, files draft PRs upstream on escalation"`, `keywords: [minsky, observer, autonomous-coding, supervisor, perrow-1984]`.
    - The `repo_sources:` machinery for fetching + caching to `~/.cache/agentbrew/sources/` already exists (rules-sync uses it); reuse rather than reinvent.
    - If command sources land later, the catalog entry can also declare `commands: ./commands/minsky*.md` so the slash commands install with the skill in one step.
  - **Files**: `src/catalog.yaml`, team overlay `catalog-overlay.yaml` (mention only — Minsky is upstream-public, not team-overlay), `docs/competition/` (if a competition page mentions Minsky), `README.md` if the catalog roster gets a README section.
  - **Acceptance**: (a) `agentbrew install minsky-observer` resolves + downloads the skill from `fyodoriv/minsky`; (b) `agentbrew sync` symlinks `SKILL.md` into every detected agent's `skillsDir`; (c) `agentbrew search minsky` returns the observer entry; (d) the catalog-team overlay is untouched.
  - **Hypothesis**: A single `catalog.yaml` entry for `minsky-observer` will reduce the 3-step manual install to `agentbrew install minsky-observer` (one command, zero git clones).
  - **Success**: `agentbrew install minsky-observer && agentbrew sync` deploys the skill to all agents. `agentbrew search minsky` lists the entry.
  - **Pivot**: If the `repo_sources:` machinery doesn't handle subdirectory skill paths (`skill-plugins/observer/`), the skill needs a top-level `SKILL.md` pointer in the Minsky repo — file the change upstream rather than patching agentbrew.
  - **Measurement**: `agentbrew install minsky-observer 2>&1 | grep -c 'installed'` returns 1; `ls ~/.claude/skills/minsky/SKILL.md` exists.
  - **Anchor**: agentbrew VISION.md § "Curator, not host"; existing catalog.yaml skill entries as reference pattern.
  - **Surfaced-by**: Minsky observer plugin (fyodoriv/minsky PR #493) — current install path bypasses agentbrew's catalog entirely.

- [ ] Introduce "plugin bundle" catalog primitive — install N catalog items as one unit
  - **ID**: catalog-plugin-bundle-primitive
  - **Tags**: scout, catalog, ecosystem-alignment, ux
  - **Details**: The Claude Code plugin ecosystem (15.9k stars on `anthropics/claude-plugins-official`) has converged on "plugin = installable bundle". A plugin folder contains a `plugin.json` manifest + optional `commands/`, `agents/`, `skills/`, `.mcp.json`, `hooks/`. Users `/plugin install <name>` to get the whole experience. claudepluginhub.com (April 2026): 32,019 active plugins, 282,325 components, 13,151 authors. Skills are 57.2% of components, commands 20.6%, agents 17.0%, MCP servers 2.5%, hooks 2.4%.

  agentbrew's catalog lists catalog items (skills + MCP + rules) (skills + MCP servers + rules). To get "the Frontend Design experience" a user has to know which skills, MCP servers, and rules to install. The ecosystem solved this with the plugin bundle. agentbrew should adopt the same primitive — `src/catalog.yaml` gains a `bundles:` section listing groups of catalog items; `agentbrew install <bundle-name>` installs all members.

  This is NOT skill hosting (agentbrew remains a curator). A bundle is a reference list — it points at existing catalog entries (which themselves point at source repos / upstream registries). The bundle metadata adds: title, description, recommended for (audit-focused / dev-focused / WORKSPACE-specific), members `[skill-id, mcp-id, rule-id, ...]`, optional `recommended_by_default: true` for the Tier 1 set.

  Concrete build:
  - Extend `src/catalog.yaml` schema with `bundles:` section
  - Add `BundleManifest` type to `src/types.ts`
  - Add `agentbrew install <bundle-name>` resolver that fans out to each member's install path
  - Add `agentbrew browse bundles` command
  - Seed with 3-5 starter bundles: `verify-everything` (verification-before-completion + doubt + code-smells-aware + tdd skills), `mcp-essentials` (top 5 MCPs by install volume), `frontend-design`, `dotfiles-aware`
  - Add tests: bundle resolves to existing catalog items, missing member fails loudly, bundle install is idempotent
  - **Files**: src/catalog.yaml (new `bundles:` section), src/types.ts (BundleManifest type), src/catalog/bundle-resolver.ts (new), src/catalog/bundle-resolver.test.ts (new), src/cli.ts (add `install <bundle>` + `browse bundles`), README.md (Bundles section)
  - **Acceptance**: (a) `agentbrew install verify-everything` installs all verification skills in the catalog + relevant rules in one command; (b) `agentbrew browse bundles` lists available bundles with description + member count; (c) bundle members reference existing catalog entries (no skill content duplicated); (d) tests cover happy path + missing-member rejection + idempotent reinstall.
  - **Hypothesis**: Bundles reduce "I want the X experience" from a a small set of command dance to a single command, matching what the Claude Code marketplace, claudepluginhub, and tonsofskills have all converged on.
  - **Success**: `agentbrew install <bundle>` installs every item in a bundle and `agentbrew status` reports the bundle as one unit; a catalog test covers a bundle with a skill, an MCP server, and a rule.
  - **Pivot**: If users prefer hand-picking individual items (the curatorial discipline) and bundles see <10% usage, deprecate the bundle primitive and instead ship "recommended starter pack" docs that list the manual commands.
  - **Measurement**: `node -e "const c = require('js-yaml').load(require('fs').readFileSync('src/catalog.yaml','utf8')); console.log(c.bundles?.length ?? 0)"` returns ≥3; `agentbrew browse bundles --json | jq 'length' ≥ 3`.
  - **Anchor**: `anthropics/claude-plugins-official` README — bundle structure (`commands/`, `agents/`, `skills/`, `.mcp.json`, `hooks/`); claudepluginhub.com April 2026 stats (282,325 components, bundle is the install unit); Claude Code docs https://code.claude.com/docs/en/discover-plugins.md.

- [ ] Document every external dependency in an ARCHITECTURE.md dependency table
  - **ID**: adopt-minsky-adapter-discipline
  - **Tags**: scout, architecture, adapters
  - **Details**: `src/adapters/` now exists (`mcp-registry.ts`, `rule-lint.ts`, `rule-lint.minsky.ts`; #62, #70). New external dependencies go behind an adapter there. What is missing is a machine-checkable dependency table in ARCHITECTURE.md (tool → adapter file or "direct, with reason"), so a swap such as mcpm.sh → MCP Registry has one place to start. Minsky is in maintenance mode, so port only the table check, not its whole rule set.
  - **Files**: ARCHITECTURE.md, `src/docs/` (one docs test for the table), `src/adapters/`
  - **Acceptance**: ARCHITECTURE.md lists every external CLI or service agentbrew calls (skills CLI, mcpm.sh, ai-rules, MCP Registry, Minsky rule lints) with its adapter file or a "direct" reason; a docs test fails when a row points to a missing file.

- [ ] Map every AGENTS.md rule to a lint or an explicit "advisory" label
  - **ID**: establish-vision-constitutional-rules
  - **Tags**: scout, constitution, rules
  - **Details**: AGENTS.md already has numbered, citable rules, and `npm run lint:rules` runs Minsky's rule lints through `src/adapters/rule-lint.minsky.ts` (#62). What is missing is a map from each rule to its enforcement. Add a table to `docs/editing-rules.md`: rule number → the lint, hook, or test that enforces it, or "advisory" with a reason. This absorbs the old rule-10 "deterministic enforcement" task.
  - **Files**: `docs/editing-rules.md`, `AGENTS.md` (link to the table)
  - **Acceptance**: every numbered AGENTS.md rule has a row naming its enforcing check or the word "advisory" plus a reason; a docs test fails when a rule number has no row.

- [ ] Drop the basic-ftp override once get-uri accepts a patched range
  - **ID**: scout-basic-ftp-override-removal
  - **Tags**: scout, dependencies, security
  - **Details**: `package.json` pins `basic-ftp` to 6.2.3 through `overrides` because `get-uri@8` asks for `^5.3.1`, and 5.x has an open denial-of-service advisory. Remove the override when `get-uri` (via `promptfoo` > `proxy-agent`) widens its range to a patched release, so the pin stops hiding upstream drift.
  - **Files**: package.json, package-lock.json
  - **Acceptance**: (1) the `basic-ftp` entry is gone from `overrides`; (2) `npm audit` stays free of high findings from `basic-ftp`.

- [ ] Re-probe only heal-attempted pairs, not every failed pair
  - **ID**: heal-cycle-reprobe-attempted-only
  - **Tags**: scout, mcp, heal, performance
  - **Details**: After this change the re-probe covers every pair that failed the first pass. Pairs that were suppressed or had no heal action cannot change, so their second start is wasted. Limit the re-probe to pairs with a heal attempt, but only if a sync heal is shown not to repair other pairs.
  - **Files**: src/mcp/heal-cycle.ts, src/mcp/heal-cycle.test.ts
  - **Acceptance**: a suppressed failing server starts once per tick; a test covers it.

- [ ] Show the total heal attempt count in `agentbrew status --verbose`
  - **ID**: mcp-status-heal-attempt-count
  - **Tags**: scout, mcp, status
  - **Details**: The snapshot now keeps a capped history plus `healAttemptCount`. Nothing reads the count yet, so an operator cannot see that one pair churns while most attempts are trimmed. Print it for pairs with many attempts.
  - **Files**: src/status.ts, src/status.test.ts
  - **Acceptance**: a pair with more attempts than the history cap shows its total in verbose status; a test covers it.

- [ ] `agentbrew status` names helper scripts that sync kept or could not install
  - **ID**: status-reports-helper-scripts
  - **Tags**: scout, sync, status, helper-scripts
  - **Details**: Scouted while shipping the helper scripts. Sync keeps a file in `~/.config/agentbrew/scripts/` that agentbrew did not write. Only `agentbrew sync --verbose` says so; default sync and `agentbrew status` stay silent, so an old hand-made copy can hide a newer shipped script. Also, `isUserModified` exists twice (`src/sync/agents-sync.ts`, `src/sync/command-sync.ts`), and `src/sync/helper-scripts.ts` has a third ownership check. One helper in `src/manifest.ts` would keep the rule in one place.
  - **Files**: `src/status.ts`, `src/drift-checks/`, `src/sync/helper-scripts.ts`, `src/manifest.ts`
  - **Acceptance**: `agentbrew status --verbose` names each kept or missing helper script with its path, and the three ownership checks share one helper.
  - **Output**: code

- [ ] `check-pr-vision-trace.mjs` checks the PR body when it runs through a symlinked path
  - **ID**: pr-vision-trace-cli-guard-symlink
  - **Tags**: scout, pr-vision-trace, helper-scripts, bug
  - **Details**: Scouted while shipping the helper scripts. The CLI guard compares `import.meta.url` with `file://${process.argv[1]}`. Node resolves symlinks for `import.meta.url` but not for `process.argv[1]`. So `node <dir-with-a-symlink>/check-pr-vision-trace.mjs body.md` prints nothing and exits 0, even for a body with no Vision trace block. A symlinked `~/.config`, or a hand-made symlink to the repo copy, turns the gate into a silent pass. Compare real paths (`pathToFileURL(realpathSync(process.argv[1]))`) instead.
  - **Files**: `scripts/check-pr-vision-trace.mjs`, `src/check-pr-vision-trace.test.ts`
  - **Acceptance**: A test runs the script through a symlinked directory with a body that has no Vision trace block and gets exit 1 with the violation list.
  - **Output**: code

- [ ] Replace the "open each once" hint for a missing command folder with a fix that works
  - **ID**: commands-dir-missing-hint-actionable
  - **Tags**: commands, sync, ux, docs
  - **Details**: When an agent's `commandsDir` is missing, `agentbrew sync` prints "open each once to create it" (`src/sync/command-sync.ts`) and the drift check says "open <agent> once to create it" (`src/drift-checks/commands.ts`). On 2026-09-28 OpenCode and other agents had config folders but no command folder. The apps were not in `/Applications`, so the hint was a dead end. `mkdir -p` on the three `commandsDir` paths plus `agentbrew sync` deployed the commands to the agents that had no command folder. Make the hint name the exact `mkdir -p <commandsDir>` command, or create the folder when the agent's config root already exists.
  - **Files**: src/sync/command-sync.ts, src/drift-checks/commands.ts, their tests
  - **Acceptance**: (1) the hint names the exact folder and a command that creates it; (2) when the agent's config root exists, sync creates the command folder and deploys; (3) tests cover both.
  - **Hypothesis**: Detected agents miss commands only because the folder is missing. Creating it when the config root exists raises command deployment to every detected agent that has a `commandsDir`.
  - **Success**: `agentbrew status --verbose` shows commands deployed to every detected agent that has a `commandsDir`.
  - **Pivot**: If an agent ignores files in the created folder (wrong folder name for its version), stop auto-creating for that agent and fix its `commandsDir` in `src/core/agents.yaml`.
  - **Measurement**: `agentbrew status --verbose 2>&1 | rg -o 'deployed to [0-9]+/[0-9]+ agents'`
  - **Anchor**: Nielsen, "10 Usability Heuristics for User Interface Design", 1994, heuristic 9 (error messages state the problem and suggest a solution).

- [ ] Re-evaluate the update-tooling catalog pointer against a generic upstream workflow
  - **ID**: replace-relocate-update-tooling-catalog-pointer
  - **Tags**: scout, catalog, skills, delegation, dotfiles
  - **Details**: The catalog points to dotfiles for the host-aware `update-tooling` skill because AgentBrew must remain a curator and cannot own machine configuration. Revisit whether an upstream generic tooling-update workflow can safely replace the pointer, or whether the host-specific applied-checkout and LaunchAgent responsibilities remain the reason it belongs in dotfiles.
  - **Files**: `src/catalog.yaml`, `src/catalog/catalog.test.ts`, dotfiles `skills/update-tooling/SKILL.md`
  - **Acceptance**: Record one decision with current evidence: retain the dotfiles pointer because host ownership is unique, contribute a generic portion upstream, or replace the pointer with an upstream source. The catalog must continue to avoid duplicating skill content.

- [ ] Index remaining garrytan/gstack niche skills in catalog.yaml
  - **ID**: index-gstack-niche-skills
  - **Tags**: scout, catalog, skills, curate, p3, landscape-2026-07-06
  - **Details**: `register-superpowers-ce-gstack-sources` indexed gstack sprint-pipeline skills from `garrytan/gstack`; the niche ones remain (iOS suite, design-shotgun/consultation, OpenClaw adapters, pair-agent, gstack-upgrade, etc.). Users can already `agentbrew install garrytan/gstack` to index all skills — this task adds catalog pointers for niche entries users search for by name.
  - **Files**: src/catalog.yaml, CHANGELOG.md, src/catalog/catalog.test.ts
  - **Acceptance**: Remaining high-demand gstack skills have catalog entries with disambiguation text; `npm run verify` passes.

- [ ] Every `gh-pr-*` hook reads PR bodies through one shared parser
  - **ID**: extract-pr-hook-body-parser
  - **Tags**: scout, hooks, shell, maintainability
  - **Details**: `hooks/lib/gh-pr-body-from-command.sh` already joins multi-line `--body` values, but only `gh-pr-body-related-prs-not-first.sh` uses it. `gh-pr-skill-requires-evals.sh` and `gh-pr-agent-artifacts-require-tests.sh` each copy a `--body-file` sed, and `gh-pr-body-requires-rationale.sh` reads `--body` line by line, so a multi-line body bypasses it. Add `--body-file` support to the shared helper and source it from all four hooks. Merges `gh-pr-body-rationale-multiline-extraction` (2026-10-15 review).
  - **Files**: `hooks/lib/gh-pr-body-from-command.sh`, `hooks/checks/gh-pr-skill-requires-evals.sh`, `hooks/checks/gh-pr-agent-artifacts-require-tests.sh`, `hooks/checks/gh-pr-body-requires-rationale.sh`, their `.test.sh` fixtures
  - **Acceptance**: all four hooks source the helper; fixtures cover quoted and unquoted `--body-file`, a multi-line `--body` with and without a rationale, and a missing body.
  - **Output**: code

- [ ] Unify `agentbrew setup opencode --model` with the Agentfile `defaultModel` surface
  - **ID**: unify-opencode-bootstrap-model-with-default-model
  - **Tags**: scout, models, opencode, api-surface
  - **Details**: Scouted while adding model-sync: `agentbrew setup opencode --model <id>` (src/mcp/opencode-bootstrap.ts) configures OpenCode's model independently of the new Agentfile `defaultModel`/`modelOverrides` mechanism, so two entry points now set "which model an agent uses." OpenCode's `~/.config/opencode/opencode.json` top-level `model` key ("provider/model") is a valid `modelConfig` surface; consider declaring it in agents.yaml and making the bootstrap flow read/write the same override map, keeping one mental model per rule #9 (small external API).
  - **Files**: `src/mcp/opencode-bootstrap.ts`, `src/core/agents.yaml`, `src/sync/model-sync.ts`
  - **Acceptance**: either opencode declares `modelConfig` and the bootstrap flow routes through it (with `modelOverrides.opencode` as the id source), or a code comment in opencode-bootstrap.ts documents why the surfaces stay separate.
  - **Output**: code

- [ ] Reconcile `skillSourceDirs` legacy semantics with Agentfile `sources`
  - **ID**: reconcile-skill-source-dirs-with-agentfile-sources
  - **Tags**: scout, skills-sync, agentfile, docs
  - **Details**: `state.sources` now models indexed skill registries whose deployment is gated by `skillsInstalled`, while legacy `skillSourceDirs` still means "deploy every skill in this directory." That distinction is documented but still subtle and easy to misuse in hand-edited state. Decide whether to keep `skillSourceDirs` as an advanced opt-in escape hatch, migrate it to an explicit `optInSourceDirs` name, or replace it with Agentfile-local skill install flows.
  - **Files**: `src/sync/skills-sync.ts`, `src/agentfile.ts`, `README.md`, `AGENTS.md`
  - **Acceptance**: Source semantics are represented by one clear schema field or by docs plus lint/validation that flags accidental registry paths in `skillSourceDirs`; `agentbrew lint` or an equivalent test catches the ambiguous configuration.

- [ ] Re-promote or replace the ask-human MCP after upstream stdio init is fixed

  - **ID**: re-promote-ask-human-mcp-after-stdio-fix
  - **Tags**: mcp, catalog, upstream, scout
  - **Details**: `ask-human-mcp` 0.1.0 and 0.1.1 currently fail before MCP initialize in stdio mode with `RuntimeError: Already running asyncio in this thread` from `FastMCP.run()` / `anyio.run()` under the package's `asyncio.run(async_main())` launcher. The catalog entry was demoted from `recommended: true` to `recommended: false` while adding deep-smoke metadata, because `agentbrew mcp probe --deep` must not install/probe a known-broken recommended MCP. Re-check upstream issue Masony817/ask-human-mcp#3, test any new release with an initialize + `list_pending_questions` smoke call, then either restore `recommended: true` or replace the entry with a maintained human-in-the-loop MCP.
  - **Files**: `src/catalog.yaml`, `src/catalog/catalog.test.ts`
  - **Acceptance**: A direct stdio probe of the chosen ask-human MCP returns `status: "ok"` with `deepTool: "list_pending_questions"` or equivalent; the catalog entry is recommended only if the live smoke passes on a clean install.

- [ ] Remove dead `replaceAllText` empty-match branch in `gdoc-surgical-edit-only.sh`
  - **ID**: gdoc-surgical-dead-replacealltext-branch
  - **Tags**: scout, hooks, dead-code, gdoc
  - **Details**: The block branch matching `replaceAllText.*containsText[^"]*""` can never fire on well-formed JSON — the closing `"` after the `containsText` key immediately ends the `[^"]*` class before it can reach `""`. Verified empirically while writing the fixture (the hook's reachable block paths are `mode:full`, `replaceMode:replace`, and the >8 KB body size guard). Either fix the regex to detect a genuinely-empty `containsText` value or delete the dead branch and document the real coverage.
  - **Files**: `hooks/checks/gdoc-surgical-edit-only.sh`, `hooks/checks/gdoc-surgical-edit-only.test.sh`
  - **Acceptance**: every block branch in the script is reachable and covered by a fixture case; no dead regex remains.

- [ ] Re-evaluate source-manifest bootstrap glue for relocation to upstream skills CLI or overlay-owned scripts
  - **ID**: replace-relocate-source-manifest-bootstrap
  - **Tags**: replace-relocate, source-manifest, bootstrap, delegation
  - **Details**: The generic `bootstrap:` source-manifest block is intentionally small agentbrew glue for overlay one-time setup. Per VISION.md's delegate → contribute → absorb rule, revisit whether this belongs permanently in agentbrew, should be contributed to `vercel-labs/skills` as source-manifest lifecycle support, or should move fully into overlay repos as explicit scripts invoked by their quickstart. Include evidence from at least one real overlay using it and from upstream skills CLI source-manifest capabilities at the time of review.
  - **Files**: `src/catalog/index-source.ts`, `src/bootstrap.ts`, `src/commands/cli-bootstrap.ts`, `README.md`, `docs/competition/vercel-skills-cli-vs-agentbrew.md`
  - **Acceptance**: A short decision note is added to this task or a linked doc with one of: keep in agentbrew because no upstream/tool-owned host covers generic source bootstrap; contribute upstream with issue/PR link; relocate to overlay quickstart scripts and remove the agentbrew command. If the decision is keep, set a next quarterly review date.

- [ ] Explore whether Agentfile should sync Claude Code session settings (autoMemoryEnabled, autoDreamEnabled, autoMode)
  - **ID**: agentfile-claude-session-settings-sync
  - **Tags**: scout, agentfile, claude-settings, exploratory, docs/research/claude-code-undocumented-config.md
  - **Details**: Claude Code has session-level settings in `~/.claude/settings.json`: `autoMemoryEnabled` (auto-extract memories per session), `autoDreamEnabled` (consolidate memories across sessions), and `autoMode` (allow/soft_deny/hard_deny/environment classifier). Binary verification confirms these are real in 2.1.138. Explore whether the Agentfile should be able to declare these settings and sync them like the existing hooks key. This is exploratory — the research doc notes this as P3 to avoid building load-bearing infra on unstable fields (e.g., `criticalSystemReminder_EXPERIMENTAL` is explicitly flagged).
  - **Files**: `src/sync/settings-sync.ts` (new, if approved), `src/cli.ts` (register sync target)
  - **Acceptance**: A decision document in `docs/research/agentfile-claude-settings-sync-decision.md` that either (a) approves the feature with implementation path OR (b) rejects with rationale (e.g., settings are user-preference, not project-level).

- [ ] Adopt rule #8 — pattern conformance index in `VISION.md`
  - **ID**: adopt-rule-8-pattern-conformance-index
  - **Tags**: scout, rule-8, constitution, architecture
  - **Reuse**: `npm run lint:rules` runs Minsky's rule checks on this repo through `src/adapters/rule-lint.minsky.ts` (rules 1, 3, 4, 6, 9, 12, 13, 17). Extend the adapter before you write a local lint; build locally only for a rule Minsky has no `--repo` script for.
  - **Details**: Minsky's rule #8: "Every artifact (file, package, interface, architectural decision, process step) traces to a named, published pattern. New artifacts add a row to `vision.md` § 'Pattern conformance index' in the same commit. Deviations from the published pattern are declared explicitly. Identifiers match pattern names when the match is total. Silent deviation is itself a constitutional violation."

  agentbrew's `getAdapter()` factory IS the Adapter pattern (Gamma 1994). The drift-detection runs every 30 min — that's MAPE-K (IBM 2003). The state.yaml + Agentfile pair is Repository + Specification (Evans 2003, Fowler 2002). But none are CITED in code or VISION.md. New contributors don't know which patterns are load-bearing.

  Build: (a) `VISION.md` gains a `## Pattern conformance index` table — rows: artifact path, pattern name, source citation, conformance (full/partial/declared deviation), notes. (b) Top-of-file JSDoc on key types (`Adapter`, `SyncEngine`, `DriftCheck`) names the pattern. (c) `scripts/check-rule-8-pattern-conformance.mjs` parses the index and verifies every claimed-pattern row points at a real file. (d) PR template "What pattern does this conform to?" field.

  This is groundwork for `establish-vision-constitutional-rules` — rule #8 is one of the iron rules listed there. Lands together or sequentially.
  - **Files**: VISION.md (new `## Pattern conformance index` section), src/**/*.ts (add pattern citations to top-of-file JSDoc on key modules), scripts/check-rule-8-pattern-conformance.mjs (new), .github/PULL_REQUEST_TEMPLATE.md (extend)
  - **Acceptance**: VISION.md has a pattern conformance index with ≥15 rows; key source files carry top-of-file pattern citations; the check passes in `npm run verify`.
  - **Hypothesis**: Naming the patterns makes architectural drift visible at PR time (vs the current "I think this is how we do it" review pattern).
  - **Success**: After 30 days, ≥3 PRs cite a specific pattern row in review and either conform or declare deviation.
  - **Pivot**: If naming patterns adds review friction with no quality gain, downgrade to "pattern citation encouraged in top-of-file JSDoc, not required" and drop the lint.
  - **Measurement**: `grep -c '^| .* |' VISION.md` in the pattern-conformance section returns ≥15.
  - **Anchor**: Minsky `vision.md` § 8 "Pattern conformance"; Gamma et al. 1994 *Design Patterns* (canonical reference); Alexander 1977 *A Pattern Language* (the original pattern-language idea); Hohpe & Woolf 2003 *Enterprise Integration Patterns* (for agentbrew's adapter family).

- [ ] Adopt rule #16 — default by default (new behavior IS the default, not opt-in)
  - **ID**: adopt-rule-16-default-by-default
  - **Tags**: scout, rule-16, constitution
  - **Reuse**: `npm run lint:rules` runs Minsky's rule checks on this repo through `src/adapters/rule-lint.minsky.ts` (rules 1, 3, 4, 6, 9, 12, 13, 17). Extend the adapter before you write a local lint; build locally only for a rule Minsky has no `--repo` script for.
  - **Details**: Minsky's rule #16: "When you implement a new behaviour or fix, make it the default immediately — not an opt-in flag behind an env var. Every new default ships with (1) a runnable measurement, (2) a documented opt-out for debugging only. Burden of proof: 'why ISN'T this the default?'"

  agentbrew has accumulated opt-in flags (`--prune`, `--dry-run`, `--verbose`, `--source`, `--curated`) that should perhaps be defaults. The audit found 3 cases where a fix landed behind a flag instead of as the default behavior.

  Build: (a) `scripts/check-rule-16-defaults.mjs` parses `src/cli.ts` for new flags added in a PR and asserts each is justified in the PR body with one of: "behavior change too disruptive", "debug-only exit hatch", "user-config knob". (b) PR template extension: "Why is this not the default?" field for every new flag. (c) Audit existing flags and either flip to default OR add an experiment file documenting why they remain opt-in.
  - **Files**: scripts/check-rule-16-defaults.mjs (new), .github/PULL_REQUEST_TEMPLATE.md (extend), docs/cli-flags-audit.md (new — one row per existing flag with justification), src/cli.ts (flip ≥1 flag to default as the canary)
  - **Acceptance**: the check runs in `npm run verify`; new flags require justification; existing flags audited; at least 1 flag flipped to default with measurement showing no regression.
  - **Hypothesis**: Forcing "why isn't this the default?" surfaces accidental opt-in features that should just be the new behavior.
  - **Success**: After 30 days, ≥3 existing flags flipped to default; ≤1 new flag added without "why isn't this default" justification.
  - **Pivot**: If burdensome flag-justification slows feature work, narrow to "any new env-var-toggled behavior requires the justification" (drop CLI flag scrutiny).
  - **Measurement**: `node scripts/check-rule-16-defaults.mjs --json | jq '.unjustified_flags | length'` returns 0; flag count in `src/cli.ts` trends down.
  - **Anchor**: Minsky `vision.md` § 16 "Default by default"; Spolsky 2001 *Joel on Software* (the "configuration is debt" essay); Conway 1968 (Conway's Law — flags often externalize team boundaries).

- [ ] First-run experience — detect offline + auto-warm `npx skills` cache
  - **ID**: first-run-offline-warmup
  - **Tags**: scout, ux, onboarding, audit-2026-05-25
  - **Details**: README mentions "Before going offline, run `npx --yes skills --version` once" but this is a footgun — users forget, then `agentbrew init` fails with `ENOTCACHED` and they're confused. Build: `agentbrew init` detects offline mode (probe network with a 2s timeout) and either (a) auto-warms the cache before going offline OR (b) gives an actionable error: "Run `npx --yes skills --version` once on a connected machine, then retry `agentbrew init`."
  - **Files**: src/init.ts (add network probe + warmup path), src/init.test.ts (extend with offline scenarios), README.md § "Offline installs" (mention the new behavior)
  - **Acceptance**: first re-test a cold offline `agentbrew init`: a failed skills-CLI delegation now falls back to the native path (`src/add-source.ts`). If it still fails, init prints the exact command to run (or uses `skillInstallMode: native`); otherwise close this task. A test covers the offline path.
  - **Surfaced-by**: 2026-05-25 ecosystem audit (subagent report § 15).

- [ ] Track install events + surface popularity signal in `agentbrew browse`
  - **ID**: catalog-install-popularity-signal
  - **Tags**: scout, catalog, ux, ecosystem-alignment
  - **Details**: Skill discovery is the #1 UX complaint in the ecosystem. The official `skills.sh` registry paginates many public skills alphabetically with no install-rank. orangebot.ai/skills built a ranked index of install-ranked public skills sorted by weekly install volume because nobody else did. claudepluginhub.com (32k+ plugins) tracks "1,730 installs in the last 7 days" per plugin. agentbrew's `browse` command has no popularity signal — Tier 1/2/3 is editorial-curated, not data-driven.

  Concrete build:
  - Local event log at `~/.config/agentbrew/install-events.jsonl` — append on every successful `agentbrew install <id>` (skill / mcp / rule / bundle)
  - Each event: `{ timestamp, item_type, item_id, source, version, agent_target }` — no PII, no telemetry over the wire
  - Aggregation: `src/catalog/popularity.ts` reads the log, computes 7d/30d/all-time install counts per item
  - `agentbrew browse --sort=trending|popular|alphabetical` (default: alphabetical, but interactive `agentbrew browse` shows top-5 trending at top)
  - `agentbrew browse <id>` shows install count history sparkline
  - Strictly local — no opt-out needed since no data leaves the machine. Optional `agentbrew telemetry export` produces an anonymized summary for users who WANT to share aggregate stats upstream (off by default)

  Integrates with the Minsky-discipline task: `src/adapters/popularity-store.ts` interface + `src/adapters/popularity-store.jsonl.ts` impl, so the storage backend is swappable (e.g. SQLite later, or a shared community endpoint if ecosystem demand emerges).
  - **Files**: src/catalog/popularity.ts (new), src/catalog/popularity.test.ts (new), src/adapters/popularity-store.ts (new), src/adapters/popularity-store.jsonl.ts (new), src/cli.ts (add `--sort` flag to browse + sparkline rendering), src/commands/cli-install.ts (append install events), README.md (Popularity tracking section)
  - **Acceptance**: (a) every successful `agentbrew install` appends a JSONL row; (b) `agentbrew browse --sort=trending` returns items sorted by 7d install count; (c) no network call is made by the popularity layer (verified by test with network mock); (d) `agentbrew browse <id>` shows a 30-day install history sparkline; (e) tests cover empty-log + corrupted-row + concurrent-write scenarios.
  - **Hypothesis**: A local install-count signal converts agentbrew's editorial Tier system into an empirically-validated signal — users see which items are actually used vs which were just recommended.
  - **Success**: Within 30 days of shipping, the `--sort=trending` view surfaces ≥3 items that are NOT in the current Tier 1 set, suggesting the editorial picks miss real usage patterns.
  - **Pivot**: If single-user install counts produce too-thin signal (Fyodor installs each thing once), pivot to a "session-frequency" signal — count how often each skill/MCP/rule is mentioned in the agent's tool-call logs (requires hooks-sync extension to capture tool-call events).
  - **Measurement**: `wc -l ~/.config/agentbrew/install-events.jsonl` increases monotonically with installs; `agentbrew browse --sort=trending --json | jq '. | length' ≥ 5`.
  - **Anchor**: orangebot.ai/skills (2026-05) — install-volume ranking for install-ranked public skills; claudepluginhub.com (April 2026 stats) — per-plugin install counters; agentbrew VISION.md § "Curator, not host" — editorial picks + empirical signal is stronger than either alone.

- [ ] (Publish-only step) File the staged upstream issue at `neiii/bridle` (upstream relocated 2026-05-02 from `superwall/bridle`) noting `harness-locate` uses singular `skill/` and `command/` for OpenCode but the official OpenCode docs use plural.
  - **ID**: bridle-opencode-path-issue
  - **Tags**: upstream-contribution, bridle, scout, blocked-explicit-permission, publish-only
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
  - **Last-enriched**: 2026-05-02

- [ ] Add catalog refs for upstream lifecycle/loop primitives — Ralph Wiggum + right-hooks
  - **ID**: catalog-refs-ralph-and-right-hooks
  - **Tags**: scout, catalog, ecosystem-alignment
  - **Details**: Two upstream primitives that the AI dev ecosystem has converged on are missing from agentbrew's catalog as direct references:

  1. **Ralph Wiggum loop** (Geoffrey Huntley) — official Anthropic plugin at `anthropics/claude-code/plugins/ralph-wiggum`. Uses Claude Code's Stop hook to make the agent self-loop in the same session until a completion promise fires. Boris Cherny (Claude Code creator) endorsed it. The pattern is the dominant "fire-and-forget" autonomous-loop idiom; agentbrew's `companion-researcher` umbrella is the parallel-lane pattern, not the Ralph pattern. Catalog entry should point at `anthropics/claude-code/plugins/ralph-wiggum` as Tier 2, with a one-line description and the install command.

  2. **right-hooks** (npm `right-hooks`, https://registry.npmjs.org/right-hooks) — lifecycle enforcement hooks for autonomous Claude Code agents. Implements the `Think → Plan → Build → Review → Test → Ship → Reflect` lifecycle with mechanical gates that block the agent from skipping phases. Multi-runtime support (Codex, Cursor, Aider) on roadmap. Catalog entry should add this as Tier 2 for users running autonomous loops.

  Both are pure references — agentbrew adds catalog rows that point at the upstream package; install handler delegates to `npm install -g right-hooks` and `/plugin install ralph-wiggum@claude-plugins-official` respectively. No skill content duplicated, no maintenance burden.

  Integrates with bundles task (`catalog-plugin-bundle-primitive`): add an `autonomous-loop` bundle that pairs `ralph-wiggum` + `right-hooks` + `verify-everything` bundle members. Integrates with adapter discipline (`adopt-minsky-adapter-discipline`): adding these is itself a "Replace? Relocate?" instance — agentbrew's prior implicit work on autonomous loops (the companion-researcher umbrella) should be re-evaluated against Ralph.
  - **Files**: src/catalog.yaml (new catalog entries under existing skills/MCPs section + 1 new bundle), src/cli.ts (install handler for the `/plugin install` path), README.md (mention in Catalog sources)
  - **Acceptance**: (a) `agentbrew browse | grep -E '(ralph-wiggum|right-hooks)'` returns entries; (b) `agentbrew install ralph-wiggum` runs `/plugin install ralph-wiggum@claude-plugins-official` for Claude Code; (c) `agentbrew install right-hooks` runs `npm install -g right-hooks`; (d) `autonomous-loop` bundle exists and installs both + verify bundle.
  - **Hypothesis**: Linking the two dominant ecosystem primitives saves the curator effort of building Ralph/lifecycle-loop skills in-house and matches "delegate before contribute" from VISION.
  - **Success**: After 30 days, the `autonomous-loop` bundle has been installed at least once and `right-hooks` ships an updated version that agentbrew picks up via the upstream-version flow.
  - **Pivot**: If either primitive turns out to be Claude-Code-only and can't be adapted to Cursor or Codex, scope the catalog entry to `agent_target: claude-code` only rather than dropping it.
  - **Measurement**: `grep -c '^  - id: ralph-wiggum' src/catalog.yaml` and `grep -c '^  - id: right-hooks' src/catalog.yaml` both return 1.
  - **Anchor**: `anthropics/claude-code/plugins/ralph-wiggum` README — official Anthropic implementation; Boris Cherny endorsement (Claude Code creator); registry.npmjs.org/right-hooks — Think→Plan→Build→Review→Test→Ship→Reflect lifecycle; Geoffrey Huntley original "Ralph is a Bash loop" essay.

<!-- P3 is intentionally blocked — see the "Priority semantics" comment at the top of this file
     for the full rule. /next-task MUST NOT claim P3 without explicit user permission. -->

- [ ] Propose managed-section marker convention as an ecosystem-wide spec (upstream contribution).
  - **ID**: ecosystem-contrib-managed-section-convention
  - **Tags**: ecosystem, contribution, standards
  - **Details**: **Publishing hold**: the final publish step (filing the PR, posting the comment, sending any external message) is a SEPARATE approval from approval to claim or research — it requires explicit per-action user approval in the session that performs it, per the file-level publishing policy. Drafting PR text and comment bodies locally is fine; the `gh pr create` / `gh issue comment` / `gh pr review` action itself is blocked until approved.
    Multiple tools now write to the same agent config files (CLAUDE.md, AGENTS.md, `.cursor/rules/`). Without a shared convention, they collide. agentbrew uses `<!-- agentbrew:start -->` / `<!-- agentbrew:end -->`. Caliber uses `<!-- caliber:managed:<name> -->` / `<!-- /caliber:managed:<name> -->`. React Doctor writes directly without markers. No standard exists.
    File a lightweight spec proposal — a gist or small repo — documenting: (a) marker format (`<!-- <tool-name>:managed:<section-name> -->`), (b) ownership semantics (only the owning tool may modify content inside its markers; other tools must preserve the block verbatim), (c) marker placement (top-level sections in markdown, can contain valid markdown), (d) nesting (disallowed — markers must be section-siblings, not nested), (e) test patterns (regex + examples). Link from agentbrew's VISION.md and file a drive-by PR on Caliber / Warden / React Doctor repos linking to the spec with a one-sentence "we'd like to align on this marker convention."
    This is low-priority, low-investment, ecosystem-hygiene work. Skip if Caliber or another tool beats us to it — the goal is alignment, not authorship.
  - **Files**: `docs/specs/managed-section-markers.md` (new) or a gist / standalone repo, upstream PRs to Caliber / other tools.
  - **Acceptance**: (a) spec document exists with the 5 sections above; (b) VISION.md links to it; (c) at least one upstream PR filed linking to the spec — accept the result whether merged or not (author goodwill + visibility matters more than the merge).
  - **Human-approval-required**: external-pr

- [ ] Evaluate delegating Agentfile `skills:` installs to the skills CLI `experimental_install`
  - **ID**: contribute-support-issue-283-declarative-manifest
  - **Tags**: upstream, skills-cli, delegation
  - **Details**: vercel-labs/skills issue #283 (declarative manifest) and #729 are still open, but a 2026-06-11 comment on #283 reports that `experimental_install` (install from `skills-lock.json`) works. PR #937 (config system) was closed on 2026-09-30 and superseded by PR #2348 (open). Test whether `experimental_install` can replace agentbrew's per-project skill resolution, and watch #2348. Any upstream comment is publish-gated.
  - **Files**: `src/sync/skills-sync.ts`, `docs/competition/vercel-skills-cli-vs-agentbrew.md` (Upstream receptivity)
  - **Acceptance**: a written result in the competition doc: either a delegation plan (what agentbrew code can be deleted) or the concrete gap that blocks it; #2348 state recorded with a date.

- [ ] Trust-building PRs on vercel-labs/skills from the drafts staged in `fyodoriv/skills`
  - **ID**: contribute-trust-building-pr-skills-cli
  - **Tags**: upstream-contribution, skills-cli, blocked-explicit-permission, bug-fix
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
  - **Human-approval-required**: external-pr

- [ ] RFC comment on vercel-labs/skills [issue #268](https://github.com/vercel-labs/skills/issues/268) + [issue #455](https://github.com/vercel-labs/skills/issues/455) — user-created skill preservation classifier.
  - **ID**: contribute-rfc-comment-issues-268-455-user-safety-classifier
  - **Tags**: upstream-contribution, skills-cli, blocked-explicit-permission, data-safety
  - **Details**: **Publishing hold**: the final publish step (filing the PR, posting the comment, sending any external message) is a SEPARATE approval from approval to claim or research — it requires explicit per-action user approval in the session that performs it, per the file-level publishing policy. Drafting PR text and comment bodies locally is fine; the `gh pr create` / `gh issue comment` / `gh pr review` action itself is blocked until approved.
    **DO NOT claim this task without explicit user approval** (P3 policy).
    Source: [docs/competition/vercel-skills-cli-vs-agentbrew.md § "Feature 7: User-created skill preservation"](../docs/competition/vercel-skills-cli-vs-agentbrew.md#7-user-created-skill-preservation--4-competing-bug-fix-prs-in-flight) and [Contribution roadmap row 3](../docs/competition/vercel-skills-cli-vs-agentbrew.md#contribution-roadmap--priority-ordered). Research (2026-04-19) found the user-safety direction has **4 competing bug-fix PRs already open** ([#609](https://github.com/vercel-labs/skills/pull/609), [#611](https://github.com/vercel-labs/skills/pull/611), [#869](https://github.com/vercel-labs/skills/pull/869), [#944](https://github.com/vercel-labs/skills/pull/944)) plus related bug reports ([#268](https://github.com/vercel-labs/skills/issues/268), [#455](https://github.com/vercel-labs/skills/issues/455), [#606](https://github.com/vercel-labs/skills/issues/606)). Filing a 5th implementation hurts: the queue is saturated and maintainers haven't merged any of them yet. The right move is RFC input on the design, not another competing PR.
    Outcome when unblocked: (a) post agentbrew's 5-case `cleanEntry()` classifier taxonomy as a comment on [issue #268](https://github.com/vercel-labs/skills/issues/268) (the foundational issue) to inform how maintainers architect the eventual fix — managed symlink / broken symlink / user symlink to valid non-managed path / user directory without `.agentbrew-managed` sentinel / user directory with sentinel; (b) cross-post a short summary on [issue #455](https://github.com/vercel-labs/skills/issues/455) tying the agentbrew taxonomy to skills CLI's `preserve-local` mode request; (c) include the specific invariant: *"The user's own files are preserved forever; `--prune`, auto-repair, and sync all treat user-created directories as sacrosanct"*; (d) link to [`src/sync/skills-sync.ts` `cleanEntry`](../src/sync/skills-sync.ts) for the implementation reference; (e) explicitly say agentbrew is NOT filing a PR, so maintainers know this is design input not queue-noise.
    If any of the 4 open PRs merges with the classifier design, close this task — the contribution has landed. If none merge and the queue grows further (a 5th community PR appears), escalate by commenting on issue #268 asking Andrew Qu / Elliot Liu for architectural direction on which PR they'd be willing to review.
  - **Files**: upstream issues at vercel-labs/skills (no agentbrew files).
  - **Acceptance**: (a) a substantive RFC-style comment is posted on BOTH #268 and #455 with the 5-case taxonomy and the invariant statement; (b) the comment links to the exact `src/sync/skills-sync.ts` `cleanEntry` reference and explicitly states "not filing a PR"; (c) if any of the 4 open PRs (#609, #611, #869, #944) subsequently merges with a classifier design, close this task with a link to the merge in the commit message; (d) if the queue stays stuck for another 4 weeks post-comment, the escalation comment on #268 asking for architectural direction is posted.
  - **Human-approval-required**: external-issue

- [ ] Companion-researcher needs working-tree branch-stomp protection
  - **ID**: companion-branch-stomp-protection
  - **Tags**: skills, companion, git-safety, multi-agent
  - **Details**: In the 2026-05-21 companion-researcher session, the
    worker's session called `git checkout <their-branch>` in the
    shared agentbrew working tree TWICE while the companion agent
    was mid-edit. Each time, the companion's next `git commit`
    landed on the worker's branch instead of the intended companion
    branch (and once even pushed to the worker's PR before being
    caught).

    Recovery steps that worked (cherry-pick + revert):
    1. `git checkout <my-companion-branch>`
    2. `git cherry-pick <bad-commit-on-worker-branch>` → lands on
       my branch.
    3. `git checkout <worker-branch>`
    4. `git revert --no-edit <bad-commit>` → adds a revert commit
       on the worker's branch so net diff is zero.
    5. `git push` both branches.
    6. `git checkout <my-companion-branch>` to resume work.

    This works but: (a) requires the companion to NOTICE the wrong
    branch before pushing, (b) leaves two unexplained commits on the
    worker's PR, (c) the worker may force-push and lose the revert.

    Real fix: companion-researcher SKILL.md should require
    re-verifying `git branch --show-current` BEFORE every `git
    commit` and `git push`, not just at session start. Add this as
    a hard rule in the umbrella's Safety Rules section ("Verify
    branch before every commit and push — `git branch --show-current`
    is cheap and catches branch-stomps").

    Better fix (longer-term): the companion should operate in a
    git worktree (separate filesystem location) rather than the
    shared working tree. The `obra/superpowers/using-git-worktrees`
    skill describes the pattern. Worktrees give each agent its own
    HEAD pointer, eliminating the branch-stomp class of bug
    entirely. Tradeoff: extra disk space (~one full checkout per
    companion session) and slightly more setup. For active
    multi-agent workflows the disk cost is worth it.

  - **Files**:
    skill-plugins/workflow/companion-researcher/SKILL.md (add the branch-
    verification rule); optionally skill-plugins/workflow/companion-*/
    SKILL.md (each sub-skill could also assert the branch before
    write operations).
  - **Acceptance**:
    Either (a) every companion-* SKILL.md has an explicit "verify
    branch before commit + push" step in its Safety Rules section,
    AND a pressure-test subagent can be shown the trap (worker
    switches branch mid-edit) and recover correctly. Or (b) the
    companion-researcher umbrella migrates to using `git worktree
    add` for its session checkout, isolating it from the worker
    entirely.

- [ ] Competitor docs state the current upstream facts, dated inside the doc
  - **ID**: refresh-competitor-vercel-skills-cli-vs-agentbrew
  - **Tags**: research, competitor
  - **Details**: The 2026-10-01 public-history reset makes git dates useless for staleness, so judge freshness by dates written in each doc. Known stale facts in `docs/competition/vercel-skills-cli-vs-agentbrew.md`: #509, #937 and #944 are closed; #869 and #971 are merged; #2348 (supersedes #937) is not mentioned; several fork-draft targets are closed. Also re-check `block-ai-rules-vs-agentbrew.md`, `mcpm-sh-vs-agentbrew.md`, and `token-usage-tools.md`. Merges the five per-file refresh tasks (2026-10-15 review).
  - **Files**: `docs/competition/*.md`
  - **Acceptance**: every listed doc has a dated "Last checked: YYYY-MM-DD" line, and the vercel doc's PR and issue states match GitHub on that date.

- [ ] Warn when OpenCodeAdapter drops env on a URL server
  - **ID**: opencode-remote-env-drop-warning
  - **Tags**: mcp, opencode, adapters, ux
  - **Details**: `OpenCodeAdapter.toEntry` silently drops `env` for URL (remote) servers because the opencode remote schema has no `environment` field. Emit a one-line sync warning (and a test) when a server has both `url` and non-empty `env`, so the loss is visible.
  - **Files**: `src/mcp/adapters.ts`, `src/mcp/adapters.test.ts`
  - **Output**: code
  - **Acceptance**: sync logs one warning naming the server when it has both `url` and a non-empty `env`; a test in `src/mcp/adapters.test.ts` asserts the warning.
