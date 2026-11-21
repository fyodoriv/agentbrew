# Qualify fixed lifecycle stage output from the test worker

The original plugin marketplace copy test stopped at 30,000 ms. The
existing pure recorder has nine qualified controls, but it has no real
worker output adapter. Keep the original failure and the rejected
process-group runner separate.

- **Hypothesis**: The existing recorder can emit fixed records through
  the test worker's stderr, despite the test's console mocks. An opt-in
  leaves the ordinary gate quiet.
- **Measurement**: On hosted CI, select only the named synthetic
  `plugin lifecycle observation output` test. Capture the runner output
  and parse its fixed prefix. Require zero records with observation off.
  With it on, require an add begin and completion, a release begin
  without a terminal record, and a remove begin and failure. Require a
  single invocation ID, monotonic durations, exactly the allowed keys,
  and no raw synthetic error marker.
- **Success**: Off emits zero records. On emits the five exact records.
  The same original error reaches the synthetic caller. Recorder health
  and all normal gates remain green. All original stage assertions and
  the 30-second test bound stay in place.
- **Pivot**: Reject a missing or leaked record, a renamed or skipped
  original assertion, an unexpected terminal record, or any lost error.
  An old run cannot be attributed without its own stage records.
- **Anchor**: The linked timeout in the
  [original observation plan](plugin-lifecycle-timeout-observation.md),
  the existing pure recorder and its nine health controls.

Only the synthetic selector may set `PLUGIN_LIFECYCLE_FIXTURE_OUTPUT=1`
during qualification. The standard
gate can run the real lifecycle case with ordinary output. Keep the
real diagnostic out of this preparation until the code lands and its
one-run admission is confirmed. Do not rerun any closed physical probe.

The [first worker candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44209458388)
produced zero opt-in records. Vitest's isolated-home setup removes
`AGENTBREW_*` settings before test discovery. Use a test-only variable
so the normal isolation remains in place.

## Hosted result

The [observer-free baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44209225778)
emitted zero records in both modes. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44209591302)
emitted zero with the flag off and all five fixed records with the flag
on. The addition completed, the release stayed open, and the removal
failed. No synthetic error marker appeared. The selected test observed
the original error object on rejection. Only this synthetic fixture
ran with the flag enabled. The earlier real timeout remains unexplained.

## Observe output failure from outside the worker

The worker output now has an admitted test supervisor. Qualify the
recorder's separate output channels before requesting the one real
diagnostic. Keep the existing recorder, worker settings and original
lifecycle case. Exercise the same writer in fresh synthetic Node
processes so a closed descriptor cannot affect the test runner.

- **Hypothesis**: The external process observes the expected records
  on both intact channels. A broken primary channel produces one fixed
  fallback marker and no valid terminal record. A worker whose two
  channels are closed returns an unqualified result.
- **Measurement**: Run `heavy-run npm exec -- vitest run src/plugins/lifecycle-observation-output.test.ts --maxWorkers=1`.
  Check the five registered cases from the parent. Bind positive records
  to a single invocation, one fixed stage and exact allowed fields.
  Retain the ordinary hosted lifecycle and recorder-health tests.
- **Success**: All 5 cases match the registered outputs and terminal
  statuses on Mac and Linux. The original action failure retains its
  identity. Zero raw errors or synthetic private markers reach either
  output stream.
- **Pivot**: One wrong outcome, one fabricated terminal record, one
  lost action failure, one private marker or one worker past the
  eight-second deadline rejects this output path.
