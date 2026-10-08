# Status & Health

> I run `agentbrew status` and know exactly what's configured, what's drifting, and what's broken.

```bash
agentbrew status                 # one-screen summary: agents, servers, sources, skills, drift
agentbrew status --verbose       # full per-agent, per-skill, per-server detail
agentbrew status --json          # machine-readable snapshot
agentbrew status --fix           # detect drift and auto-repair
agentbrew status --ci            # no color, exit 1 on drift — safe for CI gates
```

## Why status matters

Users can't trust a tool they can't inspect. AgentBrew syncs config across many agents with its own state file, a declarative Agentfile, a curated catalog, and a background auto-repair scheduler — status is the single surface that answers "is my setup healthy, and if not, what's wrong?" Without it, users can't adopt the tool, can't debug problems, and can't gate CI on config correctness.

Status is a core capability, not a nice-to-have. See [VISION.md "The Essential Core"](../VISION.md#the-essential-core) for the product-level framing.

## What the default output shows

```
$ agentbrew status

agentbrew status

  Agents:         3 detected (claude-code, cursor, codex)
  MCP Ready:      5/5 (0 need setup) — run `agentbrew setup`
  Sources:        3 registered (vercel-labs/skills, trailofbits/skills, personal)
  Skills:         47 in library across 3 sources
  Last Sync:      clean (2 min ago)
  Drift:          none

  team overlay: enabled (signals: github.example.com in ~/.config/gh/hosts.yml)
```

Each line answers one question:

| Line | Answers |
|------|---------|
| **Agents** | Which AI coding agents are installed on this machine? |
| **MCP Ready** | How many registered MCP servers are ready to use vs. need env vars filled in? |
| **MCP Health** | Whether the last auto-heal probe found runtime MCP failures that remain unresolved. |
| **Sources** | How many skill source repos are registered, and what are their names? |
| **Skills** | How many unique skills are in the library, and how many sources contribute them? (Per-agent deploy counts are surfaced by `agentbrew sync`'s summary line — both displays agree on the same canonical "unique skills" count.) |
| **Last Sync** | When did the last sync run, and was it clean? |
| **Drift** | Is the deployed config in sync with the declared source of truth? |
| **team overlay** | Only shown when relevant — is the overlay enabled, and which signals fired? |

If something is out of place — a missing MCP server, a broken skill symlink, a truncated rules file, or an MCP that still fails after auto-heal — status prints a top-level warning and points at the next command to run.

## Reading the drift section

```
  Drift:          6 issue(s)
    Rules:        ✗ <count> agent(s) missing managed section — cursor, codex
    Skills:       ✗ <count> broken symlink(s) — debug, plan
    MCP servers:  ⚠ <count> server needs env var — github (GITHUB_TOKEN)

  Run `agentbrew status --fix` to auto-repair 5 of 6 issues.
```

Drift breaks down by category. Every row is one of three kinds:

- **✗ Auto-repairable** — the deployed config differs from what agentbrew expects, and `--fix` can restore it.
- **⚠ User-actionable** — needs human input (env vars, token setup, manual file edit) before agentbrew can fix it.
- **ℹ Informational** — user-added content that isn't in agentbrew's state. See [US 11: Discover & Import](11-discover-import.md) for how to sync user-added items.

The bottom line always tells you the next command.

## `--verbose`: full per-agent detail

```bash
agentbrew status --verbose
```

Expands every section into per-agent and per-item detail. Use when something looks off and you want to see exactly which agent has which version of which skill, what every MCP server's deployed command looks like, and which rules are present in each instruction file.

Typical output is long on a well-populated machine (many agents and skills). Pipe to `less` or redirect to a file.

## `--json`: machine-readable snapshot

```bash
agentbrew status --json > status.json
jq '.drift | length' status.json         # drift count
jq '.agents[].detected' status.json      # per-agent detection status
```

Stable schema — `agents`, `mcpServers`, `sources`, `skills`, `drift`, `lastSyncAt`, `team`. Safe to parse from scripts, dashboards, or CI systems.

## `--fix`: detect and auto-repair

```bash
agentbrew status --fix
```

Runs every drift check and applies auto-repair for the ones marked `✗ Auto-repairable` above. Prints what was fixed and what's left. Informational and user-actionable items are never "fixed" — they're reported honestly.

The background scheduler (LaunchAgent on macOS, systemd / cron on Linux) runs `agentbrew fix` every 30 minutes. `status --fix` uses the same repair path on demand when you don't want to wait for the next scheduled run. MCP Health comes from the deep probe, which uses catalog-owned read-only `smokeCall` specs for recommended MCPs. See [US 06: Drift detection](06-drift-detection.md) for what gets repaired.

## `--ci`: gate pull requests on config correctness

```bash
agentbrew status --ci
```

- No color codes (safe for log aggregators)
- No interactive prompts
- **Exit code 1** if drift is detected, **exit code 0** if clean

Drop into a CI pipeline to catch config drift before a PR merges:

```yaml
# .github/workflows/agent-config.yml
- run: npx agentbrew lint
- run: npx agentbrew status --ci
```

This turns "my agent config is broken" into a PR-blocking failure. Same pattern as `npm audit --audit-level=high` in npm pipelines. See [US 18: Lint & validate](18-lint-validate.md) for what `lint` covers — the two commands are complementary (`lint` checks config files are well-formed; `status --ci` checks the deployed state matches the declared state).

## Honest numbers

The one invariant status must hold: **every number it prints has to agree with every other number**. If the skills line disagrees with the sync summary's deployed-skills count, one of them is wrong — either the label is misleading or the counter is broken. Historical status-vs-sync drift (skills, agents, rules) was fixed in PR #811 (2026-04-26) — `status` now uses sync's deduplicated `collectSkills` count, prints the same number, and the rule-snippet "already in shared-rules.md" message is disambiguated from the per-agent "agent-rules-files" drift summary.

If you ever see two numbers that disagree, file an issue — it's a bug in the product.
