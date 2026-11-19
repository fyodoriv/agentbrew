# Guard Git calls from agent scripts

## Registered experiment

Goal: protect shared checkout files and stashes when Git runs inside a
Claude Code shell script. Question: does checking the Git argument list
catch the dangerous operations and preserve ordinary Git behavior?
Metrics: the expected result, actual Git calls, and added latency.

Hypothesis: the command-text hook misses a script that calls Git with a
destructive operation. A session-scoped Git wrapper can report the
operation before it reaches Git. A read-only call keeps the same arguments,
output, and exit code.

Measurement: run `bash hooks/checks/git-script-guard.test.sh`. Use a recorder
instead of the real Git binary for unsafe cases. Compare the wrapper with
real Git in a disposable repo for the read-only case. Time ten paired
`git status --porcelain` calls through `heavy-run --exclusive`.

Check hard reset, forced clean, whole-tree checkout and restore, shared
branch creation or switch, stash drop and clear, skipped commit hooks,
and a forced push with an explicit protected destination. Check status, diff, log,
worktree list, stash list/show/apply, a checkout of a specific path,
a normal commit, and a normal push. Include a script and a nested shell.

Success: all ten blocked calls stop before Git and all ten allowed calls
reach Git with their original arguments. The real read-only case matches
Git directly. Added median latency is at most 20 ms.

Pivot: any false block, a leak of Git arguments to the hook's diagnostics,
an active-path change outside the opted-in session, or added median latency
over 20 ms rejects the approach. A PATH wrapper is a guard against
accidental damage in its session. Existing Git hooks and remote protections
remain delivery controls.

Anchor: Reason 1990 (Human Error, defenses in depth), the archived Minsky
`.claude/shims/git` control, the [Git CLI contract](https://git-scm.com/docs/git#_options),
and [Claude Code's session environment](https://code.claude.com/docs/en/hooks#persist-environment-variables).

## Baseline and controls

The baseline recorder received the whole-checkout operation from a
nested shell. The deployed-layout fixture matched the registered
blocked and allowed outcomes, and real Git status output matched byte
for byte. The fixture also checked a linked checkout, a failed checkout
probe, a dry run, and option-like file names.

## Dotfiles command rewrite

Hypothesis: a session marker can keep Git guarded when the Dotfiles
Claude command hook replaces PATH in the tool input. The Dotfiles
wrapper can request an argument decision and remain the only process
that executes the allowed operation.

Measurement: extend the deployed-layout fixture with decision-only
commands and run the companion Dotfiles default-mode Bash control.
Check the exact supported decision and the recorder for execution.
Include the combined wrappers in the queued timing check.

Success: a refused call returns exit 2 and reaches Git zero times. An
allowed decision returns exit 0 and reaches Git zero times until the
Dotfiles wrapper forwards the original command once. Keep added median
latency within 20 ms.

Pivot: any duplicate delegate, guard outside the opted-in session,
failure of the existing fixed PATH guard, or timing over the threshold.

Anchor: Dotfiles `agent-hooks/prepend-endpoint-path.sh`, Dotfiles
`bin/git`, and the Claude Code session environment contract above.
