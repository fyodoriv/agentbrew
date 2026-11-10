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
     landscape" + "watch Runlayer" folded into the existing
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

- [ ] Validate every sync selection before preparation can publish outputs
  - **ID**: sync-selection-preflight
  - **Tags**: security, stability, sync, cli
  - **Mode**: AFK
  - **Details**: Source review found additional preflight cases outside the explicit-pull correction. An empty selection currently falls through truthiness guards, and plain sync calls native plugin output before filtering its modules. Freeze synthetic empty-API, empty-pull, unknown-plain and selected-plain exclusion controls before changing these paths. The [continuation handoff](docs/plans/sync-selection-continuation-handoff-20261106.md) preserves current evidence and unapproved design; register and land bounded measurement infrastructure before capturing target cases. The [isolated binding pivot](docs/plans/sync-binding-exclusion-pivot.md) covers synthetic builder wiring only; CLI/update and real-output evidence remain. Preserve the explicit-pull guards and ordinary default behavior; do not use real plugin or credential data.
  - **Files**: `src/cli.ts`, `src/cli-helpers.ts`, `src/update.ts`, existing CLI/update/native-output tests, README and a registered preparation plan.
  - **Output**: code
  - **Acceptance**: Empty or unknown selections fail before state application, installation or publication. A valid selection excludes native plugin publication and live content preparation for every unselected module. An invocation without a selection retains normal configured behavior.
  - **Hypothesis**: a shared preflight boundary reduces predicted unrequested-publication cases from four to zero across the sealed negative controls, while the default and valid selected controls remain correct. Capture the actual baseline before any fix; this is a prospective prediction, not a measured result.
  - **Measurement**: Commit a plan with exact synthetic inputs and numeric call/write oracles first. Extend `src/cli-sync-agentfile.test.ts`, `src/cli-sync-pull.test.ts` and `src/update.test.ts`; run `JOBS=1 heavy-run npm exec -- vitest run src/cli-sync-agentfile.test.ts src/cli-sync-pull.test.ts src/update.test.ts --maxWorkers=1` for RED and GREEN, then required gates. Add real scratch output sentinels where preparation can publish.
  - **Success**: zero unrequested calls or writes across every negative control; unknown and empty inputs exit nonzero before mutation; selected/default positive controls remain correct; original explicit-pull and ownership guards stay green.
  - **Pivot**: Any invalid-input mutation, unselected publication, default regression or weakened ownership check rejects the boundary; revise the preparation route rather than hide its effects with a later filter.
  - **Anchor**: Current CLI preparation/filter ordering and empty-string guards; Basili, Caldiera and Rombach (1994), GQM; Munafò et al. (2017), preregistration.

