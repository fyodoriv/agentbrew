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

## Test supervisor ownership control

The separate draft runner can send a group signal from a saved child
PID. Its final wait also depends on the child pipes closing. A failed
signal can leave those pipes open. Keep that runner out of this
experiment. Test a separate supervisor that gets its own process
group and accepts only a fixed shutdown request on its own IPC
channel. The supervisor checks its current group before it can send
a signal to that group. The parent never signals a saved PID.

Use synthetic child programs with their own expiration timers. Both
the supervisor and the worker have a bounded lifetime. Neither uses
the real lifecycle command, a network request or the user's settings.
Treat an absent acknowledgment, a failed signal and missing terminal
evidence as separate fixed outcomes. Output may contain only fixed
receipt labels. Keep the original 30,000 ms lifecycle test and its
assertions unchanged.

- **Hypothesis**: A separate supervisor can stop its owned synthetic
  process group before the fixture deadline, report a failed signal
  without retrying against a PID, and refuse unqualified requests.
- **Measurement**: Run `heavy-run npm exec -- vitest run src/plugins/lifecycle-observation-supervisor.test.ts --maxWorkers=1` on Mac and hosted Linux. Use the five registered cases below and inspect the fixed receipts. The production lifecycle and the earlier process-group runner are outside this suite.
- **Success**: All 5 cases match their expected outcomes. Both owned
  processes end in the admitted stop case. The outside sentinel
  finishes normally. Every failed or refused control ends within 10
  seconds and makes zero unqualified signal calls.
- **Pivot**: An unexpected signal, missing acknowledgment, process or
  pipe left open after the limit, or unqualified success rejects the
  approach. Keep the original timeout cause unknown. Do not retry
  with a wider process selector.
- **Anchor**: [Node.js detached child semantics](https://nodejs.org/api/child_process.html#optionsdetached),
  [Apple signal scope](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html),
  and the original lifecycle observation plan.

| Case | Required result |
| --- | --- |
| S01 | An ordinary synthetic worker and its supervisor complete with no signal request |
| S02 | The qualified supervisor stops its own worker and itself. A separate sentinel finishes normally |
| S03 | A planted signal failure reports a fixed failure result. Both owned fixtures self-expire and the parent sends no fallback signal |
| S04 | A supervisor in the wrong group refuses the request before reaching the signal function. Its test signal function cannot send a real signal |
| S05 | No ready acknowledgment leaves the result unqualified. No signal request is sent |

On macOS, all five cases passed under the shared queue. The admitted stop
recorded the worker's terminal signal and the supervisor's normal exit.
The sentinel answered after both returned. The failed signal and the
two refusal controls all ended within 4.1 seconds. Type checking passed.

These controls qualify only the synthetic ownership and failed-signal
boundary. The real test and the external recorder channel still need
separate evidence before an observed timeout can be classified.
