# Rust migration implementation plan

## Overall goal and vision

Move agentbrew's owned executable logic to Rust in small, measured steps.
Keep UI presentation and necessary shell integration in their current forms.
Preserve sync, repair, primary-host parity, ownership and privacy while
removing project-owned interpreter implementations from converted paths.

The user requested tasks on 2026-11-01. This plan queues implementation. It
does not claim a Rust workspace, benchmark result or speed gain exists.
Current fixes and queue safety work ship first. Each port then baselines
the delivered behavior rather than reintroducing an older branch's bugs.

## Decision and alternatives

Replace one observable boundary per PR through a Rust adapter. Keep the old
path only during bounded differential testing and rollback. Keep upstream
tools delegated; reuse reviewed crates behind interfaces.

A whole-repository rewrite would combine failures and lose attribution.
Keeping every interpreter indefinitely would miss the requested outcome.
Porting only hot application code would omit hooks, generated executables,
workflow utilities and test tooling. These approaches are rejected.

Agentbrew owns the shared measurement engine and versioned workload/receipt
protocol. Dotfiles uses a thin adapter pinned to a tested source revision,
without a sibling-relative build dependency or another measurement engine.
Preparation selects and tests the reusable source boundary. It requires no
new package-registry publication.

## Evidence and current state

| Claim | Current source of truth | Delivery path | Status |
|---|---|---|---|
| CLI and build use TypeScript/Node | `package.json`, `src/cli.ts`, `tsup.config.ts` at `c9df62f` | `dist/cli.js` | fact |
| No tracked Rust workspace exists at this revision | Tracked source inventory at `c9df62f` | Workspace is preparation work | fact |
| Helpers run outside application source | `hooks/lib/`, `templates/scripts/`, workflow `scripts/`, `agent-artifact-evals/` | Hooks, sync, workflows and verification | fact |
| Agentbrew owns generated agent configuration; dotfiles owns shell/macOS state | `ARCHITECTURE.md`, `docs/repo-map.md` | Owner CLI delegation | fact |
| Existing timing sources have broader scopes than an isolated port | `scripts/metrics.sh`, `templates/scripts/agent-perf.mjs`, `scripts/verify.sh` | Events and gate-step timings | fact |
| Shared native measurement engine and pinned dotfiles adapter | `rust-measurement-harness` task | Versioned workload/receipt protocol | proposed |
| Baseline time, CPU, peak RSS, process behavior and install footprint | Sealed unchanged-source receipts | Private measurement output | verify |

## Scope

Include owned runtime code, embedded programs, extensionless executables,
hooks, generated executable templates, workflow scripts, developer tools,
build/release code and non-UI tests/evals. Refresh the inventory for each new
source. Suffixes and directory names are hints, never coverage proof.

UI exceptions cover presentation, such as the goal dashboard HTML and
terminal rendering. A browser driver, screenshot controller, metric exporter
or report-data processor is not automatically UI. Necessary shell exceptions
cover sourced environment changes, completions, first-binary bootstrap and
required protocol shims. Move business logic out of those shims. Declarative
YAML, JSON, Markdown, schemas and fixture data keep their formats; embedded
executable logic does not inherit that exception.

Upstream CLIs, browser engines and the memory service remain upstream. Port
only owned adapters. Do not copy another repository's source into agentbrew.
Frozen Augment support remains frozen under `VISION.md` NG4. Do not add a
feature/fix task for it or count retained legacy code as migrated. Record any
conflict with final eligible-code coverage as an unresolved owner-policy
boundary, rather than inventing an exclusion or a completion claim.

## Boundary contracts

- **Ownership:** agentbrew alone writes its generated agent configuration and
  deployment manifests. Dotfiles delegates through the owner CLI.
- **Lifecycle:** name configuration-file, sync-operation, watcher-instance,
  process-group, plugin-instance and receipt-run scope. Define creation,
  validation, cancellation, cleanup and deletion for each mutable owner.
