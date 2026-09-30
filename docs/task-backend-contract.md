# Task Backend Contract

## Overview

The task backend contract allows agentbrew-managed repositories to declare where their work items live: either in `TASKS.md` (the default) or in GitHub Issues/Projects. This enables skills and agents to branch on the backend without each one reinventing detection logic.

## Configuration

### Agentfile.yaml

The preferred location is in the repo's `Agentfile.yaml`:

```yaml
# Default: tasks-md (no config needed)
# mcp:
#   - context7

# Explicit github-issues backend
task_backend: github-issues
repo: owner/repo
project: 123
```

### .agents/tasks.config.yaml (fallback)

If an Agentfile is not present, the resolver falls back to `.agents/tasks.config.yaml`:

```yaml
task_backend: github-issues
repo: owner/repo
project: 123
```

### Field Definitions

- `task_backend`: Either `"tasks-md"` or `"github-issues"`. Default is `"tasks-md"`.
- `repo`: GitHub owner/repo string (e.g., `"acme/my-service"`). Required when `task_backend` is `"github-issues"`.
- `project`: GitHub Project number (integer). Required when `task_backend` is `"github-issues"`.

## Resolution Logic

The resolver (`resolveTaskBackend(repoPath)` follows this priority:

1. **Agentfile.yaml** - if present, read `task_backend`, `repo`, and `project` fields.
2. **.agents/tasks.config.yaml** - fallback if Agentfile is missing.
3. **Default** - if neither file exists or the field is not set, return `"tasks-md"`.

## Validation

The resolver validates all inputs and throws actionable errors:

- `task_backend` must be exactly `"tasks-md"` or `"github-issues"`.
- `repo` must be a string in `"owner/repo"` format.
- `project` must be a positive integer.
- When `task_backend` is `"github-issues"`, both `repo` and `project` are required.

## API

### `resolveTaskBackend(repoPath: string): TaskBackendDescriptor`

Returns a descriptor object:

```typescript
interface TaskBackendDescriptor {
  backend: "tasks-md" | "github-issues";
  repo?: `${string}/${string}`;  // only for github-issues
  project?: number;               // only for github-issues
}
```

## Examples

### Default (tasks-md)

No configuration needed:

```bash
resolveTaskBackend("/path/to/repo")
# → { backend: "tasks-md" }
```

### GitHub Issues

With configuration:

```yaml
# Agentfile.yaml
task_backend: github-issues
repo: acme/my-service
project: 123
```

```bash
resolveTaskBackend("/path/to/repo")
# → { backend: "github-issues", repo: "acme/my-service", project: 123 }
```

## Architecture

This contract follows the Hexagonal Architecture pattern (Ports & Adapters):

- **Port**: The `TaskBackendDescriptor` interface.
- **Adapters**: `tasks-md` and `github-issues` are two adapters that implement the same port.

Skills and agents depend on the port (the contract), not the adapters. Adding a new backend in the future is a matter of adding a new adapter without changing consumer code.

## References

- Cockburn, *Hexagonal Architecture (Ports & Adapters)*, 2005
