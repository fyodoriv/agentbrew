# Rust transport diagnostic reasons

## Goal and source boundary

Identify the failing fixed Git operation and terminal transport/worker branch.
Do not fix transport, change classification, permit EPERM, enable native group
proof, or claim inventory acceptance. Candidate staged tree:
`187687c9aa6c674fc47fc71b5cfc02b456e8a6f3`; HEAD:
`6bbafa0d10da0425a410540d0b0bc6cace354a07`. Rust remains uncommitted.
This plan registers instrumentation before its controls and implementation.
The candidate source paths named below are not available on the default branch.
The current published documentation base is main93c6424984f2af94c98b52417fd9142ebcc446c2.

The actual whole audit passed 68 library controls, then all 34 inventory cases
failed at `git-command` before classification. Later targets were not reached.
These are transport-blocked cases, not 34 classifier reds. The earlier shared
worker's closed fixtures establish leaf0/worker2 and TERM or KILL SignalError1
for those fixture cases only. They do not prove the cause of all 34 failures.

## Current source facts

- ReadOperation already closes operations to root-prefix, index, untracked,
  all-untracked and objects. Held-root validation first reads root-prefix.
- The worker dispatcher returns2 for invalid operation/startup/root metadata,
  root type or fchdir. Production supplies no Observation receipt handle.
- Observation already names worker supervision stages using fixed variants
  and numbers. Several early socket/spawn/PID/stdout exits remain silent.
- Worker status2 conflates startup, I/O, wait, signal, cleanup and leaf failure.
- child_owner::run_child also maps parent socket/spawn/nonblocking/I/O/wait
  and worker nonzero status to the same outer git-command. Status3 maps to
  git-limit. Fixture::codes keeps only the diagnostic code from actual JSON.
- Some reject assertions call codes twice. Count case decisions, not emitted
  rows or repeated checker invocations.

## Smallest proposed instrument

Reuse the existing worker exit boundary. Do not add a diagnostic pipe, file,
callback, logger, environment switch, arbitrary arguments or stderr capture.

1. Use the complete closed WorkerFailure table below. Preserve0=success,
   2=unqualified/unknown and all startup/root-capability rejections, and
   3=output limit. Assign4..32 only to known post-qualified supervisor
   terminal branches; every other value is unknown and fail-closed.
   Distinguish a status-preflight error from an actual signal error.
   No payload/path/PID/argument/message is encoded.
2. Preserve all decisions and cleanup paths. Only the internal nonzero status
   vocabulary changes. Every known failure still produces outer git-command,
   checker exit2 and no metadata success. Limit3 and timeouts retain their
   current outer semantics. Unknown status or signal stays explicitly unknown
   and fail-closed. No errno is ignored; native qualification stays blocked.
3. Add optional typed Diagnostic context: fixed operation, fixed parent/worker
   stage, numeric worker exit/signal when available, and decoded closed reason.
   Attach operation in snapshot::git. Parent errors use their exact fixed stage.
   Keep code/path, outer exit and successful metadata bytes unchanged. Omit
   context elsewhere. Use existing serde dependencies and one bounded record
   per failed read; no history or mutable registry. No raw error text exists
   in the new fields.
4. Let the existing inventory fixture print only that typed context for a
   git-command result. Preserve all 34 classification assertions and synthetic
   inputs. A setup diagnostic cannot count as a classification rejection.
   Keep the closed lifecycle Observation receipt separate; production still
   supplies no receipt handle.

This extends only the internal supervisor failure vocabulary. Startup
status2 assertions and outer failure outcomes stay unchanged. There is no
new diagnostic channel or native permission exception.

## Registered question and thresholds

Goal/question: can the existing failure boundary expose operation and branch
without changing fail-closed outcomes or capturing private input?

- Baseline: 34/34 inventory cases lack operation/stage/reason context.
- Prediction: unknown operation/stage count34 to0. Predict inner-reason34 to0
  only if actual failures reach newly coded known worker branches. Parent-local,
  signalled and unknown exits remain separate; do not invent an inner cause.
