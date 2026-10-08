# Existing Setup

> I already have MCP servers in Cursor and skills in Claude Code. I install agentbrew. What happens to my stuff?

## Before agentbrew

Your machine has:

- **Cursor** (`~/.cursor/mcp.json`): MCP servers such as context7, playwright, postgres, github, slack
- **Claude Code** (`~/.claude.json`): MCP servers such as context7, filesystem
- **Claude Code** (`~/.claude/skills/`): debug, commit, review (manually installed skill directories)
- **Codex**: no MCP servers configured

## Step 1: Install and run

```bash
npm install -g agentbrew
agentbrew
```

## What happens

### Agents are detected

```
Detecting agents...

  ✓ claude-code
  ✓ cursor
  ✓ codex
```

### Existing configs are discovered (not modified)

AgentBrew reads each agent's config file and imports your servers into its state:

```
  ✓ <count> existing MCP servers imported (context7, playwright, postgres, github, slack, filesystem)
    Your servers are preserved — agentbrew will sync them to all agents.
  ✓ <count> existing skills preserved
```

Imported servers are deduplicated (context7 appears in both Cursor and Claude Code — agentbrew keeps one entry). Your original config files are **not modified** at this point.

### Sync deploys to all agents

When agentbrew syncs, it writes your registered MCP servers to **every** agent's config:

- Cursor keeps its servers and gains any missing from other agents (e.g. filesystem from Claude Code)
- Claude Code keeps its servers and gains any missing from Cursor (e.g. playwright, postgres, github, slack)
- Codex had none → gets the merged set

Your skills (debug, commit, review) are **not touched** — they're directories, not agentbrew symlinks.

## After agentbrew

```bash
agentbrew status
```

```
agentbrew status

  Agents:       <count> detected (claude-code, cursor, codex)
  MCP Servers:  <count> registered
  Skills:       <count> in library across <count> sources
  Sources:      <count> tracked
  Auto-repair:  active (launchagent, every 30 min, last ran <elapsed> ago)
```

Every detected agent now shares the same merged MCP server set. Your manually installed skill directories are untouched.

## What if I add a server to Cursor manually later?

AgentBrew does not touch servers it doesn't know about. If you manually add a new server to `~/.cursor/mcp.json`:

```bash
agentbrew sync    # your manual server is left alone
agentbrew import  # brings your manual server into agentbrew and deploys to all agents
```

## What if I want to undo everything?

```bash
agentbrew export -o backup.yaml   # save current config
agentbrew sync --rollback         # restore pre-sync agent configs
```

Or remove individual items:

```bash
agentbrew remove postgres         # removes from all agents
agentbrew status                  # see everything that's deployed
```

## Key guarantees

1. `agentbrew init` **reads** your configs — it never writes to agent config files during init
2. `agentbrew sync` **merges** — user-added servers and fields survive every sync
3. Skills you installed as directories are **never replaced** with symlinks
4. Rules outside `<!-- agentbrew -->` markers are **never modified**
5. Every sync creates a **snapshot** — `agentbrew sync --rollback` to undo
