# Add an MCP Server

> I register one MCP server and every agent gets it — right format, env vars, and permissions.

```bash
# From catalog
agentbrew install context7

# Custom MCP server (new syntax with -- separator)
agentbrew install my-server -- npx -y @my/mcp-server

# npx shorthand (auto-detects package name)
agentbrew install @my/mcp-server

# With env vars
agentbrew install my-server -e API_KEY=sk-xxx -- npx @my/mcp-server

# From git repo (clones, builds, auto-detects entrypoint)
agentbrew install my-server --git https://github.com/org/my-mcp-server

# URL-based (SSE/HTTP) with auth headers
agentbrew install remote-server --url https://api.example.com/mcp --headers "Authorization: Bearer $TOKEN"
```

## What happens

`install` saves the server to `state.yaml` and auto-syncs to each agent's native config format:

| Agent | Config file | Format |
|-------|------------|--------|
| Claude Code | `~/.claude.json` | JSON |
| Cursor | `~/.cursor/mcp.json` | JSON |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | JSON |
| Devin | `~/.config/devin/config.json` | JSON |
| Codex | `~/.codex/config.toml` | TOML |
| Goose | `~/.config/goose/config.yaml` | YAML |
| + 7 more | Various | Auto-detected |

MCP servers you added manually to any agent's config file are preserved — agentbrew only writes servers it manages and leaves your custom entries untouched.

Agents whose CLI requires explicit MCP tool grants also get matching `permissions.allow` entries, including Cursor CLI's `~/.cursor/cli-config.json` and Devin's `~/.config/devin/config.json`.

## Manage servers

```bash
agentbrew status                   # list all registered servers + readiness
agentbrew setup                  # interactive wizard for env vars
agentbrew remove my-server       # remove from state + all agents
agentbrew catalog --search "database"      # search the catalog

# `mcp run` / `mcp health` (test + probe) were delegated to mcpm in slice 5b
# of `delegate-mcp-to-mcpm` (PR #851). Use mcpm directly:
mcpm run my-server               # test locally over stdio
mcpm doctor                      # probe all installed servers
```

## Discover MCP servers

Search the official MCP Community Registry or get details on a specific server.
The `mcp install` / `mcp search` / `mcp info` / `mcp list` subcommands were
delegated to mcpm in slices 5a + 5c of `delegate-mcp-to-mcpm` — use the upstream
tool directly:

```bash
mcpm search "database"           # search the registry
mcpm info postgres               # detailed info — transport, env vars
mcpm install postgres            # register globally with mcpm
mcpm ls                          # list installed servers (richer than `agentbrew mcp list` — cli-removed-commands-allowlist: comparison to deleted wrapper, PR #852)
agentbrew status                 # readiness (ready / missing env vars) for agentbrew-managed servers
mcpm doctor                      # probe a running server
```

For a guided agentbrew-curated install (auto-syncs to all detected agents +
brings the org overlay along), use the catalog instead:

```bash
agentbrew install postgres       # catalog install — bridges to mcpm for MCP_INTERSECTION_AGENTS
```

## Rotating credentials and updating config

When an API key expires or a server URL changes:

```bash
agentbrew setup my-server   # re-run the env var wizard for this server
```

The wizard shows which env vars are set and which are missing, then prompts for new values. Updated values are written to your shell config (`.zshenv.secrets` or equivalent) and applied on the next sync.

To update a server's command or args (e.g., package version bump):

```bash
agentbrew remove my-server
agentbrew install my-server -c npx -a "-y" "@my/mcp-server@2.0"
```

For git-installed servers, pull the latest:

```bash
agentbrew mcp update my-server   # git pull + rebuild
```
