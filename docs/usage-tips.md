# Usage tips

The opt-in `usage-tip` hook ends each Claude Code turn with one short tip on
using the agent better, such as `💡 Paste the exact error and command; a
paraphrase makes the agent guess.` It never blocks and adds no model context:
the tip is a `systemMessage`, shown to you and not sent to the model.

Not an agentbrew user? The same hook ships as a standalone Claude Code plugin,
[fyodoriv/claude-usage-tips](https://github.com/fyodoriv/claude-usage-tips):
`/plugin marketplace add fyodoriv/claude-usage-tips`, then
`/plugin install usage-tips@claude-usage-tips`. Both write the same log, so
the report below reads either. Change a tip in both places.

## Turn it on

Add `usage-tip` under `enabled:` in `~/.config/agentbrew/hooks-overlay/manifest.yaml`,
then run `agentbrew sync`. To silence it for one shell, set `HOOK_BYPASS_USAGE_TIP=1`.

## How a tip is picked

Tips live in [`hooks/lib/usage-tips.tsv`](../hooks/lib/usage-tips.tsv), one per
row: id, trigger, adopt regex, text. The hook reads your last prompt:

| Trigger | Fires when the last prompt… |
|---|---|
| `short` | is under 40 characters and not a slash command |
| `correction` | starts with "no", "wrong", "still broken", and similar |
| `error` | reports a failure but holds no error text |
| `long` | belongs to a transcript over 400 lines |
| `any` | always |

**Never a repeat.** A tip already shown never comes back while any tip that
fits is still unshown. The history is the whole log, across sessions. Once
every fitting tip was shown, the one shown longest ago comes next
(oldest-first rotation). Among unshown tips, a matching specific trigger wins,
then file order. A tip you already adopted never shows again, and the same tip
never shows twice in a row.

Every tip names a real Claude Code feature or a well-known prompting practice.
Never add a tip for a command or shortcut that does not exist.

## In the status line

`agent-perf.mjs statusline` (see [agent-perf.md](agent-perf.md)) prints the
session's current tip on a second line, from the last `shown` row for the
session in the log. Each `shown` row holds the tip text for this. The line goes away once you adopt that tip, and control characters in a tip are dropped. Claude Code
has one `statusLine` setting, so the tip joins the existing line; no second
status command is needed.

## Measure and improve

Each shown tip appends a `shown` row to `~/.cache/agentbrew/usage-tips/log.jsonl`
(`USAGE_TIPS_DIR` moves it). The row holds the time, session id, tip id, and
event; never prompt text. When a later prompt in the same session matches a
shown tip's adopt regex (for example `^/compact` after the compact tip), the hook
appends one `adopted` row.

```bash
bash scripts/usage-tips-report.sh
```

prints shown, adopted, and the adoption rate per tip. Rewrite or delete tips
that show often and are rarely adopted; add a tip by adding a row and a case
in `hooks/checks/usage-tip.test.sh`. Adoption is a proxy: a regex hit is not
proof the tip caused it, and tips with adopt regex `-` cannot be measured.
