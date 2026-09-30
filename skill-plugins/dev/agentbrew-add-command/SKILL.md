---
name: agentbrew-add-command
description: >
  Add a slash command or workflow to agentbrew so it deploys to all agents.
  Write once in Markdown, auto-transforms per agent. Use when the user says
  "add a command", "create a workflow", or "I want a /slash-command".
---

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

<!-- turbo -->

## 2. Second step (auto-runs in Cursor without confirmation)

More instructions.
```

Frontmatter fields:
- `description` — shown in Windsurf's command picker and agent UIs

Annotations:
- `<!-- turbo -->` above a step → becomes `// turbo` in Cursor (auto-runs
  without user confirmation prompt)

Or register an existing file:
```bash
agentbrew commands add /path/to/command.md
```

## Format Transformations Per Agent

| Agent       | Transformation                                  |
|-------------|------------------------------------------------|
| Claude Code | Kept as-is (Markdown)                          |
| Cursor      | YAML frontmatter stripped; `<!-- turbo -->` → `// turbo` |
| Windsurf    | Kept as-is; `description` used in picker      |
| Gemini CLI  | Kept as-is                                     |

## Deploy & Verify

```bash
agentbrew sync                  # deploy commands + everything else
agentbrew sync --only commands  # only the commands surface
agentbrew commands list         # verify deployed commands
```

Check that the command appears in the target agent's directory:
```bash
ls ~/.claude/commands/       # Claude Code
ls ~/.cursor/commands/       # Cursor
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

- **Do NOT edit per-agent copies** (`~/.claude/commands/`, `~/.cursor/commands/`, etc.) — agentbrew overwrites them on every sync, losing your changes
- **Do NOT skip `agentbrew sync` (or `agentbrew sync --only commands`)** after creating or editing — the canonical file has no effect until deployed
- **Do NOT put secrets or tokens in command files** — they are plaintext and deployed to all agent directories
