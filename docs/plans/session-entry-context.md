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
