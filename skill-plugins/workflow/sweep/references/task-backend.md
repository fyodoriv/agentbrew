# Task backend for sweep

Read this when `detect-task-backend` reports `github-issues`.

Do this before you stage any finding. Use the `detect-task-backend` skill.
It reads `task_backend` from `Agentfile.yaml`, then `.agents/tasks.config.yaml`.

- `tasks-md` (the default): use `TASKS.md` as written below.
- `github-issues`: the open issues in the declared `repo` are the queue.
  Never create or edit `TASKS.md` or `TASKS-AUDIT.md`, even if a stale copy exists.
  - List: `gh issue list --repo <repo> --state open`.
  - Claim: `gh issue edit <N> --repo <repo> --add-assignee @me`.
  - File a finding: search first (`gh issue list --repo <repo> --search "<words>"`),
    then `gh issue create --repo <repo> --title "<outcome>" --body "<details + acceptance>"`.
  - Complete: put `Closes #N` in the PR body. The merge closes the issue.
- Invalid backend config: stop and report the error. Do not fall back to `TASKS.md`.

For an issues-backed repo, skip `TASKS-AUDIT.md` and the Step 6 drain branch.
At the end of the sweep, file each finding as one issue. Report the issue URLs.
