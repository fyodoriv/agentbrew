# Prune Safely

> Pruning is **on by default** — every sync automatically removes stale managed entries. Use `--no-prune` to opt out.

```bash
agentbrew sync              # syncs AND prunes stale entries (default)
agentbrew sync --no-prune   # sync without removing anything
```

## How it works

Prune only removes entries that agentbrew previously created. User-created content is never touched.

| Content | What gets pruned | What's preserved |
|---------|-----------------|-----------------|
| **MCP servers** | Servers in the `managedMcpServers` manifest that are no longer in state | Servers you added manually to agent configs |
| **Skills** | Symlinks pointing to known agentbrew source directories | User-created directories, user-created symlinks |
| **Commands** | Files tracked in the manifest (matching content hash) that are no longer in source | Files you created or edited after deployment |

## Safety mechanisms

- **Manifest tracking**: agentbrew records which MCP servers it deployed in `manifest.json → managedMcpServers[]`. Only these names are candidates for pruning.
- **Content hashes**: command files are tracked by content hash. If you edited a deployed file, the hash won't match and the file is treated as user-owned.
- **Source-aware symlinks**: `cleanSymlinks()` only removes symlinks whose targets point to known agentbrew source directories. Everything else is left alone.
- **Pre-sync snapshots**: every sync (including prune) creates a backup first. `agentbrew sync --rollback` restores if needed.

With `--no-prune`, sync only adds and updates — it never removes.
