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

- Commands deploy as native skills named `agentbrew-command-<name>`. Invoke one
  explicitly, for example `$agentbrew-command-ship-it`, or select it from the
  native skill picker. Reserved, unusual, or long names get a stable hash suffix; inspect
  the generated `SKILL.md` for the exact name. Sync also keeps the legacy
  `~/.codex/prompts` output for clients that still accept custom prompts.
  Current clients can reject `/prompts:<name>` even when those files exist.
- Each native adapter contains the original command bytes in
  `references/command.md`. Its source frontmatter is metadata, not permission
  grants. The adapter disables implicit invocation and inherits the session's
  approval rules. It does not change existing `source-command-*` skills.
- Skill arguments are model-bound instructions, not native macro expansion:
  `$ARGUMENTS` is the text after the explicit invocation; `$1` through `$9`
  are positional arguments with quoted text kept together. Named `$NAME`
  placeholders require explicit `NAME=value`. The adapter never renders the
  command through shell or environment expansion.
- Sync owns only hash-recorded adapter leaves. Untracked or edited leaves,
  symlinks, and private wrapper skills stay intact. A source update refreshes
  an unchanged adapter. Pruning removes only unchanged owned leaves, preserves
  extra files, and never recursively deletes its folder. The manifest retains ownership hashes
  while that folder exists, so a returning source can restore its leaves. Those
  records are cleared after the folder itself is removed. Drift checks every
  required leaf, including the explicit-invocation policy.
- Native lifecycle hooks and skill frontmatter hooks are separate capabilities.
  Codex supports native hooks but does not execute Claude-only skill features.
- New or changed non-managed hooks need trust review in CLI `/hooks` before
  they run. Sync writes the configuration; it does not grant trust.
- Codex custom agents use standalone TOML files with `name`, `description`,
  and `developer_instructions` under `~/.codex/agents`.
- Local hook behavior does not establish support in cloud-orchestrated Work
  sessions. Check the workflow's hook limitations before relying on a policy.

Sources: [OpenAI skills reference](https://developers.openai.com/codex/skills),
[OpenAI hooks reference](https://learn.chatgpt.com/docs/hooks) and
[OpenAI custom agents reference](https://learn.chatgpt.com/docs/agent-configuration/subagents).


## Continuous repair and workflow acceptance

Every story inherits the [shared host acceptance](user-stories/README.md#shared-host-acceptance).
File deployment covers native clients. It does not grant account OAuth or
change native memory privacy settings. Configured shared semantic memory is
the common bootstrap, recall and session-learning path for agent workflows.

The periodic repair job checks all supported sync surfaces. Its successful
exit means no repairable drift remains; owner conflicts stay intact and need
attention. A successful run does not prove third-party service authentication.

`agentbrew auto-sync watch` watches configuration and registered skill, command
and agent source folders. State registration refreshes its roots without a
sync. Generated bookkeeping, backups and metrics do not trigger another run.
It reports completion only when the sync subprocess succeeds. The watcher
instance owns its roots and debounce timer until shutdown; periodic repair is
still the fallback when the foreground watcher is not running.

### Command renderer availability

Claude Code prefers ai-rules output and falls back to the existing plain Markdown transform when ai-rules is unavailable. This covers every selected command, including Agentfile and user commands, with the same owner-edit protection and safe pruning. AMP and Firebender still require their delegated formats. Codex command skills use the native bridge independently.

See [command readiness](command-readiness.md) for a content-free, source-scoped deployment check and [local skill directories](skill-directories.md) for automatic future skill selection and owner-safe removal. Test runs require a frozen repo inventory; concurrent source additions trip the isolation guard.
