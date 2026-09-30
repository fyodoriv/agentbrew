# Export & Import

> I want to move my entire agent setup to a new machine — or share it with a colleague who doesn't use git.

```bash
agentbrew export -o my-setup.yaml           # export full config as portable bundle
agentbrew import --bundle my-setup.yaml      # import on another machine (merges by default)
agentbrew import --bundle my-setup.yaml --replace  # full replace instead of merge
```

## What's included in a bundle

| Content | Exported? | Notes |
|---------|-----------|-------|
| **MCP servers** | Yes | Name, command, args, env var keys |
| **Sources** | Yes | URLs and types (GitHub, local, URL) |
| **Rules** | Yes | Shared rules content |
| **Secrets** | No | `${VAR}` placeholders stay as-is — values come from the target machine's environment |

The bundle is a human-readable YAML file. You can inspect it, edit it, or commit it to a repo.

## Merge vs. replace

By default, import **merges** — existing items on the target machine are preserved, and new items from the bundle are added. Duplicates (same server name, same source URL) are skipped.

With `--replace`, the bundle fully replaces the target state. Use this when you want an exact copy of someone's setup.

```bash
agentbrew import --bundle my-setup.yaml              # merge: keep existing, add new
agentbrew import --bundle my-setup.yaml --replace     # replace: overwrite everything
agentbrew import --bundle my-setup.yaml --dry-run     # preview what would change
```

## Import from agent configs

Separate from bundles, you can also import MCP servers that were added manually to a single agent:

```bash
agentbrew import                    # scan all agents, import user-added servers
agentbrew import --from cursor      # import only from Cursor
```

This discovers servers in agent configs that agentbrew doesn't know about and adds them to state — so the next sync deploys them everywhere.

## When to use

- **New machine setup**: export on the old machine, import on the new one
- **Team onboarding without git**: share a `.yaml` file instead of setting up a team config repo
- **Backup**: `agentbrew export -o backup.yaml` before risky changes
- **Config review**: export to inspect exactly what's registered
