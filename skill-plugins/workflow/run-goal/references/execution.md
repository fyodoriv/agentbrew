# Execution practices

Loaded from Phase 4 and Phase 5 of `SKILL.md`. Each bullet comes from a run
that failed without it.

## During execution

- Probe a live tool (Slack, Jira, a browser form) only on a throwaway
  target you own, such as your own self-DM, never on the deliverable. One
  probe saved a "test" draft in a team thread; another attached `t.txt` to
  the real draft.
- While you iterate, run only the related test files. Run the full suite
  once, right before each commit. Run mutation checks as one parallel batch,
  not one by one.
- Before you trust a loop's pass count, read one run's result line. In zsh,
  `"$T[0]"` is a subscript and expands to empty (indexes start at 1), so pytest
  got no path: a 20-run loop of one test ran the whole suite.
- When a task's measurement names one object (a fixture, a generated file) and
  your run makes a new one, say so and measure the new one too. A rerun made a
  new output that the re-applied fix did not cover.
- Right before each commit, re-check the current branch and stage exact file
  paths, never a folder. Another session can switch a shared checkout
  mid-run, and a folder add sweeps in its untracked files.
- After a scripted edit, check that `git diff --stat` shows only the lines
  you meant to change. A script that wrote a different indent turned a
  one-panel change into a diff of thousands of lines.
- Never end a turn only to wait for a background agent. Do independent work,
  or read the code yourself, while it runs.
- Verify every subagent claim you put in a deliverable. Check high-severity
  claims in the code, and drop any claim that fails the check.
- When two subagents or docs contradict each other, settle it from the
  primary source (code at a SHA, the tracker record). List the losing docs
  as stale findings in the deliverable.
- A gate you write yourself is unproven: plant one violation per rule, see it
  fail. A "flaky" step: run it alone and check its CPU time against its limit.
- Log each non-obvious decision in one line: what you chose, and why.
- Parallel workers (subagents): give them one shared brief file with the
  delivery rules, unique log names (`$TMPDIR` is shared), and the exact base
  commit (`git rev-parse HEAD` at spawn) with "do not move the base". Keep
  within the user's parallel cap. On one machine, the brief also holds the
  heavy-run lock rule from the reference below. When a worker reports, check
  its claims yourself (re-run its metric, look at side effects such as
  LaunchAgents it touched), and stop any background job it left running in
  a removed worktree.
- Running parallel workers or workflows (worktrees, a merge queue, a watch
  loop): read [references/parallel-workers.md](references/parallel-workers.md)
  first. It covers the base commit, the heavy-run lock, messages to running
  agents, session-owned files, merges, stacked PRs, and watch pollers.
- When something pops up on the user's screen (a dialog, a window) and you
  trace which process started it, log the process and its parent chain.
  Never kill processes that you or your workers did not start. Killing them
  broke another session's test run and this run's own gate.
- A sandboxed Monitor may not see other processes: check a worker's pid
  with the sandbox off before you restart it. A risky mode that breaks the
  user's own limit is removed, not patched, with a test that it stays gone.
- After a session restart (`/goal continue …`, or workers reported as
  stopped): re-measure from `origin` first, then list every worktree with
  its commits ahead, uncommitted files, and push state. Resume each stopped
  worker with its saved context (`SendMessage` to its id) and give it that
  state; never assume a stopped worker's PR landed.
- After a usage-limit gap, check that each step produced its output, not
  only that it exited 0. A judge step that scored 0 items failed; rerun
  only that step.
- Before you build a task from a queue, search git history for its ID and
  files. A task that already shipped gets its stale block closed with fresh
  evidence, not a second implementation.
- A re-issued `/goal` (for example "continue previous goal") resets the
  contract file, and the edit hook blocks every write until it is saved again.
  Re-print the prior contract in chat (same scope, plus a progress line and
  any criteria added mid-goal), save it, then continue. When workers run,
  save it before any other step: until then the hook blocks their edits too. Do not start a new
  intake or question round for the same goal.
- When you read a third-party app's logs or config for secrets (tokens,
  keys), never print a value, even through a redaction filter. Count or
  test the values in a script that prints only pass/fail. A filter that
  hid strings of 20+ characters leaked 16-character lamp tokens.
- Facts from the web (company processes, API terms, research claims): give
  a research subagent a written file to fill, a rule to open every URL it
  cites, and an "omit what you cannot verify" rule. Run it in parallel with
  the code. Then add a gate step that fails when a claim has no source, so
  later edits cannot drop them.
- A deployed site behind a sign-in (Cloudflare Access, SSO) is still checkable:
  run the same server code locally over the published data, and measure there.
  A test that sets a data-dir variable from `mktemp` must check that `mktemp`
  worked; an empty variable falls back to the real data folder.
- When a goal keeps source data word for word, store what a tool wrote to
  disk (a saved tool-result file, a CLI's stdout) or the tool's reply copied
  without changes. Never summarize while copying. Give the store a way to
  replace a bad copy, and name the rows copied by hand in the report.

## Gate exit status

Read the gate's own exit status, not a line that a wrapper printed. In
`gate; echo "exit $?"` run in the background, the background task reports
the `echo`, which always succeeds. Use `gate; rc=$?` and print `$rc`
(`status` is read-only in zsh), or read the failure lines in the log, before you trust "passed".
A pipe hides the status too: after `gate | tail -20`, `$?` is the status of
`tail`. Never pipe the gate's own output (`gate | tail`, `gate | tee`) when
its status decides the commit. Run the gate into a log, read `$rc`, and
commit and push only when it is 0:
`log="${TMPDIR:-/tmp}/gate-<name>.log"; gate > "$log" 2>&1; rc=$?; tail -20 "$log"; echo "gate rc=$rc"; [ "$rc" -eq 0 ] && git commit … && git push`.
When the gate fails, the whole line also exits 1, so a background task reports the failure.
One run piped a failing suite into `tail`, and its commit and push still ran.
A count check such as `grep -c` swaps the gate's 0 and 1: it exits 1 when
the count is 0 (clean) and 0 when it finds a match; an error exits 2. So
never put it in the gate slot above, and never chain the next step on it
with `&&`: a clean check then skips the commit, and a check that finds a
leak lets the commit run. Stage first. Then count matches in the staged
diff, and commit only when the count is exactly 0:
`git add …; n=; d="${TMPDIR:-/tmp}/staged.diff"; git diff --cached > "$d" && n=$(grep -icE -- "${pattern:?}" "$d"); echo "count=$n"; [ "$n" = 0 ] && git commit …`.
Plain `git diff` skips staged and new files. Commit only what is staged: no `-a`, no paths after `git commit`.
A failed `git diff` leaves the count empty, so the commit does not run. An empty count means the check
did not finish (an unset pattern, a grep error, or a diff grep skipped as binary): find the cause first.

## Pre-existing failures

Before you call a failure "pre-existing", run the same test files with the
same flags on the unchanged base (a detached worktree) and compare the two
failure lists. Only a failure on both lists is pre-existing. A wait loop on
a background job must run outside the agent sandbox: `pgrep` and `ps` fail
inside it, so the loop exits at once and looks finished.

## Metrics and stale gates

A metric is code too. Before you trust a new counter's numbers or merge
the PR that adds it, give its diff and the metric's definition to a
fresh-context reviewer. One review of a `/work` run counter found 4 real
bugs: a stats call counted as a run, no split at an idle gap, a
lower-middle median, and every Artifact call counted as a publish.

A gate you started before your last edit tests old code. Stop it and
start it again after the edits; never report its result for the new code.
