# Agent support and runtime readiness

The [generated support tables](../README.md#supported-agents) show the sync
surfaces and skill features for each agent. They come from
`src/core/agents.yaml`; `npm run docs:agent-matrix` refreshes them. The freshness
test fails when the table differs from the definitions.

## Runtime checks

A synced configuration directory does not prove the agent runs.
`agentbrew status` checks executable permissions on PATH for Claude Code,
Codex, Gemini CLI, and OpenCode when those agents are detected. Other clients
have no runtime probe; their detected status still means the config directory
exists. Frozen agents receive no new runtime checks.

`agentbrew status --verbose` also runs each known CLI's `--version` and
Codex's `login status`. Each subprocess has a one-second timeout. The compact
and JSON views run no subprocesses. Login output is reduced to signed in,
needs login, or unavailable; raw authentication output is never printed.

On macOS, Codex checks also look for `ChatGPT.app` in `/Applications` and the
user's Applications folder. The terminal CLI and desktop host are separate
installations; use `brew install --cask chatgpt` for the desktop host.

## Skills that are not shared

Status reports real skill folders with a `SKILL.md` under a detected agent's
skill directory. Generated symbolic links are excluded. These folders are not managed links. Agents can also discover skills from
native shared directories such as `~/.agents/skills`, so an agent-directory
count alone does not prove which skills are visible. To share a folder through
agentbrew, adopt its source with `agentbrew install <source-directory>`. Review the files and choose a source
outside a generated agent directory before adoption. Sync never moves or
removes these folders during this check.

## Codex boundaries

- Commands deploy as custom prompts under `~/.codex/prompts` and run as
  `/prompts:<name>` in the CLI. This does not guarantee a desktop slash menu.
- Native lifecycle hooks and skill frontmatter hooks are separate capabilities.
  Codex supports native hooks but does not execute Claude-only skill features.
- New or changed non-managed hooks need trust review in CLI `/hooks` before
  they run. Sync writes the configuration; it does not grant trust.
- Codex custom agents use standalone TOML files with `name`, `description`,
  and `developer_instructions` under `~/.codex/agents`.
- Local hook behavior does not establish support in cloud-orchestrated Work
  sessions. Check the workflow's hook limitations before relying on a policy.

Sources: [OpenAI hooks reference](https://learn.chatgpt.com/docs/hooks) and
[OpenAI custom agents reference](https://learn.chatgpt.com/docs/agent-configuration/subagents).
