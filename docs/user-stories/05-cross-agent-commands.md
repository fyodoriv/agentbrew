# Cross-Agent Commands

[Shared host acceptance](README.md#shared-host-acceptance) applies to this story and its regression tests.

> I write one command file and every agent gets it in its native format.

**Metric**: `story_fail_rate` for US05 in [`metrics.md`](../metrics.md): `commands` sync errors and failed `commands` runs.

**E2E**: [`us05-us06-commands-and-drift.test.ts`](../../real-e2e/scenarios/us05-us06-commands-and-drift.test.ts)

```bash
agentbrew commands init    # create ~/.config/agentbrew/commands/
# Add .md files to the commands directory
agentbrew sync             # deploys commands + everything else to all agents
agentbrew sync --only commands  # only the commands surface
```

## How it works

Commands are written once in Markdown with YAML frontmatter. AgentBrew auto-transforms them per agent:

- **Claude Code** — deployed as-is to `~/.claude/commands/`
- **OpenCode** — deployed to `~/.config/opencode/commands/`
- **Gemini CLI** — converted to TOML format, deployed to `~/.gemini/commands/`

Write once, works everywhere. Commands you created or edited directly in an agent's commands directory are preserved — agentbrew only updates files it deployed.


An Agentfile can select a command folder or individual Markdown files. A
selected file deploys to Claude and Codex without exposing siblings. Source
refresh, collision diagnostics, owner-edit protection and pruning use the same
selection. See `src/sync/command-file-sources.test.ts`.

Declared command paths remain desired while absent. Their unchanged outputs are pruned, parent-folder watch coverage detects recreation, and both hosts restore the source through normal sync. Removing the owning declaration unregisters its path without removing another owner’s sources.

Claude Code command deployment does not depend on ai-rules availability: native Markdown is the supported fallback for every selected source. Existing owner edits survive refresh and removal; other delegated-only hosts still report unavailable rendering.

Integrations inspect `agentbrew commands list --json` and match their exact winning source plus every expected host. Missing, stale, kept or unavailable artifacts block requested readiness without overwriting owner data. See [command readiness](../command-readiness.md).