- **Anchor**: The registered worker result above, the existing
  `lifecycleObservation` sink and fallback contract, and the
  [Node.js synchronous writer API](https://nodejs.org/api/fs.html#fswritesyncfd-string-position-encoding).

| Case | Captured worker result |
| --- | --- |
| O01 | Opt-in add emits an exact begin and completion on stderr. The worker exits 0 |
| O02 | Ordinary add emits zero records on either stream. The worker exits 0 |
| O03 | Close stderr before begin. Emit one fallback marker on stdout, run zero actions and exit 17 for unqualified output |
| O04 | Close stderr after begin and throw a synthetic action error. Retain that error object, emit one fallback marker, leave begin open and exit 17 |
| O05 | Close both channels before begin. Expect no output, zero actions and independent exit 17 |

All five cases passed in the local Mac run. The fallback produced its
fixed marker for each primary-only failure. The two-closed-channel
control stayed quiet and returned 17. The nine recorder health controls
passed, and the existing synthetic worker emitted the same five stage
records. Type checking also passed.

The exit 17 receipt belongs to the test fixture. Before a real lifecycle
run, register how a missing or broken channel affects the diagnostic
verdict. The earlier lifecycle timeout and its cause stay open.

## Validate the diagnostic receipt before the one-time run

The observer can emit stage records. Its outer reader must bind them to a
single run of the exact marketplace-copy test. A runner that does not confirm
that test's outcome supplies an unqualified receipt.

- **Hypothesis**: A validator can accept a complete run, a confirmed test timeout with one open stage, and a confirmed action failure with one failed stage. Missing or ambiguous evidence stays unqualified.
- **Measurement**: Run `npx vitest run src/plugins/lifecycle-observation-output.test.ts` on hosted Linux and macOS. Pass the validator fixed recorder streams and controlled test verdicts. Check a complete nine-stage run, a timeout during update, a failure during rollback, and the invalid cases below.
- **Success**: All 3 valid receipts return their exact classification. All 8 negative receipts return unqualified. Output contains only a fixed status and, when available, one known stage ID.
- **Pivot**: Reject the reader after 1 wrong classification, 1 unexpected field in its result, or 1 change to the original test, its timeout or its assertions.
- **Anchor**: The existing recorder and the qualified output failure controls above.

The invalid cases are no records, a recorder-failure marker, incomplete
framing, a duplicate begin, a skipped stage, mismatched timing, a verdict
that conflicts with the stage records, and an unconfirmed test outcome.
Only the later authorized driver may supply the actual runner verdict.
This check does not run the diagnostic or attribute the earlier timeout.

## Bind the captured records to the exact test

Use a bounded hosted process, one named Vitest test and a private result
file. Confirm both captured streams and the reported test result before
calling the stage checker. The known in-test timeout is 30,000 ms. A process
deadline or a different test timeout cannot establish an open stage.

- **Hypothesis**: The launcher can bind a framed stage stream to one passing or failed result from the exact marketplace-copy test without exposing the runner's raw output.
- **Measurement**: Run `npx vitest run src/plugins/lifecycle-observation-capture.test.ts` on hosted Linux and macOS. Substitute disposable Node children for the actual test launch. Inspect the exact argv, private result file, stdout, stderr and child exit status.
- **Success**: All 3 supported cases report the expected complete, open-stage or failed-stage result. All 8 invalid captures stay unqualified. The original case runs 0 times during qualification.
- **Pivot**: Reject after 1 unintended original invocation, 1 false classification, 1 raw error or path printed, or 1 child whose output was not bounded.
- **Anchor**: The earlier stage receipt outcomes and the locked Vitest JSON reporter.

The invalid captures are a different file, a different test, multiple
executed tests, a signaled or timed-out process, a recorder failure marker,
a stage record on stdout, incomplete JSON output, and a different test
timeout. The temporary folder belongs to one driver invocation and is
released after capture. The job that eventually runs the original case must
use a clean hosted checkout and an external job deadline. The one-run
admission stays separate.

### Qualify the typed timeout result and both capture channels

The locked JSON reporter prefers the stack over the error message. The timeout
runner can replace the stack with its call-site marker. Read the test error's
message from Vitest's reporter interface and emit only a fixed verdict.
Require the exact file ancestry, no other pending test, the JSON completion
receipt on stdout, and a terminal marker on stderr.

- **Hypothesis**: A companion reporter can emit the configured timeout from
  a harmless Vitest test while preserving the separate capture receipts.
- **Measurement**: Run a nested disposable Vitest fixture with a 125 ms
  deadline. Use the same reporters and separate buffered output streams.
  Test a nested lookalike, a pending test, and a missing completion marker on
  each stream.
- **Success**: The real short fixture reports 125 ms and both completion
  receipts. All 4 extra invalid cases stay unqualified. The original
  marketplace-copy test runs 0 times with observation during qualification.
- **Pivot**: Reject after 1 incorrect reported timeout, 1 qualified result
  with an incomplete channel, or 1 original diagnostic invocation.
- **Anchor**: The locked Vitest `Reporter.onTestRunEnd` and `TestResult.errors`
  interfaces and the earlier stage output check.

### Verify the worker stream and exclusive test selection

The coordinator can finish while a test worker's stderr closes early. Add
one opt-in completion line from the same worker, after the selected test's
stage writes. The ordinary suite keeps the hook quiet and preserves the
original test body. Disable the result cache and keep the disposable test's
dependency cache inside its own folder.

- **Hypothesis**: Anchoring the launch to the exact file, suite and test
  skips a nested lookalike. A worker marker followed by the coordinator
  marker supplies evidence from both legs of stderr capture.
- **Measurement**: Add the same quiet worker hook and a nested lookalike to
  the disposable 125 ms Vitest fixture. Verify the result statuses, marker
  order, cache scope, and independent missing and out-of-order marker cases.
- **Success**: Exactly 1 disposable case executes, 1 nested lookalike is
  skipped, both worker and coordinator markers appear in order, and 0 cache
  writes leave the disposable folder. Both new invalid captures stay
  unqualified. The original diagnostic still runs 0 times.
- **Pivot**: Stop after 1 extra case executes, 1 unknown worker result is
  accepted, or 1 observed write escapes the disposable folder.
- **Anchor**: The locked Vitest test-name filter, worker transport and
  recorder output contracts.
