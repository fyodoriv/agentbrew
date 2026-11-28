# Measure missing macOS gate traces with fewer API calls

**Hypothesis:** Looking up artifacts only for runs with a long macOS job
reduces API calls while preserving the historical missing-trace count.
Matching the runner and attempt also prevents another artifact from hiding
a missing macOS trace.

**Measurement:** Compare the old and revised query on a frozen set of 50
run fixtures. Count API calls and missing traces. Include a long macOS
attempt with a Linux artifact and a different-attempt macOS artifact.

**Success:** Both queries count 1 in the historical-shaped fixture. The
revised query uses at most 60 API calls. Both mismatched artifact controls
count 1 missing trace. The cancelled-with-log eval tells the agent to read
that log before deciding whether to retry.

**Pivot:** If 1 actual missing trace is masked or the matching case
disagrees, keep the metric in review until the job and artifact IDs agree.

**Anchor:** [Historical macOS overrun](https://github.com/fyodoriv/agentbrew/actions/runs/45644193000)
and [runner-specific timeout receipt](https://github.com/fyodoriv/agentbrew/actions/runs/46066828725).
