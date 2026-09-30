# Update Everything

> I pull latest skills from all sources and re-sync without losing my config.

```bash
agentbrew sync --pull          # pull all sources, re-sync everything
agentbrew sync --pull --dry-run  # preview what would change without applying
```

## How it works

`sync --pull` fetches the latest from every tracked source (git pull for repos, rescan for local folders), updates the catalog index, then runs a full sync to all agents. Your personal config is preserved — both `state.yaml` and any manual edits you made to agent config files:

- MCP servers you added manually to agent configs survive sync
- Rules you wrote outside the managed markers survive sync
- Skills you created as directories or symlinks survive sync
- Commands and agent definitions you edited survive sync

To sync manual changes from one agent to all others, run `agentbrew import` first — it discovers MCP servers you added directly to agent configs and brings them into agentbrew state. Or run `agentbrew sync --discover` to see which servers exist in agent configs but not in agentbrew.

```bash
agentbrew upgrade               # check for agentbrew CLI updates from npm
agentbrew upgrade --check       # check only, don't install
```

## When agentbrew itself is updated

When you upgrade agentbrew (`agentbrew upgrade`), new capabilities are picked up automatically:

- **New sync modules** (e.g., instructions sync, agent definitions) — activated on next `agentbrew sync`
- **New agent support** (e.g., Gemini CLI MCP) — detected agents get new sync automatically
- **New drift checks** — `agentbrew status --fix` runs them immediately
- **New recommended items** — NOT auto-installed. Run `agentbrew install --recommended` to get them.

No `init --force` needed for new sync types — they just work.

## What if an update breaks something?

```bash
agentbrew sync --rollback   # restore agent configs from last pre-sync snapshot
```

Every sync creates a timestamped backup. Up to 10 snapshots are kept. Rollback restores agent config files to their pre-sync state. Your `state.yaml` is not rolled back — only agent config files.