- Instrument success: 100% correct decisions across the frozen table/stage
  controls; zero unknown-status permits, outer status/code changes, successful
  byte changes, or payload/argv/stderr/environment captures.
- Attribution success: all34 cases identify their first operation/stage plus
  actual numeric exit or explicit parent-local reason. Claim inner-cause
  coverage only when all34 report known worker reasons. Otherwise that metric
  stays non-green, even if parent-stage coverage is complete.
- Pivot: any changed permit/cleanup decision, swallowed errno, false reason,
  collision, unmapped known branch or disclosure rejects this adapter. Unknown
  first-case attribution stops the whole-matrix run until the instrument is
  corrected. Setup/compiler/registry/admission failure is inconclusive.
- Anchors: Basili, Caldiera, Rombach 1994, GQM; Munafò et al. 2017,
  preregistration; committed lifecycle fixed-observation contract.

## Controls and exact commands to freeze before code

The table and exact control names below are frozen by this prediction.
Use closed synthetic values and existing scratch owners, never owner config.

Every Cargo run uses the canonical queue, owner HOME/PATH/Git wrapper, one
compiler worker and one test thread. Freeze inputs/tree before admission and
redirect output durably. Proposed commands, from the inventory worktree:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --lib transport_diagnostic_ -- --test-threads=1
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --test inventory reviewed_baseline_passes_without_executing_source -- --exact --test-threads=1 --nocapture
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --test inventory -- --test-threads=1 --nocapture
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --lib -- --test-threads=1
```

First capture valid missing-context instrumentation red before implementing the
instrument. The existing single baseline case must retain its outer failure
unless another separately registered transport fix intervened. Inspect its
fixed context before admitting the whole matrix. Inventory Cargo101 is still
expected while original classification assertions remain blocked. Derive
per-case attribution from the existing serial Cargo report, not a new engine
or counts of duplicated diagnostic rows. Preserve all68 library outcomes.
No timing rerun is needed for this stage metric. Any later lifecycle timing
run retains the registered exclusive queue/validity contract unchanged.

## ABI evidence and deliberately retained ambiguity

`tests/snapshot.rs::worker_rejects_invalid_startup_without_metadata_or_error_payload`
pins Some(2) at lines523 and535. Inputs are wrong mode, version99, unknown or
missing operation, bad capability count, and a non-directory root descriptor.
Keep every assertion and input byte unchanged. Therefore ALL pre-supervisor
failure returns in snapshot.rs remain2, including untested fstat/fchdir errors.
Do not claim a precise startup reason from status2. Distinct startup statuses
would need a separately registered ABI-version amendment; this proposal does
not introduce one.

`tests/lifecycle.rs` lines137–155 assert successful outer fixture completion
and exact owner-result text. Lines147–151 only include worker-status in failure
diagnostics. Lines159–189 assert successful owner completion plus owned-PID
absence, not internal2. The fixture writes the actual supervise result to
worker-status, then exits with that result. Its owner observes outer codes
git-command/git-limit. Preserve those checks, including current non-green
success/held cases; a more specific failure must not turn either green.

`tests/inventory.rs` line148 and `tests/reviewed_sources.rs` line152 allow only
outer checker0/1/2. Those remain unchanged. Existing lifecycle Observation
receipt text also stays unchanged. A historical receipt's Worker2 is a fact
about that prior run, not a new expectation to rewrite.

## Complete terminal status table

Source lines refer to the exact current tree. The reason is the existing
terminal return branch, not necessarily the first underlying OS failure.
0,2,3 retain their complete existing meanings and precedence. Known4..32 are
private supervisor return reasons. Values1 and33..255 are unknown, never a
known reason or permit. No strings or errno values are packed into an exit.

| Exit | Fixed reason | Actual current branch |
| --- | --- | --- |
| 0 | Success | worker_owner557–558: reap succeeds, failed=false, status.success |
| 2 | Unqualified | snapshot16–38 malformed mode/version/non-Unix; snapshot308–322 operation/startup/fstat/type/fchdir; unexpected unaccounted failure flag |
| 3 | OutputLimit | worker_owner559, only after the existing success arm fails and limit_failed=true |
| 4 | SignalSetup | worker_owner302–304; worker_signals139–165 returns Err |
| 5 | Request | worker_owner306–308; request172–220 returns Err |
| 6 | StartupCancelled | worker_owner310–312 combined cancelled/work_done condition |
| 7 | ChildSocket | worker_owner314–315 UnixStream pair failure |
| 8 | ChildSpawn | worker_owner322–323 command.spawn failure |
| 9 | ChildPid | worker_owner326–327 invalid converted child PID |
| 10 | ChildStdout | worker_owner337–338 missing piped stdout |
| 11 | IoSetup | worker_owner342–347 child-input/output/parent-stdout nonblocking setup failure |
| 12 | WaitBeforeCleanup | worker_owner373–398 leader.status error |
| 13 | TermUnreserved | worker_owner437–443; Leader::signal248–249 returns before status/kill because reservation is absent |
| 14 | TermWait | same caller; Leader::signal251 status preflight fails |
| 15 | TermKillPermission | same caller; actual kill_process_group252–256 fails with Errno::PERM |
| 16 | TermKillOther | same caller; actual kill_process_group fails with any other error except existing accepted SRCH |
| 17 | CleanupDeadline | worker_owner446–448 existing end.elapsed return |
| 18 | KillUnreserved | worker_owner456–462; Leader::signal248–249 reservation absent |
| 19 | KillWait | same caller; Leader::signal251 status preflight fails |
| 20 | KillKillPermission | same caller; actual kill_process_group fails with Errno::PERM |
| 21 | KillKillOther | same caller; actual kill_process_group other error except existing accepted SRCH |
| 22 | WaitAfterKill | worker_owner534–570 final leader.status error |
| 23 | ReapWait | worker_owner536/560, limit_failed=false; Leader::reap262 status query fails |
| 24 | ReapNotTerminal | same return; Leader::reap262–263 returns because status is None |
| 25 | ReapChildWait | same return; Leader::reap265–267 child.wait error |
| 26 | LeafNonzero | final560, successful reap and failed=false, nonsuccess code present |
| 27 | LeafSignal | final560, successful reap and failed=false, terminating signal present |
| 28 | Stopped | final560, successful reap, limit_failed=false, first failed flag came from371–372 |
| 29 | InputIncomplete | same final branch; first flag came from401–408 |
| 30 | InputWrite | same final branch; first flag came from478–484 |
| 31 | OutputRead | same final branch; first flag came from504–511 |
| 32 | OutputWrite | same final branch; first flag came from522–528 |

No extra clock, wait, signal, process or pipe call is added to discriminate
reasons. SignalSetup, Request, StartupCancelled, IoSetup and Stopped are the
exact existing aggregate boundaries. They do not identify nested causes.
The Request boundary includes nonblocking, cancellation/deadline, frame EOF,
oversize/extra bytes, input read and policy rejection. SignalSetup includes
registration and mask failures. Do not infer a more specific reason.

Crucial causal correction: `Leader::signal` currently returns unit for both
its status preflight and kill errors. Inspecting stale `last_error == PERM`
alone would falsely call a wait error a signal denial. The proposed adapter
must return a fixed typed error identifying Unreserved/Wait/Kill(errno class)
without changing its existing calls, call order or outcomes. Reap likewise
needs a typed Wait/NotTerminal/ChildWait boundary, not an inferred leaf failure.
Drop must retain the existing ignored error and bounded cleanup behavior;
these codes identify the main return, not secondary Drop outcomes or absence
of descendants. Darwin qualification remains blocked.

For final560, remember only the first existing failed-flag site in one
supervise-invocation-local optional enum. It is set only alongside an existing
false-to-true transition. Never overwrite it with cleanup observations.
Evaluate the unchanged success arm first, then the unchanged limit arm, then
reap error, first failure flag, or leaf status. Any impossible/missing tag
returns2 Unknown. Do not change short-circuit predicates to collect evidence.

## Parent context mapping, not worker exits

Parent stages are a separate closed enum; they must not impersonate a worker
reason: InputLimit(child_owner41–42), RootClone(snapshot238),
RequestSocket(child_owner45), RequestMode48, WorkerSpawn54, WorkerStdout63,
OutputMode64, Deadline74–75, RequestWrite87, OutputRead102, WorkerWait109,
OutputLimit96–98, WorkerLimit114–115, RecordedFailure118–119,
WorkerNonzero120–124 and IncompleteSend120–124. Attach one of the existing
five ReadOperation values in git. RootClone occurs before run_child and must
not be omitted. Framing is a four-byte bounded length plus the unchanged
input. Its construction has no fallible Result branch; do not invent a
FrameBuild failure. IncompleteSend means the existing status-success branch
is false solely because sent differs from frame.len(). A missing status
continues waiting until the existing deadline, not a fabricated exit.

Keep the parent failure-tag assignment alongside each existing assignment
to failure; preserve its existing overwrite order. In particular, worker3
still overrides it to git-limit. Final RecordedFailure reports the winning
tag, not a previous superseded error. Only WorkerNonzero with a numeric4..32
is decoded through the table. Code2,
unknown code, code=None and a signal termination remain unknown inner reason;
numeric signal and exit are separate fields. Never treat a signal number as
an exit-table index. Existing outer git-limit/git-timeout precedence stays.

## Frozen instrumentation control names

These exact new names are frozen under the existing library test harness:

1. transport_diagnostic_worker_reason_table_roundtrips
2. transport_diagnostic_unqualified_startup_stays_two
3. transport_diagnostic_unknown_exit_stays_unknown_and_failed
4. transport_diagnostic_signal_exit_does_not_decode_a_reason
5. transport_diagnostic_parent_stage_table_covers_existing_errors
6. transport_diagnostic_term_wait_is_not_kill_permission
7. transport_diagnostic_kill_wait_is_not_kill_permission
8. transport_diagnostic_reap_error_is_not_leaf_failure
9. transport_diagnostic_success_and_limit_precedence_is_unchanged
10. transport_diagnostic_first_failure_tag_is_not_overwritten
11. transport_diagnostic_absent_context_is_not_invented
12. transport_diagnostic_serialization_has_only_closed_fields
13. transport_diagnostic_outer_codes_remain_unchanged
14. transport_diagnostic_root_clone_and_incomplete_frame_are_not_worker_failures
15. transport_diagnostic_parent_timeout_and_limit_precedence_is_unchanged

Add one integration control in the existing lifecycle test file:
transport_diagnostic_closed_invalid_request_roundtrip. Extend only its closed
fixture's allowed case set with owner-invalid-request: use the actual shared
child_owner and worker_owner, Objects input policy, and invalid synthetic
request bytes. The supervisor must produce the existing Request observation
and the registered5 failure before any leaf spawn. The real parent must return
git-command with worker_exit5/Request and remain failed. This cannot be a
fixture that directly exits5 or calls the decoder in place of the worker.
Keep existing success/refusal/overflow/cancellation oracles unchanged. The
new control proves one real worker-to-parent failure path, not every OS branch.

Round-trip input is the full exact0..255 range, plus missing code and actual
signal-shaped ExitStatus values; assert the table's exact allowed set, not
only uniqueness. No force-killing a real process is needed to construct the
signal-shaped unit value. Permission controls must distinguish a synthetic
wait-PERM from kill-PERM using the actual typed selector shared by production.
These unit controls prove mapping and serialization, not OS branch reach.

The semantic instrumentation red should reuse the actual existing reviewed
baseline fixture: inspect its real checker JSON and require the fixed context
before its unchanged empty-code assertion. Current JSON lacks that field, so
the expected red is missing transport context, not a compiler error. The
later known failure context does not make its classification assertion pass.

Case accounting uses the FIRST checker invocation for each of the existing34
cases. Preserve that report and status before evaluating the unchanged
classification assertion. In rejects(), retain self.codes() once for both
the predicate and failure message; do not invoke the checker a second time.
An unknown first report cannot be replaced by a later known report. Record
first-invocation transport-success separately if it occurs; do not invent a
worker failure reason for success. The metric denominator stays exactly34
case decisions, with known failure, unknown failure and transport-success
categories exhaustive. Additional checker calls within a case remain useful
functional evidence but cannot improve its first-invocation attribution.

Retain the exact inventory baseline, all34 cases, snapshot invalid-startup
control and lifecycle oracles. No assertion is broadened from status2 to any
nonzero. Additive supervisor statuses do not alter the existing snapshot
startup boundary or any outer checker/fixture status contract.

Use the four canonical queued Cargo commands above.
Add this exact retained non-timing regression command after instrumentation:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --test snapshot worker_rejects_invalid_startup_without_metadata_or_error_payload -- --exact --test-threads=1
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run --exclusive cargo test --locked --manifest-path rust/Cargo.toml --test lifecycle transport_diagnostic_closed_invalid_request_roundtrip -- --exact --test-threads=1
```

