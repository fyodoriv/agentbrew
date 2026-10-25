---
name: agentbrew-add-command
description: >
  Add a slash command or workflow to agentbrew so it deploys to all agents.
  Write once in Markdown, auto-transforms per agent. Use when the user says
  "add a command", "create a workflow", or "I want a /slash-command".
---

## Preflight: duplicates, conflicts, pins

Do this before you install or sync anything. It applies to every request to set up a tool: a skill, MCP server, command, hook, plugin, or CLI.

1. **Look for duplicates.** List what already does this job: `agentbrew status --verbose`, `agentbrew audit-skills`, `claude plugin list`, and the `hooks` and `statusLine` keys in `~/.claude/settings.json`. If something already covers it, extend that instead, or ask.
2. **Look for conflicts.** Check each surface the new tool touches: hooks on the same event, the single status line, MCP server and skill names, command names, LaunchAgents (read-only: `ls ~/Library/LaunchAgents` or `launchctl list | grep <name>`; never load or unload one), and plugins.
3. **Prove it works with the setup.** Install it first in a scratch HOME (`HOME=$(mktemp -d)`), with a copy of the relevant settings, and run one real call. If that call needs a login the scratch HOME lacks, run the tool's `--help` or start check instead, and say so. Then install it for real.
4. **Pin versions.** Pin a tag or commit, never a moving branch. Write the pin where agentbrew reads it (`agentbrew install --git <url> --ref <tag>`, `agentbrew mcp add … --ref <tag>`, the catalog entry, or the Agentfile).

Report what you checked and what you found, even when you found nothing.

## What You Do

Create one canonical command file. Agentbrew transforms and deploys it to every
agent's native format automatically. Write once, deploy everywhere.

## Create the Command File

Write a Markdown file at `~/.config/agentbrew/commands/<name>.md`:

```markdown
---
description: One-line description of what this command does
---

## 1. First step

Instructions here. This runs first.

## 2. Second step

More instructions.
```

Frontmatter fields:
- `description` — shown in each agent's command picker and agent UIs

Or register an existing file:
```bash
agentbrew commands add /path/to/command.md
```

## Format Transformations Per Agent

| Agent       | Transformation                                  |
|-------------|------------------------------------------------|
| Claude Code | Kept as-is (Markdown)                          |
| Gemini CLI  | Converted to TOML (`.toml`): `description` + `prompt` |

## Deploy & Verify

```bash
agentbrew sync                  # deploy commands + everything else
agentbrew sync --only commands  # only the commands surface
agentbrew commands list         # verify deployed commands
```

Check that the command appears in the target agent's directory:
```bash
ls ~/.claude/commands/       # Claude Code
ls ~/.gemini/commands/       # Gemini CLI
```

## Edit an Existing Command

Edit the canonical file at `~/.config/agentbrew/commands/<name>.md`, then:
```bash
agentbrew sync --only commands
```

Never edit the per-agent copies — agentbrew overwrites them on sync.

## Remove a Command

```bash
agentbrew remove <name>          # auto-detects command type, removes everywhere
agentbrew sync --only commands   # re-sync to clean up per-agent files
```

## Rules

- One canonical file per command — agentbrew handles format conversion
- Use kebab-case filenames: `my-workflow.md` → `/my-workflow` command
- Keep commands focused — one task per command
- Agent-specific commands go directly in the agent's directory (agentbrew won't
  overwrite files it didn't create)
- Test commands in one agent before relying on them across all agents

## Constraints (Do NOT)

- **Do NOT edit per-agent copies** (`~/.claude/commands/`, `~/.gemini/commands/`, etc.) — agentbrew overwrites them on every sync, losing your changes
- **Do NOT skip `agentbrew sync` (or `agentbrew sync --only commands`)** after creating or editing — the canonical file has no effect until deployed
- **Do NOT put secrets or tokens in command files** — they are plaintext and deployed to all agent directories
