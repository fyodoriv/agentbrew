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
