# Run guards


These are the checks no outer runner does for you. Do them
yourself.

1. **Preflight** before the first task: no rebase, merge, or detached `HEAD`
   in progress; count uncommitted files and commit or set them aside with a
   WIP commit, never a bare stash; on macOS, run long unattended runs under
   `caffeinate -i` so the Mac does not sleep.
2. **Sync between tasks**: return to the default branch and
   `git pull --rebase`. If a rebase conflict touches only `TASKS.md`, resolve
   it by keeping both sides' task blocks, then continue.
3. **Stuck task cap**: a task you attempted 3 times without shipping gets
   `**Blocked by**: attempted 3 times — <last error>` and you move on.
4. **All blocked**: when every remaining task has `**Blocked by**:`, wait one
   10-minute interval (`/loop` sleep, or end the session), re-read the queue,
   and stop with the reason `all_tasks_blocked` if nothing changed.
5. **Stall stop**: two passes in a row that ship nothing end the run. Report
   `stalled` with the task IDs you tried.
6. **Empty queue**: run one sweep. If it adds nothing, stop with
   `queue_empty`.
7. **Network loss**: pause and retry; do not burn tasks on network errors.