- **Transport:** use argv and versioned JSON. Preserve exits, byte-sensitive
  text, permissions and unknown/deny decisions. Never eval reconstructed
  commands or infer write authority from a path.
- **Privacy:** use synthetic fixtures and private, permission-restricted,
  content-free receipts. No command payloads, tokens, raw memory, private
  paths or conversation transcripts belong in measurements.
- **Memory:** preserve configured semantic-memory policy, deduplication and
  privacy opt-ins. Keep ChatGPT/Codex and Claude histories separate. Do not
  restore session import or full-conversation synchronization.
- **Resources:** use machine-wide heavy-run admission and its worker budget.
  Timing runs use `heavy-run --exclusive`. Record queue delay, compiler time,
  external tools and workload execution separately. Never disable resource
  pressure or workload-lifetime safeguards to obtain a measurement.

## Measurement contract

These are **proposed preparation commands**, not live measurements or an
existing CLI. `rust-source-inventory` provides the inventory command;
`rust-measurement-harness` adds the differential runner. Later tasks cannot
start before those prerequisites land and pass their own controls.

```bash
heavy-run cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- inventory --check
heavy-run cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- harness-selftest
heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- baseline --slice rust-text-and-file-primitives --seal
heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- compare --slice rust-text-and-file-primitives --samples 60
heavy-run --exclusive cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- final-audit
```

Use each task's exact ID in `--slice`. The runner resolves a committed
workload registry and sealed baseline rather than an unrecorded baseline.

1. Register realistic and adversarial workloads before production changes.
   Pin source, fixture hashes, platform, architecture, toolchain, lockfile,
   cache state, sampling estimator and bounded timeout/cleanup policy.
2. Measure unchanged source. Preserve failures and every sample. Separate
   cold/warm work, execution and queue wait. Missing or contaminated data
   is inconclusive; it is never zero or passing.
3. Seal baseline **B**, then commit actual numeric hypotheses, keep/pivot
   thresholds and exact commands before replacement code. B is unmeasured
   in this plan; formulas here are proposed thresholds, not observations.
4. Compare stdout/stderr, exit status, file bytes, permissions, side effects,
   signals, timeouts and descendant cleanup. A known bug needs a separately
   approved expected-outcome correction; do not silently change the oracle.
5. Use release binaries and paired samples. Record wall/CPU time, peak RSS
   in correct platform units, subprocess behavior and install footprint.
   The proposed comparison uses 60 pairs and an upper 95% confidence bound.
   Preparation registers estimator, seed, noise bound and inconclusive rules
   before candidate results exist. Exclude compilation from workload timing.
6. Keep independent review, existing gates and rollback evidence before
   deleting an old path. Publish negative outcomes as well as successful
   ports, using sanitized receipts only.

**G — common keep gate:** 100% of approved behavior cases agree; unauthorized
writes, leaked secrets, orphaned owned children and new false permits are 0;
100% of converted owned logic executes without its project legacy runtime;
define dimensionless ratios **R_T = candidate p95 time / baseline p95 time**
and **R_M = candidate peak RSS / baseline peak RSS**. Their upper 95% paired
confidence bounds must each be at most **1.10**. An upstream interpreter
host is a separately named contract, not an excuse to retain owned
interpreted business logic.

This targets runtime independence with resource guards. It does not claim
Rust is faster. A speed-specific slice must first profile the real lever,
then preregister at least **10% lower p95 workload time** with G intact.

**Pivot:** any safety or approved-behavior failure stops a port immediately.
A resource upper bound over 1.10 requires a different boundary, dependency
or algorithm. Never relax thresholds after results. Inconclusive evidence
keeps the old path active and requires a separate preparation change.
Coverage percentages prove scope, not user benefit.

## Numbered work breakdown

All tasks are AFK within synthetic, scratch and already-authorized local
boundaries. A live credential, host, physical-device or publication need is
an explicitly blocked validation step; mocks do not satisfy it. Large
families split into child slices with their own baseline, G and rollback.
One implementation PR changes one observable boundary.

