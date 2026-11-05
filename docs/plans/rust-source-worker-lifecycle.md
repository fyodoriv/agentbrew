# Fixed metadata worker lifecycle implementation plan

## Overall goal and vision

The Rust inventory must read source metadata without leaving owned helper
processes or blocked pipe readers behind. It must keep the selected directory
capability, preserve the caller's signal policy and finish cleanup inside the
existing operation deadline. This is measurement-tool preparation, not a
production runtime migration or a whole-inventory completion claim.

## Decision and alternatives

Use one short-lived fixed-operation worker as the signal and reaping owner.
It owns one Git child group and leaves the checker/library host unchanged.
Reuse maintained rustix process/time APIs and worker-only signal adapters.
A general host registry is outside scope.

Per-call signal registration is rejected because unregister can leave a
changed disposition. A checker-wide registry adds host and library policy
that this tool does not own. Killing only a leader does not close a pipe held
by a descendant. Group cleanup alone does not cover an escaped process or
external SIGKILL of the worker; those limits stay explicit below.

## Evidence and current state

| Claim | Current source of truth | Delivery path | Status |
| --- | --- | --- | --- |
| Git reads are a closed operation set anchored to a held directory | `rust/src/snapshot.rs` | fixed worker before normal CLI dispatch | fact |
| The current owner can reap a leader before blocking pipe joins | `rust/src/snapshot.rs`, `run_child` and `GitChild` | current shared child/pipe owner | fact |
| A held-pipe fixture exceeds the total deadline | proposed `rust/tests/lifecycle.rs` | actual shared owner, bounded fixture | verify |
| Isolated worker ownership closes every supported path within its budget | protocol and controls below | proposed version-two transport | proposed |
| Current snapshot canaries cover fsmonitor and lazy-fetch policy | `rust/tests/snapshot.rs` | closed read-policy controls | fact |
| Lifecycle or whole-inventory acceptance is complete | future required gate and inventory ledger | not established by this plan | verify |

## Scope

Change only the fixed metadata transport, its fixtures and documentation.
Keep source classification, inventory completeness, production ports and queue
resource policy separate. Keep owner Git routing, read-operation arguments,
limits, no-follow source access and no-helper policy intact.

Expected movement: one seeded descendant-held-pipe deadline violation becomes
zero. That baseline is a prediction until its actual assertion is observed.
All supported cancellation outcomes must match; owned-group leftovers, foreign
signals and caller policy changes must be zero. Any valid violation rejects
the approach. A compiler/setup failure or invalid timing sample proves nothing.

## Boundary contracts

### Hypothesis and measurement

**Goal:** keep each fixed metadata operation, its I/O, and its owned child group
inside one bounded lifecycle without changing caller signal policy.

**Question:** can an ephemeral worker own cancellation and exclusive reaping
without installing handlers in the parent checker, library or Cargo harness?

**Metric:** 100% expected decisions below; zero live descendants remaining in the
owned group after completed cleanup; zero parent-directory or host-handler
changes; zero signals to a released or foreign identity.

The existing **30-second total bound** starts before parent spawn. It includes
spawn, request input, Git execution, output, escalation, cleanup, leader reap,
pipe closure and joins. Reserve the last 2 seconds for cleanup: stop normal work
by the shared deadline minus that reserve. Timeout detection at second 30 followed
by an unbounded drain is a failure.

Cancellation during active metadata has a **2-second total bound**, measured
from the harness sending SIGINT/SIGTERM or the observed parent-death event. It
includes polling, escalation, reap and pipe completion. Descendant cleanup is
checked independently of the parent's exit time. A signaled parent's Rust
`ExitStatus.code()` is None; actual signals are 2/15. Labels 130/143 are shell
equivalents, not expected Rust exit codes.

Any valid control violation rejects the transport. Do not loosen thresholds.
Change the owner/adapter and register the next approach before measuring it.

