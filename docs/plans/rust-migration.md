# Rust migration implementation plan

**Status (2026-11-10): porting stays paused until the owner starts it.**
This plan was rewritten on 2026-11-10 after the
[validation review](#validation-review-2026-11-09). No code is ported yet.
The re-plan Pivot did not apply: all seven MUST findings are resolved and
gate G stays. The measured hot path (hook helpers) now comes first.

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
- **Field telemetry:** each command sends one content-free event with `ms`
  and `runtime` (`ts` now, `rust` after a port)
  ([details](../observability.md)). The dashboard shows p50 and p95 per
  command and runtime.

## Evidence and current state

Reviewed at revision `b86c47ca` on 2026-11-10.

| Claim | Current source of truth | Status |
|---|---|---|
| CLI and build use TypeScript/Node | `package.json`, `src/cli.ts`, `tsup.config.ts` | fact |
| Rust crates exist under `rust/`: `checkup-run`, `fetch-mutation`, `gdoc-capture`, `history-audit-prep`, `page-error-probe` | Each crate has its own `Cargo.toml` and `Cargo.lock` | fact |
| A prebuilt native `checkup-run` ships for one platform | `native/checkup-run/`, [source-build plan](source-build-prebuilt-764.md) | fact |
| No workspace manifest `rust/Cargo.toml` and no `migration-check` binary exist | Tracked source; draft PR #767 is unmerged | fact |
| Hook checks are shell scripts, one process per check | `hooks/manifest.yaml`, `hooks/checks/`, `hooks/lib/` | fact |
| The performance gate tracks CLI rows and single-hook rows, but no whole-chain row | `scripts/perf-budget.tsv` | fact |
| Commands send `ms` and `runtime`; hook checks send no event | `src/core/events.ts`, [observability](../observability.md) | fact |
| Time for the whole hook chain of one Bash call | Step 1 below | unmeasured |

**Existing Rust code is grandfathered.** The crates above shipped before
gate G existed. They are delivered behavior and the baseline for later work.
They do not count as migrated slices. The inventory manifest lists each one.
A later change that makes one of them replace a non-Rust path must pass G.

## Scope

In scope: owned code on a measured hot path. Today that is the hook checks,
their `hooks/lib/` helpers and the generated helper scripts they call.

Out of scope until reopened: every slice in
[Recorded exceptions](#recorded-exceptions).

Never in scope:

- UI presentation, such as the goal dashboard HTML and terminal rendering.
- Shell that must stay shell: sourced environment changes, completions,
  first-binary bootstrap and required protocol shims. Move business logic
  out of those shims when their slice is ported.
- Declarative YAML, JSON, Markdown, schemas and fixture data.
- Upstream CLIs, browser engines and the memory service. Do not copy another
  repository's source into agentbrew.
- Frozen Augment support (`VISION.md` NG4). It stays as it is. The manifest
  marks it `frozen`. It needs no port and no task.

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

This is the one rule for both repositories. The dotfiles plan repeats it
word for word.

- Hot-path slices and source collection in dotfiles do not wait for
  agentbrew. They use the dotfiles performance gate and local logs.
- A dotfiles step that runs `migration-check` waits until the agentbrew task
  `rust-source-inventory` merges. No other dotfiles step waits.
- Dotfiles pins the shared crate as a git dependency with an exact `rev`.
  It commits `Cargo.lock` and a `cargo vendor` copy, with a
  `.cargo/config.toml` source replacement. `cargo build --locked --offline`
  then works with no network and no sibling checkout.
- The vendored copy is a pinned snapshot of agentbrew's crate. Dotfiles
  never edits it and never writes a second engine.

## Measurement contract

### Commands that run today

```bash
npm run --silent perf:gate -- --force --json
bash scripts/run-hook-fixtures.sh
jq -s '[.[] | select(.command == "sync") | .ms] | sort | .[length / 2 | floor]' ~/.local/share/agentbrew/logs/events.jsonl
node ~/.config/agentbrew/scripts/agent-perf.mjs report --all --days 7 --json
```

The first prints `base_min`, `head_min`, `ratio`, `paired_delta_ms` and
`verdict` per tracked row. The second proves hook verdict parity. The third
prints the local p50 of one command; the dashboard shows the same number per
`runtime` for all installs. The fourth prints agent tool time per step.

### Commands that run after `rust-source-inventory` merges

`rust/Cargo.toml` and `migration-check` do not exist yet. These commands are
**runnable after the inventory step merges**. Until then no task may cite
one as its measurement.

```bash
heavy-run cargo build --locked --release --manifest-path rust/Cargo.toml --bin migration-check
heavy-run rust/target/release/migration-check inventory --check
heavy-run --exclusive rust/target/release/migration-check compare --slice <task ID> --pairs 30
```

Build with plain `heavy-run` first. Time only the built binary under
`heavy-run --exclusive`. Compile time never counts as workload time. The
`compare` command exists only when a reopened slice needs the differential
runner (see [Deferred preparation steps](#deferred-preparation-steps)).

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

- **Time, for a row in the budget file:** the performance gate decides. Its
  estimator is `min-and-paired-median`: the fastest of 15 runs and the median
  of the paired differences must both agree. Measured on 2026-11-10: 0 false
  alarms in 20 clean runs and 20 of 20 seeded slowdowns caught under load.
- **Time and memory, for other workloads:** R_T is the median of the paired
  ratios candidate time / baseline time. R_M is the same for peak RSS. Use at
  least 30 order-balanced pairs. Take a percentile bootstrap of the median
  with 10,000 resamples and a committed seed. Use its upper 95% bound.
- **Noise floor first:** run the same comparison with the baseline on both
  sides (an A/A run). Its upper bound must be at most 1.05. If it is higher,
  the result is inconclusive. Fix the run conditions; never the thresholds.
- **Memory without the runner:** take peak RSS from `/usr/bin/time -l` over
  15 pairs and compare the medians.
- **p95** is a field number. Read it from the dashboard, where the sample
  count is large. It is not a merge gate.

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
  `heavy-run`. The Rust build runs in `npm run verify` only when `rust/`
  changed.

**Named exemptions.** Three preparation steps still call the old runtime by
design: `rust-source-inventory`, the measurement runner and native candidate
dispatch. The clause "runs without its former interpreter" does not apply to
them. Every other clause does. `rust-hook-chain-timing` adds measurement
only, so the same exemption covers it.

**Pivot:** any safety or approved-behavior failure stops a port at once. A
resource bound over 1.10 needs a different boundary, dependency or
algorithm. A missed user-benefit number ends the slice; it does not lower
the number. Never relax a threshold after results. Inconclusive evidence
keeps the old path active.

## Numbered work breakdown

All tasks are AFK within synthetic, scratch and already-authorized local
boundaries. One implementation PR changes one observable boundary. Tests
move with their slice: a port keeps the old tests until the new ones catch
the same planted defects. There is no separate "move tests to Rust" step.

| Step / task ID | Why and change | User-benefit metric, number and command | Depends on |
|---|---|---|---|
| 1. `rust-hook-chain-timing` | No number exists for the whole hook chain of one Bash call. Add a budget row `hook-bash-chain` and a sampled content-free field event. | Recorded exception: it adds the instrument. Done when the row prints in `npm run --silent perf:gate -- --force --json` and an A/A run stays under the gate limit. | none |
| 2. `rust-hook-dispatcher` | About 8 hook processes start on each agent Bash call. Run the Bash checks through one dispatcher that reads the payload once. Weigh a single shell dispatcher first. | `hook-bash-chain` `ratio` at most 0.50 against the merge-base, from `npm run --silent perf:gate -- --force --json`. Field: p50 of the chain event for `runtime` `rust` at most half of `shell`. | 1 |
| 3. `rust-hooks-and-generated-helpers` | The other hook families still start `jq`, Perl or Python per call. Move each family into the dispatcher. | Each ported `hook-*` row `ratio` at most 0.70, same command. Each new family adds its row first. | 2 |
| 4. `rust-cold-path-profile` | Sync, catalog, MCP lifecycle and doctor probes were never profiled. Measure where their time goes before any port. | Recorded exception: measurement only. Output is the share of wall time in owned code per command, next to its field p50 from the `jq` command above. | none; parallel with 1-3 |
| 5. `rust-source-inventory` | Keep scope honest with a small manifest and a small validator. No full harness. | Recorded exception: preparation. Done when `migration-check inventory --check` rejects every planted omission. | none; parallel with 1-3 |
| 6. `rust-final-audit` | Prove that every owned executable is ported, a recorded exception or frozen. | Recorded exception: audit. Done when unrecorded components are 0 and every ported slice still meets its number. | 2, 3, 4, 5 |

Step 2 commits the absolute `hook-bash-chain` number from step 1 before any
dispatcher code. The ratio above is the decision rule; the absolute number
is the baseline receipt.

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
current language. It reopens only when both conditions hold: the field
dashboard or `rust-cold-path-profile` shows a user-visible cost, and a
profile puts at least half of that cost in owned interpreter code. A
reopened slice gets a task with its own number first. The task blocks that
this re-plan removed remain in git history at `b86c47ca`.

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
| Frozen Augment support | Policy: keep it, never change it. | None. |

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
proof of deployed behavior or field performance. After the switch, the
dashboard must show the gain for `runtime` `rust` within 14 days, or the
slice rolls back.

**Final audit rule.** The audit passes when every owned executable
component in the manifest has one of three states: `ported` with receipts,
`exception` with a row in the table above, or `frozen`. Unrecorded
components must be 0. The audit claims "all measured hot paths ported". It
never claims "all code is Rust".

## Decisions (2026-11-10)

The owner chose to fix the plan and to ship it without another question
round. The choices below were **adopted by default on the reviewer's
recommendation**. The owner did not decide them one by one. **The owner can
reverse any of them.**

| Choice | Adopted default |
|---|---|
| Order | The hook-dispatcher slice comes first, with a pre-registered cut per agent Bash call. It needs no native dispatch and no full harness. |
| Cold paths | Doctor probes, sync orchestration and the other slices in the table above are recorded exceptions. |
| Test tasks | The separate "move tests to Rust" task is gone. Tests move with their slice. |
| Inventory | The inventory step is a manifest and a small validator. |
| Cheaper options | Each slice weighs a cheaper fix first and ports only when that fix misses the number. |
| Existing Rust code | Grandfathered as delivered behavior. It passes G only when it replaces a non-Rust path. The review asked for a statement; this is the default. |
| Final audit and frozen support | Frozen support and recorded exceptions are named audit states. The review said this needs an owner decision; this default makes the audit passable until the owner rules. |

## Validation review (2026-11-09)

An independent reviewer checked the earlier plan against measured timings on
2026-11-09. Verdict: **re-plan before any port**. No task in either
repository was done. The owner paused porting the same day and asked for
field metrics and a speed gate first. Both now exist
([Telemetry](../observability.md),
[performance gate](../observability.md#performance-gate)).

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
  repositories. Gate G now carries a build budget.

### Findings to fix

None open. The seven MUST findings are resolved below.

### Resolved findings (2026-11-10)

| Finding | What changed | Where |
|---|---|---|
| Stale evidence | The evidence table reviews revision `b86c47ca` and lists the Rust crates. They are grandfathered and pass G only when they replace a non-Rust path. | [Evidence and current state](#evidence-and-current-state) |
| Commands cannot run | Commands are split into "run today" and "run after `rust-source-inventory` merges". Build uses plain `heavy-run`; only the built binary is timed under `--exclusive`. | [Measurement contract](#measurement-contract) |
| Gate G contradicts the preparation steps | G exempts the inventory, the measurement runner, native candidate dispatch and the timing step by name from the "without its former interpreter" clause. | [Gate G](#gate-g) |
| The statistic is not usable | The p95 confidence bound is gone. The gate's `min-and-paired-median` rule decides tracked rows. Other workloads use a bootstrap of the median paired ratio after an A/A noise floor of at most 1.05. | [Statistic and noise floor](#statistic-and-noise-floor) |
| The final audit cannot pass | The audit accepts three named states: `ported`, `exception` and `frozen`. It needs 0 unrecorded components. Adopted by default; the owner can reverse it. | [Rollout](#rollout-security-and-regression-coverage), [Decisions](#decisions-2026-11-10) |
| One cross-repo rule | One rule, repeated word for word in both plans: who waits for what, and git `rev` pin plus `cargo vendor` for offline `--locked` builds. | [Cross-repo rule](#cross-repo-rule) |
| No user benefit metric | Every step names a metric, a number and a command, or is a recorded exception with its reason. | [Numbered work breakdown](#numbered-work-breakdown), [Recorded exceptions](#recorded-exceptions) |

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