The task queue owns dependencies and acceptance. These source paths are
starting points; the inventory must find omitted and newly added code.
Every row is owned by agentbrew. Dotfiles inventory can proceed in parallel,
but its measurement adapter depends on `rust-measurement-harness` here.

| Step / task ID | Why and change | Source boundary | Dependency / parallelism | Acceptance and verification |
|---|---|---|---|---|
| 1. `rust-source-inventory` | Prevent hidden executable work from escaping scope; add manifest and minimal Rust validator. | Tracked sources, generated targets, embedded and extensionless code. | none | 100% classified, 0 unknown components; `inventory --check` rejects planted omissions. |
| 2. `rust-measurement-harness` | Make per-step decisions reproducible; add the shared engine, receipts and sealed baselines. | New Rust workspace; existing event and timing contracts. | 1 | `harness-selftest` rejects planted semantic, privacy, resource and cleanup failures. |
| 3. `rust-native-delivery` | Introduce a recoverable candidate without changing the live default. | `package.json`, `scripts/install.sh`, `scripts/worktree-deps.sh`, CLI dispatch and assets. | 2 | G plus scratch install, interrupted update and rollback; `compare --slice rust-native-delivery --samples 60`. |
| 4. `rust-text-and-file-primitives` | Preserve exact text and file safety with native parsing. | `src/core/json-text-edit.ts`, redaction, secrets, environment, transforms and `src/utils.ts`. | 3 | G, 0 unintended byte changes or missed planted secrets; task-specific `compare`. |
| 5. `rust-process-primitives` | Bound execution, cancellation and resource use. | `src/core/git-retry.ts`, `launchctl.ts`, `user-scheduler.ts`, MCP probes and child environment. | 3; parallel with 4 | G, 0 orphaned children or admission bypasses; task-specific `compare`. |
| 6. `rust-state-and-agentfile` | Keep state transactions and ownership intact. | `src/state.ts`, `settings.ts`, `manifest.ts`, `agentfile*.ts`, `paths.ts`, `lock.ts`, `core/state-manager.ts`. | 4, 5 | G, 0 lost updates or foreign-owner writes; task-specific `compare`. |
| 7. `rust-catalog-and-sources` | Preserve source provenance through native install/update/remove. | `src/catalog/`, source fetch/cache, skill tools, import/update/prune and owner preservation. | 6 | G, offline and user-kept-target controls; task-specific `compare`. |
| 8. `rust-sync-content` | Preserve primary-host content parity and owner edits. | `src/sync/` skill, rule, command, agent-definition and instruction engines/delegates. | 6, 7 | G, supported host parity and no-op/foreign-file controls; task-specific `compare`. |
| 9. `rust-sync-configuration` | Reconcile settings and scheduler inputs without changing trust. | `src/sync/` MCP, model, hooks, permissions, statusline and helper engines; sync runner and agent maps. | 6; parallel with 7 and 8 | G, dry-run/no-op/unknown-key/trust controls; task-specific `compare`. |
| 10. `rust-mcp-lifecycle` | Keep source pin/build, registration and healing bounded. | `src/mcp/`, registry adapter and MCP command registration. | 5, 6, 7 | G, refused re-pin, bad build, runnable entrypoint and offline controls; task-specific `compare`. |
| 11. `rust-memory-integration` | Preserve semantic-memory privacy and retention. | `src/memory/`, memory sync and generated lifecycle bridges. | 5, 6, 9 | G, 0 payload leaks, unowned deletion or history imports; task-specific `compare`. |
| 12. `rust-plugin-trust-and-feedback` | Preserve signatures, scopes and public-write consent. | `src/plugins/`, overlay/team glue where present, report/contribute and GitHub integration. | 5, 6, 7 | G, wrong/revoked signer, capability, leak and denied-publication controls; task-specific `compare`. |
| 13. `rust-diagnostics-and-repair` | Keep health and post-fix evidence honest. | Health, drift checks/fixes, repair logs, status, ops and next steps. | 6, 8, 9, 10 | G, 0 false healthy/fixed results; task-specific `compare`. |
| 14. `rust-metrics-and-perf` | Retain metric meaning, histories and honest attribution. | `src/measure/`, `src/metrics/`, events/telemetry/logger, perf helper and metric/report scripts. | 5, 6; parallel with domain ports | G, 0 semantic/redaction changes, unknown evidence stays unknown; task-specific `compare`. |
| 15. `rust-cli-and-actions` | Make supported actions native through one parser. | CLI/commands/actions, bootstrap/init/upgrade, portable bundles, completion, project detection, lint/audit and screenshot orchestration. | 7–14 | G, 100% native routes for converted actions, consent and invalid-input controls; task-specific `compare`. |
| 16. `rust-hooks-and-generated-helpers` | Preserve deny/unknown decisions and bounded hook execution. | `hooks/checks/`, `hooks/lib/`, `src/hooks/`, executable `templates/scripts/`. | 4, 5, 6 | G, 0 new false permits or injection paths; task-specific `compare`. |
| 17. `rust-workflow-tools-and-scaffolds` | Keep owned workflows and generated projects usable. | Workflow `scripts/` and executable new-project templates. | 14, 15, 16 | G, scratch workflows/projects preserve approval and cleanup; task-specific `compare`. |
| 18. `rust-tests-and-evals` | Preserve independent defect detection while changing test language. | Non-UI tests/evals, fake services, affected selection, fixtures, real-e2e helpers and executable test configuration. | 2; each tested slice before retiring its oracle | 100% registered planted defects still detected, 0 omitted contracts; task-specific `compare`. |
| 19. `rust-build-release-and-install` | Build, verify and distribute recoverable native artifacts. | Owned `scripts/`, build/lint/docs generators, install/update/uninstall/release and CI executable steps. | 15, 17, 18 | G plus supported architecture install/update/offline/interruption/rollback cases; task-specific `compare`. |
| 20. `rust-final-audit` | Prove all eligible sources and deployed paths have evidence. | Repository manifest, generated outputs, installed-source receipts and docs. | All preceding slices | 0 unexplained eligible legacy components, G and valid per-step receipts; `final-audit`. |

