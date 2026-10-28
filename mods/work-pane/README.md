# work-pane

An optional Claude Code mod: a pane beside the chat that shows the day's
`/work` progress. It lists what needs you first, then each step and its status.

## Install

`mods/` is a local plugin marketplace (`agentbrew-mods`). Install once, and
every Claude Code session loads the mod straight from this checkout:

```bash
claude plugin marketplace add ~/apps/tooling/agentbrew/mods
```

```bash
claude plugin install work-pane@agentbrew-mods
```

The owner's dotfiles do this on every apply (`claude_mods` setting). To try
it in one session only: `claude --plugin-dir ~/apps/tooling/agentbrew/mods/work-pane`.

Then type `/work` to start the day: the pane opens by itself. `/work-pane` opens
it without starting a run.

## How it works

`/work-pane` runs `agentbrew work --json` once to find `dashboard.statusPath`
(`$XDG_STATE_HOME/agentbrew/work/<date>.json`). `/work` rewrites that file on
every step change. The pane reads it every 5 seconds.

## Design check

The pane is terminal UI (`Box` and `Text` from the mod runtime). It has no
HTML, CSS, colours, fonts or touch targets. `/hallmark audit mods/work-pane/`
(Hallmark's `sloplint`) reports 0 Floor, 0 Reflex and 0 warnings, so there is
nothing for a redesign to change. The text layout is pinned by
`tests/pane.test.tsx`. Re-run the audit if the pane ever renders HTML.
