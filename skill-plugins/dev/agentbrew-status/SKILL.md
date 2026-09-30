---
name: agentbrew-status
description: >
  Check agentbrew health: agents, MCP servers, drift. Use when the user says
  "what's deployed", "check agentbrew", "is everything in sync", "what skills
  do I have", or "show status".
---

## What You Do

Run health checks and report what's deployed. Interpret output — don't just
dump raw command output at the user.

## Quick Status

```bash
agentbrew status    # agents, MCP servers, skill sources — high-level overview
agentbrew status --fix     # detect drift and AUTO-REPAIR it
```

`status` shows what's configured. `status --fix` detects drift and fixes it in place.
Use plain `status` to check without repairing, or `status --ci` for CI gates (exit 1 on drift, no color).

## Drill Into Subsystems

```bash
mcpm ls                    # all registered MCP servers per intersection client
                           #   (the `agentbrew mcp list` wrapper was deleted in slice 5c — cli-removed-commands-allowlist: historical deletion note
                           #    of `delegate-mcp-to-mcpm`, PR #852 — use mcpm directly)
agentbrew rules show       # shared rules content
agentbrew status --verbose # skills per agent + per-source counts (was `skills status`)
agentbrew commands list    # deployed slash commands
agentbrew status           # also shows drift inline (no separate `diff` subcommand)
```

## Diagnose Drift

If `agentbrew status --fix` reports drift that can't be auto-repaired:

1. **Missing source** — a skill/command source path no longer exists.
   Run `agentbrew status` to see registered sources; remove stale entries with
   `agentbrew remove <source>`.
2. **Removed agent config** — agent was uninstalled or its config dir moved.
   Check `agentbrew status` for agents marked as "not installed".
3. **Permissions** — agentbrew can't write to an agent's directory.
   Check file permissions on the target path shown in the drift report.
4. **Broken symlink** — a skill symlink points to a deleted source.
   Run `agentbrew sync` to rebuild all symlinks (the global `sync` covers skills;
   there is no separate `skills sync --force`).

## Auto-Repair

Agentbrew includes automatic drift prevention:
- `agentbrew init` installs a macOS LaunchAgent that runs repair every 30 min
- `agentbrew status --fix` auto-repairs any drift it finds
- `agentbrew auto-sync watch` repairs on every file change (foreground)
- Check LaunchAgent: `agentbrew auto-sync status`
- The `Auto-repair` line in `agentbrew status` is `active` only after a recent successful run. `not running`, `broken`, `stale`, or `failing` means background repair is not working — tell the user and run `agentbrew auto-sync install`. `disabled` means launchd has the job disabled, often on purpose (endpoint safe mode) — tell the user; do not run `launchctl enable` without their approval

## Rules

- Drift repair is automatic — don't tell users to manually fix drift; run `status --fix`
- When reporting status, give context: summarize skills, agents, and drift from the command output — not raw JSON
- If auto-repair can't resolve drift, investigate the root cause (see Diagnose above)
- Use `agentbrew status` to show what's out of sync before deciding whether to repair

## Constraints (Do NOT)

- **Do NOT manually edit agent config files to fix drift** — run `agentbrew status --fix` instead; manual edits get overwritten on the next sync
- **Do NOT report raw command output** to the user — interpret it: summarize counts, highlight failures, explain what drift means
- **Do NOT ignore unresolved drift** — if `status --fix` can't auto-repair, diagnose the root cause (missing source, broken symlink, permissions) before moving on
