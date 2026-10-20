# Cross-Agent Commands

> I write one command file and every agent gets it in its native format.

**Metric**: `story_fail_rate` for US05 in [`metrics.md`](../metrics.md): `commands` sync errors and failed `commands` runs.

**E2E**: [`us05-us06-commands-and-drift.test.ts`](../../real-e2e/scenarios/us05-us06-commands-and-drift.test.ts)

```bash
agentbrew commands init    # create ~/.config/agentbrew/commands/
# Add .md files to the commands directory
agentbrew sync             # deploys commands + everything else to all agents
agentbrew sync --only commands  # only the commands surface
```

## How it works

Commands are written once in Markdown with YAML frontmatter. AgentBrew auto-transforms them per agent:

- **Claude Code** — deployed as-is to `~/.claude/commands/`
- **OpenCode** — deployed to `~/.config/opencode/commands/`
- **Gemini CLI** — converted to TOML format, deployed to `~/.gemini/commands/`

Write once, works everywhere. Commands you created or edited directly in an agent's commands directory are preserved — agentbrew only updates files it deployed.
