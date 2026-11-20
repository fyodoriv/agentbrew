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
