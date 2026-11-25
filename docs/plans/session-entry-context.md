# List project context at session entry

Task: `hook-session-entry-context`. The existing context helper needs a
SessionStart adapter so an agent sees the project document list automatically.

Hypothesis: reusing the installed helper gives repository sessions the document
list and shared-memory reminder within the startup budget, with no output for
unrelated events, missing helpers, non-repositories, or timed-out helpers.

Measurement: run the focused hook fixture in the exclusive heavy-run queue.
It checks a real helper against a synthetic repo, a nested working directory,
non-repo silence, an oversized result, an unavailable helper, malformed input,
and a helper that hangs with a child process. Run the required hosted gate.

Success: every registered case passes; emitted JSON is at most 2,048 bytes;
the slow helper returns no context and leaves no running child; each successful
fixture completes within one second. The existing task retains its separate
14-day in-use measurement.

Pivot: any wrong-repository result, output overflow, surviving child, exceeded
successful-case startup budget, or required gate failure rejects the adapter.

Anchor: the existing `perf-brief` SessionStart adapter, the installed
`templates/scripts/load-project-context.sh` contract, and the task's acceptance.

Use an opt-in Claude Code hook. Call only the installed home-owned helper,
with a fixed system tool path and a bounded subprocess lifetime. Keep state
within one hook invocation; create no persistent session or project state.
The reminder names the configured memory tools; it does not claim that recall
ran or that a memory service is healthy.

## First fixture result and measurement correction

The missing adapter returned exit 127 in the exclusive queue. The first
implementation supplied context, but the startup assertion failed. Its clock
included a second observer interpreter startup. Preserve the one-second
threshold. Measure the complete hook subprocess from one already-running
observer and print that interval before deciding whether the adapter is fast
enough. A failure of that corrected interval still rejects the candidate.

The corrected test timed out after two seconds. Reject the Python candidate;
its internal deadline did not cover interpreter startup or earlier filesystem
work. The exact slow operation remains unknown. The next candidate uses native
Perl and its core JSON parser, with an alarm before parsing or filesystem work
and an owned helper process group. Keep every outcome and the one-second
successful-case threshold unchanged. A slow successful result or surviving
helper rejects this candidate too.

A synthetic comparison separated the adapter from its helper: a fast helper
took 0.228 seconds through the hook. The unchanged real helper took 0.796
seconds with the system tool path and 0.058 seconds with the actual Xcode Git
directory first. A subsequent warm hook took 0.288 seconds. These observations
do not prove the cold startup budget. Prefer an installed macOS toolchain Git
over its system launcher, keep the caller's project tools excluded, and rerun
the complete unchanged acceptance fixture.

Independent review found a startup boundary gap: inherited Perl environment
options can load a project module before the alarm begins. Register a synthetic
module that writes a marker. Prediction: an isolated interpreter launch leaves
zero marker files while still returning the context. One marker rejects the
candidate. Run that fixture red before changing the wrapper, then run the whole
focused qualification again.
