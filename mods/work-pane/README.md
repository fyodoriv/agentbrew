# work-pane

An optional Claude Code mod: a pane beside the chat that shows the day's
`/work` progress. It lists what needs you first, then each step and its status.

## Install

```bash
claude --plugin-dir ~/apps/tooling/agentbrew/mods/work-pane
```

Then type `/work-pane` to open the pane, and `/work` to start the day.

## How it works

`/work-pane` runs `agentbrew work --json` once to find `dashboard.statusPath`
(`$XDG_STATE_HOME/agentbrew/work/<date>.json`). `/work` rewrites that file on
every step change. The pane reads it every 5 seconds.