Exact proposed measurement:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run --exclusive cargo test --locked --manifest-path rust/Cargo.toml --lib --test snapshot --test lifecycle -- --test-threads=1
```

Root records exact trees/exits. First measure the unchanged shared child/pipe
owner with bounded fixture controls. A valid baseline reaches a real lifecycle
assertion; compiler/setup failures are inconclusive. No fix before actual red.

**Anchors:** Basili, Caldiera and Rombach (1994), GQM; Munafò et al. (2017),
preregistration; POSIX process groups, waitid(WNOWAIT), kill and exec signal
semantics; safe rustix 1.1.4 process/time APIs; maintained signal-hook flag APIs
and its unregister warning.

### Selected process owner and protocol

One ephemeral fixed-op worker owns exactly one owner-Git child and its group.
This replaces same-PID exec with fixed child supervision. There is no general
host registry/supervisor. The parent and Cargo harness retain their handlers.

1. Capture expected parent PID and absolute host-monotonic deadline **before
   spawn**. Pass both as validated startup capabilities beside the versioned
   closed operation enum. No generic Git argv, executable setting or unbounded
   timeout override is accepted. Version 2 carries decimal expected-parent PID,
   deadline seconds and deadline nanoseconds after the closed operation name.
   Both processes use safe rustix CLOCK_MONOTONIC. Nanoseconds must be below
   1,000,000,000; PID must exceed 1; the deadline must be future and at most
   30 seconds ahead on worker admission. No new per-worker relative timer.
2. Validate version, operation, directory descriptor, deadline and supplied parent
   identity before Git. Initial getppid alone is invalid: an early orphan can
   already have parent 1. Refuse a mismatched/expired startup, and recheck parent
   identity immediately after child creation and while active.
3. Safe fchdir occurs before worker threads or Git. Establish signal/reaper policy
   only in this fresh worker. Maintained flags live until worker exit; never
   unregister a temporary action into an altered SIGTERM default.
   Install the worker's SIGINT/SIGTERM actions before safely unblocking exactly
   those signals with maintained nix `pthread_sigmask`. Query and verify the
   resulting worker mask before Git. If establishment/query is unsupported or
   fails, refuse with zero Git spawns. Handler registration alone does not prove
   delivery when a mask was inherited. Parent/harness masks remain unchanged.
4. Explicitly establish a waitable SIGCHLD disposition before any child/thread.
   Prove inherited SIG_IGN/SA_NOCLDWAIT handling rather than assuming exec resets
   ignored dispositions. If exclusive waitability cannot be established, refuse
   before Git. No wait-any thread or competing child reaper is admitted.
5. Git gets an invocation-owned group. Keep its leader unreaped with safe
   waitid(EXITED|NOHANG|NOWAIT) while the identity is actionable. After terminal
   completion, cancellation, limit or failure: drain remaining group members,
   then reap, complete pipes and retire. ECHILD invalidates ownership: never
   signal the former numeric PGID or use an unbounded/platform fallback.
6. Build Git argv/settings in the existing fixed owner. Preserve owner
   HOME/PATH/XDG/DOTFILES routing and null Git stderr. No source program, arbitrary
   fixture command or configurable executable becomes a production operation.
7. Keep stdout as the existing binary/NUL metadata stream. Use a bounded versioned
   request frame on existing stdin: one big-endian u32 payload length followed by
   exactly that many bytes. The cap is 8 MiB. ObjectBatch permits only complete
   40/64-hex-ID lines ending in LF; other ops require length zero. No subsequent
   payload is accepted. The parent retains its write capability after
   sending the frame; early EOF requests cancellation. The worker owns Git's
   separate stdin endpoint and closes it after the validated batch.
8. Parent request/output I/O must be nonblocking/deadline-aware. Drop, reader/writer
   thread-spawn failure, broken pipes and timeout cooperate through cancellation
   and endpoint closure inside the same total budget. They must **not** SIGKILL
   the supervisor and call that an external exception. No blocking writer/join
   is allowed to extend cleanup beyond the deadline.
9. Parent-side loss of reaping ownership fails closed and never authorizes a
   numeric PID/group signal. Generic library contexts that cannot meet the owner
   contract may be refused. Do not install implicit library/harness handlers or
   construct a general host supervisor to mask an unsupported context.

The worker must remain responsive throughout its cleanup reserve. A failure to
finish a valid controlled path inside the bound rejects this architecture; it
is not hidden behind an indefinite final wait or an inconclusive result.

### Coverage boundary

The guarantee covers descendants **remaining in the owned group**. Deliberate
setsid/setpgid escape is unsupported and named. External SIGKILL of the worker
also remains unsupported. Internal parent cleanup is not such an exception.
Current heavy-run supervises its direct command and is **not** an external
supervisor for detached groups; do not rely on it to repair this design.

Catchable parent cancellation, parent death before startup, and parent death
after child/pipe readiness remain required controls. Detached groups are not
admitted on an initial getppid observation alone.

### Valid timing samples

Run deadline controls under the exclusive reservation. The dev-only resource
adapter is sysinfo 0.40.1, with only its system feature: initialize an empty
System, explicitly load its CPU list, then refresh only CPU/memory. Take two
refresh samples with an observed monotonic difference of at least 250 ms; the
initial empty/zero sample is not admission evidence. Do not collect process,
user, disk or network records. Require a nonempty CPU list, finite global and
per-CPU usage values in 0..=100, total RAM greater than zero, and available RAM
no greater than total. Only validated samples may apply the admission limits:
global CPU usage at or below 80% and available RAM at or above 15% of total,
both on admission and each subsequent 250 ms refresh. Unsupported, unavailable,
empty, non-finite, out-of-range or otherwise invalid data is inconclusive and
non-green; never replace it with zero or classify it as a valid idle host.
During measurement, a separate monotonic observer samples
every 20 ms; a scheduling gap over 200 ms invalidates the sample. Wall/monotonic
elapsed divergence over 200 ms flags pause/sleep/clock interference. Include an
automated deliberately paused/saturated validity control.

An invalid sample is explicitly **inconclusive and non-green**. Repeat unchanged
sources under valid conditions, never relax the 30-second/2-second thresholds.
The same registered predicates classify automated injected pause/saturation
samples as inconclusive. No manual machine-state judgment or post-result guard
selection is permitted.

### Bounded fixture and actual baseline

Use one dedicated Rust Cargo fixture binary with a closed case enum. It may
spawn only the same compiled Cargo fixture artifact. No arbitrary command/argv,
owner Git replacement or new production worker operation is exposed. A narrow
test-only adapter exercises the actual shared child/pipe owner, not a simulation.

Cases include leader exit with a live stdout-holding descendant, live leader
plus descendant, immediate input refusal, output overflow and ordinary success.
PID/ready receipts use owned scratch files, not metadata stdout. Sleepers have a
finite 35-second fallback. A failing baseline records the violation first, then
waits for fallback cleanup before reporting; it leaves no unbounded fixture.

The first red must show the existing owner joining a descendant-held output pipe
past its 30-second total bound. Preserve that source/result separately from fix.

### Frozen controls

| Case | Expected outcome |
|---|---|
| Existing native/source/snapshot controls | Preserve all expected outcomes; no skips |
| Leader exits but descendant holds output | Total deadline respected; group drained; joins complete |
| Leader/descendant exceed work phase | Escalation, reap and pipes fit total 30 seconds |
| Refused input larger than pipe capacity | Bounded error and no blocking join |
| Output overflow / nonzero terminal exit | Sanitized failure; owned group and pipes closed |
| Parent SIGINT/SIGTERM after child/pipe ready | Actual signal status; descendants gone within 2 seconds |
| Worker SIGINT/SIGTERM after child/pipe ready | Worker drains its group within 2 seconds |
| Parent death before startup check | Supplied-parent mismatch; zero Git spawns |
| Parent death in check/spawn interval | Post-spawn check drains any new group within 2 seconds |
| Parent Drop/thread failure/timeout | Cooperative cleanup; no internal supervisor SIGKILL |
| Inherited ignored/no-wait SIGCHLD | Proved safe reset/exclusive waitability, or refusal |
| Inherited blocked SIGINT/SIGTERM | Worker establishes delivery or refuses before Git; host masks unchanged |
| Competing reaper / ECHILD | Refusal; zero signals through released identity |
| Two operations and unrelated protected fixture | No cross-data/signals; protected fixture survives |
| Library and Cargo harness | Host signal dispositions unchanged |
| Paused/saturated measurement | Explicit non-green inconclusive outcome; fixed thresholds |
| Empty/invalid resource samples or refresh interval below 250 ms | Explicit non-green inconclusive outcome; zero is not an availability fallback |

### Deterministic race barriers and bad-order mutations

Use ready/release barriers, not sleeps intended to hit a race. Before cancel,
prove child PID exists and its pipe is held.

- Pause between child creation and ownership publication. Cancellation must not
  see an empty owner and abandon the child. A planted publish-after-unlock
  ordering must fail the same externally observed liveness predicate.
- Pause after WNOWAIT observes terminal leader status but before cleanup/reap/
  retirement. Cancellation must still address the reserved owned group.
- Pause after retirement. Cancellation must never use the former identity. A
  planted early-retirement/late-signal ordering must be detected with an owned
  protected fixture and recorded invalid-signal sink, never by killing an unknown
  PID read from a stale receipt.
- Correct ordering passes every control. Each planted bad ordering produces its
  expected failure; an unreachable mutation is inconclusive.

Read-only observers never kill a process merely because a reaped receipt names
it. Barriers/mutations are closed fixture cases and unavailable through normal
CLI/environment settings.

### Candidate dependencies and primary evidence

Reuse safe rustix 1.1.4 process/time APIs. Signal-hook 0.4.5 is a maintained
worker-only candidate; no dependency is installed by this proposal. Registry
source builds fresh sigaction flags; the safe flag API may establish waitability
without application-owned unsafe code. Actual inherited-policy controls must
prove that before acceptance. Nix 0.31.3's safe `pthread_sigmask` is the narrow
worker-only mask adapter; no parent or harness mask is changed.

- https://docs.rs/rustix/1.1.4/rustix/process/fn.waitid.html
- https://docs.rs/rustix/1.1.4/rustix/process/fn.kill_process_group.html
- https://docs.rs/signal-hook/0.4.5/signal_hook/flag/fn.register_usize.html
- https://docs.rs/signal-hook-registry/latest/src/signal_hook_registry/lib.rs.html
- https://docs.rs/signal-hook-registry/latest/signal_hook_registry/fn.unregister.html
- https://docs.rs/sysinfo/0.40.1/sysinfo/struct.System.html
- https://docs.rs/nix/0.31.3/nix/sys/signal/fn.pthread_sigmask.html

Fsmonitor/promisor canaries remain separate registered controls. Positives run
outside discovery; negatives use exact closed read operations and owner routing.

## Numbered work breakdown

### 1. Measure the existing owner

- **Why:** prove the deadline failure before changing ownership.
- **Parallelism:** first; inventory-ledger review can continue privately.
- **Owner / boundary:** Cargo-owned fixture and the actual shared child owner.
- **Change:** add the closed lifecycle fixture and `rust/tests/lifecycle.rs`;
  keep runtime supervision unchanged. Fixture paths are proposed until added.
- **Evidence / acceptance:** a valid red reaches the actual held-pipe deadline
  assertion; finite fallback cleanup leaves no unbounded fixture. Keep all
  existing source/snapshot controls.
- **Verification:** run the exact exclusive command above; retain tree, exit,
  expected/actual assertion and automated sample-validity evidence.

### 2. Implement the fixed worker owner

- **Why:** give cancellation, reaping and pipes one bounded owner.
- **Parallelism:** depends on step 1's valid red and its committed prediction.
- **Owner / boundary:** `rust/src/snapshot.rs` and early worker dispatch in
  `rust/src/main.rs`; no implicit host signal registry.
- **Change:** implement the versioned capabilities, framed input, exclusive
  child ownership and cooperative cleanup specified above. Add only the safe
  maintained dependency features actually needed.
- **Evidence / acceptance:** all frozen lifecycle controls pass; cleanup fits
  the same total budgets; lost ownership refuses before numeric signaling.
- **Verification:** identical exclusive command and source-policy canaries.

### 3. Prove race sensitivity and containment

- **Why:** a fast parent exit alone does not prove descendant cleanup.
- **Parallelism:** depends on step 2; independent source review can run beside
  queued gates.
- **Owner / boundary:** closed fixture barriers and owned protected processes.
- **Change:** run the registered bad-order and invalid-sample controls without
  exposing fixture operations through production configuration.
- **Evidence / acceptance:** every bad ordering has its expected failure;
  correct ordering and unrelated fixtures survive. Invalid samples stay
  explicitly inconclusive and non-green.
- **Verification:** same exclusive gate; distinguish positive, negative and
  inconclusive receipts. Never count an unreachable mutant as proof.

### 4. Integrate and review

- **Why:** retain current source and discovery behavior after transport changes.
- **Parallelism:** depends on steps 2 and 3.
- **Owner / boundary:** agentbrew developer tooling and its repository gates.
- **Change:** update the source plan with actual evidence, preserve task and
  caller boundaries, and obtain an independent contract/source review.
- **Evidence / acceptance:** all native/source/snapshot/lifecycle controls and
  the repository gate pass on the exact composed tree. Whole-inventory work
  stays open until its separate acceptance is proved.
- **Verification:** the exclusive Cargo command above, then
  `heavy-run npm run verify:changed`; if it does not report merge-ready,
  `heavy-run npm run verify` remains required.

## Rollout, security and regression coverage

Commit this prediction before lifecycle fixture or supervision changes. Observe
and retain the valid baseline before applying the fix. Keep stdout metadata
bounded; keep diagnostics free of source payloads, credentials and owner config.
Never change owner capacity, signal foreign processes or turn an unsupported
ownership context into an unbounded fallback. Revert the owned transport change
through normal review if a retained contract fails. Public delivery requires
fresh authentication and all normal leak and repository gates; local measurement
can continue while that delivery is unavailable.

## Baseline fixture boundary

`rust/src/child_owner.rs` contains the unchanged existing child/pipe owner.
Snapshot reads and `rust/tests/fixtures/lifecycle.rs` compile the same source.
The separate `lifecycle-fixture` Cargo binary is a developer-test artifact;
it is not installed or distributed as an app command. It accepts only closed
self-spawning cases, with a scratch-directory release file and a 35-second
fallback. It never replaces owner Git or accepts an arbitrary program.
`rust/tests/lifecycle.rs` measures total completion and parent cancellation.
Acceptance requires owner completion and actual leader/descendant PID absence
inside the same deadline. Read-only probes accept only ESRCH as absence;
other probe results are non-green. A done marker is only a fixture aid.
`rust/tests/support/lifecycle_validity.rs` owns per-measurement CPU/RAM and
clock observations. Invalid observations fail as inconclusive before any
timing result is accepted. The future native-delivery task must retain this
test-artifact boundary when packaging the developer checker.

## Version-two candidate ownership

`rust/src/worker_owner.rs` is the shared worker supervisor. The production
fixed-operation dispatcher and closed fixture compile that same owner. Only
the fresh worker installs signal actions and changes its mask. It owns the
Git leader's group and reserves the unreaped leader through final signals.
The parent and worker request writers use standard Unix sockets, so a broken
request does not require changing the host's SIGPIPE disposition. The socket
still carries the registered frame on stdin; retaining its write endpoint
keeps the request active, and closure cancels it. All metadata stdout remains
unchanged. Parent I/O uses a per-operation nonblocking loop, with no pipe
threads to join. Cleanup uses the original absolute deadline and cannot
restart its two-second reserve on an early return.

The lifecycle fixture supplies a readiness/release barrier before its held
leader exits. This lets a correct quick cleanup pass the same process-absence
oracle. It does not add fixture-specific group cleanup. The initial valid
baseline remains separate evidence; the candidate still requires the full
registered cancellation, inheritance, race and containment controls.

The status-diagnosis checkpoint records only a fixed worker reason enum and
numeric status, signal, error or byte-count values. The production dispatcher
always supplies no receipt. Only the closed fixture supplies its owned scratch
file handle. There is no callback, configurable logger, payload, environment
or argument capture. These observations identify the actual failure branch;
they do not change return status or the acceptance predicates.

The later registered transport diagnostic experiment extends only internal
post-qualification failure statuses to the fixed range 4 through 32. Startup
and root-capability rejection remain exactly 2. Success 0, output limit 3,
outer failure codes, cleanup calls and their order stay unchanged. The parent
receives a typed optional context through its existing worker-status boundary;
production still has no receipt file or extra IPC channel. Wait errors and
actual kill errors use separate typed selectors, so a stale permission errno
cannot become a claimed signal denial. Terminal cleanup failure labels the
return branch; an earlier failed-flag tag cannot override it. This is developer
measurement preparation, not a native permission exception or a passing
whole-inventory result.
