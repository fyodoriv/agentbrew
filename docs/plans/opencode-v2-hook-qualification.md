# Separate OpenCode startup from hook loading

A default-config standalone run timed out before reaching the local model.
It also logged a rejection of the named-export V1 bridge. The rejection
establishes a compatibility gap. The report does not establish the cause
of the timeout.

- **Hypothesis**: With the same installed local model and a fresh minimal
  provider config, both scratch sessions complete. Only the session with
  the V1 bridge logs a plugin rejection.
- **Measurement**: Build the minimal V2 provider config from Agentbrew's
  existing helper, using the configured local model name. Run two fresh
  `opencode run --standalone --archived` processes through one exclusive
  queue request. Cap each at 120 seconds. Add the repository bridge to
  the second scratch config. Use a synthetic reply-only prompt.
- **Success**: 2/2 scratch runs reach the local model and complete within
  120 seconds. The bridge-enabled run alone reports its rejected export.
- **Pivot**: If either process times out, retain the distinct startup and
  loader observations. Do not attribute the timeout to the bridge from
  co-occurrence alone.
- **Anchor**: local 2.3.0 loader output and the [OpenCode migration guide](https://opencode.ai/docs/build/plugins/migrate-v1).

These controls diagnose startup only. A bridge port still needs real tool
and session canaries under both supported host versions.

## Isolated comparison

The no-bridge session reached the 120-second bound without a reply and
logged no bridge rejection. With the V1 bridge present, the second fresh
process logged the rejection and returned the expected reply in 41 seconds.
The registered two-pass target was not met. Rejection did not stop the
second run from reaching the local model. The cause of the first timeout
remains open, and this experiment gives no V2 hook enforcement credit.
