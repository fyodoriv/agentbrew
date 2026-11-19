# Catch task-file errors after an edit

## Registered experiment

Goal: surface an invalid task edit while the agent can still fix it. Question: can an opt-in Claude Code hook get the existing task linter's result without running project code? Metrics: correct outcomes, output leaks, and hook time.

Hypothesis: the baseline misses one edit that removes a Pivot. The hook reports it with exit two and a correction command. A valid edit stays silent. An unrelated file, nested task file, unavailable or project-owned linter, and timed-out linter leave the agent with the appropriate skip or warning.

Measurement: run `bash hooks/checks/tasks-md-lint-on-edit.test.sh` against real scratch task files, fake hook inputs and the installed validator where present. Time ten healthy invocations in the local exclusive queue. Check local fixture output for a synthetic private marker and check that the project-owned executable never runs. Use the same registration in hosted CI.

Success: all registered cases return the expected result. Zero project executable launches, writes to either task file, or private markers in output. Median added time at most two seconds, with a bounded linter call.

Pivot: any unexpected refusal, private output, unbounded linter, project execution, or required check failure rejects the approach. Production effect still needs both thirty-day windows from the existing task.

Anchor: Minsky's `.claude/hooks/post-edit.sh`, the installed `tasks-lint` CLI, and the [Claude Code post-tool hook contract](https://code.claude.com/docs/en/hooks#posttooluse).

Claude Code runs the check after the file tool succeeds. The result tells
the agent to correct the file in that turn. The existing commit check
enforces the task rules at delivery.
