# Observe source-checkout failure classes safely

Commit this prediction before diagnostic test edits or measurements. This is
instrumentation preparation, not a diagnosed cause or a product fix.

## Retained baseline and uncertainty

The composed full gate reported a missing concurrent child outcome in
`src/sync/pull-source-caches.test.ts`. Its updater child finished successfully
with the accepted source and lock revisions. The index child printed a wait
notice followed by `fixture refresh failed`; its catch discarded the error,
and no `FIXTURE_B_RESULT` record existed.

An unchanged exact-case diagnostic on the completed checkout later passed:
one selected case passed with the remaining cases skipped. Its source test,
lease implementation and index implementation matched default revision
`81cb2f1b557bd25e67d848b0ffd1740eba8d9643`. That pass does not explain the
preceding failure, prove an infrastructure cause or establish a pre-existing
defect. Preserve both raw receipts in their private evidence owner.

`indexAllSources` can reject before emitting an outcome when a checkout lease
cannot be acquired. Its worker settling function retains the rejection
identity. A typed refusal and an unrelated filesystem or application error
must not be conflated. A directory-removal race is one inspection hypothesis,
not an observed cause.

## Scope and privacy

Change only the actual-child diagnostic boundary and its synthetic controls
in the existing source-copy test file. Leave product source, lease policy,
original test assertions, outcome interpretation, retries and deadlines
unchanged. Do not introduce unlocked fallback or turn an exception into a
successful or accepted source result.

The child's catch may emit one separate `FIXTURE_B_FAILURE` JSON record with
only these enum fields:

| Field | Allowed values | Selection rule |
| --- | --- | --- |
| kind | lease-refusal, other | `instanceof SourceCheckoutLeaseRefusal`, otherwise other |
| errno | ENOENT, EACCES, EPERM, EEXIST, OTHER | Exact string whitelist; every unknown or absent code becomes OTHER |

Import the existing class through the child's normal source module route so
classification uses the actual type. Do not inspect or serialize message,
stack, cause, constructor name, source URL, checkout path or arbitrary error
properties. Never copy unknown code strings to output. Preserve catch exit
one and the separate successful-result marker. Unknown real failures remain
failures; instrumentation does not grant a retry exception.

Diagnostic records belong to the child process invocation. Their lifecycle
ends after the parent has read the terminal result and preserved the private
qualification evidence. Keep retained logs private and use synthetic values
in committed controls. Do not import real owner payloads or credentials.

## Frozen synthetic actual-child controls

Each control rejects in an actual child process through the same catch
representation as the concurrent index child. Do not replace this with a
handwritten expected log or only a parent-process helper test.

| Control | Constructed error | Required failure record | Required terminal result |
| --- | --- | --- | --- |
| typed refusal | Actual `SourceCheckoutLeaseRefusal` with a synthetic private marker in its message and no code | kind lease-refusal; errno OTHER | Exit one; no B success record; no marker disclosure |
| filesystem error | Actual `Error` with code ENOENT and a synthetic private marker in its message | kind other; errno ENOENT | Exit one; no B success record; no marker disclosure |
| unexpected error | Actual `Error` with a synthetic private marker in its message and an unrecognized synthetic code | kind other; errno OTHER | Exit one; no B success record; no marker or raw-code disclosure |

The synthetic marker is test data, never a real private value. Require one
parseable enum record per control and exact allowed keys. Check stdout and
stderr together for prohibited marker/code disclosure. A missing record or
unknown terminal state is not a passing observation.

## Hypothesis and thresholds

Goal → Question → Metric: make a failed concurrent source-refresh test
diagnosable without exposing private errors. Can the instrument classify
every frozen actual-child failure while preserving all failure semantics?

Predict missing classification falls from three of three synthetic controls
to zero after instrumentation. Predict correct enum records for three of
three controls, retained exit one for every control, zero raw-marker
disclosures and zero false B success records. The current generic catch
supplies no classification; execute the actual baseline after registration.
These are instrumentation accuracy and privacy outcomes, not source-refresh
reliability or successful product-fix claims.

Success requires the entire frozen matrix, unchanged original assertions and
deadlines, and normal required repo gates. Any missing or incorrect record,
raw error field, false success, changed oracle or raised timeout rejects the
instrument. Pivot to another safe observation boundary; do not infer a cause
or select a product change from the unchanged case's later pass.

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric;
Munafò et al. (2017), preregistration and reproducibility.

## Execution and delivery order

1. Qualify and commit this docs/task prediction without changing diagnostic
   code or running the proposed controls.
2. Add the frozen actual-child controls and capture RED against the unchanged
   generic catch. Preserve terminal statuses and private output receipts.
3. Add only safe enum instrumentation. Run the unchanged controls GREEN and
   the original exact source-copy case without changing its assertions.
4. Run the affected cohort and required full gate. Land this qualified
   instrumentation as its own PR before any product fix.
5. Classify a subsequent actual failure only from its emitted record. If no
   failure recurs, report the cause as UNKNOWN. A separately registered
   product experiment may start only after observation establishes its input.

Proposed measurement, after the controls exist:

```sh
JOBS=1 heavy-run npm exec -- vitest run src/sync/pull-source-caches.test.ts --maxWorkers=1
JOBS=1 CARGO_BUILD_JOBS=1 VITEST_MAX_WORKERS=2 LOCKFILE_SYNC_NPM=npm@10.9.2 NO_CACHE=1 heavy-run npm run verify
```

