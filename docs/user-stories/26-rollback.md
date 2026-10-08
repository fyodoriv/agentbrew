# Rollback

> Something went wrong after `agentbrew sync` — an agent stopped working, my rules got truncated, my MCP servers are missing. I undo the last sync in one command.

```bash
agentbrew sync --rollback        # restore every agent's config from the pre-sync snapshot
```

## The guarantee

Every `agentbrew sync` creates a timestamped snapshot of every agent config file it is about to write — *before* it writes anything. If something goes wrong, `sync --rollback` restores the previous state. No user action is unrecoverable.

This exists because the tool touches many config files across many agents in one command, and mistakes happen — a bad Agentfile, a misconfigured MCP server, an agent that changed its format, or a bug in agentbrew itself. Without a one-command undo, users couldn't trust the tool.

Rollback is an [essential capability](../VISION.md#the-essential-core). It is never removed, never gated behind a flag, and never requires the user to have planned for it.

## What gets restored

The snapshot captures every file agentbrew is about to touch in a given sync:

| Path | Restored? | Notes |
|------|-----------|-------|
| `~/.cursor/mcp.json`, `~/.claude/*.json`, `~/.codex/config.toml`, etc. | Yes | Every MCP config file for every detected agent |
| `~/.claude/CLAUDE.md`, agent instruction files | Yes | Rules + instructions files |
| `~/.config/agentbrew/commands/`, `~/.claude/commands/`, `~/.cursor/commands/` | Yes | Command directories |
| `~/.config/agentbrew/agents/`, per-agent agent-definition dirs | Yes | Agent persona files |
| Symlinks in `~/.*/skills/` directories | Yes | Skill symlinks — their targets (the source repos) are untouched |

The snapshot lives at `~/.config/agentbrew/backups/<timestamp>/` with the original directory structure mirrored inside. You can inspect a snapshot manually if you want to see what the rollback will do before running it.

## What does not get rolled back

- **`state.yaml`** — agentbrew's own state file is not snapshotted by `sync --rollback`. The rollback restores the *deployed* state on disk, not the *declared* state. If `state.yaml` had a bad entry that caused the bad sync, rolling back the deployed files will get silently re-broken on the next `agentbrew sync`. Fix the state (or the Agentfile that populated it) before running sync again.
- **Source repos cached under `~/.cache/agentbrew/`** — these are downloaded content, not user-modifiable, and can always be re-fetched.
- **Files agentbrew didn't touch this sync** — the snapshot is scoped to the files the sync was about to change. Untouched files stay as they are.

For `state.yaml` rollback, there's a separate path — the hidden `agentbrew sync --rollback` command restores the last state backup. See `agentbrew sync --rollback --help`. The two rollbacks solve different problems, which is why they're distinct.

## Snapshot retention

AgentBrew keeps the last **10 sync snapshots** by default. Older ones are pruned automatically. 10 is enough to recover from "I ran sync three times today and the one before the last one was fine" without consuming unbounded disk space.

Each snapshot is small — a few kilobytes per agent config file. Total footprint on a well-populated machine is under 1 MB. You don't need to manage it.

## When to use rollback

1. **An agent stopped working right after sync.** The fastest diagnostic is `agentbrew sync --rollback` — if the agent works again, the sync introduced the problem and you now know where to look. Re-sync after fixing the root cause.

2. **You ran `agentbrew sync --pull` and a source repo landed broken upstream.** Rollback restores the pre-pull state while you wait for upstream to fix itself or pin the source to a known-good commit.

3. **An Agentfile change produced unexpected results.** Roll back, edit the Agentfile, sync again. No need to reverse-engineer what sync did.

4. **Auto-repair did something you didn't want.** The background scheduler runs `status --fix` every 30 minutes. If you come back to your machine and an auto-repair broke something, rollback the most recent snapshot (which was taken just before the auto-repair ran) and investigate with `agentbrew status --verbose`.

## What rollback looks like

```
$ agentbrew sync --rollback

Restoring agent configs from: ~/.config/agentbrew/backups/2026-04-19T18-30-22Z/

  ✓ cursor         (~/.cursor/mcp.json)
  ✓ claude-code    (~/.claude/CLAUDE.md)
  ✓ claude-code    (~/.claude/commands/)
  ✓ codex          (~/.codex/config.toml)

Restored <count> file(s) across <count> agent(s).

  Agent configs are back to the state before the last sync.
  state.yaml is unchanged — run `agentbrew sync` again after fixing the root cause.
```

Exit code 0 on success, 1 if the snapshot is missing or unreadable.

## Recovery workflow

```bash
# 1. Notice something broke after a sync
#    (e.g. Cursor's MCP panel shows "no servers" after you ran agentbrew install)

# 2. Roll back the last sync immediately — this takes seconds
agentbrew sync --rollback

# 3. Verify your agents are working again
agentbrew status

# 4. Figure out what caused the problem
agentbrew status --verbose              # is any MCP config suspect?
agentbrew lint                          # is the Agentfile or state.yaml malformed?
cat ~/.config/agentbrew/backups/<latest>/.cursor/mcp.json  # what did sync have?
tail -n 20 ~/.local/share/agentbrew/logs/auto-sync.log  # recent sync history (auto-sync runs)

# 5. Fix the root cause — edit state.yaml, correct the Agentfile, remove a
#    broken MCP entry — then re-sync. If that's still broken, roll back again
#    and try a smaller change.
agentbrew sync
```

Rollback is cheap. Use it as a diagnostic tool, not just an emergency lever.

## What if rollback itself fails?

If `~/.config/agentbrew/backups/` is corrupted, empty, or deleted, rollback can't restore what isn't there — the command prints an error with the missing path and exits 1.

In that case, your recovery path is the declarative state:

1. If your Agentfile is committed to git and you know it's good: `agentbrew sync --agentfile ~/dotfiles/Agentfile.yaml` re-deploys from that source.
2. If `state.yaml` is intact: `agentbrew sync` re-deploys from state.
3. If both are corrupted: `agentbrew init --force` re-discovers agents and rebuilds state, then `agentbrew install --recommended && agentbrew sync` rebuilds from the catalog.

The declarative source of truth (Agentfile or state.yaml) is the deep backup. Snapshot rollback is the fast path; re-sync from declared state is the always-works fallback. Neither requires you to remember what was installed.
