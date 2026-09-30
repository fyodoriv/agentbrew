# Add a New Agent to an Existing Setup

> I installed Cursor yesterday. How do I get my skills and MCP servers deployed to it?

## Re-detect agents

```bash
agentbrew init --force   # re-scan for agents, preserve existing config
```

This re-runs agent detection without losing your MCP servers, skills, or rules. The new agent is added to state, and the next sync deploys everything to it.

## Why isn't it automatic?

After the initial `agentbrew init`, new agents are NOT auto-detected on `agentbrew sync`. This is intentional:

- Prevents false positives from temporary installations or partial setups
- Keeps state explicit — you control when agents are added
- The background drift repair (every 30 min) does NOT detect new agents either

## What `init --force` does

1. Re-scans for known agent config directories (`~/.claude/`, `~/.cursor/`, etc.)
2. Adds newly detected agents to state (existing agents are preserved)
3. Discovers any existing config in the new agent (MCP servers, skills)
4. Re-syncs everything to all agents (including the new one)

## After re-detection

The new agent immediately gets:
- All registered MCP servers (in its native config format)
- All installed skills (as symlinks)
- Shared rules (injected with managed markers)
- Commands (transformed to the agent's format if needed)
- Agent definitions (if the agent supports them)
