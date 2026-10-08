# Agent Definitions

> I write a persona once and every agent tool gets it — Claude Code, Cursor, Codex, all of them.

```bash
agentbrew agents init                      # create ~/.config/agentbrew/agents/ directory
agentbrew agents list                      # show all agent definitions and deployment status
agentbrew sync --only agents               # deploy definitions to all detected tools
agentbrew agents add-source team /path     # register an external definitions directory
```

## What are agent definitions?

Agent definitions are Markdown persona files (e.g. `researcher.md`, `reviewer.md`) that describe how an AI agent should behave for a specific role. You write them once in `~/.config/agentbrew/agents/` and agentbrew deploys them to every tool that supports custom agents:

| Tool | Deployed to |
|------|------------|
| Claude Code | `~/.claude/agents/` |
| Cursor | `~/.cursor/agents/` |
| Codex | `~/.codex/agents/` |

## Multiple sources

You can pull agent definitions from several directories — your own, your team's, and open-source collections:

```bash
agentbrew agents add-source personal ~/my-agents
agentbrew agents add-source team /path/to/team-repo/agents
agentbrew sync   # merges all sources, deploys everywhere (or `agentbrew sync --only agents`)
```

When names collide across sources, user-defined agents take precedence over team-defined ones.

## How it works

1. `agentbrew agents init` creates the agents directory and a starter template
2. Write `.md` files — one per persona
3. `agentbrew sync` (or `agentbrew sync --only agents`) copies them to every detected tool
4. Drift detection ensures they stay deployed — if an agent tool resets its config, the next auto-repair cycle restores your definitions
