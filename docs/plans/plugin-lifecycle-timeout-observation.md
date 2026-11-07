# Prepare plugin lifecycle timeout observation

This is a diagnostic-preparation scout. Commit its prediction before adding
observation code or running its proposed controls. No product fix, timeout
change, assertion removal or passing-retry claim belongs to this task.

## Known evidence and unknown boundary

The controlled source-lease research's single verification full exited one
with `Error: Test timed out in 30000ms.` at
`src/plugins/cli-plugin.test.ts:200:3`. The named case adds a signed fixture,
checks the marketplace copy, creates its next release, updates, rolls back
and removes the plugin. It invokes registered commands in-process through
`Command.parseAsync`; it is not an external CLI-process benchmark.

The terminal report does not identify which operation consumed the bound.
No observed per-stage timing or unfinished-stage record exists for that run.
Its cause remains UNKNOWN. Preserve the failed full; do not label it
infrastructure, pre-existing or unrelated without the required evidence.

## Narrow proposed observation

Instrument only the test-owned lifecycle boundary. Use fixed stage labels
for add, initial-copy assertion, next-fixture release, update, updated-copy
assertion, rollback, rolled-back-copy assertion, remove and final-copy
assertion. Record a monotonic begin and matching completion or failure for
each stage. A begin without terminal evidence remains incomplete.

Keep the existing real `Command.parseAsync` path and signed scratch Git
fixtures. Preserve every original assertion, exception and `process.exitCode`
check. Keep the case limit at 30,000 ms; do not split it, stub its lifecycle,
raise a deadline or insert an automatic retry to make it pass.

Output may contain only a fixed stage ID, invocation ID, monotonic timing,
duration and allowed state label. Never copy arguments, source URLs, scratch
paths, signer material, keys, raw exceptions, messages, stacks or causes.
The current fixture mocks console output, so a proposed recorder must retain
private test-owned evidence independently of those mocks and survive failed
case teardown. Do not write to the owner's HOME or agent configuration.

Recorder state belongs to one lifecycle-test invocation. Its lifecycle ends
after terminal evidence is retained and the owning fixture is safely
released. Missing or ambiguous timing cannot become a completed stage.

## Frozen observation controls

These are proposed instrumentation controls, not further source-lease
physical admissions:

| Control | Required record | Guard |
| --- | --- | --- |
| completed stage | One begin and one matching completion with a nonnegative monotonic duration | No missing or duplicate terminal state |
| incomplete stage | Begin with no completion evidence remains incomplete | No fabricated completion or swallowed pending operation |
| failed private-marker stage | Failure state retains the original thrown failure while output contains only allowed metadata | No raw marker, argument, path, key or error disclosure |

Use synthetic markers and deterministic recorder inputs for these controls.
They establish recorder accuracy, not the cause of the real timeout.

## Hypothesis, success and pivot

Goal → Question → Metric: can a future lifecycle timeout be localized without
exposing its payload or weakening its test? Predict zero missing or false
state classifications across the frozen controls, zero false completion or
swallowed failure, and zero private-marker disclosures.

Success requires every control, unchanged original assertions and the
30,000 ms bound, plus normal required qualification in a clean checkout that
does not contain the exhausted physical lease probes. Land the observation
preparation before any product-repair experiment.

If any boundary is ambiguous, a record disappears, a failure is swallowed or
an unsafe field leaks, reject the recorder. Revise observation rather than
change the denominator, replace real work or raise the timeout.

## Proposed commands and one later diagnostic

## Recorder registration (2026-11-06)

Before implementation, register one invocation-scoped recorder with a fixed
stage vocabulary. It writes only stage, state and monotonic timing records to
an explicitly supplied test-owned sink. The lifecycle case supplies a sink
that survives its fixture cleanup; no argument or exception text reaches it.
Each stage emits begin before work and completion only after success. A thrown
error emits failure and is rethrown unchanged. An unresolved operation keeps
its begin record without a terminal record.

Prediction: the completed, unresolved and failed synthetic controls each
classify correctly (3/3), with zero false terminals, swallowed errors or
private-marker disclosures. The fixed original case retains all assertions
and its existing timeout. Measurement: `JOBS=1 heavy-run npm exec -- vitest
run src/plugins/cli-plugin.test.ts -t 'plugin lifecycle observation'
--maxWorkers=1 --reporter=default --silent=false`. Success requires all three
controls and all privacy and failure guards. Any missing or duplicate record,
false completion, swallowed error or disclosure rejects this recorder design.
The controls do not explain the earlier timeout. The previously registered
one-case diagnostic remains separate and follows delivery of instrumentation.

Before measuring the reporter path, predict that one deliberately timed-out
synthetic Vitest case retains exactly one safe begin record and no terminal
record in its captured output. Run it only as a child of the focused
`plugin lifecycle observation` command above, with a scratch test root and
synthetic values. Success requires the expected timeout and the single record;
missing, duplicated or private output rejects the sink. This does not run the
original lifecycle case or explain its earlier timeout.

For the outer runner's cleanup, predict that one synthetic parent and its
same-group child both terminate after the bounded group kill. A focused
`plugin lifecycle observation` control must see the expected timeout and
confirm that the process group no longer exists. Any surviving group or
unverified kill rejects the cleanup method. This control uses no real plugin.

