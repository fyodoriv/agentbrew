# Update Skills & Sources

> A skill I installed got updated in its source repo. How do I get the new version?

```bash
agentbrew sync --pull                    # pull latest, refresh installed skills, re-sync to all agents
agentbrew sync --pull debug              # update a single skill by name
agentbrew sync --pull --dry-run          # show what would be updated without changing files
```

## Check what's outdated

```bash
agentbrew sync --pull --dry-run          # compare locked versions against latest remote commits without applying
```

This compares your locked versions (in `agentbrew.lock`) against the latest commits in each source repo. Shows which sources have newer versions available.

## Update everything

```bash
agentbrew sync --pull                    # full update: pull, refresh, lock, re-sync
agentbrew sync --pull               # equivalent — fetch latest from all sources, then re-sync
```

This pulls the latest from every tracked source (git pull for repos, rescan for local folders), **re-copies updated skill files** to the installed-skills staging directory, updates the lock file with new SHAs, and re-syncs to all agents.

Your personal config is preserved — manual edits to agent configs, user-added MCP servers, and custom rules are never overwritten.

## Update a single skill

```bash
agentbrew sync --pull debug              # update just the "debug" skill from its source
```

This fetches the latest from the source that provides the named skill, refreshes only that skill's files, and re-syncs. Other installed skills are untouched.

## Preview before applying

```bash
agentbrew sync --pull --dry-run          # show what would be refreshed without changing anything
```

Dry-run mode skips git pulls, file copies, and sync engines — it only reports which skills would be updated based on current cache state.

## How version pinning works

When you install a skill, agentbrew records the exact git commit SHA in `~/.config/agentbrew/agentbrew.lock`. This means:

- `agentbrew sync` (without `--pull`) deploys what's already installed — it does NOT fetch updates
- `agentbrew sync --pull` fetches latest and updates the lock file
- The lock file is human-readable YAML — you can inspect it to see what's pinned

## When a source goes offline

If a source repo is deleted or archived:
- Skills already installed from that source continue to work (they're local copies)
- `agentbrew sync --pull` will warn that the source is unreachable
- Remove the source with `agentbrew remove <source-url>` to stop tracking it
- Skills from the removed source remain installed until you explicitly clean them
