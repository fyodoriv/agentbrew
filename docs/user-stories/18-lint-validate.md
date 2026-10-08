# Lint & Validate

> I changed my config and want to make sure everything is valid before syncing.

```bash
agentbrew lint   # validate all config files
```

## What gets checked

| File | Validated | What it checks |
|------|-----------|---------------|
| **AGENTS.md** | Source template exists | Used by instructions-sync to deploy to all agents |
| **catalog.yaml** | Valid YAML + recommended MCP smoke metadata | Catalog of available skills, MCP servers, and rules. Recommended MCPs must declare `smokeCall.tool` so `agentbrew mcp probe --deep` can exercise them beyond `tools/list`. |
| **Agentfile** | Valid YAML, known keys only | Declarative manifest in cwd (`Agentfile.yaml`, `Agentfile.yml`, or `Agentfile`) |
| **state.yaml** | Structure + required fields | agents, sources, mcpServers arrays and rules.sharedFile present |
| **MCP configs** | Per-agent config parseable | Each detected agent's native MCP config (JSON, TOML, YAML) |
| **shared-rules.md** | Exists, non-empty | Shared rules file deployed to all agents |
| **Commands** | Each `.md` file readable, non-empty | Command files in `~/.config/agentbrew/commands/` |
| **Skill sources** | Directories accessible | Each registered skill source path exists and contains skills |

## Output

```
Validating agentbrew config...

  ✓ AGENTS.md
  ✓ src/catalog.yaml
  ✓ Agentfile.yaml (MCP servers from your Agentfile)
  ✓ state.yaml (<agents> agents, <mcp> MCP servers)

MCP configs
  ✓ cursor
  ✓ claude-code
  ✓ windsurf

Shared rules
  ✓ shared-rules.md (<line-count> lines)

Commands
  ✓ <count> command(s)

Skill sources
  ✓ workflow (<count> skills)
  ✓ vercel-labs/skills (<count> skills)

All config valid
```

Errors return exit code 1 — safe to use in CI or pre-commit hooks.

## Agentfile validation

When an `Agentfile.yaml` exists in the current directory, lint checks:

- **YAML syntax** — catches typos and formatting errors before sync
- **Known keys** — warns on unrecognized top-level keys (`mcp`, `skills`, `sources`, `rules` are valid)
- **MCP server count** — reports how many servers are declared

This means standard YAML linters (yamllint, IDE extensions) also work on `Agentfile.yaml` — the `.yaml` extension is intentional.

## When to run

- Before committing an Agentfile to a shared repo
- After editing `state.yaml` or `shared-rules.md` directly
- In CI to catch config drift (`agentbrew lint && agentbrew status --ci`)
- After upgrading agentbrew to verify config compatibility
