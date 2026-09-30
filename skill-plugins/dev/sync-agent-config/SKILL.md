---
name: sync-agent-config
description: >
  Syncs skills, MCP servers, rules, commands, and instructions across all agents
  using agentbrew. Use after adding/removing skills, changing shared rules, or
  when agent configs drift. Don't use for creating new skills (use Anthropic skill-creator or Superpowers writing-skills)
  or adding MCP servers (use agentbrew-add-mcp).
---

## What You Do

Run agentbrew sync to deploy all config (skills, MCP servers, shared rules,
commands, instructions) to every supported agent. Agentbrew handles format
conversion — you maintain one source of truth, it handles the rest.

## Step 1: Check Current State

```bash
agentbrew status            # overview: agents, MCP servers, sources, skill counts
agentbrew status --verbose  # detailed per-agent / per-skill status
agentbrew status --fix      # detect drift and auto-repair
```

If `agentbrew status --fix` reports drift, it auto-repairs. If it can't repair
(missing source, removed agent config), see the `agentbrew-status` skill for
diagnosis steps.

## Step 2: Sync Everything

```bash
agentbrew sync      # deploys all: skills, MCP, rules, commands, instructions
```

Or sync individual subsystems when you only changed one thing — `--only`
takes one or more comma-separated modules
(`mcp,rules,commands,agents,skills,hooks,instructions`):

```bash
agentbrew sync --only mcp        # MCP servers → Claude, Cursor, Windsurf, Kiro, etc.
agentbrew sync --only rules      # shared rules → all agents
agentbrew sync --only commands   # slash commands → Cursor, Claude Code, etc.
agentbrew sync --only skills     # skill symlinks → all agent skill dirs
```

## Step 3: Verify

```bash
agentbrew status           # confirm everything deployed with expected counts (+ drift)
mcpm ls                    # verify MCP servers appear in each intersection client
                           #   (the `agentbrew mcp list` wrapper was deleted in slice 5c — cli-removed-commands-allowlist: historical deletion note
                           #    of `delegate-mcp-to-mcpm`, PR #852 — use mcpm directly)
agentbrew rules show       # verify shared rules content
agentbrew status --fix     # confirm no remaining drift (and auto-repair if any)
```

**Token overhead check**: after syncing, estimate the deployed instructions file size:
`wc -c ~/.claude/CLAUDE.md | awk '{print int($1/4) " tokens"}'`. Target: under ~8K tokens.
If over budget, check for cross-section duplication (Git Safety, Commit Format, Dependency
Policy appear in both template and shared-rules.md) and Cursor rules deployed to non-Cursor
agents. See `docs/instructions-analysis.md` for trimming guidance.

## What Gets Synced Where

```
state.yaml (mcpServers)        → mcp-sync      → ~/.cursor/mcp.json
                                                  ~/.codeium/windsurf/mcp_config.json
                                                  ~/.kiro/settings/mcp.json
shared-rules.md                → rules-sync    → ~/.augment/guidelines.md
                                                  ~/.codex/AGENTS.md
~/.config/agentbrew/commands/  → command-sync  → ~/.cursor/commands/
                                                  ~/.claude/commands/
skill-plugins/ + sources       → skills-sync   → ~/.claude/skills/
                                                  ~/.cursor/skills/ (every agent)
templates/AGENTS.md            → instructions  → ~/.claude/CLAUDE.md
                                                  ~/.augment/guidelines.md
```

## Auto-Repair (runs in background)

Agentbrew keeps configs in sync automatically:
- `agentbrew init` installs a macOS LaunchAgent: runs repair every 30 min
- `agentbrew status --fix` auto-repairs drift on demand (use `agentbrew status --ci` for CI)
- `agentbrew auto-sync watch` repairs on every file change (foreground daemon)
- Check daemon status: `agentbrew auto-sync status`

## Constraints (Do NOT)

- **Don't edit individual agent configs directly** — agentbrew overwrites them on every sync; manual edits are silently reverted within 30 minutes
- **Don't write counts in docs** (skills, agents, tests, files) — they go stale; never update one, delete it. Use `agentbrew status --verbose` for live numbers
- **Don't skip `agentbrew status --fix` after sync** — always verify no remaining drift; a successful sync command doesn't guarantee all targets were writable

## Related Skills

- **`agentbrew-status`** — detailed health check and drift diagnosis
- **`agentbrew-add-mcp`** — register a new MCP server
- **`agentbrew-add-skill`** — add a new skill source
- **`skill-creator`** (Anthropic) / **`writing-skills`** (Superpowers) — create or improve a skill (run sync after)
