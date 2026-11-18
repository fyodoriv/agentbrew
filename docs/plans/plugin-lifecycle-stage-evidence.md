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
