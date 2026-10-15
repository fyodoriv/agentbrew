# Task backend for grind

Read this when `detect-task-backend` reports `github-issues`.

Do this before you read or write any task. Use the `detect-task-backend` skill.
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

For an issues-backed repo, read "TASKS.md" in the rest of this skill as "the
issue queue", and "remove the task block" as "`Closes #N` in the PR".
