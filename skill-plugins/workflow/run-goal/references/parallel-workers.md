# Parallel workers, merge queues, and watch loops

Read this before a goal runs several agents at once: workflow agents in
worktrees, a serialized merge queue, or a loop that watches for new work.
Each rule comes from a real failure in a goal run.

Contents: Starting workers · Steering running agents · Files the main session owns · Merges · Waiting · Watch loops · Fix rounds, waiting workers, and duplicate PRs

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
- A worker that ends its turn while its run waits for the lock reports
  "completed" with an interim line ("the visual run is still queued"). Read
  its worktree (commits ahead, uncommitted files) before you count it done,
  and resume it with `SendMessage` when the run finishes. Before you queue a
  gate behind the lock, set up the worktree's deps first: in one run a gate
  waited 40 minutes in the queue only to fail at once on a missing
  `node_modules`.
- A queued run can die while it waits for the lock (exit 144, an empty log),
  and its worker then never wakes. On each check-in, list the live lock
  waiters (`ps` for the lock helper and its command), not only the worker's
  last line. A worker with no live run and no PR is stalled: resume it with
  `SendMessage`, name the exact steps, and tell it never to end a turn
  without a live run or a PR URL.
- A new issue in a watch loop that touches files a running worker edits
  waits until that worker's PR merges. Start workers only on issues whose
  files do not overlap.
- Keep the shared brief outside every worktree a worker may remove, and
  check it still exists before each message to a worker. In one run the
  brief file was deleted mid-run, and workers kept going from memory.
- A guard that caps subagent depth at 1 stops a worker from starting its own
  reviewer. Check the cap first; when it blocks, review the diff yourself
  and say so in the merge evidence.
- A worker whose reviewer hits a usage limit and merges after a self-review
  has not been reviewed. Run a fresh-context review of the merged commit
  yourself, and fix what it finds in a follow-up PR. In one run, both
  self-reviewed merges hid real bugs: 3 in one and 2 in the other.
- Unique numbers that a check enforces (user story ids, migration numbers)
  race between sessions: another session's PR can take your number while
  your gate runs. Before the last gate, fetch main and check the number is
  still free. Open the PR as soon as the number is final, so other sessions
  see it. In one run, one branch was renumbered three times (US-79 to US-84),
  and each rename cost a gate.
- A gate that runs far past its usual time is hung, not slow. Run each test
  file alone with `timeout 180` to find the file that never ends. In one run,
  a test loop with no cap hung a gate for 2 hours.

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
- Never merge a stack bottom-up with `gh pr merge --delete-branch`. Deleting
  A's branch closes B instead of retargeting it, and a PR whose base is
  still a branch merges into that branch, not main. In one run this closed
  2 of 4 stacked PRs and merged a third into a dead branch. Merge main into
  the top branch, run the gate there, and land the top branch as one PR that
  closes every issue in the stack; or retarget each PR to main
  (`gh pr edit <n> --base main`) before you merge the one below it.
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

## Fix rounds, waiting workers, and duplicate PRs

Green suites still miss defects. In one goal run, reviewers found real
defects in 6 of 8 green PRs: a crop that picked the wrong figure, a cache
entry saved under the wrong key, a CLI crash in sandboxed shells, and a
fixture that missed one path, so a test failed only on the owner's machine.

When you resume a worker with `SendMessage` for a fix round, repeat the rule
in that message: "fresh-context review of the diff before merge". A resumed
worker can miss a rule that only its first brief named. In one run, workers
resumed for fix rounds merged without that review. Later reviews found 9
more defects in one fix PR, including a high-severity data loss, and 6 more
in another. Another unreviewed PR had a high-severity trust bypass. Before
you count a fix as done, read the review's output yourself, not only the
worker's report. If no review ran, run one now. If the PR already merged,
review the merged diff and send each finding back as a new fix round.

A worker that ends its turn while its gate waits in the `heavy-run` queue
shows as "completed", but its last line says it is waiting. That is not a
report: it has no PR, SHA, or gate rc yet. Do not count it done. It resumes
only if its background run ends with a notice. A killed shell sends none,
and the worker then waits forever: in one run three workers sat idle for
about 3 hours after their gate shells were killed, while the lead checked
only the `heavy-run` lock and reported "progressing". So:

- In the brief: a worker waits for its gate in the foreground (a 10-minute
  tool timeout, then wait again on the log's `rc=` line), never by ending
  its turn on a background job. A live worker then writes to its
  transcript at least every 10 minutes.
- For the whole run, the lead keeps a Monitor on
  `scripts/stalled-agents.py --session <id> --minutes 20 --watch 300`. It
  prints `STALLED <agent> <N>m` for an unfinished worker whose transcript
  has been silent that long, and next to it `KILLED <task>` for each
  background shell whose output ends `[killed]`. Re-arm it at each expiry.
- On a STALLED line, resume that worker at once with a `SendMessage`: say
  its gate shell is gone and it must rerun the gate in the foreground.
- A check-in judges worker liveness from this script, not from the gate
  lock: a lock held by another repo says nothing about your workers.

Right before each merge, list the repo's open PRs again. Another session on
the same account can open a second PR for the same issue mid-run. In one run,
two PRs for one issue (one CONFLICTING, one MERGEABLE) came from two
sessions. Compare them, keep one, and ask the owner before you close the
other session's PR.
