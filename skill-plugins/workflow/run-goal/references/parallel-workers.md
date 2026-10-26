# Parallel workers, merge queues, and watch loops

Read this before a goal runs several agents at once: workflow agents in
worktrees, a serialized merge queue, or a loop that watches for new work.
Each rule comes from a real failure in a goal run.

## Starting workers

- Pin the base. The shared brief names the exact base commit
  (`git rev-parse HEAD` at spawn) and says "do not move the base". In one
  run, three worktree workers started from different bases (one from `main`,
  one from an unmerged PR branch it fast-forwarded itself), and integration
  needed cherry-picks and one conflict. Land an open PR the parts depend on
  first, then spawn from the new head.
- Before you start workers on one machine, write a heavy-run rule into the
  brief: one shared lock (`heavy-run <command>` where it is installed, else
  `mkdir` a lock dir and remove it when done) and
  `nice -n 15` for every heavy run (full suite, test cache, timing), one run
  at a time. Six workers without it each ran parallel suites, and a 10-core
  Mac reached load 245 with swap 93% full in 15 minutes; with it, load stayed
  near 10 to 25. A timing taken without the lock is invalid: take it again.
- Use one lock kind for every session. In one run, workers used an old
  `lockf` file while the main session used `heavy-run`; both "held" a lock
  and load reached 64. Another session's e2e gate outside any lock pushed
  it to 161 until the lock became a shared Agentfile rule.
- The brief says: one simple command per Bash call, `npm ci` alone before
  the first gate, and queued gates in the background. Compound commands and
  foreground lock waits were blocked by hooks and cost a round trip each.
- Keep the shared brief outside every worktree a worker may remove, and
  check it still exists before each message to a worker. In one run the
  brief file was deleted mid-run, and workers kept going from memory.
- A guard that caps subagent depth at 1 stops a worker from starting its own
  reviewer. Check the cap first; when it blocks, review the diff yourself
  and say so in the merge evidence.

## Steering running agents

- Never send a message to an agent that still runs inside a Workflow. The
  message starts a second copy of it in the same worktree, and the two copies
  undo each other (one stashed the other's work). To change a running
  workflow, edit the shared brief that later agents read first, or stop the
  workflow.
- An agent that starts a long command in the background and then returns
  ends that command. A merge step must wait for its gate to finish and the PR
  to merge before it returns; say so in the merge prompt.

## Files the main session owns

- Worker briefs name the files the main session owns. Workers never call
  `update_plan` and never write the goal contract or retro file: they share
  the session's paths, and one worker that loaded this skill overwrote the
  main contract.

## Merges

- Merge steps rebase only before the first push. After a push, fix a
  conflict by merging `origin/main` into the branch. A merge prompt that says
  "rebase again" leads to a force-push, which the user's rules forbid.
- Stacked PRs: a squash merge of PR A makes PR B (built on A) conflict. When
  main's tree equals A's head and B contains A's head, resolve every conflict
  with B's side, then check that the merged tree equals B's tested tree
  (`git diff <B-tested-sha> HEAD` is empty). Then no new test run is needed.
- To clear a conflict on an agent's PR, push only that agent's own merge
  commit, as a fast-forward. A different merge commit makes the agent's branch
  diverge, and it then needs another merge and another full gate.
- A scripted conflict fix may "keep both sides" only in a file that is
  append-only. A task queue also loses blocks when work finishes, so keeping
  both sides brings finished tasks back. For such a file, take main's version
  and apply only your branch's own change.
- Strip all four git markers when you resolve by script, including the diff3
  base line (`|||||||`) and the base text after it. A gate check that fails on
  any marker line in a tracked file catches the rest.
- A file that every PR appends to (a learnings log) makes every open PR
  conflict after each merge. A `merge=union` attribute helps local merges
  only: GitHub ignores merge drivers when it decides mergeability. Use one
  file per PR instead.
- Test the combination, not only each worker. Each worker runs its own tests
  green, but a switch one worker flips can break the other's tests. In one
  run, a worker turned a feature on and broke 3 of the other worker's tests,
  and a crop one worker added contradicted the other's test. Only the final
  suite found them, an hour before the deadline. After you merge workers'
  branches, run the per-commit gate on the merged branch at a steady pace,
  under the shared heavy-run lock (niced, one file at a time if a worker
  uses the GPU). Route each red test
  to the worker whose commit made it red.
- In zsh, `$var:` followed by a letter is a modifier (`$h:r` drops an
  extension). Write `"${h}:refs/heads/x"` in refspecs.
- Stop at the first failed step of a commit chain. A cleanup that runs
  `git worktree remove --force` after a failed commit deletes the uncommitted
  work; keep the edits in a script so they can be applied again.

- Several PRs that each append to one file (an `evals.json`) conflict after
  every merge. Merge main into a PR right before its gate, merge it as soon
  as the gate passes (`gh pr merge --match-head-commit <gated sha>`), and
  merge the next PR only after re-checking it is still MERGEABLE. Take a new
  eval id from `origin/main`'s max at that moment: outside sessions take ids
  too, and four PRs in one run collided on ids 128 to 131.
- A gate whose base moved during the run cannot count. Stop it at once to
  free the lock, merge main, and queue it again.
- Trust the gate's exit status, not its last line. One run printed
  "verify: passed" and exited 1; a clean rerun was needed before the push.

## Waiting

- A stop hook that blocks while a PR shows conflicts turns every turn into a
  wait. Wait on local state instead: a Monitor that loops until the agent's
  worktree has no unmerged files and a new HEAD.

## Watch loops

- Before you build a skill or command for a new request, search open PRs and
  branches in the skill repos. Another session may build the same thing on
  the same day: reuse it and drop your copy.
- A Monitor runs in the sandbox, where `gh` can fail with a TLS error. Run
  the poller as a background shell outside the sandbox that writes to a log,
  and let the Monitor follow the log. The poller prints a line for every
  failure, so silence never hides a dead poller.
- Report two latencies for each picked-up item: issue to pickup (bounded by
  the poll interval) and issue to merged PR (which includes implementation,
  review, and the full gate).
