# Rust migration implementation plan

**Status (2026-11-10): porting stays paused until the owner starts it.**
This plan was rewritten on 2026-11-10 after the
[validation review](#validation-review-2026-11-09). No code is ported yet.
The re-plan Pivot did not apply: gate G stays. A first independent review of
this rewrite found five of the seven MUST findings only partly resolved. This
revision applies its fixes. A second independent review on 2026-11-10 graded all
seven findings resolved in both plans. The
owner has not ruled on the defaults in
[Decisions](#decisions-2026-11-10); task `rust-owner-rules-on-replan-defaults`
tracks that. The measured hot path (hook helpers) now comes first.

## Overall goal and vision

Make the things users wait for faster, and prove it with numbers.
Move owned executable logic to Rust only where a slice names a user-benefit
metric. Keep UI presentation and necessary shell integration as they are.
Preserve sync, repair, primary-host parity, ownership and privacy.

The user asked for tasks on 2026-11-01. A slice with no measured user
benefit is a [recorded exception](#recorded-exceptions). It reopens when
field numbers and a profile show a gain. Runtime independence alone is not
a reason to port.

## Decision and alternatives

Replace one observable boundary per PR. Start with the hook checks that run
on every agent Bash call. Weigh a cheaper fix first in every slice. Port to
Rust only when the cheaper fix misses the pre-registered number.

A whole-repository rewrite would combine failures and lose attribution.
Porting every slice in dependency order put the hot path at step 16. Both
are rejected. Keeping every interpreter with no measurement is rejected too.

Two existing tools measure each slice:

- **Performance gate:** `npm run perf:gate` times the rows of
  `scripts/perf-budget.tsv` against the merge-base in the same run
  ([details](../observability.md#performance-gate)).
- **Field telemetry:** each command sends one content-free event with
  `duration_ms` and `runtime` (`ts` now, `rust` after a port)
  ([details](../observability.md)). The local event log keeps the same time
  as `ms`. The owner's dashboard ("Tooling performance: agentbrew +
  dotfiles", private since 2026-11-10) shows p50 and p95 of `duration_ms`
  by command, version and runtime. It is in the owner's PostHog project
  and needs a login. It cannot be verified from the repository. A public
  link is to be added.

## Evidence and current state

Reviewed at revision `a803087d` on 2026-11-10.

| Claim | Current source of truth | Status |
|---|---|---|
| CLI and build use TypeScript/Node | `package.json`, `src/cli.ts`, `tsup.config.ts` | fact |
| Rust crates exist under `rust/`: `checkup-run`, `fetch-mutation`, `gdoc-capture`, `history-audit-prep`, `page-error-probe` | Each crate has its own `Cargo.toml` and `Cargo.lock` | fact |
| A prebuilt native `checkup-run` ships for one platform | `native/checkup-run/`, [source-build plan](source-build-prebuilt-764.md) | fact |
| No workspace manifest `rust/Cargo.toml` and no `migration-check` binary exist | Tracked source | fact |
| `scripts/verify.sh` has no cargo step | Tracked source | fact |
| Hook checks are shell scripts, one process per check | `hooks/manifest.yaml`, `hooks/checks/`, `hooks/lib/` | fact |
| The performance gate tracks CLI rows and single-hook rows, but no whole-chain row | `scripts/perf-budget.tsv` | fact |
| Sent events carry `duration_ms` and `runtime`; the local log keeps `ms`; hook checks send no event | `src/core/telemetry.ts` (sets `runtime` and `duration_ms`), `src/core/events.ts` (the local log) | fact |
| Time for the whole hook chain of one Bash call | Step 1 below | unmeasured |

**Existing Rust code is grandfathered.** The crates above shipped before
gate G existed. They are delivered behavior and the baseline for later work.
They do not count as migrated slices. The inventory manifest lists each one
with the state `grandfathered`. A later change that makes one of them
replace a non-Rust path must pass G.

## Scope

In scope: owned code on a measured hot path. Today that is the hook checks,
their `hooks/lib/` helpers and the generated helper scripts they call.

Out of scope until reopened: every slice in
[Recorded exceptions](#recorded-exceptions).

Never in scope (manifest state `out-of-scope`):

- UI presentation, such as the goal dashboard HTML and terminal rendering.
- Shell that must stay shell: sourced environment changes, completions,
  first-binary bootstrap and required protocol shims. Move business logic
  out of those shims when their slice is ported.
- Declarative YAML, JSON, Markdown, schemas and fixture data.
- Upstream CLIs, browser engines and the memory service. Do not copy another
  repository's source into agentbrew.

Frozen Augment support (`VISION.md` NG4) stays as it is. The manifest marks
it `frozen`. It needs no port and no task.

## Boundary contracts

- **Ownership:** agentbrew alone writes its generated agent configuration and
  deployment manifests. Dotfiles delegates through the owner CLI.
- **Lifecycle:** name configuration-file, sync-operation, watcher-instance,
  process-group, plugin-instance and receipt-run scope. Define creation,
  validation, cancellation, cleanup and deletion for each mutable owner.
- **Transport:** use argv and versioned JSON. Preserve exits, byte-sensitive
  text, permissions and unknown/deny decisions. Never eval reconstructed
  commands or infer write authority from a path.
- **Privacy:** use synthetic fixtures and content-free receipts. No command
  payloads, tokens, raw memory, private paths or conversation transcripts
  belong in measurements. A new event field must pass `sanitizeEvent`.
- **Memory:** preserve configured semantic-memory policy, deduplication and
  privacy opt-ins. Keep ChatGPT/Codex and Claude histories separate.
- **Resources:** use machine-wide heavy-run admission and its worker budget.
  Never disable resource-pressure safeguards to obtain a measurement.

### Cross-repo rule

This is the one rule for both repositories. The other plan holds the same
bullets, byte for byte.

- Hot-path slices and source collection in dotfiles do not wait for
  agentbrew. They use the dotfiles performance gate and local logs.
- A dotfiles step that runs `migration-check inventory` waits until the
  agentbrew task `rust-source-inventory` merges.
- A dotfiles step that runs `migration-check compare` also waits until
  agentbrew's deferred measurement runner merges. No other dotfiles step
  waits.
- Dotfiles pins the shared crate as a git dependency with an exact `rev`.
  It commits `Cargo.lock` and a `cargo vendor` copy, with a
  `.cargo/config.toml` source replacement. `cargo build --locked --offline`
  then works with no network and no sibling checkout.
- The vendored copy is a pinned snapshot of agentbrew's crate. Dotfiles
  never edits it and never writes a second engine.

## Measurement contract

### Commands that run today

Each command below was started once on the owner's Mac on 2026-11-10. The
text after each one says what it printed. One of them, the performance
gate, did not finish; its text says so.

```bash
npm run --silent perf:gate -- --force --json
```

**Result not verified here.** The run was queued behind the dotfiles gate
in the shared `heavy-run` queue. It had printed nothing when this revision
was committed. The [gate docs](../observability.md#performance-gate) say
`--json` prints `base_min`, `head_min`, `ratio`, `paired_delta_ms` and
`verdict` per command; this plan did not confirm that by a finished run. The
task `rust-hook-chain-timing` runs the gate before any change.

```bash
bash scripts/run-hook-fixtures.sh
```

It exited 0. Each fixture file printed a line such as
`a-pr-is-not-ready.sh: 29 passed, 0 failed`. The last line was
`Hook fixture tests: all passed`. The agent sandbox blocks its `mktemp`;
run it outside the sandbox.

```bash
jq -s '[.[] | select(.event == "sync") | .ms] | sort | .[length / 2 | floor]' ~/.local/share/agentbrew/logs/events.jsonl
```

It printed `1201`: the local p50 of the `sync` event in ms. The local log
names the event in `event`. Few lines carry a `command` field, so a filter
on `.command` prints `null`.

```bash
jq -s --arg since 2026-11-03 --arg until 2026-11-11 '[.[] | select(.event == "sync" and .ts >= $since and .ts < $until) | .ms] | sort | .[length / 2 | floor]' ~/.local/share/agentbrew/logs/events.jsonl
```

It printed `1953`: the same p50 for the lines from `since` up to, but not
including, `until`. With `since` 2026-10-20 and `until` 2026-11-03 it
printed `1184`. This is the **local-log fallback** for any check that names
the dashboard. Change the event name and both dates. It prints `null` when
no line matches.

```bash
node ~/.config/agentbrew/scripts/agent-perf.mjs report --all --days 7 --json
```

It printed one JSON object with `toolMs` (190460600) and `calls` (15161)
for the last 7 days, plus the per-step numbers.

```bash
for i in $(seq 15); do printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git status"},"cwd":"/tmp","session_id":"perf-gate","tool_use_id":"perf-gate"}' | /usr/bin/time -l bash hooks/checks/no-home-crawl.sh 2>&1 >/dev/null | awk '/maximum resident set size/ {print $1}'; done | sort -n | sed -n 8p
```

It printed `9306112`: the median peak RSS in bytes of 15 runs of one hook
row. This is the **peak RSS command**. Change the hook path to the row's
command. The agent sandbox blocks `/usr/bin/time -l`; run it outside the
sandbox.

### Commands that run after `rust-source-inventory` merges

`rust/Cargo.toml` and `migration-check` do not exist yet. These commands are
**runnable after the inventory step merges**. Until then no task may cite
one as a command that runs now.

```bash
heavy-run cargo build --locked --release --manifest-path rust/Cargo.toml --bin migration-check
heavy-run rust/target/release/migration-check inventory --check
```

### Command that runs after the deferred measurement runner merges

```bash
heavy-run --exclusive rust/target/release/migration-check compare --slice <task ID> --pairs 30
```

No task builds the runner today (see
[Deferred preparation steps](#deferred-preparation-steps)). No task may
cite `compare` until a reopened slice opens that step and it merges.

Build with plain `heavy-run` first. Time only the built binary under
`heavy-run --exclusive`. Compile time never counts as workload time.

### Rules

- Register workloads, fixtures and thresholds before production changes.
- Measure unchanged source first. Keep every sample and every failure.
  Missing or contaminated data is inconclusive. It is never zero or passing.
- Commit the baseline number and the numeric prediction before the
  replacement code.
- Compare stdout, stderr, exit status, file bytes, permissions and side
  effects. A known bug needs a separately approved expected-outcome change.
- Publish negative results too. Use sanitized receipts only.

### Statistic and noise floor

The plan no longer uses a confidence bound on a p95 ratio. Sixty pairs give
about three tail samples, and measured noise on this Mac was 19-50%.

- **Time, for a row in the budget file (R_T):** the performance gate
  decides. Its estimator is `min-and-paired-median`: the fastest of 15 runs
  and the median of the paired differences must both agree. R_T is the
  `ratio` it prints. Measured on 2026-11-10: 0 false alarms in 20 clean runs
  at load 6.5 to 36.5, and 20 of 20 seeded slowdowns of +25% to +35% caught
  at load 5.9 to 10.3. A slowdown of 10% to 15% at load 10 or more was not
  measured.
- **The row must keep its command path.** The gate gives a row only a
  ceiling check when its command file does not exist at the base; `ratio` is
  then `null`. A port PR must not change the row's command path. The row
  keeps calling the same entry file, and that file calls the new code.
- **Time, for a workload with no row (R_T):** the median of the paired
  ratios candidate time / baseline time, from at least 30 order-balanced
  pairs. Take a percentile bootstrap of the median with 10,000 resamples and
  a committed seed. Use its upper 95% bound. This needs the deferred
  measurement runner.
- **Memory (R_M), one definition for every slice:** run the peak RSS
  command above once on the baseline tree and once on the candidate tree.
  Each run gives the median of 15 runs. R_M is the candidate median divided
  by the baseline median.
- **Noise floor first (A/A):** run the same comparison with the baseline on
  both sides. For a gate row, 20 A/A runs must pass 20 times. For R_M, two
  baseline medians must give a ratio from 0.95 to 1.05. For a workload with
  no row, the A/A upper bound must be at most 1.05. If a floor fails, the
  result is inconclusive. Fix the run conditions; never the thresholds.
- **p95** is a field number. Read it from the owner's dashboard, where the
  sample count is large. It is not a merge gate.

### Gate G

**G — common keep gate** for every port slice:

- 100% of approved behavior cases agree.
- Unauthorized writes, leaked secrets, orphaned owned children and new
  false permits are 0.
- 100% of the converted logic runs without its former interpreter.
- R_T and R_M are each at most **1.10** by the statistic above.
- The slice meets its own user-benefit number.
- The build budget holds: a cold `cargo build --locked --release` of the
  slice's crate takes at most 120 s and a warm build at most 15 s under
  `heavy-run`. The Rust build must run in `npm run verify` only when `rust/`
  changed. `scripts/verify.sh` has no cargo step today. The first port task
  that adds Rust code (`rust-hook-dispatcher`) adds that step with this
  condition.

**Named exemptions.** G as a whole applies to port slices only: steps 2
and 3. Steps 1, 4, 5 and 6 and the two deferred preparation steps (the
measurement runner and native candidate dispatch) port nothing. Only the
first two clauses apply to them: behavior agreement and the safety counts.
The interpreter clause, R_T, R_M and the user-benefit number do not apply to
them. The build budget applies to any of them that builds Rust.

**Pivot:** any safety or approved-behavior failure stops a port at once. A
resource bound over 1.10 needs a different boundary, dependency or
algorithm. A missed user-benefit number ends the slice; it does not lower
the number. An ended slice becomes a row in
[Recorded exceptions](#recorded-exceptions) with its measured number, in
the same PR that ends it. Never relax a threshold after results.
Inconclusive evidence keeps the old path active.

## Numbered work breakdown

All tasks are AFK within synthetic, scratch and already-authorized local
boundaries, except the owner ruling. One implementation PR changes one
observable boundary. Tests move with their slice: a port keeps the old tests
until the new ones catch the same planted defects. There is no separate
"move tests to Rust" step.

| Step / task ID | Why and change | User-benefit metric, number and command | Depends on |
|---|---|---|---|
| 1. `rust-hook-chain-timing` | No number exists for the whole hook chain of one Bash call. Add a budget row `hook-bash-chain` and a sampled content-free field event. | Recorded exception: it adds the instrument. Done when the row prints in `npm run --silent perf:gate -- --force --json` and 20 A/A runs pass. | none |
| 2. `rust-hook-dispatcher` | About 8 hook processes start on each agent Bash call. Run the Bash checks through one dispatcher that reads the payload once. Weigh a single shell dispatcher first. | `hook-bash-chain` `ratio` at most 0.50 against the merge-base, from `npm run --silent perf:gate -- --force --json`. The row keeps its command path. Field: p50 of the chain event for the version after the switch at most half of the version before it. | 1 |
| 3. `rust-hooks-and-generated-helpers` | The other hook families still start `jq`, Perl or Python per call. Move each family into the dispatcher. | Each ported `hook-*` row `ratio` at most 0.70, same command. Each family adds its row in a PR before its port PR, so the row exists at the base. | 2 |
| 4. `rust-cold-path-profile` | Sync, catalog, MCP lifecycle and doctor probes were never profiled. Measure where their time goes before any port. | Recorded exception: measurement only. Output is the share of wall time in owned code per event, next to its local p50 from the `jq` command above. | none; parallel with 1-3 |
| 5. `rust-source-inventory` | Keep scope honest with a small manifest and a small validator. No full harness. | Recorded exception: preparation. Done when `migration-check inventory --check` rejects every planted omission. | none; parallel with 1-3 |
| 6. `rust-final-audit` | Prove that every owned executable has one of the five audit states. | Recorded exception: audit. Done when unrecorded components are 0 and every ported slice still meets its number. | 2, 3, 4, 5, and the owner ruling |

Step 2 commits the absolute `hook-bash-chain` number from step 1 before any
dispatcher code. The ratio above is the decision rule; the absolute number
is the baseline receipt.

The field comparison is by version, not by runtime. A shell dispatcher that
wins keeps `runtime` `ts`, so only the version separates before from after.

The owner ruling is task `rust-owner-rules-on-replan-defaults` (HITL). It
blocks step 6 only.

### Deferred preparation steps

These steps have no task now. Open one when a recorded exception reopens
and needs it.

- **Measurement runner:** `migration-check compare` for workloads that have
  no budget row. It applies the statistic above.
- **Native candidate dispatch:** per-slice dispatch beside the Node CLI,
  with atomic replace and rollback. Hook slices do not need it: the
  [prebuilt native path](source-build-prebuilt-764.md) already delivers a
  binary.

### Recorded exceptions

A recorded exception has no user-benefit metric today. It stays in its
current language. It reopens only when both conditions hold: the owner's
dashboard, the local-log fallback or `rust-cold-path-profile` shows a
user-visible cost, and a profile puts at least half of that cost in owned
interpreter code. A reopened slice gets a task with its own number first.
The task blocks that this re-plan removed remain in git history at
`b86c47ca`.

| Slice | Reason | Cheaper option to weigh first |
|---|---|---|
| CLI startup and actions | Agents ran the CLI 6 times in 9 days. Startup is about 145 ms against a 34 ms Node floor. | Lazy command loading; the Node compile cache. The `cli-*` budget rows guard it. |
| Sync content and sync configuration | Likely dominated by git, file I/O and child tools. Not profiled. | Profile first (step 4). |
| Catalog and sources | Likely dominated by git and network. Not profiled. | Profile first (step 4). |
| MCP lifecycle | Likely dominated by builds and probes of child tools. Not profiled. | Parallel or cached probes. |
| Diagnostics and repair | Doctor probes are cold paths that wait on child tools. | Parallel or cached probes. |
| State, Agentfile, text and file primitives | Leaf code with no measured cost of its own. | None needed. |
| Process primitives | No measured cost; queue safety work ships on its own. | None needed. |
| Memory integration | Time is in the upstream service. | None needed. |
| Plugin trust and feedback | Rare actions; trust rules gain nothing from a port. | None needed. |
| Metrics and perf collectors | `perf-record` is on the hot path and belongs to step 3. The rest runs rarely. | None needed. |
| Workflow tools and scaffolds | Rare, agent-driven scripts. | None needed. |
| Tests and evals | Tests move with their slice. | None needed. |
| Build, release and install | Rare; a Rust build would add compile time to every gate. | The existing build cache. |

## Rollout, security, and regression coverage

Instrumentation lands before the first port. Each port PR carries the
baseline commit, the prediction, the result and a rollback proof. Use
separate worktrees and scratch HOME/state directories. Keep machine-wide
admission and worker limits. Queue safety work never waits for this plan.

Existing runnable guards remain authoritative:

```bash
node scripts/lint-tasks-stability.mjs TASKS.md
heavy-run npm run verify:changed -- origin/main
heavy-run npm run verify
heavy-run bash scripts/run-hook-fixtures.sh
heavy-run npm run test:install-e2e
```

The changed-files gate is sufficient only when it says `merge-ready`.
Production ports keep the old contract tests until independently reviewed
Rust tests detect the same planted defects. Keep leak, approval, signature
and endpoint-policy gates intact. Tests never publish, change live
credentials or touch owner chat history.

Switch a default one slice at a time after G, the existing gates and an
independent review pass. Install atomically, re-read the installed artifact
and keep the prior artifact until rollback works. A fixture pass is not
proof of deployed behavior or field performance.

**14-day field check.** Within 14 days after a switch, the owner's dashboard
must show the gain for the new version. The dashboard is private and has no
public link yet. When it is not available, use the local-log fallback
command with the slice's event name. Run it once with `since` at the
switch date and `until` 14 days later. Run it again with `since` 14 days
before the switch and `until` at the switch date. Compare the two. No gain
in either source rolls the slice back.

**Final audit rule.** The audit passes when every owned executable
component in the manifest has one of five states:

- `ported`, with receipts.
- `exception`, with a row in the table above. This includes a slice that
  ended at its Pivot.
- `frozen`: frozen agent support.
- `grandfathered`: Rust code that shipped before gate G.
- `out-of-scope`: UI presentation and shell that must stay shell, as listed
  in [Scope](#scope).

Unrecorded components must be 0. The audit claims "all measured hot paths
ported". It never claims "all code is Rust".

## Decisions (2026-11-10)

The owner chose to fix the plan and to ship it without another question
round. The choices below were **adopted by default on the reviewer's
recommendation**. The owner did not decide them one by one. **The owner can
reverse any of them.** Task `rust-owner-rules-on-replan-defaults` asks the
owner to rule on them; until then they are defaults, not decisions.

| Choice | Adopted default |
|---|---|
| Order | The hook-dispatcher slice comes first, with a pre-registered cut per agent Bash call. It needs no native dispatch and no full harness. |
| Cold paths | Doctor probes, sync orchestration and the other slices in the table above are recorded exceptions. |
| Test tasks | The separate "move tests to Rust" task is gone. Tests move with their slice. |
| Inventory | The inventory step is a manifest and a small validator. |
| Cheaper options | Each slice weighs a cheaper fix first and ports only when that fix misses the number. |
| Existing Rust code | `grandfathered` as delivered behavior. It passes G only when it replaces a non-Rust path. The review asked for a statement; this is the default. |
| Final audit states | The audit accepts `ported`, `exception`, `frozen`, `grandfathered` and `out-of-scope`. The review said the audit needs an owner decision; this default makes the audit passable until the owner rules. |

## Validation review (2026-11-09)

An independent reviewer checked this plan against measured timings on
2026-11-09. Verdict: **re-plan before any port**. Zero of the 48 tasks in the
two repositories are done. The owner paused porting the same day and asked
for field metrics and a speed gate first
([Telemetry](../observability.md),
[performance gate](../observability.md#performance-gate)).

The text in this section is the reviewer's, as written. Each resolution
stands beside it.

Measured on one loaded Mac; treat the numbers as a ranking, not a benchmark:

- Direct CLI use is rare for agents (6 runs in 9 days). `agentbrew --version`
  takes about 145 ms against a 34 ms Node floor; `dotfiles --version` takes
  about 64 ms. Startup is not the hot path.
- Hook helpers are the hot path. About 28,000 agent Bash calls in 9 days each
  fired about 8 hooks of 125-483 ms; `bash -c true` takes about 7 ms.
- In dotfiles, `app-priority` ran 17,488 times (1.3 s mean), and the Bats
  `test` step is 74% of gate time.
- Sync, git maintenance, upgrade, catalog, MCP lifecycle and doctor probes
  are likely dominated by git, network and child tools. They were not
  profiled; a port there needs a profile first.
- Rust compiles are already the largest agent Bash cost in other
  repositories. This plan has no build-time budget.
  *Resolution (2026-11-10): [Gate G](#gate-g) now has a build budget.*

### Findings to fix

No MUST finding is open in this text. The table below keeps each finding as
the reviewer wrote it.

Status on 2026-11-10: a first review of the re-plan graded findings 1, 6
and 7 resolved and findings 2, 3, 4 and 5 partly resolved in this
repository. This revision applies the fixes it asked for. A second
independent review on 2026-11-10 graded all seven findings resolved in both
plans.

### Resolved findings (2026-11-10)

| Finding, as the reviewer wrote it | What changed | Where |
|---|---|---|
| **Stale evidence.** The evidence table reviews an old revision. The repository now has Rust code that never passed gate G. State whether it is grandfathered or must pass G. | The evidence table reviews revision `a803087d` and lists the Rust crates. They are `grandfathered` and pass G only when they replace a non-Rust path. | [Evidence and current state](#evidence-and-current-state) |
| **Commands cannot run.** Every measurement command needs `rust/Cargo.toml` and `migration-check`. Both exist only in an unmerged draft. Mark them "runnable after the inventory step merges". Build with plain `heavy-run` first; time only the built binary under `--exclusive`. | Commands are split into three blocks: run today (each was run once, with its output stated), run after `rust-source-inventory` merges, and run after the deferred runner merges. Build uses plain `heavy-run`. | [Measurement contract](#measurement-contract) |
| **Gate G contradicts the preparation steps.** Inventory, harness and native delivery still dispatch to the old runtime, so they cannot run "without the legacy runtime". Exempt them by name. | G applies in full to port slices only. The named non-port steps keep only the behavior and safety clauses. | [Gate G](#gate-g) |
| **The statistic is not usable.** An upper 95% bound on a p95 ratio from 60 pairs rests on about three tail samples, and measured noise was 19-50%. Name the estimator (for example a bootstrap of the median ratio) and measure the noise floor first, or every result is "inconclusive". | The p95 bound is gone. The gate's `min-and-paired-median` rule gives R_T for tracked rows. R_M has one definition and one command. Each has an A/A floor. A bootstrap of the median ratio covers workloads with no row. | [Statistic and noise floor](#statistic-and-noise-floor) |
| **The final audit cannot pass.** Frozen agent support stays, exclusions are forbidden, and the audit needs zero unexplained legacy components. This needs an owner decision. | The audit accepts five named states and needs 0 unrecorded components. This is a default. Task `rust-owner-rules-on-replan-defaults` tracks the owner's ruling and blocks the audit. | [Rollout](#rollout-security-and-regression-coverage), [Decisions](#decisions-2026-11-10) |
| **One cross-repo rule.** Say once whether dotfiles work waits for the agentbrew validator, and how the shared crate is pinned (git revision plus vendoring) so `--locked` builds work offline. | One rule with the same bullets in both plans: who waits for the inventory, who waits for the runner, and git `rev` pin plus `cargo vendor`. | [Cross-repo rule](#cross-repo-rule) |
| **No user benefit metric.** Each slice needs one (for example p95 hook time per agent Bash call). A slice with none becomes a recorded exception. | Every step names a metric, a number and a command, or is a recorded exception with its reason. | [Numbered work breakdown](#numbered-work-breakdown), [Recorded exceptions](#recorded-exceptions) |

Proposed changes (SHOULD, owner decides):

- Move one hook-dispatcher slice to the front, with a pre-registered p95 cut
  per agent Bash call. It does not need native delivery or the full harness.
- Keep cold paths (doctor probes, sync orchestration) as recorded exceptions.
- Drop the separate "move tests to Rust" tasks; tests move with their slice.
- Cut the inventory step to a manifest and a small validator.
- Weigh cheaper options per slice first: lazy command loading and the Node
  compile cache for CLI startup; one `ps` pass for `app-priority`; parallel
  or cached doctor probes; `bats --jobs` for the gate.

*Resolution (2026-11-10): each one is adopted by default in
[Decisions](#decisions-2026-11-10). The owner has not ruled yet. One
difference: the pre-registered cut is on the gate's fastest-run `ratio`, not
on p95, because p95 is not a usable merge statistic here.*

Every later port must show its gain on the field dashboard and pass the
performance gate. Events carry a `runtime` field (`ts`, `shell`, `rust`) for
that comparison.

*Resolution (2026-11-10): see the 14-day field check in
[Rollout](#rollout-security-and-regression-coverage). The comparison is by
version, with a local-log fallback.*

## Measurement anchors

- Basili, Caldiera and Rombach (1994), *The Goal Question Metric Approach*:
  connect each slice to a user-visible measure.
- Munafò et al. (2017), *A manifesto for reproducible science*: register the
  hypothesis and decision rule before observing the candidate.
- Kohavi, Tang and Xu (2020), *Trustworthy Online Controlled Experiments*:
  run A/A checks, keep guard metrics and keep negative results.
- Efron and Tibshirani (1993), *An Introduction to the Bootstrap*: percentile
  intervals for a median.
- [Cargo build](https://doc.rust-lang.org/cargo/commands/cargo-build.html) and
  [cargo vendor](https://doc.rust-lang.org/cargo/commands/cargo-vendor.html):
  locked, offline builds from a vendored source.
