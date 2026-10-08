# Drift Detection & Repair

> Something changed my agent's config. AgentBrew detects it and fixes it — without losing my manual edits.

```bash
agentbrew status --fix       # detect drift, auto-repair
agentbrew status             # view drift summary without fixing
agentbrew status --ci        # machine-readable output, exit 1 on drift
```

## What gets synced

`agentbrew sync` (and the background auto-repair) runs 6 sync engines in order:

| Engine | Source | Target | Format |
|--------|--------|--------|--------|
| MCP servers | `state.yaml` | Each agent's config file | JSON, TOML, YAML (per agent) |
| Instructions | `templates/AGENTS.md` | `~/.claude/CLAUDE.md`, Augment guidelines, etc. | Markdown with marker sections, auto-deduplicated against managed rules |
| Rules | `shared-rules.md` | Each agent's rules file | Marker-injected sections |
| Commands | `~/.config/agentbrew/commands/` | Each agent's commands dir | Markdown, auto-transformed per agent |
| Skills | `skillSourceDirs` in state | Each agent's skills dir | Symlinks (source repo owns the files) |
| Agent defs | `~/.config/agentbrew/agents/` | Each agent's agents dir | Markdown |

**Instructions sync** deserves special attention: the `templates/AGENTS.md` file is the single source of truth for shared agent instructions. On every sync, its content is deployed between `<!-- agentbrew:instructions:start -->` and `<!-- agentbrew:instructions:end -->` markers in each agent's instruction file. Sections whose headings also appear in the managed rules section are automatically deduplicated to avoid wasting context budget.

## Drift checks, every 30 minutes

| Check | Auto-repaired? |
|-------|---------------|
| MCP server missing from an agent's config | Yes |
| MCP runtime probe failing after sync | Yes for registered heal actions; otherwise P0 follow-up + status warning |
| MCP env vars not configured | No — run `agentbrew setup` |
| MCP tool permissions out of sync (Cursor CLI) | Yes |
| Rules managed section missing | Yes |
| Skill symlinks missing | Yes |
| Broken skill symlinks | Yes |
| Commands not deployed | Yes |
| Instructions out of date | Yes |
| Skill frontmatter invalid | No — run `agentbrew status --fix` |
| User-added MCP servers not in agentbrew state | No — informational, run `agentbrew import` |
| User-created skills (non-symlink directories) | No — informational |
| User-created commands (untracked files) | No — informational |

The background scheduler (LaunchAgent on macOS, systemd/cron on Linux) runs `agentbrew fix` every 30 minutes. If drift is found, it auto-syncs. Each tick also deep-probes MCP servers using catalog-owned read-only `smokeCall` metadata, attempts registered heal actions, writes `~/.cache/agentbrew/mcp-health.json`, and files a deduped P0 follow-up for failures that remain after healing. No competitor has this.

## What gets auto-repaired vs. what's informational

Auto-repair only touches agentbrew-managed content — your manual edits to rules (outside markers), user-added MCP servers, custom skill directories, and modified command files are never overwritten.

The last drift checks for user-added items are **informational only** — they surface content you added manually so you know it exists in one agent but not others. Run `agentbrew import` to bring user-added MCP servers into agentbrew state and deploy them everywhere.

```bash
agentbrew auto-sync status      # is the scheduler running?
agentbrew auto-sync install     # re-install if needed
agentbrew auto-sync uninstall   # disable background repair
```

## Advanced sync control

```bash
agentbrew sync --dry-run        # preview what would change without applying
agentbrew sync --only mcp       # sync only MCP servers (skip rules, skills, etc.)
agentbrew sync --sequential     # run sync categories one at a time (default is parallel)
agentbrew sync --pull           # fetch latest from all sources before syncing
```

## What if something goes wrong?

If a sync or auto-repair breaks your agent config:

```bash
agentbrew sync --rollback   # restore from the last pre-sync snapshot
```

Every sync creates a timestamped backup of all agent config files before making changes. Up to 10 snapshots are kept. The rollback restores the previous state — your agent configs go back to how they were before the last sync.

If auto-repair keeps failing (e.g., a source repo is offline):

```bash
agentbrew status            # see what's wrong without trying to fix it
agentbrew status --verbose  # detailed view of all sync errors
```

The errors are logged and shown in `agentbrew status`. Fix the root cause (re-add the source, fix permissions, etc.), then run `agentbrew sync` to retry.
