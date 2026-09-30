# Get Started

> I install agentbrew and all my agents end up with the same config.

```bash
npm install -g agentbrew
agentbrew
```

That's it. On first run, agentbrew auto-detects your agents, installs recommended skills + MCP servers, syncs everything, and sets up background drift repair. No separate `init` step needed.

If you prefer not to install globally: `npx agentbrew` works the same way.

## What happens

1. **Detect agents** — scans for known config directories (`~/.claude/`, `~/.cursor/`, `~/.codeium/`, etc.). The README agent matrix lists every recognized agent.
2. **Discover existing config** — reads each agent's MCP config and skills directory, deduplicates by name.
3. **Save state** — writes `~/.config/agentbrew/state.yaml` (human-readable YAML, version-controlled).
4. **Install drift repair** — platform-native scheduler runs `agentbrew status --fix` every 30 minutes (LaunchAgent on macOS, systemd/cron on Linux).

Any existing agent config you have — custom MCP servers, personal rules, edited commands — is preserved. AgentBrew only adds and manages its own entries.

After `install --recommended`, you get curated skills (debug, plan, commit, review, pr, refactor, iterate, semgrep, codeql, etc.), MCP servers (context7, playwright, tasks-mcp), and rule sets — all deployed to every detected agent.

## What it looks like

```
$ agentbrew

Detecting agents...

  ✓ claude-code
  ✓ cursor
  ✓ windsurf
  ✓ devin

Discovering existing config...

  Skills: <unique-skills> unique across <detected-agents> agents
  MCP servers: <unique-mcp> unique

── Summary ─────────────────────────────────────

  ✓ <detected-agents> agents detected
  ✓ <unique-skills> skills discovered
  ✓ <unique-mcp> MCP servers discovered
  ✓ State saved to ~/.config/agentbrew/state.yaml

── Next steps ──────────────────────────────────

  agentbrew install --recommended   Install curated skills + MCP servers
  agentbrew sync                    Deploy everything to all agents
  agentbrew catalog                 Browse the full catalog
  agentbrew status                  See what's configured
```
