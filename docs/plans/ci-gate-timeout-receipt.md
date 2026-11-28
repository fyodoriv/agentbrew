# Keep the verification trace when a hosted gate times out

**Hypothesis:** A bounded gate and a small per-step trace leave a usable
record after a hosted timeout. The Nov 25 macOS overrun left no job log.
A controlled timeout should preserve the interrupted step and its start
and end timestamps.

**Measurement:** Run `npx vitest run src/scripts/verify-cache.test.ts` in
hosted CI for successful, cached, and failed steps. Dispatch the CI
workflow's macOS timeout probe on the candidate, then inspect its run
and download the selected attempt's `gate-log` artifact.

**Success:** A 1-minute probe times out before the 45-minute job limit
and uploads a trace with 1 interrupted step. Normal verification keeps
the 45-minute job limit, caps the gate at 40 minutes, and adds less than
60 seconds to the median gate time.

**Pivot:** If 1 probe times out without the trace, keep the task open and
check runner cancellation and upload order. If median overhead exceeds
60 seconds, record only the top-level stages.

**Anchor:** The [Nov 25 macOS job](https://github.com/fyodoriv/agentbrew/actions/runs/45644193000/job/139310606189)
and [GitHub Actions step timeout syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepstimeout-minutes).

## Boundaries

Record UTC timestamps, fixed step names, and outcomes. Leave command
arguments, subprocess output, and environment values out of the artifact.
When the optional trace ends at a start row, the upload step records the
time when it observes the interruption. The trace applies to the selected
runner and attempt. A stopped runner or a job that exhausts its total
budget may be unable to upload an artifact.