For each `task-specific compare`, use the full command in that task's
Measurement field. First run `baseline --slice <task ID> --seal` with the
same registered runner and exclusive admission, then commit its actual
numeric predictions before implementation. The angle-bracket form here is
an instruction, not a claimed runnable fixture or a measured result.

## Rollout, security, and regression coverage

Inventory and instrumentation land before production ports. Native dispatch
and shared primitives follow. Disjoint content, MCP, memory, plugin and
measurement lanes may run concurrently after their listed contracts land.
CLI/action replacement joins these lanes. Workflow, test and build migration
then close the remaining owned paths. Cross-repo consumers use pinned
contracts, never uncommitted sibling files.

Use separate worktrees, scratch HOME/state directories, ports, process
groups and receipt outputs. Keep machine-wide admission and worker limits.
Never run conflicting deployment writers concurrently. Real CPU/memory
workloads prove capacity; sleep fixtures alone do not. Queue safety work
must not wait for this language migration.

Scheduler/queue interoperability fixtures keep an outer exclusive capacity
reservation and use an isolated scratch `HEAVY_RUN_DIR`. They never target
the live queue or forge a nesting lease. Clear inherited nesting markers
only for the isolated controller while retaining the outer worker budget;
simulated inner slots do not authorize extra live-machine capacity.

Existing runnable guards remain authoritative:

```bash
node scripts/lint-tasks-stability.mjs TASKS.md
heavy-run npm run verify:changed -- origin/main
heavy-run npm run verify
heavy-run bash scripts/run-hook-fixtures.sh
heavy-run npm run test:install-e2e
```

