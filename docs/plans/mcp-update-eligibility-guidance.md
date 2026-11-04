# MCP update eligibility guidance

Registered amendment: 2026-11-02, before the eligibility repair.
This extends PR #607's guidance checks without changing its candidate safety,
fresh-runtime consent, publication, five-second deadlines or existing cohorts.

## Baseline and hypothesis

The aligned candidate tree `b0f7521de6f55379c2598a21abdf2293d240344a`
passes its real-Git install cases, environment-phase counter and entrypoint
checks. Its broader related run has17 failures in the older mocked unit file.
Most need qualified fixture setup. Two already initialize state correctly and
reach actual eligibility checks: missing server and existing non-Git server.

Both receive the same generic refusal. The fixed oracles require distinct
guidance: missing server uses the existing error channel and says
`not found in state`; a non-Git server uses the existing log channel and says
`was not installed from git`. Both retain exit1 and refuse before runtime
acquisition. The related run established two failures; the exact focused
baseline below must still be captured after this registration.

GQM goal: preserve actionable update eligibility diagnostics.
Question: can a user distinguish an absent server from a server installed by
another route? Metric: failing assertions in these two existing tests.
Prediction:2 failures become0, with both original expected messages, channels
and exit statuses retained. No new sensitive input or raw error is printed.

## Frozen measurement

Run in the selected MCP candidate checkout, not this prediction-only checkout:

```sh
JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/mcp/mcp-git.test.ts -t 'logs error when server is not found in state|logs error when server has no gitUrl'
```

Preserve the existing two tests unchanged for the baseline and repair. Setup,
compiler and dependency errors are inconclusive. The exact failure must reach
the message/channel assertion with initialized state; do not manufacture a
passing test by relaxing an expected message or accepting both channels.
The baseline whole-file SHA256 is
`74c011e1d0f0a6fa0d00eeb03df19911ff8d5e77e34a380bcc58e8df4d12edc6`.

Success:0/2 failures, original exit1 and pre-acquisition refusal, no secret
disclosure, and no regression in the other MCP safety/compatibility controls.
Pivot: any remaining failure, changed eligibility result, weakened refusal,
raw payload or legacy-runtime mutation rejects the approach.

The other older mocked fixtures need separate setup qualification. The real
initialized-state Ctrl-C test already retains exit130; a unit test that never
reaches the password prompt does not establish a cancellation regression.
Keep that distinction and preserve the original cancellation oracle.

Final acceptance still needs all related tests and the required full gate on
qualified task-owned dependencies, with `NO_CACHE=1` after installation changes.
This amendment is not a waiver for the remaining17-test cohort.

Anchors: Basili, Caldiera and Rombach (1994), *Goal Question Metric*;
Munafò et al. (2017), preregistration; the existing CLI diagnostic assertions.