The earlier lifecycle signal receipt supplies no new result for this change.
If a fresh lifecycle comparison is required, use its existing exclusive timing
command and validity controls; keep known non-green expectations explicit.
Root and an independent ABI judge reviewed this table before registration.

## Implementation and delivery sequence

1. **Register.** Owner: documentation branch. Why: freeze the failure table,
   exact inputs and thresholds before results. Update only this plan and the
   existing rust-source-inventory task link. Run the required changed gate
   below and commit this prediction before any new fixture or instrument.
2. **Observe missing context.** Owner: the existing inventory fixture. Depends
   on registration. Add the fixed context assertion to its actual CLI report;
   keep its classification assertion. Capture a missing-field semantic red,
   never a compile/setup failure. Preserve first-invocation evidence.
3. **Implement the narrow adapter.** Owner: the unpublished Rust developer
   checker candidate. Depends on valid red and root source authorization.
   Change only typed diagnostics, existing failure return labels and the named
   controls. Preserve cleanup, status2 startup, stdout and outer decisions.
4. **Measure and review.** Owner: root with independent source review. Run
   the exact focused commands on frozen inputs. Inspect the first real case
   before the whole matrix. Keep classifier acceptance and native lifecycle
   qualification non-green; do not claim either from diagnostic coverage.
5. **Publish separately.** Owner: root. This docs registration can land before
   the supporting foundation. Source publication requires normal review and
   repository gates on the composed candidate, with non-green boundaries
   explicit. A later transport fix requires its own committed prediction and
   valid semantic red; diagnostics do not authorize an EPERM fallback.

## Documentation registration gate

From this documentation branch, the exact existing required gate is:

```sh
JOBS=1 VITEST_MAX_WORKERS=1 heavy-run npm run verify:changed -- HEAD
```

It must return zero and report merge-ready before the docs-only prediction
commit. If it does not report merge-ready, the normal full repository gate
remains required. This validates docs, not the future Rust instrument. The
existing task's original complete-inventory acceptance remains unchanged.

## Security and remaining boundaries

Do not capture source payloads, raw Git output, owner paths, arguments, stderr,
credentials or environment values. Typed diagnostics contain only fixed enums
and numbers. Preserve owner Git wrapper routing and fail closed on unknown
status. No settings, services, installed runtime or production CLI changes
belong in this preparation. The supporting staged tree remains unpublished;
all34 inventory acceptance cases and Darwin lifecycle qualification remain
non-green until their separate contracts pass.
