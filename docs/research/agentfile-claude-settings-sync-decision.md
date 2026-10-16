# Decision: the Agentfile does not sync Claude Code session settings

- **Task**: `agentfile-claude-session-settings-sync`
- **Date**: 2026-10-16
- **Status**: decided — reject (option b in the task); no follow-up

## Context

[`claude-code-undocumented-config.md`](claude-code-undocumented-config.md)
found three Claude Code settings in `~/.claude/settings.json`:

- `autoMemoryEnabled`: turns auto memory on or off.
- `autoDreamEnabled`: turns memory consolidation across sessions on or off.
- `autoMode`: rules for the auto mode permission classifier
  (`allow`, `soft_deny`, `hard_deny`, `environment`).

The task asks: should the Agentfile declare these keys, and should
`agentbrew sync` write them, as it already writes `hooks`?

## Options

| Option | What it means |
|---|---|
| A. New `claudeSettings:` Agentfile key, synced by a new `settings-sync.ts` | agentbrew owns these keys in `settings.json`. |
| B. Generic pass-through (`agentSettings.<agent>: {...}`) | agentbrew writes any key the user names, for any agent. |
| C. Reject: leave the keys to Claude Code and the machine-config layer | No agentbrew change. |

## Evidence (2026-10-16)

Installed version: `claude --version` prints `2.1.301 (Claude Code)`.

- **All three keys still exist.** `grep -a -c -F` on
  `~/.local/share/claude/versions/2.1.301`: `autoMemoryEnabled` 8,
  `autoDreamEnabled` 6, `autoMode` 134, `soft_deny` 53, `hard_deny` 46.
- **Two keys are now documented.** The settings reference
  (`https://code.claude.com/docs/en/settings-reference.md`) lists:
  - `autoMemoryEnabled`: scope "Any file", default `true`. The `/memory`
    toggle "writes this key to your user settings". The env var
    `CLAUDE_CODE_DISABLE_AUTO_MEMORY` overrides it for one session.
  - `autoMode`: scope "User or managed". The classifier does not read it
    from project settings. Arrays from several files are joined. The
    literal `"$defaults"` keeps the built-in rules.
- **`autoDreamEnabled` is not documented.** It has no match in the
  settings reference, the settings page, or the memory page. It is an
  unstable field.
- **The defaults are already safe.** Auto memory is on by default. Auto
  mode with no `autoMode` key uses only the built-in rules.
- **Claude Code writes these keys itself.** The `/memory` toggle writes
  `autoMemoryEnabled`. A sync that also writes the key would fight the
  user's own toggle on every run. `statusline-sync.ts` shows the cost: it
  needs a manifest record (`managedStatusLine`) to tell its own value from
  the user's.
- **The machine-config layer already owns user preferences here.** The
  dotfiles script `run_after_claude-settings-model.sh` pins
  `permissions.defaultMode` and `skipAutoPermissionPrompt` in the same
  file, and the dotfiles `claude.model_default` doctor check verifies them.
  `autoMode` and `autoMemoryEnabled` are the same kind of preference.
- **The keys are Claude-only.** agentbrew's value is one source for many
  agents. Hooks and models map to several agents through
  `src/core/agents.yaml`. These keys have no equal in other agents.
- **The live file does not set them.** `jq` on `~/.claude/settings.json`
  shows `autoMemoryEnabled`, `autoDreamEnabled`, and `autoMode` all unset.
  No user need is waiting on this feature.

## Recommendation

**Option C: reject.** These keys are per-user preferences, not shared
agent config. Claude Code already has a UI for them, the defaults are safe,
and one key is undocumented. A sync would add an ownership manifest for a
Claude-only feature with no current user.

Option B is also rejected. A generic pass-through turns the Agentfile into
a second copy of each agent's settings file. VISION.md says agentbrew
wraps tools and keeps a small surface.

A user who wants these keys pinned on every machine sets them where
`permissions.defaultMode` is already pinned: their machine-config layer
(for example a chezmoi script). A team that wants `autoMode` rules for
everyone uses Claude Code managed settings, which the docs name as the
other valid scope.

## Follow-up

None. Re-open only when both are true:

- a user asks to share `autoMode` rules across many machines and has no
  machine-config layer; and
- Claude Code documents `autoDreamEnabled`, or the request covers only the
  documented keys.