The proposed describe block does not exist yet. After registration:

```sh
rg -q 'plugin lifecycle observation' src/plugins/cli-plugin.test.ts
JOBS=1 heavy-run npm exec -- vitest run src/plugins/cli-plugin.test.ts -t 'plugin lifecycle observation' --maxWorkers=1 --reporter=default --silent=false
```

After instrumentation lands and its original case is explicitly authorized,
one exact diagnostic invocation may use:

```sh
JOBS=1 heavy-run npm exec -- vitest run src/plugins/cli-plugin.test.ts -t 'add, update, rollback, and remove keep the marketplace copy current' --maxWorkers=1 --reporter=default --silent=false
```

Preserve its actual result and safe stage records. A later pass leaves the
earlier cause UNKNOWN; do not repeat until it fails or passes. A new product
fix needs an observed and reproduced boundary plus a separate committed
hypothesis. Neither proposed measurement has run at scout creation.

The source-lease experiment remains closed at six admissions. Do not run
verify:changed, related selection or a full gate from its unqualified
checkout to qualify this scout. Use a separate clean checkout for future
instrumentation qualification so no capped probe is replayed.

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric;
Munafò et al. (2017), preregistration; the existing in-process lifecycle test
and its retained terminal failure.


## Recorder health preparation

Independent review found that a failed terminal-record sink can silently
leave only a begin record. The earlier focused passes did not qualify that
boundary. No new real lifecycle diagnostic has run.

Goal: distinguish missing recorder evidence from an unfinished lifecycle
action. Question: can an invocation-owned health state and an independent
fixed fallback signal expose a sink failure while preserving the original
thrown object? Predict **5/5** synthetic controls pass:

- `recorder health signals primary failure`: a failing primary terminal sink
  marks health unqualified and emits one fixed fallback signal.
- `recorder health survives both sinks failing`: both channels fail and health
  stays unqualified.
- `recorder health preserves action identity`: the exact action object is
  rethrown unchanged with no private payload in either channel.
- `recorder health accepts complete stage`: successful recording is healthy.
- `recorder health leaves pending stage incomplete`: an unresolved action
  remains incomplete and is never reported as a terminal action.

The fallback channel is test-owned and independent of the primary sink. It
receives only a fixed payload-free failure signal. The state belongs to one
recorder invocation. An external controller may qualify a run only when it
has valid lifecycle records and positive health evidence. If both channels
fail or process loss prevents health observation, the result is unqualified.
No in-memory flag is claimed durable after process loss.

Commit this prediction before writing the new test file or changing the
recorder. Add a named synthetic test that runs the existing recorder, preserves
the original thrown object, and fails specifically because no health signal is
available. Setup failure is inconclusive:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
JOBS=1 heavy-run npm exec -- vitest run src/plugins/lifecycle-recorder-health.test.ts -t 'recorder health signals primary failure' --maxWorkers=1 --reporter=verbose --silent=false 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
[ "$status" -ne 0 ] && grep -Fq 'recorder health signals primary failure' "$log" && grep -Eq 'Tests[[:space:]]+1 failed' "$log" && grep -Fq 'missing recorder health' "$log"
BASH
```

Then implement the health boundary. Run a separate pure test file so these
controls do not launch or signal any child process. Require all five names and
the exact passed-test count:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
JOBS=1 heavy-run npm exec -- vitest run src/plugins/lifecycle-recorder-health.test.ts --maxWorkers=1 --reporter=verbose --silent=false 2>&1 | tee "$log" || exit 1
grep -Eq 'Tests[[:space:]]+5 passed' "$log" || exit 2
for name in 'recorder health signals primary failure' 'recorder health survives both sinks failing' 'recorder health preserves action identity' 'recorder health accepts complete stage' 'recorder health leaves pending stage incomplete'; do
  grep -Fq "$name" "$log" || exit 2
done
BASH
```

Success requires all five named controls, unchanged original action identity,
zero false qualified states or private disclosures, and the normal full gate.
Any missing health, false completion, swallowed error, disclosure, or failed
gate rejects this method. Keep the earlier timeout cause UNKNOWN.

The runner's failed-group-signal and process identity boundary is separate and
still unqualified. A detached PID or an apparently live leader does not prove
a race-free group identity. Do not add a signal when that identity is unknown,
and do not claim finite reaping after permission failure, uninterruptible
sleep, or escaped descendants. A later registered runner method must retain the
owned handle and report unqualified evidence without signaling unowned
processes. At this stage run only the separate pure recorder-health file. The draft's
existing lifecycle file contains the unqualified group-signal runner, and the
normal full gate discovers it. The original runner controls and this draft's
full gate must wait until a group-ownership and failed-signal method is
independently registered and qualified. The full gate remains eventual
acceptance; pure recorder controls do not qualify it. No control here changes
the closed source-lease cohorts or permits another real diagnostic.

Anchor: the existing observation protocol; Basili, Caldiera and Rombach
(1994), Goal Question Metric; Munafò et al. (2017), preregistration.
