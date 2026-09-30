---
name: agentbrew-manage-permissions
description: >
  Manage Claude Code tool permissions. Review allowed/denied tools, add MCP
  server permissions. Use when the user says "allow tool", "add permission",
  "block tool", or "what tools are allowed".
---

## What You Do

Review and manage tool permissions for Claude Code via `~/.claude/settings.json`.
MCP server permissions are auto-managed by agentbrew — manual edits are for
edge cases only.

## Check Current Permissions

```bash
agentbrew status              # shows MCP servers + their permission status
cat ~/.claude/settings.json   # full permissions object
```

The `permissions` key in `settings.json` has two arrays:
- `allow` — tools Claude can use without asking
- `deny` — tools Claude is blocked from using

## Permission Pattern Reference

```
mcp__server-name__*          All tools from an MCP server
mcp__server-name__tool-name  One specific tool from an MCP server
Bash(git *)                  Bash commands matching a glob pattern
Bash(yarn *)                 Specific yarn scripts
Read                         File read
Write                        File write
Edit                         File edit
WebFetch                     Web fetching
WebSearch                    Web search
```

## Add a Permission

For MCP server permissions — let agentbrew handle it:
```bash
agentbrew mcp add <server>   # permissions auto-added on sync
agentbrew sync
```

For manual permissions (Bash patterns, built-in tools), edit directly:
```bash
# Open settings
cat ~/.claude/settings.json

# Edit: add to permissions.allow array
# Example: add Bash(docker *) to allow Docker commands
```

Then verify the edit didn't break anything:
```bash
agentbrew status --fix
```

## Remove a Permission

Edit `~/.claude/settings.json` to remove the entry from `allow` or `deny`, then:
```bash
agentbrew status --fix    # verify consistency
```

## Deny a Tool

Add to `permissions.deny` to explicitly block a tool even if an MCP server
would otherwise expose it:
```json
{
  "permissions": {
    "deny": ["mcp__dangerous-server__delete-everything"]
  }
}
```

## Rules

- Use the most specific pattern possible — `mcp__github__create_pr` not `mcp__*`
- MCP server permissions are auto-handled — only edit manually for fine-grained control
- Never remove core tool permissions (Read, Write, Edit) without explicit user request
- Always run `agentbrew status --fix` after any manual edits to `settings.json`
- `deny` overrides `allow` — if a tool is in both, it's denied

## Constraints (Do NOT)

- **Do NOT use broad wildcards** like `mcp__*` or `Bash(*)` — they grant unrestricted access to all tools or all shell commands; always scope to a specific server or command pattern
- **Do NOT manually edit `settings.json` for MCP servers** — use `agentbrew mcp add` and let agentbrew manage permissions; manual edits get overwritten on next sync
- **Do NOT remove Read, Write, or Edit permissions** without an explicit user request — this breaks basic agent functionality
- **Do NOT skip `agentbrew status --fix`** after manual edits — invalid JSON or conflicting allow/deny entries will silently break Claude Code tool access