- [ ] Observe a real concurrent source-refresh failure before choosing a fix
  - **ID**: source-lease-real-failure-classification
  - **Tags**: reliability, sync, measurement, privacy
  - **Mode**: AFK
  - **Details**: Published evidence is retained in [draft PR #805](https://github.com/fyodoriv/agentbrew/pull/805); keep it unmerged while qualification is false. The [frozen diagnostic cohort](docs/plans/source-lease-failure-observation.md#bounded-real-failure-cohort) is closed at its ten-invocation cap. Every invocation passed; no real failure was classified. The original acceptance remains UNVERIFIED and the earlier cause UNKNOWN. Preserve that contract and every receipt; do not reopen or extend the cohort. The separate `source-lease-release-window-research` task studies controlled physical schedules and cannot satisfy this real-incident criterion.
  - **Blocked**: closed-cohort-no-admission — all ten natural-cohort invocations are consumed without a classified failure. Acceptance remains UNVERIFIED; earlier cause UNKNOWN. No additional invocation is authorized by this handoff.
  - **PR**: https://github.com/fyodoriv/agentbrew/pull/805
  - **Files**: `src/sync/pull-source-caches.test.ts`, `docs/plans/source-lease-failure-observation.md`
  - **Output**: measurement
  - **Acceptance**: at least one actual failed invocation has its safe enum record; zero failures remain unclassified and zero private errors are disclosed. Every result belongs to the frozen source revision and keeps its actual exit. A current failure class does not establish the earlier incident's cause or authorize an unregistered product fix.
  - **Hypothesis**: the bounded cohort yields at least one classified real failed invocation from the current baseline of zero, with zero unclassified failures, private disclosures or changed failure semantics. If no failure recurs, the evidence remains unverified.
  - **Measurement**: historical closed-cohort command: `JOBS=1 heavy-run npm exec -- vitest run src/sync/pull-source-caches.test.ts -t 'keeps copied bytes bound to the accepted revision across production updater processes' --maxWorkers=1 --reporter=default --silent=false`. The ten admitted invocations all passed with no classified real failure. This result is UNVERIFIED; do not run this cohort again.
  - **Research**: 2026-11-06: source-equivalent observer revision `3558265` matched merged `c3331d9`; every admission retained its native handle, command, log and actual exit. Sequential admission timestamps and unchanged source hashes were verified. Classified real failures: zero. The bounded-cohort success criterion is not met. Controlled research has a separate committed-prediction requirement and never replaces this result.
  - **Success**: at least one real failed invocation classified by a valid kind/errno record; zero unclassified failures or private disclosures; no more than ten invocations; unchanged source, assertions, deadlines and retries; no claim that the new observation proves the earlier cause.
  - **Pivot**: ten passing invocations leave the criterion unverified and require separately registered controlled-race research. Any unclassified failure, disclosure, missing terminal evidence or changed source invalidates the cohort and stops it. Do not reset the denominator, repeat until green, raise a timeout or reinterpret an exception as success.
  - **Anchor**: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al. (2017), preregistration; existing `SourceCheckoutLeaseRefusal` and exact cross-process fixture contracts.

- [ ] Distinguish controlled source-lease release windows with physical evidence
  - **ID**: source-lease-release-window-research
  - **Tags**: reliability, sync, measurement, concurrency
  - **Mode**: AFK
  - **Details**: Published evidence is retained in [draft PR #805](https://github.com/fyodoriv/agentbrew/pull/805); keep it unmerged while qualification is false. The [registered research](docs/plans/source-lease-release-window-research.md#executed-cohorts-and-failed-qualification) used all six permitted physical admissions. Initial and verification controls each matched their frozen matrix, but qualification is FALSE: the single full gate failed at an unchanged plugin lifecycle case with an unclassified timeout. Preserve source and every record. No physical admission or gate retry remains under this registration. The closed natural cohort remains UNVERIFIED and the earlier incident's cause UNKNOWN; controlled results cannot replace its criterion or authorize a product fix.
  - **Blocked**: needs-plugin-boundary-diagnosis-and-new-qualification-registration — the six-admission cap is exhausted and the full gate failed. Diagnose the separately scouted plugin boundary without running these physical controls; any further physical qualification needs a new committed registration.
  - **PR**: https://github.com/fyodoriv/agentbrew/pull/805
  - **Files**: `src/sync/pull-source-caches.test.ts`, `docs/plans/source-lease-release-window-research.md`
  - **Output**: measurement
  - **Acceptance**: physical milestone receipts distinguish typed refusal, valid leased acquisition and the predicted raw ENOENT window. Every child is reaped, error output is enum-only, source and production lease settings stay unchanged, and no work enters without a verified lease. Unsupported scheduling capability, missing ordering evidence or a different outcome stays unverified.
  - **Hypothesis**: the registered release-window control yields an actual filesystem ENOENT classified as other, while the held control yields typed refusal and the pre-released control acquires safely. Every control matches its same frozen class in both the initial and separately registered verification cohort, with zero unclassified outcomes, private-error disclosures or unlocked work.
  - **Measurement**: completed commands and original thresholds remain frozen in the linked plan. Initial controls matched three of three; the single full verification matched three of three but exited one. The admission cap is closed. Do not run the physical describe block, related tests, verify:changed or another full gate from the experiment checkout containing the exhausted physical controls as a diagnostic retry.
  - **Research**: 2026-11-06: source tree `bbe912a7d2930c96ba1e5527d4db37bc166c7fe3`, probe SHA256 `76b8fb17cc7f30aae8e556cfe122ca40a8c2c28369f22b18d62f6a24e460320e`; initial and verification milestones, safe enums, wrapper restoration and child reaping matched. Full gate: 6,422 passed, one failed, 33 skipped; actual exit one. Exact failure: `Error: Test timed out in 30000ms.` at `src/plugins/cli-plugin.test.ts:200:3`. Its cause remains UNKNOWN. This is not a successful research closeout.
  - **Success**: each cohort matches three of three frozen physical controls; no more than six total physical admissions; zero unclassified outcomes, private disclosures, unlocked work or unowned cleanup; unchanged production source, retry policy and deadlines; the single qualifying full gate passes. This qualifies only the controlled research mechanism.
  - **Pivot**: any different class, missing barrier proof, failed child cleanup, unsafe disclosure or unsupported seam stops the current cohort and prevents further admissions. No repeat, replacement admission or full-gate retry is permitted by this registration. Preserve evidence and separately register any next method. Keep the earlier incident UNKNOWN and the real-failure cohort UNVERIFIED.
  - **Anchor**: Basili, Caldiera and Rombach (1994), GQM; Munafò et al. (2017), preregistration; Musuvathi et al. (2008), deterministic concurrency testing; official Node built-in export guidance linked in the plan.

- [ ] Observe the plugin lifecycle timeout boundary before choosing a repair
  - **ID**: plugin-lifecycle-timeout-observation
  - **Tags**: reliability, tests, measurement
  - **Mode**: AFK
  - **Details**: Published evidence is retained in [draft PR #805](https://github.com/fyodoriv/agentbrew/pull/805); keep it unmerged while qualification is false. The unchanged add/update/rollback/remove marketplace-copy case timed out at its existing 30,000 ms limit. The terminal report identifies the whole case, not the stalled action or cause. Follow [the diagnostic preparation](docs/plans/plugin-lifecycle-timeout-observation.md). Commit that prediction before adding safe test-owned stage records. Preserve original assertions, failure propagation and the time bound; land qualified observation before selecting a product fix. Use a separate clean checkout without the capped physical research probes for any normal full qualification. The [pure recorder pivot](docs/plans/lifecycle-recorder-no-writer-pivot.md) keeps nine synthetic health controls; the runner, external observation and real diagnostic remain unqualified.
  - **PR**: https://github.com/fyodoriv/agentbrew/pull/805
  - **Files**: `src/plugins/cli-plugin.test.ts`, `docs/plans/plugin-lifecycle-timeout-observation.md`
  - **Output**: measurement
  - **Acceptance**: safe stage records distinguish completed, incomplete and failed in-process lifecycle boundaries without logging arguments, keys, paths or raw errors. A real timeout is attributed only to an observed open boundary; source inspection or a later pass cannot establish the earlier cause. No product or timeout fix is included.
  - **Hypothesis**: the registered observation controls reduce missing or false boundary classifications to zero, while incomplete operations remain incomplete, errors retain failure semantics and private-marker disclosures remain zero. The real timeout cause stays UNKNOWN until a diagnosed and reproduced boundary exists.
  - **Measurement**: after the preparation prediction and proposed controls exist, run `rg -q 'plugin lifecycle observation' src/plugins/cli-plugin.test.ts && JOBS=1 heavy-run npm exec -- vitest run src/plugins/cli-plugin.test.ts -t 'plugin lifecycle observation' --maxWorkers=1 --reporter=default --silent=false`. The linked plan separately bounds one later exact-case diagnostic after instrumentation delivery; no such measurement has run at task creation.
  - **Success**: all three observation controls classify their exact lifecycle state; zero false completion, swallowed failures or private-marker disclosures; unchanged original assertions and 30,000 ms case limit; required gates pass without executing the exhausted lease probes. A repair still requires separate diagnosed/reproduced-boundary evidence and a committed hypothesis.
  - **Pivot**: any ambiguous boundary, missing record, altered timeout/assertion, disclosed payload or passing retry presented as a cause rejects the observation. Preserve the unknown and revise measurement; do not raise the timeout, replace real lifecycle work with a stub or run until green.
  - **Anchor**: Basili, Caldiera and Rombach (1994), GQM; Munafò et al. (2017), preregistration; the actual terminal timeout and current in-process `Command.parseAsync` lifecycle fixture.


- [ ] Build and install evidence rejects stale locked dependencies
  - **ID**: locked-install-evidence
  - **Tags**: security, stability, dependencies
  - **Mode**: AFK
  - **Details**: The build preflight can report a lockfile match with a stale transitive package. The worktree helper can clone an unqualified donor and issue a fresh lock stamp, while the full-gate cache excludes installed dependencies from its identity. Follow [the registered preparation](docs/plans/locked-install-evidence.md). Reuse supported dependency tooling before adding an adapter. Land instrumentation first; keep existing optional-peer failures explicit and preserve canonical dependencies during qualification.
  - **Files**: `scripts/build-pipeline-guard.sh`, `scripts/worktree-deps.sh`, `scripts/verify.sh`, their existing tests, dependency setup guidance
  - **Output**: code
  - **Acceptance**: stale transitive packages, unqualified donors and installation changes cannot produce a false lock-exact receipt or reuse an unrelated successful gate. Supported optional and local-file dependencies remain supported; errors and unavailable evidence fail closed without changing the declared dependency contract.
  - **Hypothesis**: the five registered negative controls produce zero unsafe permits after repair, while all four supported controls remain valid. Baseline values must come from the new instrumentation, not the current shallow check or source inspection.
  - **Measurement**: register and land the plan's instrumentation, then run `JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/build-pipeline-guard.test.ts src/worktree-deps.test.ts src/scripts/verify-cache.test.ts` before and after repair, followed by a qualified task-owned installation and `JOBS=1 NO_CACHE=1 heavy-run npm run verify`.
  - **Success**: zero unsafe permits across all five fixed negative controls, all four positive controls pass, no dependency-policy change or canonical installation mutation, and normal repository gates pass on the qualified installation.
  - **Pivot**: any unsafe permit, unsupported omission, manufactured stamp, cached result from a different installation or hidden optional-peer failure rejects the approach; preserve the evidence and revise the adapter rather than weaken the contract.
  - **Anchor**: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al. (2017), preregistration; npm's documented dependency-tree scope and lockfile contract linked in the plan.

- [ ] Remove the frozen vulnerable dependency ranges without hiding optional paths
  - **ID**: dependency-alert-remediation
  - **Tags**: security, stability, dependencies
  - **Mode**: AFK
  - **Details**: Repair Dependabot alerts 162/161/160/156/155/154/153/150/149 through supported upstream parents. Update the Vitest/coverage pair and the named lock targets; upgrade the Azure identity parent so its nested MSAL copy is fixed too. Preserve optional graph resolution, the jks stub, all unrelated overrides and the current Node floor. Commit [the frozen experiment](docs/plans/dependency-alert-controls.md) before any audit, installation or package change; read-only advisory triage is not a passing baseline. Partial task `dependency-runtime-fast-uri` does not complete this task. Final strict full-graph acceptance still needs `dependency-peer-compatibility`; all original metrics and receipts remain authoritative.
  - **Files**: `package.json`, `package-lock.json`, README dependency/security guidance, `docs/plans/dependency-alert-controls.md`
  - **Output**: code
  - **Acceptance**: every frozen advisory/range is absent from all resolved locked copies; optional Azure paths remain resolved, no forge dependency or unrelated root update appears, normal installation and full gate pass, and all frozen alerts later report fixed on the default branch. Dismissal, omitted dependencies and unavailable service data do not satisfy acceptance.
  - **Hypothesis**: the minimal upstream resolution reduces predicted unsafe advisory/range rows from nine to zero, with zero dependency/gate regressions and unchanged protected overrides, optional declarations and Node floor. Count a row unsafe if any matching locked copy remains affected, not npm audit's aggregate or the number of vulnerable package nodes.
  - **Measurement**: after registration, run the exact lock/semver query and `heavy-run npx --yes --prefer-offline --package=npm@10 -- npm audit --include=optional --json`, npm tree and existing lockfile validation from the plan before and after its named package actions; require `heavy-run npm run verify` and the plan's exact env-unset GitHub fixed-status query after merge. No npm audit/install result is claimed at task creation.
  - **Success**: zero unsafe frozen rows, no new unresolved security finding, zero protected-contract changes, passing installation/tree/full-gate evidence, and every frozen GitHub alert fixed with a timestamp.
  - **Pivot**: any remaining affected copy, missing optional/registry evidence, unsupported parent resolution, unrelated root change, forge reintroduction or gate regression rejects the candidate. Preserve unknowns and revise the resolution approach rather than changing the denominator, dismissing alerts or forcing a major override.
  - **Anchor**: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al. (2017), preregistration; primary advisories and published parent manifests linked in the plan.

- [ ] Repair the two new dependency alerts through compatible upstream parents
  - **ID**: dependency-alerts-172-175
  - **Tags**: security, stability, dependencies
  - **Mode**: AFK
  - **Blocked**: needs-compatible-upstream-parent-and-peer-contract — published parents still require vulnerable minimatch 10.x. The newer Promptfoo that fixes its pinned Hono copy adds a peer incompatible with the protected jks stub and retains the watcher peer conflict. Require compatible primary metadata before implementation.
  - **Details**: Repair only alerts 172 (`@hono/node-server`, GHSA-rmxm-3fg6-px4f) and 175 (`minimatch`, GHSA-g3hv-75wg-m249). [The evidence and preparation plan](docs/plans/dependency-alerts-172-175.md) records exact ranges and parent constraints. Keep the original nine-row `dependency-alert-remediation` cohort, including MSAL alert 162, unchanged. Preserve optional paths, the local jks stub, existing overrides and the Node floor. This records read-only triage, not a passing baseline or an authorized package update.
  - **Files**: future supported parent resolution in `package.json` and `package-lock.json`; dependency/security documentation; no unrelated root update is pre-approved.
  - **Output**: code
  - **Acceptance**: neither new advisory range matches any resolved locked copy; the complete optional graph has no invalid/missing edges, normal installation and full gate pass, protected contracts remain unchanged, and both alerts report fixed with timestamps. No dismissal, omitted path, forced major override or reduced original-nine requirement counts as success.
  - **Hypothesis**: after compatible metadata and a committed exact candidate prediction, the two unsafe advisory rows fall from a predicted two to zero, with zero new unresolved findings, invalid/missing edges or protected-contract changes. Count rows, not vulnerable package nodes; measure the baseline before implementation.
  - **Measurement**: first commit the exact supported parent selection and runnable experiment; then run the plan's proposed two-row semver query, strict full-graph/audit checks through npm 10, qualified task-owned normal install, existing lockfile/full gates and live GitHub fixed-status query. Commands are future steps, not passing harness evidence.
  - **Success**: zero unsafe rows among these two, zero new unresolved findings, zero invalid/missing full-tree edges, zero protected-contract changes, green normal installation/full gate and two fixed-alert timestamps. The original nine-row experiment remains separate.
  - **Pivot**: any affected copy, unsupported parent resolution, concealed peer error, omitted optional path, new unresolved finding, protected-contract change or missing acceptance evidence rejects the candidate. Keep the task blocked rather than force a major override or change the denominator.
  - **Anchor**: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al. (2017), preregistration; primary GitHub advisory APIs and published parent manifests linked in the plan.

- [ ] Restore a supported full dependency graph without forcing the watcher peer
  - **ID**: dependency-peer-compatibility
  - **Tags**: security, stability, dependencies
  - **Mode**: AFK
  - **Blocked**: needs-compatible-upstream-contract — checked published Nunjucks latest 3.2.4 requires optional Chokidar `^3.3.0`; current and latest Promptfoo require `5.0.0`, as does the app root. No supported current placement was found under these protected declarations. A future compatible parent release or separately approved upstream change must supply the missing contract; do not force an override or downgrade the root.
  - **Details**: The unchanged-source dependency tree check reports invalid Chokidar 5 at Promptfoo → Nunjucks. Optional means the peer may be absent; it does not accept an incompatible present version. npm rejects placing a peer inside its consumer. Record supported parent/peer metadata before attempting a resolution. [Stage R's constraint record](docs/plans/dependency-alert-controls.md#exact-constraint-and-source-limit) preserves the source evidence and all original nine-alert final requirements.
  - **Files**: future supported parent resolution in `package-lock.json`; dependency documentation; no root declaration or override change is pre-approved.
  - **Output**: code
  - **Acceptance**: existing full-graph validation exits zero without invalid/missing edges, unsupported peer placement, root downgrade, forced peer override, optional omission, stub change or reduced final alert requirement.
  - **Hypothesis**: an upstream-supported compatible peer contract reduces the observed invalid Chokidar edge from one to zero while all protected root declarations and optional paths remain unchanged. No presently checked latest release establishes that contract.
  - **Measurement**: first record the new compatible primary metadata and commit its exact resolution prediction; then repeat `heavy-run npx --yes --prefer-offline --package=npm@10 -- npm ls --package-lock-only --all --include=optional --json`, original audit/lock checks and `heavy-run npm run verify`. Preserve baseline ELSPROBLEMS and do not treat the runtime-only view as this result.
  - **Success**: zero invalid/missing full-tree edges, supported peer resolution, unchanged protected contracts and all normal gates passing; only actual zero satisfies the original full-graph requirement.
  - **Pivot**: any remaining conflict or unsupported placement rejects the parent choice. Keep this task blocked on compatible evidence rather than masking the error or accepting an incompatible major.
  - **Anchor**: npm 10.9.9 Arborist peer placement and edge validity source; published Nunjucks/Promptfoo manifests linked in Stage R; Basili, Caldiera and Rombach (1994), Goal Question Metric.

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
  - **Prior implementation evidence**: needs-time — 2026-10-18: the hook is on for the owner's Mac (dotfiles #160 owner overlay, `agentbrew sync` done; it fired live on a test loop). The original follow-up was due on or after 2026-10-25.
  - **Research**: 2026-11-01: the original `until <arg>` key is absent; absence is not zero. The agentbrew `for heavy-run --status` category alone is 680.07 s/day across 10 calls, but that is whole-loop wall time outside the hint's until/while scope. No comparable timeout-rate result exists. The old alias cannot decide Success or Pivot.
  - **Preparation**: the installed recorder, parser, and reporter match the reviewed source. An isolated synthetic attempt and completion produced one paired timing record without copying the marker. Prediction commits 88a830b and f4661d6 precede the new fixtures and source. The [observation procedure](docs/plans/sleep-loop-measurement-preparation.md#verified-observation-window) uses the verified start recorded privately.
  - **Next experiment**: after a full seven-day cohort, replay the exact first window with the pinned report clock. Keep the original thresholds and report unknown timing, mode, and correlation. Unavailable timeout-cause evidence cannot satisfy the no-rise guard.
  - **Blocked**: needs-field-window — wait for a full seven-day cohort. Fixture accuracy, metadata coverage, an absent alias, or a partial cohort cannot close the task.

## P2

- [ ] Decide whether pull requests must carry a Vision trace block
  - **ID**: decide-pr-vision-trace-gate
  - **Tags**: ci, docs, process
  - **Mode**: HITL
  - **Details**: `.github/workflows/pr-vision-trace.yml` failed every pull request that had no `Vision trace` block. No recent pull request body has one, so the workflow is parked: it starts only by hand. The owner decides: restore the `pull_request` trigger and add the block to the PR template and agent rules, or delete the workflow, its script and its test.
  - **Files**: `.github/workflows/pr-vision-trace.yml`, `scripts/check-pr-vision-trace.mjs`, `.github/PULL_REQUEST_TEMPLATE.md`
  - **Output**: mixed
  - **Acceptance**: The workflow either runs on every pull request and passes on a body written from the template, or it is gone with its script and test.
  - **Hypothesis**: one clear rule moves the share of merged pull requests that match the declared trace policy from 0 of the last 6 to 6 of the next 6.
  - **Measurement**: `gh pr list --state merged -L 6 --json body --jq '[.[]|.body|test("Vision trace")]|map(select(.))|length'`
  - **Success**: 6 of 6 when the gate is kept; the workflow file is absent when it is dropped.
  - **Pivot**: fewer than 5 of 6 after the gate is restored means agents do not load the rule; drop the gate.
  - **Anchor**: Forsgren, Humble and Kim (2018), Accelerate: a gate that always fails is ignored; Basili, Caldiera and Rombach (1994), GQM.

- [ ] Teach the run-goal skill that agentbrew now has hosted CI
  - **ID**: run-goal-skill-hosted-ci-wording
  - **Tags**: skills, ci, docs
  - **Mode**: AFK
  - **Details**: GitHub Actions now runs `npm run verify` on every pull request ([`docs/ci.md`](docs/ci.md)). The run-goal skill and four of its evals still describe a repo with no CI and tell the agent to merge on the local gate alone. The text stays correct for repos without CI, but it must also say what to do when hosted checks exist: wait for the check, read the log on a failure, and never merge on a red or pending check. The session that owns the run-goal retro makes this edit; the hosted-CI change did not touch the skill on purpose.
  - **Files**: `skill-plugins/workflow/run-goal/SKILL.md`, `skill-plugins/workflow/run-goal/evals/evals.json`
  - **Output**: mixed
  - **Acceptance**: The skill names both cases (hosted checks present, no hosted checks). One new eval covers a repo with a pending hosted check, and the agent waits for it.
  - **Hypothesis**: one explicit rule moves merges made while a hosted check is red or pending from an unknown number to 0 of the next 10 goal merges.
  - **Measurement**: `gh pr list --state merged -L 10 --json number,statusCheckRollup --jq '[.[]|select(any(.statusCheckRollup[]?; .conclusion!="SUCCESS" and .conclusion!="SKIPPED" and .conclusion!="NEUTRAL"))]|length'`
  - **Success**: 0 of 10.
  - **Pivot**: 2 or more of 10 means the rule is not loaded at merge time; move the check into a deterministic hook instead of skill text.
  - **Anchor**: Forsgren, Humble and Kim (2018), Accelerate (change failure rate).

- [ ] Make the launchagent queue test Q01 pass under machine load
  - **ID**: launchagent-queue-q01-load-timeout
  - **Tags**: tests, reliability
  - **Mode**: AFK
  - **Details**: On 2026-11-09 `src/sync/launchagent-queue.test.ts` test Q01 ("keeps repair behind selected queue admission") failed 3 of 3 full-gate runs with `expected 124 to be +0` while the load average was 25 to 30. It passed 12 of 12 runs under `heavy-run --exclusive` at load 8.5. Exit 124 is the 3.5-second timer inside the test's own fixture queue, so the test measures machine speed, not queue order. Replace the wall-clock limit with an ordering assertion, or wait on an explicit ready signal.
  - **Files**: `src/sync/launchagent-queue.test.ts`
  - **Output**: code
  - **Acceptance**: Q01 passes 20 of 20 runs while a second full gate runs on the same machine, and it still fails when the queue admission order is broken on purpose.
  - **Hypothesis**: removing the fixed 3.5-second timer moves Q01 failures under load from 3 of 3 to 0 of 20.
  - **Measurement**: `for i in $(seq 20); do npx vitest run src/sync/launchagent-queue.test.ts -t Q01 >/dev/null 2>&1 || echo fail; done | wc -l`, run while `heavy-run npm run verify` runs in a second worktree.
  - **Success**: 0 failures of 20.
  - **Pivot**: 2 or more failures of 20 means the queue itself is slow under load, not only the test; measure queue admission time and file that as its own task.
  - **Anchor**: Luo et al. (2014), An Empirical Analysis of Flaky Tests (async wait is the top cause).

- [ ] Move the hosted Linux job back to ubuntu-latest when Playwright supports it
  - **ID**: ci-ubuntu-latest-playwright
  - **Tags**: ci, tests
  - **Mode**: AFK
  - **Details**: On 2026-11-10 the first hosted run of `.github/workflows/ci.yml` failed on `ubuntu-latest` at the `playwright-install` step: `Playwright does not support chromium on ubuntu26.04-x64`. The job now runs on `ubuntu-24.04`. GitHub removes old images over time, so check the installed Playwright version against the newest image and move the label back when Chromium installs there.
  - **Files**: `.github/workflows/ci.yml`, `package.json`
  - **Output**: code
  - **Acceptance**: the `verify` job passes on `ubuntu-latest`, and the pin comment in `ci.yml` is gone.
  - **Hypothesis**: a Playwright version with a Chromium build for the newest image moves `playwright-install` failures on `ubuntu-latest` from 1 of 1 to 0.
  - **Measurement**: `gh workflow run ci.yml --ref <branch>` on a branch with `ubuntu-latest`, then `gh run view <id> --json jobs --jq '.jobs[].conclusion'`.
  - **Success**: every job prints `success`.
  - **Pivot**: if no Playwright release supports the image 60 days before GitHub retires `ubuntu-24.04`, run the browser tests in the Playwright container image instead.
  - **Anchor**: Forsgren, Humble and Kim (2018), Accelerate (change failure rate).

- [ ] Detect duplicate Ollama servers before they split the local prompt cache
  - **ID**: ollama-single-server-readiness
  - **Tags**: opencode, local-ai, reliability, readiness
  - **Mode**: AFK
  - **Details**: On 2026-11-09 the Ollama desktop app and `com.agentbrew.ollama` competed for port 11434. The managed server repeatedly logged `address already in use`; requests alternated between separate caches and runner settings, causing fresh-session smoke times to vary from 16 seconds to a 120-second timeout. The duplicate app was stopped and three runs then passed in 48, 26, and 16 seconds. Add a supported readiness check that identifies this ownership conflict without killing a user process.
  - **Files**: `src/mcp/opencode-bootstrap.ts`, OpenCode/Ollama readiness checks and tests, `README.md`.
  - **Output**: code
  - **Acceptance**: the check reports duplicate Ollama listeners or server processes and names the managed endpoint; one managed server passes; no user process is stopped automatically.
  - **Hypothesis**: an explicit duplicate-server check makes this cache-splitting failure visible before smoke tests, reducing undiagnosed competing-server states from one observed incident to zero in the final fixture and live check.
  - **Measurement**: run the new check with one managed server and with an isolated duplicate-server fixture, then rerun the three no-override smoke tests.
  - **Success**: the fixture reports the conflict, the live single-server check passes, and all three smoke runs finish within 120 seconds.
  - **Pivot**: if listener inspection cannot attribute ownership reliably, report the endpoint and process evidence without automatic remediation instead of changing ports.
  - **Anchor**: Ollama runner and `ollama serve` logs from 2026-11-09; Basili, Caldiera and Rombach 1994 (GQM).

- [ ] Remind an agent to draft a review request after adding reviewers
  - **ID**: review-ask-classifier-822
  - **Tags**: agents, hooks, communication
  - **Mode**: AFK
  - **Details**: Issue #822 needs a reminder-only hook and a generic rule, without sending chat messages. The [classifier preparation](docs/plans/review-ask-classifier-822.md) and its [gate](docs/plans/review-ask-classifier-gate-822.md) cover bounded synthetic CLI inputs through `hooks/lib/review-request-classifier-test.py`, `hooks/checks/review-request-classifier.test.sh` and `hooks/checks/review-request-classifier-gate.test.sh`. The [report parser pivot](docs/plans/review-ask-report-pivot-822.md), [imported-report preparation](docs/plans/review-ask-imported-report-822.md) and their discovery plans prepare `hooks/lib/review_ask_report.py` and its synthetic gate controls. The [owned runner preparation](docs/plans/review-ask-inprocess-runner-822.md) and its [discovery follow-up](docs/plans/review-ask-runner-discovery-followup-822.md) add bounded synthetic event controls. They do not qualify a real event, MCP request or optional channel.
  - **Output**: code
  - **Acceptance**: Qualify actual event and command-success semantics before enabling a hook. Register separate real-agent and MCP controls before claiming support; keep all messages as drafts.
  - **Hypothesis**: The pure classifier recognizes 2/2 supported synthetic reviewer forms and yields 0/8 false positives, without process or network calls.
  - **Measurement**: Run the two wrapper commands and existing consumer suite in the registered classifier and gate plans.
  - **Success**: Two positives, eight negatives and all six wrapper controls pass with zero output leaks or classifier process/network calls.
  - **Pivot**: Any missed positive, false positive, disclosure, unexpected call or existing-consumer regression rejects the classifier approach.
  - **Anchor**: Existing PR command parser; Claude hooks reference; Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (preregistration).

- [ ] Measure whether a chat rule prevents duplicate follow-ups
  - **ID**: chat-message-rule-decision-821
  - **Tags**: agents, evaluation, communication
  - **Mode**: AFK
  - **Details**: Issue #821 needs a decision measurement before a rule change. The registered plan is [chat message rule](docs/plans/chat-message-rule-821.md); its first baseline stopped on an invalid response. The separate [schema pivot](docs/plans/chat-rule-schema-pivot-821.md) prepares `scripts/chat-rule-schema-protocol.mjs` and `scripts/run-chat-rule-schema-controls.sh` without a model call. The earlier preparation owns `scripts/eval-chat-message-rule-821.mjs`, `scripts/chat-rule-tap.mjs`, and `scripts/run-chat-rule-controls.sh`. None sends real messages or establishes model performance.
  - **Output**: code
  - **Acceptance**: Preserve the failed original baseline and its receipt. Before a new model attempt or candidate rule, register a distinct protocol, independently selected cases, exact measurement and numeric thresholds. Keep real chat untouched.
  - **Hypothesis**: The original prediction was 4/4 correct decisions and at least one fewer error than its frozen baseline; that experiment stopped before a baseline was captured. A new decision prediction must be registered separately.
  - **Measurement**: The original plan's baseline and candidate commands are historical and must not be rerun. Register new exact commands, model, cases, receipt and digest before a new attempt.
  - **Success**: The original 4/4 and one-fewer-error threshold remains historical; a distinct experiment must set its own numeric decision threshold before measurement.
  - **Pivot**: The original invalid response rejects that approach and its empty receipt stays reserved. A distinct approach must register its own pivot before measurement.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (preregistration).

<!-- Rust migration requested 2026-11-01: preparation lands before production ports. -->

- [ ] Re-plan the Rust migration around measured user benefit
  - **ID**: rust-plan-replan-after-validation
  - **Tags**: migration, rust
  - **Mode**: HITL
  - **Details**: The 2026-11-09 validation review found the plan cannot run as written and puts the measured hot path (hook helpers) at step 16. Apply the seven MUST findings in [Rust migration](docs/plans/rust-migration.md#validation-review-2026-11-09) to both plans and task queues, and get the owner's decision on each SHOULD change (hook dispatcher first, cold-path exceptions, test tasks, smaller inventory). Porting stays paused until this lands.
  - **Output**: docs
  - **Acceptance**: Both plans carry no open MUST finding; every remaining slice names a user-benefit metric or is a recorded exception; the owner's decisions are written in the plans.
  - **Hypothesis**: Fixing the seven MUST findings moves the count of plan steps that cannot run as written from 7 to 0, so the first port can start with a runnable gate.
  - **Measurement**: `rg -c '^[0-9]+\. \*\*' docs/plans/rust-migration.md` on the "Findings to fix" list after each finding is resolved and removed — target 0.
  - **Success**: 0 open MUST findings in both plans, confirmed by an independent reviewer.
  - **Pivot**: If more than 2 MUST findings cannot be resolved without dropping gate G, abandon the all-code migration and keep only measured hot-path slices.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration).


- [ ] Account for every executable before migrating it
  - **ID**: rust-source-inventory
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Create a reviewed component manifest and minimal Rust validator so embedded programs, extensionless entrypoints and generated executables cannot escape scope. Classify UI and necessary shell narrowly. Record frozen-support residue without adding work for it. Plan: [Rust migration](docs/plans/rust-migration.md). Diagnostic preparation: [fixed transport reasons](docs/plans/rust-transport-diagnostic-reasons.md); the supporting Rust foundation is preserved in [draft PR #767](https://github.com/fyodoriv/agentbrew/pull/767) at checkpoint `6e32d628`; it remains unmerged and inventory acceptance remains pending. Supplemental literal-writer prediction: [registration](docs/plans/rust-literal-adapter-registration-proposal-20261105.md). It adds a bounded corpus without changing inventory acceptance.
  - **Output**: code
  - **Acceptance**: Each executable component has an owner, caller boundary, migration slice or justified exception. Planted omissions fail the validator. No production replacement occurs in this preparation task.
  - **Hypothesis**: Content and caller analysis makes executable-scope classification complete at 100%, with 0 unclassified owned components and 0 missed planted omissions.
  - **Measurement**: `heavy-run cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- inventory --check` — proposed command delivered by this task, not currently available.
  - **Success**: 100% classification; 0 unclassified owned executable components; every planted omission is rejected.
  - **Pivot**: Any missed embedded or extensionless component -> abandon suffix-only discovery and use content/caller analysis. Missing evidence is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration).

- [ ] Measure compatibility and resource use before replacing runtime code
  - **ID**: rust-measurement-harness
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Land the shared Rust measurement engine and versioned workload/receipt protocol as a preparation PR. Dotfiles consumes a pinned adapter to this owner implementation. Seal unchanged-source baselines; each later port commits actual numeric predictions before replacement code. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-source-inventory
  - **Acceptance**: Capture exits, output, file bytes/permissions/side effects, child lifetime, cold/warm execution, CPU, peak RSS and install footprint in private sanitized receipts. Pin source, fixtures, toolchain, platform and cache. Reject planted semantic, privacy, cleanup, missing-sample and resource failures.
  - **Hypothesis**: Registered differential workloads and sealed baselines make 100% of planted invalid receipts and behavior/resource violations fail before any production port can pass.
  - **Measurement**: `heavy-run cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- harness-selftest` — proposed command delivered by this task; no baseline result is claimed.
  - **Success**: 100% of registered planted violations rejected; 0 missing/contaminated measurements reported as passing; baseline replay meets its preregistered noise bound.
  - **Pivot**: Any false pass or non-repeatable baseline -> stop ports and change instrumentation or workload design, not thresholds after results.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Run a native candidate beside the current CLI with proven rollback
  - **ID**: rust-native-delivery
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Add locked Rust builds, asset resolution and per-slice candidate dispatch for scratch installs. Keep the live entrypoint until the slice passes G; prove atomic replacement and recovery first. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-measurement-harness
  - **Acceptance**: Scratch install, missing assets, wrong architecture, interrupted update and rollback preserve approved configuration and executable ownership. Keep per-slice before/after and rollback receipts.
  - **Hypothesis**: Native dispatch succeeds in 100% of supported scratch cases and recovery in 100% of interruption cases, with 0 behavior/safety regressions and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-native-delivery --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G in the linked plan; 100% supported scratch dispatch and rollback; 0 ownership errors.
  - **Pivot**: Any rollback, asset or compatibility failure -> change dispatch before moving callers. An upper resource ratio above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Preserve exact text and file safety through native parsing
  - **ID**: rust-text-and-file-primitives
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Move parsing, redaction, environment and filesystem leaves behind Rust interfaces. Preserve untouched bytes, encodings, symlink rules, modes and atomic writes. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-native-delivery
  - **Acceptance**: Escaped JSON, CRLF, unknown keys, traversal, symlink swaps, malformed input and planted credentials preserve approved output and rejection behavior. Keep per-slice before/after and rollback receipts.
  - **Hypothesis**: 100% of converted leaf workloads run without an owned legacy interpreter, with 0 approved-behavior/safety regressions and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-text-and-file-primitives --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G; 0 unintended byte changes, unexpected writes or missed planted secrets.
  - **Pivot**: Any corruption, unexpected write or secret false negative -> change parser/I/O boundary. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Keep child lifetimes and resource limits correct in native adapters
  - **ID**: rust-process-primitives
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port safe argv, environment scrubbing, retries, scheduler calls, timeouts, signals and owned process-group cleanup. Consume machine-wide admission and worker budgets; separate queue wait from execution. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-native-delivery
  - **Acceptance**: TERM/INT, timeout, wrapper death, failed probes, hostile environment and child escape controls leave no owned work alive or reservation released early. Keep per-slice before/after and rollback receipts.
  - **Hypothesis**: 100% native converted execution preserves approved behavior with 0 orphaned children, budget bypasses or secret disclosures, and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-process-primitives --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G; 0 orphaned owned children, admission bypasses or unintended environment disclosures.
  - **Pivot**: Any lifecycle/admission violation -> replace the process-ownership design before moving consumers. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Validate the November skills-target delta in native runtimes
  - **ID**: validate-skills-targets-2026-11
  - **Tags**: skills, compatibility, validation, blocked-runtime
  - **Output**: measurement
  - **Details**: The 2026-11-01 research found allowed upstream target IDs missing from the local name intersection. The exact IDs, claimed project/user paths and availability checks are in `docs/competition/skills-compatibility-2026-11-01.md`. Same-name commands were not found; binary aliases and application IDs remain unverified. Shared directories are not client detection. Reconcile `kimi-code-cli` with existing `kimi-cli`; keep Eve and PromptScript project-only. Preserve the tested Codex feature override, frozen Augment and all four policy exclusions. Do not register a client from marketing alone.
  - **Measurement**: First obtain a native runtime or a verified native probe for each selected target. Commit a preparation PR with the exact native-load commands and fixture harness before changing adapters. Run those commands plus `npm run verify`; record real native results separately from mocked filesystem controls.
  - **Hypothesis**: Validated adapters load the expected skill in every selected native target while preserving existing target behavior and user-owned files.
  - **Success**: Native-load failure rate 0%, user-file loss rate 0% and existing-target regression rate 0% for every adapter retained. Unverified candidates stay unregistered.
  - **Pivot**: At least 1 native-load failure or ownership regression rejects that adapter approach; do not widen support until a replacement approach is measured.
  - **Anchor**: Agent Skills specification; Basili, Caldiera and Rombach 1994 (GQM); `docs/competition/skills-compatibility-2026-11-01.md`.
  - **Files**: src/core/agents.yaml, src/core/agent-name-map.ts, native probe tests, docs/support-matrix.md
  - **Acceptance**: Each candidate has a native proof or an explicit unresolved runtime dependency; only proved adapters are published. The weekly recurring acceptance completes only after its allowed target delta is resolved.
  - **Blocked**: required-native-runtime — no native probe was verified for the candidate identities. Public source research is available and already recorded; only native support validation is blocked. Commit runnable instrumentation before adapter changes.

- [ ] Measure the missing Q4 dissolution capacity and story evidence
  - **ID**: measure-dissolution-capacity-2026-q4
  - **Tags**: strategy, measurement, blocked-input
  - **Output**: measurement
  - **Details**: `docs/competition/dissolution-reviews/2026-Q4.md` confirms the source-size condition, but the compound kill trigger also requires user-story gains. The separate capacity trigger requires current maintenance effort below 0.5 FTE. Neither can be inferred from commits, stars or source lines. Reuse an owner-approved effort/outcome source; do not build a time tracker or publish personal activity records.
  - **Hypothesis**: Goal: ground the existing dissolution decision in effort and outcomes. Question: can an owner-approved source reproducibly supply both missing inputs? Prediction: pre-registering its query, denominator and period will yield source-backed inputs or explicit unknowns, preserving the existing 0.5 FTE threshold and compound size/story-gain criterion.
  - **Measurement**: Preparation only. Once the owner identifies an available effort/outcome source and denominator, commit its exact read-only query and measurement period before observing or changing the kill decision. Until then, no runnable capacity query exists and no FTE value is claimed.
  - **Success**: Both missing trigger inputs have reproducible source-backed measurements, or remain explicitly unknown. No kill decision is changed from proxy metrics.
  - **Pivot**: If either input is unavailable, retain the unknown result and current keep-and-shrink decision; do not replace the missing input with a vanity metric.
  - **Anchor**: Existing VISION kill criteria; Forsgren, Humble and Kim 2018; Basili, Caldiera and Rombach 1994.
  - **Files**: docs/competition/dissolution-reviews/2026-Q4.md, docs/VISION.md only after a measured decision
  - **Acceptance**: A preparation artifact fixes the query and period before measurement; a later report records the actual evidence and decision. No source deletion is included.
  - **Blocked**: needs-owner-measurement-source — current maintenance hours and comparable user-story outcomes are not recorded in the reviewed sources. This task does not authorize external account setup or data collection.

- [ ] Report Hallmark's render wait that never ends on apps that poll
  - **ID**: hallmark-render-wait-upstream
  - **Blocked**: owner step: say yes to a public issue on nutlope/hallmark (a third-party repo); the `report-upstream` skill drafts and scrubs it first
  - **Details**: In careerbrew's Hallmark redesign (careerbrew#252, 2026-10-27), Hallmark's render check waited for the page's network to go fully quiet. The app polls every 5 s, so the check timed out on every view. A local copy with a looser wait (DOM content loaded plus a short settle) worked. Propose that wait, or a setting for it, upstream.
  - **Hypothesis**: the Hallmark render audit finishes on a polling app with 0 timeouts, down from 8 of 8 views.
  - **Measurement**: `/hallmark audit web/` on careerbrew, counting views that time out.
  - **Success**: 0 timeouts with the upstream fix.
  - **Pivot**: if upstream declines, keep a local wrapper in agentbrew with the looser wait.
  - **Anchor**: Basili, Caldiera & Rombach 1994 (GQM).

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

- [ ] Checkups show their last run and record each run (issue #572)
  - **ID**: checkup-run-record
  - **Mode**: AFK
  - **Implementation decision**: One Rust record owner serves the existing Agentbrew and dotfiles callers. Follow the [registered controls](docs/plans/checkup-run-records.md).
  - **Tags**: checkup, state
  - **Details**: Issue #572: one JSON file per checkup under `${XDG_STATE_HOME:-~/.local/state}/checkups/<checkup>.json` with `finished_at`, `result`, and `commits`. Show the previous completion at start and save a valid completion at end. Issue #764's source-build adapters reuse this recorder/publisher under [separately preregistered controls](docs/plans/source-build-prebuilt-764.md) (initial registration `81b7c9b`, cache extension `0d02ed8`). Qualify the original six callers and later targets under this task's existing controls.
  - **Files**: `scripts/checkup.sh`, `scripts/build-checkup-run.sh`, `scripts/build-source.sh`, `scripts/native-build-tools.mjs`, `scripts/build-native-prebuilt.mjs`, rendered checkup template, generic checkup CLI and Rust record owner, dotfiles tooling-checkup adapter and skill
  - **Output**: code
  - **Acceptance**: Preserve prior completed records and rich history. Qualify all three producers, stale recovery, skill decisions and required installed targets.
  - **Hypothesis**: Complete FIRST/TWO cases rise from a predicted 0/6 to 6/6, with zero unsafe writes, stale replays or extra export probes.
  - **Measurement**: Run the [registered commands](docs/plans/checkup-run-records.md) for observer calibration, six selected caller cases, safety, skill and installed artifact controls.
  - **Success**: 6/6 caller cases and 2/2 completed runs in each TWO. Pass every safety variant, 4/4 scoped model decisions and 4/4 initial native families. Keep required later target qualifications open until measured.
  - **Pivot**: Reject any semantic miss, unsafe write, extra probe or history regression. Missing setup, provider or target proof is inconclusive.
  - **Anchor**: Issue #572; Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (preregistration)

- [ ] Scroll and screenshot a Google Doc over CDP without focus (issue #561)
  - **ID**: gdoc-cdp-screenshots
  - **Mode**: AFK
  - **Implementation decision**: Extend the existing Google Docs workflow through an adapter over maintained browser transport. The bounded source search did not recover the named old script. Its location does not block preparation. Keep real Google Docs rendering and focus proof separate from synthetic transport controls; [preparation routing](docs/plans/owned-issue-preparation.md) records the limits.
  - **Progress**: The [Rust preparation](docs/plans/gdoc-capture-reducer.md) passed 14/14 reducer and 11/11 wire and output cases. Native ownership, cleanup, rendering and focus proof remain open.
  - **Tags**: browser, docs
  - **Details**: Issue #561: open the doc in its own CDP tab, scroll page by page, one screenshot per page, no keystrokes or window activation, close the tab after.
  - **Files**: a skill script under `skill-plugins/`
  - **Output**: code
  - **Acceptance**: as in issue #561
  - **Hypothesis**: visual checks of long Docs need 0 focus steals and cover every page.
  - **Measurement**: run on a 10-page test doc
  - **Success**: 10 screenshots, 0 focus changes
  - **Pivot**: CDP cannot scroll the Docs canvas -> use the Docs export to PDF instead
  - **Anchor**: issue text; Forsgren, Humble, Kim 2018 (lead time)

- [ ] page-zero-errors skill: a CDP gate for console and network errors (issue #563)
  - **ID**: page-zero-errors-skill
  - **Mode**: AFK
  - **Implementation decision**: The former upstream was removed from the catalog in `43465de` and remains unavailable. The [Rust reducer and loopback preparation](docs/plans/page-error-loopback.md) tests bounded synthetic capture. Real Chrome admission, session coverage, and capture cutoff still need proof before an adapter can report success.
  - **Tags**: browser, skills, verification
  - **Details**: Issue #563 requires a skill and a capture command that exits non-zero on console errors, exceptions, or 4xx/5xx requests. Implement the capture in Rust. Sign-in and gateway hosts are settings.
  - **Files**: `skill-plugins/`, README skill list
  - **Output**: code
  - **Acceptance**: as in issue #563
  - **Hypothesis**: frontend changes called done with page errors drop to 0.
  - **Measurement**: the wrapper on a fixture page with one console error and one 404
  - **Success**: exit 1 naming both; exit 0 on a clean page
  - **Pivot**: CDP capture misses errors before attach -> launch the page under the capture instead
  - **Anchor**: issue text; Forsgren, Humble, Kim 2018 (lead time)

- [ ] History-wide leak audit before a plugin goes public (issue #564)
  - **ID**: plugin-history-leak-audit
  - **Mode**: AFK
  - **Implementation decision**: Extend the existing plugin audit boundary and wrap gitleaks. The scanner is already installed on the verified development machine; do not install it implicitly on other machines. Use the [synthetic registration](docs/plans/plugin-history-leak-audit.md) before production work.
  - **Tags**: security, plugins, oss
  - **Details**: Issue #564: scan every commit on every ref (emails, messages, ref names, paths, added lines) with gitleaks on a bare mirror and a fixed config; `--fresh` mode; patterns from a user env file.
  - **Files**: `src/plugins/`, the plugin publishing guide, the CLI reference
  - **Output**: code
  - **Acceptance**: as in issue #564
  - **Hypothesis**: leaks in history found before a plugin goes public: seeded leaks found 5 of 5.
  - **Measurement**: `JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/plugins/leak-audit-history.test.ts src/plugins/leak-audit.test.ts`
  - **Success**: every case from S01 through S05, 8/8 calibration cases, 8/8 control groups, zero disclosure or false-clean results.
  - **Pivot**: Any missed surface, failed control or incomplete input accepted as clean stops the candidate.
  - **Anchor**: issue text; Forsgren, Humble, Kim 2018 (lead time)

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
  - **Prior implementation evidence**: needs-time — 2026-10-22: `scripts/worktree-deps.sh` skips `npm ci` when `package-lock.json` is unchanged since its last install, runs `npm ci --prefer-offline --no-audit --no-fund` otherwise, and AGENTS.md now names it as the install command (PR feat/speed-up-npm-ci). Local run on the `npm ci` path: re-run 14.4–16.6 s → 0.02 s; a fresh install stays 9–11 s with a warm cache. 7-day baseline before the change: 4m59s/day (38x in 11 sessions, p95 5m02s). Measure on or after 2026-10-29 with `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (the agentbrew `npm ci` line; add the `bash worktree-deps.sh` line, where installs move), then close or pivot.
  - **Research**: 2026-11-01: exact repo key groups total 235.70 s/day (npm ci 188.02 plus worktree-deps 47.68). This exceeds the old category threshold, but these are whole-tool-call durations assigned to one dominant command; chained work and queue wait cannot be separated by the aggregate. It is not isolated npm runtime or proof that the cache remedy failed. Keep every historical observation and report tooling-started attribution as unknown.
  - **Diagnostic**: 2026-11-01: nine of nine warm-cache leaf trials were valid on committed source `e76c9a1be454`. Medians were npm ci 9.2188 s, helper fresh 1.0537 s and helper rerun 0.0128 s; ratios 0.11430 and 0.00139 met both registered ratio thresholds. The private harness and prior plan hash match. This does not measure daily cost, chained work or queue time.
  - **Next experiment**: verify installed recorder/helper/report source and record a private UTC cutover. Collect a new full seven-day cohort with the original Success/Pivot thresholds. Neither diagnostic fixture ratios nor metadata coverage can close the daily-cost task.
  - **Blocked**: needs-field-window — judge the field outcome only after a new full seven-day cohort from verified installed-source cutover. Normal delivery must verify deployment and record that cutover privately. Fixtures, complete tagging and unavailable attribution do not satisfy the outcome or timeout guard.

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
  - **Prior implementation evidence**: needs-time — 2026-10-22: `npm run lint:changed` (`scripts/lint-changed.sh`) runs the local `node_modules/.bin/biome` on changed files only, and AGENTS.md names it as the lint command (PR feat/speed-up-npx-biome). Local run: `npx biome check src scripts` 1.3–1.5 s → `npm run lint:changed` 0.6–0.8 s (one changed file). So Biome itself is not the slow part: the review keys a compound command on its first heavy command, so `npx biome … && npx vitest …` lines carry the test time. 7-day baseline before the change: 4m19s/day (29x in 6 sessions, p95 6m14s). Measure on or after 2026-10-29 with `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (the agentbrew `npx biome` line plus the `npm run lint:changed` line); if their sum stays over 3 min/day, the chained test runs belong to `speed-up-agentbrew-test-loop`, then close or pivot.
  - **Prior measurement limit**: measurement-preparation — 2026-11-01: the direct repo row is 175.34 s/day, above the 60 s Success threshold; a for-wrapped row adds 85.86 s/day of whole-loop wall time, not proven Biome runtime. Keep the task open. Verify the new wrapper-key deployment and collect a fresh full seven-day cohort; do not turn an absent lint:changed row into zero.
  - **Blocked**: needs-field-window — judge the field outcome only after a new full seven-day cohort from verified installed-source cutover. Normal delivery must verify deployment and record that cutover privately. Fixtures, complete tagging and unavailable attribution do not satisfy the outcome or timeout guard.

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
  - **Prior implementation evidence**: needs-time — 2026-10-22: one clonefile(2) call replaces `cp -cR`, and a re-run with an unchanged lockfile keeps `node_modules` (PR feat/speed-up-bash-worktree-deps-sh). Local run: fresh worktree 11.7–13.3 s → 1.2 s, re-run 16.3–18.9 s → 0.07 s. 7-day baseline before the change: 6m52s/day (35x in 6 sessions, p95 6m31s). Measure on or after 2026-10-29 with `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (the agentbrew `bash worktree-deps.sh` line), then close or pivot.
  - **Prior measurement limit**: measurement-preparation — 2026-11-01: the direct repo row is 47.68 s/day, but tooling-started sessions add 148.79 s/day of the same key and a repo loop adds 1.89 s/day. A narrow row alone does not prove the covered outcome. Keep the task open; verify wrapper-key deployment and collect the same project scopes in a fresh full seven-day cohort.
  - **Blocked**: needs-field-window — judge the field outcome only after a new full seven-day cohort from verified installed-source cutover. Normal delivery must verify deployment and record that cutover privately. Fixtures, complete tagging and unavailable attribution do not satisfy the outcome or timeout guard.

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
  - **Prior implementation evidence**: needs-time — 2026-10-22: `verify:changed` now runs `tsc`, `lint:changed`, and `vitest related` on a code diff instead of the whole `npm run verify`; the full gate keys the hook fixtures on the files they run and shares its step cache across worktrees; AGENTS.md points the inner loop at `npm test` (PR feat/speed-up-agentbrew-test-loop). Measured split of the 7 days before (perf log joined to the commands): about half of the `verify:changed` time was code diffs that ran the full gate, and most `npx vitest` time was whole folders and `new-project-contract.test.ts`. Local runs: a one-file `src/` diff 9m52s (old path, the full gate, load ~90) → 30 s (load 77); hook fixtures 128 s → 0.7 s cached in a second worktree. 7-day baseline before the change: 39m32s/day (`npx vitest` 15m36s, `verify:changed` 15m07s, `verify` 8m49s). Measure on or after 2026-10-29 with `python3 ~/.claude/skills/tooling-checkup/scripts/agent_time_review.py --days 7` (sum of the agentbrew `npm run verify:changed`, `npx vitest`, and `npm run verify` lines), then close or pivot.
  - **Prior measurement limit**: measurement-preparation — 2026-11-01: direct repo rows total 720.10 s/day, but heavy-run npm adds 171.75 s/day with unknown leaf commands and loop-prefixed vitest adds 8.80 s/day. Tooling-started sessions add more unallocated test time. Keep the task open; do not assign ambiguous history to tests or ignore it. Verify wrapper-key deployment and start a fresh full seven-day cohort.
  - **Blocked**: needs-field-window — judge the field outcome only after a new full seven-day cohort from verified installed-source cutover. Normal delivery must verify deployment and record that cutover privately. Fixtures, complete tagging and unavailable attribution do not satisfy the outcome or timeout guard.

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

- [ ] Change configuration natively without losing ownership
  - **ID**: rust-state-and-agentfile
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Migrate state/settings, Agentfile merge/mutation, manifests, paths and locks. Preserve schemas, layers, user text, transaction recovery and no-op behavior. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-text-and-file-primitives, rust-process-primitives
  - **Acceptance**: Concurrent updates, failed writes, stale locks, relative paths, unknown fields and repeated no-ops preserve approved state and recovery. Keep before/after and rollback receipts.
  - **Hypothesis**: 100% of converted configuration workloads run natively with 0 lost updates, foreign-owner writes or approved-behavior regressions, and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-state-and-agentfile --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G in the linked plan; 0 lost updates, unowned changes or persistent no-op mutations.
  - **Pivot**: Any data loss/ownership mismatch -> change transaction and merge boundary. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Install and update source content through native ownership-aware adapters
  - **ID**: rust-catalog-and-sources
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port catalog/source registration, fetch/cache, skill tools, import/install/update/remove and pruning. Keep upstream delegation, provenance and user-kept targets. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-state-and-agentfile
  - **Acceptance**: Offline, changed-ref, deleted-source, duplicate-name, interrupted fetch and user-modified-target controls preserve approved outcomes and ownership. Keep before/after and rollback receipts.
  - **Hypothesis**: 100% of converted local source operations run natively with 0 unowned removals, provenance collisions or behavior regressions, and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-catalog-and-sources --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G; 0 unowned removals or provenance collisions; delegated upstream tools stay delegated.
  - **Pivot**: Any provenance/removal defect -> change source/cache adapter, not a silent fallback. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Deploy skills and content natively with the same ownership rules
  - **ID**: rust-sync-content
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port skills, rules, commands, agent definitions and instruction composition one engine per measured slice. Preserve source discovery, primary-host parity, owner edits and upstream delegation. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-state-and-agentfile, rust-catalog-and-sources
  - **Acceptance**: Both primary hosts receive equivalent supported content. No-op, dry-run, rename, stale-owned-output, foreign-file and failed-write cases retain exact ownership behavior. Keep before/after and rollback receipts. Preserve selected-pull guards for pre-sync installation, live rule aliases and deferred staged-skill cleanup; use the CLI pull and source-skill-prune regressions as sealed migration controls.
  - **Hypothesis**: 100% native converted sync cases preserve primary-host behavior with 0 foreign mutations and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-sync-content --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G; 100% supported primary-host parity; 0 foreign-file writes or persistent no-op mutations.
  - **Pivot**: Any primary-host gap or ownership loss -> change engine contract before the next engine. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Reconcile native agent settings without changing trust or opt-ins
  - **ID**: rust-sync-configuration
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port MCP/model/hook/permission/statusline/helper reconciliation and watcher/repair scheduling by engine. Preserve routing, unknown keys, hook trust, opt-ins and scheduler environment. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-state-and-agentfile
  - **Acceptance**: Dry-run writes nothing; reapply is a no-op; primary-host config, disabled features, owner-edited settings, restart and source-refresh cases preserve approved behavior. Keep before/after and rollback receipts. Selected pulls must not publish excluded Git MCP runtimes; retain the runtime and accepted source receipt controls from the pull-source-caches regression.
  - **Hypothesis**: 100% native converted configuration sync preserves behavior with 0 unauthorized hook activations, re-enabled opt-outs or no-op mutations, and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-sync-configuration --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G; 0 trust/opt-in/ownership regressions and 0 persistent no-op mutations.
  - **Pivot**: Any trust, opt-in or source-refresh regression -> revise configuration ownership. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Manage MCP lifecycle through bounded native adapters
  - **ID**: rust-mcp-lifecycle
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port registry, entrypoint resolution, pin/build registration, setup, validation, probing and healing in measured slices. Baseline delivered re-pin fixes; preserve delegated and optional-model boundaries. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-state-and-agentfile, rust-process-primitives, rust-catalog-and-sources
  - **Acceptance**: Runnable directory/symlink entrypoints, refused pins, failed builds, bad schemas, offline registry and bounded probes preserve approved register-or-rollback behavior. Keep before/after and rollback receipts.
  - **Hypothesis**: 100% native converted lifecycle cases preserve behavior with 0 unverified build registrations or surviving probe children, and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-mcp-lifecycle --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G; 0 invalid registrations or surviving probe children; unsupported/unknown outcomes remain honest.
  - **Pivot**: Any invalid registration or cleanup failure -> change lifecycle boundary and retain the previous path. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Keep shared semantic memory private through native integration
  - **ID**: rust-memory-integration
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port owned memory transport/readiness, pack/provenance ledgers, backup and lifecycle bridges. Delegate the service itself; preserve enablement, deduplication, retention and privacy choices. Keep native chat histories separate. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-state-and-agentfile, rust-sync-configuration, rust-process-primitives
  - **Acceptance**: Synthetic enabled/disabled, stale-owner, changed-pack, corrupt-backup and unavailable-service cases preserve records and honest errors. No conversation history is imported or synchronized. Keep before/after and rollback receipts.
  - **Hypothesis**: 100% native converted integration cases preserve approved behavior with 0 private payload leaks, unauthorized record deletions or chat-history imports, and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-memory-integration --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G in the linked plan; 0 privacy/retention/opt-in regressions, private payloads in receipts or native history imports.
  - **Pivot**: Any privacy/retention/opt-in regression -> stop and change integration boundary. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Keep signed plugins and public-write approvals intact in native flows
  - **ID**: rust-plugin-trust-and-feedback
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port plugin signatures/scopes, overlay composition, contribution drafts, report sanitization and publication adapters. Preserve approvals and human-only allowances; use fake external writers. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-state-and-agentfile, rust-catalog-and-sources, rust-process-primitives
  - **Acceptance**: Wrong/revoked signer, capability escalation, malformed overlay, private references and denied publication fail closed. Approved local drafts work; tests never post publicly. Keep before/after and rollback receipts.
  - **Hypothesis**: 100% native converted trust/draft cases preserve behavior with 0 new false permits, disclosures or real test publications, and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-plugin-trust-and-feedback --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G; 0 trust bypasses, private-reference disclosures or real public writes from tests.
  - **Pivot**: Any trust/publication bypass -> abandon the affected adapter design before rollout. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Detect and repair drift through native diagnostics
  - **ID**: rust-diagnostics-and-repair
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port health snapshots, drift decisions/fixes, repair provenance, status/ops and next steps. Require post-fix verification; retain unknown/unsupported states, dry-run and changed-source detection. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-state-and-agentfile, rust-sync-content, rust-sync-configuration, rust-mcp-lifecycle
  - **Acceptance**: Planted drift, ineffective repairs, unavailable tools, concurrent source changes and empty evidence preserve severity, exits and repair ownership. Keep before/after and rollback receipts.
  - **Hypothesis**: 100% native converted diagnostics preserve behavior with 0 false healthy/fixed results or unowned repairs, and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-diagnostics-and-repair --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G; 0 false healthy/fixed results and 0 repairs outside recorded ownership.
  - **Pivot**: Any false success -> change evidence or repair boundary rather than weaken checks. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Measure the same operational outcomes through native collectors
  - **ID**: rust-metrics-and-perf
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port event processing, context measurement, perf recording, usage/weekly metrics and report-data processing. Preserve histories, attribution limits, safe labels and time windows. Separate queue, external-tool and workload time. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-state-and-agentfile, rust-process-primitives
  - **Acceptance**: Malformed events, missing data, clock skew, daylight-saving changes, unknown timeout causes and planted secrets preserve honest metric meaning and redaction. Keep before/after and rollback receipts.
  - **Hypothesis**: 100% native converted collectors preserve semantics with 0 payload disclosures or unknown-to-causal relabeling, and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-metrics-and-perf --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G; 0 changed metric meanings, private payload disclosures or fabricated zeroes/causal claims.
  - **Pivot**: Any semantic/privacy mismatch -> redesign receipt/aggregation boundary. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Run every supported user action through the native CLI
  - **ID**: rust-cli-and-actions
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port command orchestration by action family through one parser/action registry. Include bootstrap, completion, portable bundles, lint/audit and browser screenshot orchestration. Preserve argv, exits, prompts, confirmations and terminal-only reasons. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-catalog-and-sources, rust-sync-content, rust-sync-configuration, rust-mcp-lifecycle, rust-memory-integration, rust-plugin-trust-and-feedback, rust-diagnostics-and-repair, rust-metrics-and-perf
  - **Acceptance**: Every discovered converted action has a native route; help, invalid input, noninteractive refusal and safe scratch actions preserve CLI/agent discovery and approval behavior. Keep before/after and rollback receipts.
  - **Hypothesis**: 100% of converted actions run natively with 0 missing discovery paths or consent regressions, and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-cli-and-actions --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G; 100% native routes for converted actions; 0 missing CLI/agent discovery paths or consent regressions.
  - **Pivot**: Any missing action or consent regression -> change dispatch before another action family. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Enforce the same hook decisions with native executable helpers
  - **ID**: rust-hooks-and-generated-helpers
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port hook checks, Python/Perl/jq helpers and generated executable logic by hook family. Preserve protocol, opt-ins, parsing, safe unknown handling, endpoint setup and ownership-aware deployment. Retain only necessary shell shims. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-text-and-file-primitives, rust-process-primitives, rust-state-and-agentfile
  - **Acceptance**: Permitted/denied controls plus hostile heredocs, substitutions, bad JSON, absent tools and timeouts preserve verdicts and bounded execution. Keep before/after and rollback receipts.
  - **Hypothesis**: 100% native converted hook cases preserve behavior with 0 new false permits, injection paths or hidden legacy business logic, and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-hooks-and-generated-helpers --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G in the linked plan; 0 new false permits, injection paths or unexplained owned interpreted hook logic.
  - **Pivot**: Any deny/unknown or injection regression -> change parser/protocol boundary, not an allow rule. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Run owned workflow utilities and generated projects natively
  - **ID**: rust-workflow-tools-and-scaffolds
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port README/review/goal/watch/open-work/rankings utilities and executable project scaffolds in separate workflow slices. Retain prompts and declarative assets; UI presentation is narrow, while report-data and browser orchestration remain in scope. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-cli-and-actions, rust-hooks-and-generated-helpers, rust-metrics-and-perf
  - **Acceptance**: Scratch repositories/projects, cancelled watches, absent dashboards, denied public actions and interrupted scaffolds preserve outputs, approvals and cleanup. Keep before/after and rollback receipts.
  - **Hypothesis**: 100% of converted workflow/generated non-UI logic runs natively with 0 behavior, approval or cleanup regressions, and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-workflow-tools-and-scaffolds --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G; 100% native converted workflows and generated non-UI logic; 0 real test publications or surviving owned children.
  - **Pivot**: Any workflow/generated-project mismatch -> change wrapper/template boundary before deletion. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Retain independent defect detection while moving non-UI tests to Rust
  - **ID**: rust-tests-and-evals
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port owned non-UI tests, fake services, eval providers, affected selection, fixtures and executable test configuration alongside completed production slices. Retain each old oracle until its Rust replacement detects the same planted defects. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-measurement-harness
  - **Acceptance**: Old and Rust runners reject the same planted production, cleanup, redaction and approval defects. Test each production slice before retiring its oracle; fixture rewrites retain negative behavior. Keep only necessary shell-boundary fixtures and actual UI adapters.
  - **Hypothesis**: Rust test/eval replacements retain 100% registered planted-defect detection with 0 omitted contracts and no resource regression beyond 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-tests-and-evals --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code; retain existing full gate.
  - **Success**: 100% registered planted defects detected; 0 omitted behavior contracts; G for test-runner lifecycle/resources.
  - **Pivot**: Any lost defect detection -> retain the old oracle and redesign the Rust fixture/test boundary. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Build and install the native tool without redundant project runtimes
  - **ID**: rust-build-release-and-install
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Port owned verification, docs generators, lints, checkup, build/install/update/uninstall/release and CI executable steps. Produce locked native artifacts; preserve integrity and approval gates. No registry publication is needed to prove local behavior. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: code
  - **Blocked by**: rust-cli-and-actions, rust-workflow-tools-and-scaffolds, rust-tests-and-evals
  - **Acceptance**: Supported scratch clean install, no-op update, offline failure, wrong architecture, missing asset, interrupted replacement, uninstall and rollback meet registered contracts. Keep before/after and rollback receipts.
  - **Hypothesis**: 100% supported converted install/update/recovery cases run without a project Node/Python/Perl runtime for owned non-UI logic, with 0 safety/behavior regressions and p95 time/peak RSS at most 1.10 times sealed B.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-build-release-and-install --samples 60` — proposed harness command; seal baseline and commit actual numeric predictions before code.
  - **Success**: G; 100% supported install/update/rollback cases; 0 unverified artifact replacements or approval bypasses.
  - **Pivot**: Any installation/recovery defect -> change packaging before native defaults. Resource upper bound above 1.10 -> change architecture; inconclusive is not passing.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Prove all eligible code and deployed paths have migration evidence
  - **ID**: rust-final-audit
  - **Tags**: migration, rust
  - **Mode**: AFK
  - **Details**: Reconcile source inventory, every step's before/after receipts, generated targets, installed source, docs and remaining dependencies. Delete only proven unused implementations. Frozen residue remains an unresolved policy boundary, never false completion. Plan: [Rust migration](docs/plans/rust-migration.md).
  - **Output**: measurement
  - **Blocked by**: rust-source-inventory, rust-measurement-harness, rust-native-delivery, rust-text-and-file-primitives, rust-process-primitives, rust-state-and-agentfile, rust-catalog-and-sources, rust-sync-content, rust-sync-configuration, rust-mcp-lifecycle, rust-memory-integration, rust-plugin-trust-and-feedback, rust-diagnostics-and-repair, rust-metrics-and-perf, rust-cli-and-actions, rust-hooks-and-generated-helpers, rust-workflow-tools-and-scaffolds, rust-tests-and-evals, rust-build-release-and-install
  - **Acceptance**: Every eligible owned component maps to tested Rust delivery; each exception has a narrow reason and test. No unsupported all-code or speed claim is made. Current whole-tool behavior and installed artifacts agree with receipts.
  - **Hypothesis**: Complete source/caller and deployment reconciliation exposes all remaining gaps: 0 unclassified or unexplained eligible legacy components, complete valid per-step receipts, and 0 safety/behavior regressions.
  - **Measurement**: `heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- final-audit` — proposed harness command; run existing full gate and re-read installed-source evidence.
  - **Success**: 0 unexplained eligible legacy components; 100% valid per-step receipts; G on declared whole-tool workflows; no unresolved policy conflict hidden as an exception.
  - **Pivot**: Any unexplained residue, invalid receipt or unresolved frozen-support conflict -> keep migration incomplete and resolve the specific boundary; do not change the goal to converted lines.
  - **Anchor**: Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration); Kohavi, Tang and Xu 2020 (guard metrics).

- [ ] Classify upstream skill-to-plugin conversions during source refresh
  - **ID**: classify-upstream-skill-plugin-conversions
  - **Tags**: skills, sync, ownership, upstream
  - **Mode**: AFK
  - **Details**: On 2026-11-08, `agentbrew sync --pull` printed `insecure-defaults not found in trailofbits/skills`. Upstream commit `82e8e0a` intentionally removed its `SKILL.md` and converted it to a plugin-only workflow. A refresh should distinguish this from a missing or broken source, preserve owner-modified installed content, and never silently prune it.
  - **Files**: `src/update.ts`, source/skill discovery and removal tests, `README.md`
  - **Output**: code
  - **Acceptance**: a synthetic upstream skill-to-plugin conversion produces an explicit classified result and supported migration guidance on repeated refreshes; owner edits and unmanaged copies survive; the status report does not keep calling the source missing.
  - **Hypothesis**: source-aware conversion classification reduces unclassified `not found` refresh warnings for the fixture from 1 to 0 with 0 unowned removals.
  - **Measurement**: `JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/update.test.ts` with a conversion fixture and a repeated-refresh ownership control.
  - **Success**: 0 unclassified conversion warnings and 0 unowned removals in the fixture and repeat control.
  - **Pivot**: if plugin conversion cannot be detected generically, require an explicit recorded classification instead of adding layout guesses or automatic deletion.
  - **Anchor**: VISION G1 and "Never destroy data you didn't create"; trailofbits/skills commit `82e8e0a` (2026-08-05).

## P3

- [ ] Propose the guard start-budget note to the built-in workflow-authoring skill
  - **ID**: workflow-authoring-guard-budget-upstream
  - **Tags**: workflow, agents, third-party
  - **Details**: `workflow-authoring` is Anthropic's built-in skill, so its text cannot change here. run-goal's `references/parallel-workers.md` now says to read the live agent-usage-guard start cap, count planned agent starts (reviewers, fixers, re-reviews) before a fan-out, group small PRs per reviewer, and stop the fan-out after the first refusal. Propose a short version of that note upstream through the `report-upstream` skill, with the 2026-11-08 goal-run data (2 refusals after a review plus fix fan-out).
  - **Files**: none in this repo (upstream proposal); `skill-plugins/workflow/run-goal/references/parallel-workers.md` is the source text
  - **Output**: docs
  - **Acceptance**: the upstream issue is filed after the owner approves the exact text, or this task records why it was not filed.
  - **Hypothesis**: with the note in workflow-authoring, a fresh agent that writes a fan-out workflow plans its agent starts under the guard cap in 3 of 3 trials.
  - **Measurement**: three fresh-agent trials that load only workflow-authoring and plan a 12-PR review fan-out; count plans that state a start total under the live cap.
  - **Success**: 3 of 3 plans stay under the cap.
  - **Pivot**: if upstream declines, keep the note in run-goal only and close this task.
  - **Anchor**: agent-usage-guard `core/agents.ts` rolling-start rule; Basili, Caldiera and Rombach (1994), GQM.
  - **Blocked**: needs-owner-approval — 2026-11-08: filing on Anthropic's repo is a public post in another org. The owner must approve the exact issue text from the `report-upstream` skill first; agents do not post it on their own.

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
  - **Blocked**: needs-owner-approval — 2026-10-27: filing on anthropics/claude-plugins-official is a public post in another org. The owner must approve the exact issue text from the `report-upstream` skill first; agents do not post it on their own.

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

- [ ] Propose a local-model component-isolation eval to systematic-debugging
  - **ID**: systematic-debugging-local-model-boundary
  - **Tags**: skills, debugging, third-party, opencode
  - **Details**: The third-party `systematic-debugging` skill (obra/superpowers) worked for the 2026-11-08 OpenCode/Ollama investigation, but has no eval for this boundary: raw Ollama answered with reasoning disabled while the full OpenCode default timed out. Propose an eval requiring component isolation, cancellation only of session-owned smoke requests, and no readiness claim when the configured default still fails. Do not edit the installed mirror.
  - **Files**: none in this repo (upstream eval proposal); the scenario is retained in dotfiles `skills/update-tooling/evals/evals.json`
  - **Output**: docs
  - **Acceptance**: the exact eval proposal is filed upstream after owner approval, or this task records the maintainer/owner decision; a fresh-agent trial separates CLI, server, model, and reasoning-control evidence before a fix.
  - **Hypothesis**: with this eval, a fresh agent identifies the failing component and avoids a false default-model readiness claim in 3 of 3 simulated trials.
  - **Measurement**: three fresh-agent simulated trials using the OpenCode hosted-pass/local-default-timeout scenario; count correct component isolation and readiness verdicts.
  - **Success**: 3 of 3 trials keep the default unready, isolate the boundary, and preserve unrelated sessions.
  - **Pivot**: if upstream declines, keep the scenario in the owned update-tooling eval and close this proposal.
  - **Anchor**: systematic-debugging Phases 1–3; Ollama OpenAI compatibility `reasoning_effort` documentation (checked 2026-11-08).
  - **Blocked**: needs-owner-approval — filing on obra/superpowers is a public post in another org and needs approval for the exact text.

- [ ] Propose a readiness-evidence review eval to requesting-code-review
  - **ID**: requesting-code-review-readiness-evidence
  - **Tags**: skills, review, third-party, opencode
  - **Details**: `requesting-code-review` (obra/superpowers) needs a case where tests and Agentbrew status are green but the configured OpenCode default model still times out. The reviewer must inspect that evidence and reject a full-readiness claim rather than approve from the diff alone.
  - **Files**: none in this repo (upstream eval proposal)
  - **Output**: docs
  - **Acceptance**: after owner approval, propose an upstream eval that requires claim-by-claim review against live evidence and a `not ready` verdict when any required runtime probe fails.
  - **Hypothesis**: the added case makes a fresh reviewer reject a false full-readiness claim in 3 of 3 simulated trials.
  - **Measurement**: three fresh-reviewer trials with green static checks and a failing default-model probe.
  - **Success**: 3 of 3 reviews reject full readiness and name the failed probe.
  - **Pivot**: if upstream declines, retain the case in run-goal's owned eval and close this proposal.
  - **Anchor**: requesting-code-review plan-alignment and evidence rules; the 2026-11-08 OpenCode readiness run.
  - **Blocked**: needs-owner-approval — an upstream public post requires approval for the exact text.

- [ ] Propose a live-state readiness eval to verification-before-completion
  - **ID**: verification-before-completion-live-readiness
  - **Tags**: skills, verification, third-party, opencode
  - **Details**: `verification-before-completion` (obra/superpowers) needs a case where a sync or fix line says success but a later apply reverts it. Require fresh default-model, MCP, installed-file, and chezmoi-state reads before the final claim; never reuse an earlier hosted-model pass.
  - **Files**: none in this repo (upstream eval proposal)
  - **Output**: docs
  - **Acceptance**: after owner approval, propose an upstream eval that rejects stale or substitute evidence and verifies the actual configured runtime and live applied state.
  - **Hypothesis**: the added case prevents stale or wrong-model completion evidence in 3 of 3 simulated trials.
  - **Measurement**: three fresh-agent trials with an earlier hosted pass, a failed default probe, and drift after an apply.
  - **Success**: 3 of 3 trials require fresh default-runtime and live-state evidence before any claim.
  - **Pivot**: if upstream declines, retain the case in the owned update-tooling eval and close this proposal.
  - **Anchor**: verification-before-completion's Iron Law; OpenCode served-output and Ollama evidence from 2026-11-08.
  - **Blocked**: needs-owner-approval — an upstream public post requires approval for the exact text.

- [ ] Propose a guarded retro-delivery eval to finishing-a-development-branch
  - **ID**: finishing-development-branch-guarded-retro
  - **Tags**: skills, delivery, third-party
  - **Details**: `finishing-a-development-branch` (obra/superpowers) needs a goal-retro case with pre-approved PR delivery, unrelated dirty work elsewhere, and a failing required runtime probe. Run the full gate and independent review before merging the eval-only change, never use the retro PR to hide the goal blocker, and never force-clean a worktree.
  - **Files**: none in this repo (upstream eval proposal)
  - **Output**: docs
  - **Acceptance**: after owner approval, propose an upstream eval covering the standing-approval path, green gate, independent review, honest blocked-goal report, and preservation of unowned work.
  - **Hypothesis**: the added case makes fresh agents deliver an approved retro without false completion or unsafe cleanup in 3 of 3 simulated trials.
  - **Measurement**: three fresh-agent trials using the approved retro/green-gate/unrelated-dirty-work scenario.
  - **Success**: 3 of 3 trials keep the runtime blocker visible and avoid unowned changes and forced cleanup.
  - **Pivot**: if upstream declines, retain the case in run-goal's owned eval and close this proposal.
  - **Anchor**: finishing-a-development-branch verification and cleanup rules; the 2026-11-08 tooling retro run.
  - **Blocked**: needs-owner-approval — an upstream public post requires approval for the exact text.

- [ ] Propose a generated-config runtime-proof eval to test-driven-development
  - **ID**: test-driven-development-runtime-config-proof
  - **Tags**: skills, testing, third-party, opencode
  - **Details**: `test-driven-development` (obra/superpowers) needs a case where unit contracts pass but generated OpenCode config still fails live. The 2026-11-08 fix required red/green cycles plus actual V2 smoke evidence for removing the legacy provider and implicit small model, and placing `reasoning_effort` on the selected model. Unit success alone was not enough.
  - **Files**: none in this repo (upstream eval proposal)
  - **Output**: docs
  - **Acceptance**: after owner approval, propose an upstream eval that requires a failing contract before each production change and a real runtime probe of the generated artifact before completion.
  - **Hypothesis**: the added case prevents unit-only false completion in 3 of 3 simulated generated-config trials.
  - **Measurement**: three fresh-agent trials with valid unit contracts and a failing real V2 default-model probe; count trials that require live evidence before delivery.
  - **Success**: 3 of 3 trials preserve red/green evidence and reject completion until the real generated config responds within the registered bound.
  - **Pivot**: if upstream declines, retain the scenario in the owned OpenCode bootstrap tests and close this proposal.
  - **Anchor**: test-driven-development's red/green and whole-suite rules; the 2026-11-08 OpenCode V2 bootstrap investigation.
  - **Blocked**: needs-owner-approval — an upstream public post requires approval for the exact text.

- [ ] Propose a quota-read boundary eval to agent-browser
  - **ID**: agent-browser-quota-read-boundary
  - **Tags**: skills, browser, third-party, kimi
  - **Details**: `agent-browser` (vercel-labs/agent-browser) needs an eval for quota reads where a supported CLI/API endpoint exists. Require using that endpoint with redacted credential handling, not browser automation or invented URLs. The no-weekly response should show actual 5-hour and monthly windows rather than a fabricated total.
  - **Files**: none in this repo (upstream eval proposal)
  - **Output**: docs
  - **Acceptance**: after owner approval, propose an upstream eval that requires supported endpoint reuse, no credential in browser content or curl argv, and an explicit no-weekly fallback.
  - **Hypothesis**: the added case keeps fresh agents on supported read-only quota paths with zero credential disclosures in 3 of 3 simulated trials.
  - **Measurement**: three fresh-agent trials with weekly, no-weekly, and malformed-response fixtures; count correct endpoint, redaction, and fallback decisions.
  - **Success**: 3 of 3 trials avoid invented endpoints and secrets while preserving the actual quota windows.
  - **Pivot**: if upstream declines, keep the scenario in the owned add-command eval and close this proposal.
  - **Anchor**: agent-browser trust-boundary and auth guidance; Kimi `GET /coding/v1/usages` contract.
  - **Blocked**: needs-owner-approval — an upstream public post requires approval for the exact text.

- [ ] Propose a platform-command exclusion eval to spec-driven-development
  - **ID**: spec-driven-development-platform-command-exclusion
  - **Tags**: skills, specifications, third-party, opencode
  - **Details**: `spec-driven-development` (obra/superpowers) needs an eval where the owner rejects platform-specific command files. The revised spec must remove them while retaining the measurable optimization outcome and local-default constraint.
  - **Files**: none in this repo (upstream eval proposal)
  - **Output**: docs
  - **Acceptance**: after owner approval, propose an upstream eval that requires scope revision before planning, with no hidden command files added.
  - **Hypothesis**: the added case prevents platform-command scope creep in 3 of 3 simulated specification trials.
  - **Measurement**: three fresh-agent specification trials with an owner rejection; count specs that preserve the outcome without adding commands.
  - **Success**: Every revised spec excludes command files and retains measurable acceptance criteria.
  - **Pivot**: if upstream declines, retain the case in the owned task-command-center eval and close this proposal.
  - **Anchor**: spec-driven-development boundary and scope-check rules; the 2026-11-09 optimization spec revision.
  - **Blocked**: needs-owner-approval — an upstream public post requires approval for the exact text.

- [ ] Propose a measured optimization eval to writing-plans
  - **ID**: writing-plans-measured-optimization
  - **Tags**: skills, planning, third-party, performance
  - **Details**: `writing-plans` (obra/superpowers) needs an eval for a measured optimization that reuses an existing highspeed CLI instead of adding commands. Require baseline evidence, owner constraints, a fact/proposal ledger, and exact verification, not a performance guarantee from one sample.
  - **Files**: none in this repo (upstream eval proposal)
  - **Output**: docs
  - **Acceptance**: after owner approval, propose an upstream eval covering baseline/after metrics, existing-tool reuse, local-default preservation, and no platform-specific commands.
  - **Hypothesis**: the added case makes fresh plans evidence-bounded and reuse-first in 3 of 3 simulated optimization trials.
  - **Measurement**: three fresh-plan trials with baseline latency and context snapshots; count plans with exact verification and no unsupported speedup claim.
  - **Success**: Every plan uses existing tools, preserves constraints, and avoids new command files and guarantees.
  - **Pivot**: if upstream declines, retain the case in the owned task-command-center eval and close this proposal.
  - **Anchor**: writing-plans evidence and current-state requirements; the 2026-11-09 optimization baseline.
  - **Blocked**: needs-owner-approval — an upstream public post requires approval for the exact text.

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
    Multiple tools now write to the same agent config files (CLAUDE.md, AGENTS.md). Without a shared convention, they collide. agentbrew uses `<!-- agentbrew:start -->` / `<!-- agentbrew:end -->`. Caliber uses `<!-- caliber:managed:<name> -->` / `<!-- /caliber:managed:<name> -->`. React Doctor writes directly without markers. No standard exists.
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
    | [#537](https://github.com/vercel-labs/skills/issues/537) | Global install leaves agent skill dir missing for non-universal agents | `isUniversalAgent` is decided by project skillsDir but applied to global installs; needs a `isGlobalUniversal` distinction with broader testing. Not drive-by. |
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


- [ ] Add machine-setup verification cases to third-party skills
  - **ID**: setup-goal-third-party-skill-retro
  - **Research**: 2026-11-01: read agent-browser's current command-usage, skill-loading, and skill-selection eval prompts; none covers shared CDP attachment beside another agent's live tab. Proposed command-usage case: "Read a dashboard in the existing shared CDP browser; another agent owns its active tab." Require a named session, a new owned tab, --pin-tab, no navigation of another agent's tab, and no credentials in output. Keep the installed mirror unchanged. Publication remains blocked until the owner approves the exact upstream text.
  - **Review-retro**: 2026-11-01: Anthropic engineering:code-review and obra/superpowers receiving-code-review have no eval prompts in their installed packages. Propose a composition case where apply records ownership hashes, automatic dedupe rewrites the body, and a later owner removal must prune generated content while retaining edits made before or after dedupe. Require a live composition probe before approval. For receiving-code-review, also propose a staged-code prediction case that rejects hook overrides, isolates a normal docs-only commit, and discloses already observed results without claiming fresh preregistration. These are proposals only; do not edit installed mirrors or publish upstream without exact approval.
  - **Desktop-retro**: 2026-11-01: extend the existing computer-use proposal with a session-import cleanup case. Require explicit import provenance before archiving copies, preserve original and active chats, use the supported native configuration API when UI control is unavailable, and verify the single requested preference changed without changing other settings. A UI safety refusal never permits an alternate UI-control backdoor. Keep this as a proposal; do not edit the installed third-party mirror.
  - **Verification-retro**: 2026-11-01: the installed verification-before-completion package has no eval prompts. Propose a case with a passing full gate on source A, a later docs-only delta covered by the repo-declared merge-ready gate, and a subsequent untracked test not covered by either result. Require exact source/delta attribution and actual exit codes; never call a queued run, stale source, or third-party success report proof of the current tree. Keep the proposal local pending exact upstream approval.
  - **Tags**: skills, evals
  - **Details**: The ChatGPT Work setup goal used third-party openai-docs, agent-browser, verification-before-completion, computer-use, built-in-browser, chrome-browser, plugin-management, OpenAI system skill-creator, systematic-debugging, and test-driven-development. Keep these proposals local until publication is approved. For openai-docs, check current installed CLI/schema evidence before stale setup notes. For agent-browser, prefer an installed native CLI for configuration diagnostics. For verification-before-completion, hooks.json with zero trusted active runtime hooks must not pass activation. For computer-use, built-in-browser, and chrome-browser, respect ChatGPT desktop control restrictions and use permitted website or CLI alternatives; use a fresh CAPTCHA reference, treat approved CAPTCHA verification as separate from OAuth consent, retain already-verified sign-in without asking again, and distinguish a failed page reload from missing account state. For plugin-management, available does not mean installed or authenticated. For OpenAI system skill-creator, distinguish native and upstream-provider bodies and preserve owner folders and links. For systematic-debugging and test-driven-development, identify scratch HOME/bin collisions before changing production and require a failing reproduction before the fix.
  - **Files**: third-party skill evals (proposal only)
  - **Output**: docs
  - **Acceptance**: each proposed case rejects the described false completion claim; publication remains a separate approved action.
  - **Hypothesis**: fixture false-completion decisions fall from 1 to 0 for each proposed case.
  - **Measurement**: run each upstream skill's eval harness with the proposed machine-setup fixture.
  - **Success**: all proposed fixtures reject false completion.
  - **Pivot**: any false completion remains after a prompt revision -> use a deterministic runtime check instead.
  - **Anchor**: Basili, Caldiera & Rombach 1994 (GQM).
