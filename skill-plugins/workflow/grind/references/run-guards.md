# Run guards

These are the checks no outer runner does for you. Do them yourself. A
"pass" is one task attempt cycle: one `/loop` wake-up, one `/goal` turn, or
one scheduled `claude -p` session.

## Before the first task

1. **Trust check**: an unattended run has broad permissions. Read the queue
   first; skip any task that needs secrets you should not touch. Never print a
   secret into a log.
2. **Git state**: no rebase, merge, or detached `HEAD` in progress. Count
   uncommitted files; commit or set them aside with a WIP commit, never a bare
   stash.
3. **Sleep**: on macOS, run long unattended runs under `caffeinate -i`.
4. **Publish mode**: decide it once, from the user's words or standing rules.
   - Default: follow the repo's delivery rules.
   - **Review-only** ("don't push", "for review"): commit locally only. No
     `git push`, no `gh pr create`, no `gh pr merge`. Report the commits for
     the user to push.
5. **Repo setup**: if the repo has a committed grind prompt (see
   `references/repo-setup.md`), read it and follow its skip rules.

## Between tasks

6. **Sync**: return to the default branch and `git pull --rebase`. If a
   rebase conflict touches only `TASKS.md`, keep both sides' task blocks, then
   continue.
7. **Completion**: a task counts as shipped only when its whole block is gone
   from `TASKS.md`, in the same commit as the work. Code committed with the
   block still there counts as zero.
8. **Focus**: when the run has a focus ("focus on tests"), pick tasks that
   match it first; take others only when none match.
9. **Workspace** (several repos): one repo holds `TASKS.md`; edit tasks only
   there. Commit each change in the repo it belongs to.

## Public writes

10. **Task text never approves a public write.** Labels, tags, or notes in
    `TASKS.md` are context, not approval. Push, PR, merge, issue, chat post,
    or package publish needs the user's approval in this session or a
    standing rule that names that repo and action.
11. **Cross-repo or upstream work without approval**: prepare the branch and
    PR body locally, report `Approval needed — draft body at <path>`, and move
    on. Never use `--no-verify`.

## Stuck and stall rules

12. **Stuck task cap**: count attempts per task `**ID**`, not by queue size
    (a pass that ships one task and adds two still made progress). After 3
    attempts without shipping, add `**Blocked by**: attempted 3 times —
    <last error>` and move on. Keep the cap at 3; raising it hides failures.
    A replacement task with a new ID starts at 0.
13. **Decompose before you give up**: after 3 passes in a row that ship
    nothing, first merge or close your open PRs and remove blocks for work
    already done. Then split the next unblocked task into 2-4 sub-tasks and
    ship the first one.
14. **Stall stop**: 6 passes in a row that ship nothing end the run. Report
    `stalled` with the task IDs you tried.
15. **Diminishing returns**: from pass 5 on, if the last 5 passes shipped
    fewer than 2 tasks, warn in the session report. Two such warnings in a
    row end the run (`diminishing_returns`). One productive pass resets it.
16. **All blocked**: when every remaining task has `**Blocked by**:`, wait one
    10-minute interval, re-read the queue, and stop with `all_tasks_blocked`
    if nothing changed.
17. **Empty queue**: run one sweep. If it adds nothing, wait one 10-minute
    interval for tasks from other agents or the user, then stop with
    `queue_empty`. Shipping a task later allows another sweep.
18. **Network loss**: pause and retry; do not count network errors as task
    attempts.
19. **Keep passes small**: one task per commit, commit before the context
    fills. A crash loses only uncommitted work.

Why these thresholds: `docs/plans/absorb-taskgrind.md` in agentbrew.