The changed-files gate is sufficient only when it explicitly says
`merge-ready`. Production ports retain applicable legacy contract tests
until independently reviewed Rust tests detect the same planted defects.
UI checks stay with their UI code. Keep leak, approval, signature and
endpoint-policy gates intact. Tests never publish, change live credentials
or touch owner chat history.

Select native defaults one slice at a time after G, existing gates and
independent review pass. Install atomically, re-read the installed artifact
and source receipt, exercise a safe real workflow and retain the verified
prior artifact until rollback works. A fixture pass is not proof of real
host trust, platform integration, deployed behavior or field performance.

Open preparation decisions: crate reuse, MSRV/platform support, shared-crate
pinning, estimator/noise budget, required host bridges and the frozen-support
policy conflict. Name the owner and required evidence before any consumer
depends on a choice. Do not turn an open decision into an exclusion.

## Validation review (2026-11-09)

An independent reviewer checked this plan against measured timings on
2026-11-09. Verdict: **re-plan before any port**. Zero of the 48 tasks in the
two repositories are done. The owner paused porting the same day and asked
for field metrics and a speed gate first
([Telemetry](../observability.md), performance gate).

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

Findings to fix before work resumes (MUST):

1. **Stale evidence.** The evidence table reviews an old revision. The
   repository now has Rust code that never passed gate G. State whether it is
   grandfathered or must pass G.
2. **Commands cannot run.** Every measurement command needs
   `rust/Cargo.toml` and `migration-check`. Both exist only in an unmerged
   draft. Mark them "runnable after the inventory step merges". Build with
   plain `heavy-run` first; time only the built binary under `--exclusive`.
3. **Gate G contradicts the preparation steps.** Inventory, harness and
   native delivery still dispatch to the old runtime, so they cannot run
   "without the legacy runtime". Exempt them by name.
4. **The statistic is not usable.** An upper 95% bound on a p95 ratio from 60
   pairs rests on about three tail samples, and measured noise was 19-50%.
   Name the estimator (for example a bootstrap of the median ratio) and
   measure the noise floor first, or every result is "inconclusive".
5. **The final audit cannot pass.** Frozen agent support stays, exclusions
   are forbidden, and the audit needs zero unexplained legacy components.
   This needs an owner decision.
6. **One cross-repo rule.** Say once whether dotfiles work waits for the
   agentbrew validator, and how the shared crate is pinned (git revision plus
   vendoring) so `--locked` builds work offline.
7. **No user benefit metric.** Each slice needs one (for example p95 hook
   time per agent Bash call). A slice with none becomes a recorded exception.

Proposed changes (SHOULD, owner decides):

- Move one hook-dispatcher slice to the front, with a pre-registered p95 cut
  per agent Bash call. It does not need native delivery or the full harness.
- Keep cold paths (doctor probes, sync orchestration) as recorded exceptions.
- Drop the separate "move tests to Rust" tasks; tests move with their slice.
- Cut the inventory step to a manifest and a small validator.
- Weigh cheaper options per slice first: lazy command loading and the Node
  compile cache for CLI startup; one `ps` pass for `app-priority`; parallel
  or cached doctor probes; `bats --jobs` for the gate.

Every later port must show its gain on the field dashboard and pass the
performance gate. Events carry a `runtime` field (`ts`, `shell`, `rust`) for
that comparison.

## Measurement anchors

- Basili, Caldiera and Rombach (1994), *The Goal Question Metric Approach*:
  connect runtime independence to behavior, resource and operational measures.
- Munafò et al. (2017), *A manifesto for reproducible science*: register the
  hypothesis and decision rule before observing the candidate.
- Kohavi, Tang and Xu (2020), *Trustworthy Online Controlled Experiments*:
  retain guard metrics, negative outcomes and inconclusive results.
- [Cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html) and
  [Cargo build](https://doc.rust-lang.org/cargo/commands/cargo-build.html): use
  locked builds and bound both build and test execution; build jobs do not
  automatically bound test threads or subprocess fan-out.
