---
name: detect-task-backend
description: Detect which task backend a repo uses (TASKS.md or GitHub Issues) using the agentbrew task backend contract. Use when a skill or agent must read, add, or close tasks and does not yet know where the repo keeps them.
---

# Detect Task Backend

Detects which task backend a repository uses by calling `resolveTaskBackend(repoPath)`. This is a reference consumer demonstrating the task backend contract pattern.

## When to use

Use this skill when you need to know whether a repo uses TASKS.md or GitHub Issues for task tracking. This is useful for skills that branch their behavior based on the task backend (e.g., filing tasks, listing tasks, picking next task).

## Implementation pattern

```typescript
import { resolveTaskBackend } from "agentbrew/src/core/task-backend";

const descriptor = resolveTaskBackend(repoPath);

if (descriptor.backend === "github-issues") {
  // Use GitHub Issues API
  const { repo, project } = descriptor;
  // ... file/list tasks via GitHub API
} else {
  // Default to TASKS.md
  // ... read/write TASKS.md file
}
```

## Configuration

Repos declare their backend in `Agentfile.yaml` (preferred). If no Agentfile is present, `resolveTaskBackend(repoPath)` falls back to `.agents/tasks.config.yaml`. If neither file declares a backend, the descriptor defaults to `tasks-md`.

```yaml
# Default (tasks-md) — no config needed
# mcp:
#   - context7

# GitHub Issues backend
task_backend: github-issues
repo: owner/repo
project: 123
```

Validation is part of the contract:

- `task_backend` must be exactly `tasks-md` or `github-issues`.
- `repo` must be an `owner/repo` string when `task_backend: github-issues`.
- `project` must be a positive integer when `task_backend: github-issues`.
- Malformed explicit GitHub Issues config is an actionable error; do not silently fall back to `TASKS.md`.
- A stale `TASKS.md` file does not override a `github-issues` descriptor.

## See also

- [Task Backend Contract](https://github.com/fyodoriv/agentbrew/blob/main/docs/task-backend-contract.md)
- [resolveTaskBackend API](https://github.com/fyodoriv/agentbrew/blob/main/src/core/task-backend.ts)
