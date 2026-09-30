# Cross-Agent Commands

> I write one command file and every agent gets it in its native format.

```bash
agentbrew commands init    # create ~/.config/agentbrew/commands/
# Add .md files to the commands directory
agentbrew sync             # deploys commands + everything else to all agents
agentbrew sync --only commands  # only the commands surface
```

## How it works

Commands are written once in Markdown with YAML frontmatter. AgentBrew auto-transforms them per agent:

- **Claude Code** — deployed as-is to `~/.claude/commands/`
- **Cursor** — frontmatter stripped, comment syntax adjusted, deployed to `~/.cursor/commands/`
- **Windsurf** — transformed to workflow format, deployed to `~/.codeium/windsurf/global_workflows/`
- **Devin** — deployed to `~/.config/devin/commands/`
- **OpenCode** — deployed to `~/.config/opencode/commands/`
- **Gemini CLI** — converted to TOML format, deployed to `~/.gemini/commands/`

Write once, works everywhere. Commands you created or edited directly in an agent's commands directory are preserved — agentbrew only updates files it deployed.