Neither command is a claimed instrumentation result at prediction creation.

## Focused observation record

Prediction `5d27c2c` preceded the actual-child controls and instrumentation.
With the unchanged generic catch, every registered control retained exit one
and emitted no success record or raw marker, but all lacked classification.
The control cohort failed exactly on missing enum records.

The shared child catch now emits only the registered kind and errno labels.
It reads an own code descriptor instead of invoking a getter and retains
default enums if inspection fails. The existing generic failure notice and
exit one remain. The real index child and synthetic controls use the same
catch representation; no product module changed.

The whole source-copy file then passed, including the synthetic controls and
the unchanged original cross-process case. All registered enum decisions and
failure exits matched, with no synthetic private-marker or unrecognized-code
disclosure and no false success record. The original failure did not recur
in this cohort. Its cause remains UNKNOWN. Full qualification and separate
instrumentation delivery were still pending at that checkpoint.

## Full instrumentation qualification

After normal composition with default revision `7fa37f6`, the frozen tree
`5b997f9f26693650c810a16fbea3e9631def40df` passed the uncached full gate:
6,401 tests passed, 33 were skipped, and all twenty steps ran fresh. The real
command and its wrapper both exited zero. The qualified test-file SHA256 is
`eeaa88314b4c279b3cffc2905091902a64aab46bf4e88fbcffe051179bc3f2cf`.

The synthetic controls intentionally retain their failed child-process logs
as private qualification evidence. Their terminal exit one is part of the
control, not a failed parent assertion. The expected retained logs contain
the registered enums, no private marker or unrecognized code, and no success
record. They are owned evidence, not unidentified cleanup candidates. Keep
the earlier failed full result and unchanged exact-case pass separately.

This closes instrumentation qualification. It does not classify the original
incident or qualify a product repair. Delivery remains a separate step.

## Bounded real failure cohort

This is a new prediction added at instrumentation closeout. Commit it before
running this cohort; it was not part of prediction `5d27c2c`. The prior full
failure, later focused passes and synthetic controls are retained provenance,
not samples in this future cohort.

Goal → Question → Metric: before choosing a product repair, can the unchanged
cross-process case yield an observed real error class? Predict at least one
real failed invocation with a safe enum record, from a baseline of zero
classified real failures. Require zero unclassified failures and zero private
disclosures. No product fix, deadline change, oracle change or exception
reinterpretation belongs to this measurement.

### Frozen procedure

1. Verify that the qualified instrumentation has merged. Record its exact
   source revision and the test, lease and index module hashes before the
   first admission. Preserve every original assertion, retry rule and timeout.
2. Admit only the existing exact case below, sequentially. Assign immutable
   invocation IDs 1 through 10 before admission. Each admission consumes its
   ID; do not replace failed, cancelled or missing observations with a new
   attempt under the same ID. Never have two cohort invocations active.
3. Preserve each command, accepted process handle, source revision, terminal
   exit, complete private log and any retained child log before deciding
   whether another invocation is allowed. Poll the same live handle after an
   observation timeout; it is not a reason to restart or advance the cohort.
4. On the first actual failed invocation with a valid `FIXTURE_B_FAILURE`
   record, stop. Require exactly the allowed kind/errno fields, establish that
   the record belongs to this invocation's index child, and retain its real
   failed exit. Do not turn it into a passing gate result.
5. An unclassified failure, private error disclosure, missing terminal
   evidence or changed source invalidates the cohort and stops it. Preserve
   the result and investigate observation separately. Do not continue until a
   later pass conceals it, alter a timeout or reset the sample IDs.
6. If every admitted invocation passes, stop at ten. The criterion remains
   unverified. Pivot to separately registered controlled-race research, rather
   than calling repeated passes proof of a fix or continuing indefinitely.

Run this exact existing case for each permitted invocation:

```sh
JOBS=1 heavy-run npm exec -- vitest run src/sync/pull-source-caches.test.ts -t 'keeps copied bytes bound to the accepted revision across production updater processes' --maxWorkers=1 --reporter=default --silent=false
```

This is a bounded diagnostic cohort, never a gate retry policy. Success
requires at least one classified actual failed invocation, zero unclassified
failures, zero private disclosures and the unchanged failure semantics.
Passing all ten does not satisfy success. A new observed error class is not
proof of the earlier incident's cause or of its mechanism. Any product repair
still needs a separate committed prediction and a decisive reproduction.

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric;
Munafò et al. (2017), preregistration. No cohort result is claimed here.

## Closed cohort result

The committed cohort reached its cap on 2026-11-06. Every one of its ten
sequential invocations passed with actual exit zero. No real failed
invocation was classified. Source-equivalent observer revision `3558265`
matched merged revision `c3331d9` at tree
`e9b991d6149160bc523ca4b83c22c78de34b5879`. Its source hashes stayed unchanged.

Private evidence retains immutable admission IDs, commands, native handles,
complete logs, real exits and the sequential-admission audit. No unclassified
failure or private-error disclosure was detected. Those guards do not satisfy
the missing real-failure criterion: the outcome is **UNVERIFIED**, and the
earlier incident's cause remains **UNKNOWN**.

This cohort is closed. Do not admit another invocation or count older runs as
its samples. The separate [controlled release-window research
prediction](source-lease-release-window-research.md) studies an artificial
schedule. Even a physical synthetic reproduction cannot satisfy this cohort's
historical acceptance or establish the earlier incident's cause.
