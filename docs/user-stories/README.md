# Use Cases

AgentBrew syncs skills, MCP servers, rules, commands, and instructions across every agent listed in `src/core/agents.yaml`. Every mutation auto-syncs — one command does everything.

**Data safety guarantee:** AgentBrew never destroys data it didn't create. Your manual edits to agent config files — custom MCP servers, personal rules, edited commands — are preserved across every sync, update, and auto-repair cycle.

**Lifecycle status.** Each user story below is one of three states: shipped-and-staying, shipped-being-removed (⚠ marked inline), or planned. The full lifecycle map lives in [`docs/VISION.md` § "What We're Building — Status"](../VISION.md#what-were-building--status); the queue of in-flight work is in [`TASKS.md`](../../TASKS.md). See [`VISION.md`](../VISION.md) for project direction.

## Flows

| # | Use Case | One-liner | Command |
|---|----------|-----------|---------|
| 1 | [Get started](01-get-started.md) | Zero to fully configured in 2 min | `agentbrew init` |
| 2 | [Install a skill](02-install-skill.md) | One install, every agent gets it | `agentbrew install <name>` |
| 3 | [Add MCP server](03-add-mcp-server.md) | One registry, deployed in every format | `agentbrew install srv -- npx pkg` |
| 4 | [Share rules](04-share-rules.md) | One rules file, injected everywhere | Edit `shared-rules.md` |
| 5 | [Cross-agent commands](05-cross-agent-commands.md) | One command file, auto-transformed | `agentbrew sync --only commands` |
| 6 | [Drift detection](06-drift-detection.md) | Drift checks, auto-repair every 30 min | `agentbrew status --fix` |
| 7 | [Add a source](07-add-source.md) | Any GitHub repo becomes a skill source | `agentbrew install <repo>` |
| 8 | [Update everything](08-update.md) | Pull latest, re-sync, keep personal config | `agentbrew sync --pull` |
| 9 | _Team config (removed 2026-04-24)_ | Superseded by [US 23: Agentfile + git symlink](23-cross-repo-discovery.md) | — |
| 10 | [Data safety](10-data-safety.md) | Manual edits survive every sync | `agentbrew sync --rollback` |
| 11 | [Discover & import](11-discover-import.md) | User-added servers found and synced everywhere | `agentbrew sync --discover` |
| 12 | [Prune safely](12-prune-safely.md) | Clean up stale entries without data loss | `agentbrew sync` (prunes by default) |
| 13 | [Update skills](13-update-skills.md) | Pull latest from sources, update lock file | `agentbrew sync --pull` |
| 14 | [Recommended changes](14-recommended-changes.md) | Get new recommended items after upgrade | `agentbrew install --recommended` |
| 15 | [Add new agent](15-add-new-agent.md) | Deploy everything to a newly installed agent | `agentbrew init --force` |
| 16 | [Agentfile & project config](16-agentfile-project-config.md) | Declarative manifest, project detection, per-file rules | `agentbrew init --from-state` |
| 17 | [Existing setup](17-existing-setup.md) | Already have servers & skills — agentbrew preserves everything | `agentbrew init` |
| 18 | [Lint & validate](18-lint-validate.md) | Validate all config files before syncing | `agentbrew lint` |
| 19 | [Export & import](19-export-import.md) | Move your setup to a new machine or share without git | `agentbrew export` / `agentbrew import --bundle` |
| 20 | [Agent definitions](20-agent-definitions.md) | Write a persona once, deploy to every tool | `agentbrew sync --only agents` |
| 21 | [Completions & hooks](21-completions-hooks.md) | Tab-complete + auto-sync on shell open and git checkout | `agentbrew completions install` |
| 22 | [Lock & reproducible installs](22-lock-reproducible.md) | Pin sources to exact commits for team consistency | `agentbrew lock --verify` |
| 23 | [Cross-repo discovery](23-cross-repo-discovery.md) | Commit an Agentfile; teammates run sync and get identical setup | `agentbrew sync` |
| 24 | [Browse the catalog](24-browse-catalog.md) | See what skills, MCP servers, and rules are available | `agentbrew catalog` |
| 25 | [Status & health](25-status-and-health.md) | Know what's configured, what's drifting, what's broken | `agentbrew status` |
| 26 | [Rollback](26-rollback.md) | Undo the last sync in one command from a pre-sync snapshot | `agentbrew sync --rollback` |
| 27 | [Team overlays](27-team-overlay.md) | Layer your company's curated skills + MCP + rules on top of agentbrew | `agentbrew team set <url>` |
| 28 | [One-liner setup + uninstall](28-quickstart-uninstall.md) | Each team overlay ships its own quickstart/uninstall scripts | `~/apps/<overlay>/bin/quickstart` |
| 29 | [Shared memory packs](29-shared-memory-packs.md) | One loopback semantic-memory runtime with explicit packs and managed project-memory ingestion | `agentbrew memory enable` |
