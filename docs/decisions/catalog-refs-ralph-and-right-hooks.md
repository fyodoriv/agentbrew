# Decision: no catalog entries for Ralph Loop or right-hooks today

- **Task**: `catalog-refs-ralph-and-right-hooks`
- **Date**: 2026-10-16
- **Status**: superseded on 2026-10-25 — the catalog now has a `claude_plugins` item type (see "Update 2026-10-25" below)

## Context

The task asked for two catalog entries plus an `autonomous-loop` bundle:

- **Ralph Wiggum loop**: Anthropic's Claude Code plugin that uses a Stop hook
  to keep the agent working until a completion promise appears.
- **right-hooks** (npm): lifecycle hooks that block an agent from skipping
  Think, Plan, Build, Review, Test, Ship, Reflect phases.

It also asked for new install handlers: `/plugin install` for Claude Code
plugins and `npm install -g` for npm hook packages.

## Evidence (2026-10-16)

- **Ralph moved and was renamed.** `anthropics/claude-code/plugins/ralph-wiggum`
  still exists, and the official marketplace `anthropics/claude-plugins-official`
  now ships it as `plugins/ralph-loop`. Users install it in one Claude Code
  command: `claude plugin install ralph-loop@claude-plugins-official`.
- **Claude Code now has a built-in goal loop.** `/goal` keeps a session
  working until a condition holds, and agentbrew already ships the `run-goal`
  skill and a hook that loads it on every `/goal`. That covers the
  "fire-and-forget loop" need the task named.
- **right-hooks has no adoption.** npm lists two versions (1.0.0 and 1.1.0);
  the last publish was 2026-03-31, and it had 0 downloads in the week of
  2026-10-06 to 2026-10-12 (`api.npmjs.org/downloads/point/last-week/right-hooks`).
  It is not an ecosystem primitive.
- **The catalog has no item type for either.** Skills, MCP servers, rules,
  and CLI tools are catalog types. A Claude Code plugin and a global npm
  hook package would each need a new type and a new install path. The
  bundle primitive (`catalog-plugin-bundle-primitive`) is a separate open
  task.
- **Global installs are a side effect.** `npm install -g` from `agentbrew
  install` changes the machine outside agentbrew's own folders, which the
  catalog avoids today.

## Options

| Option | Result |
|---|---|
| A. Add both entries, two install handlers, and the bundle | Two new catalog types for one plugin with a native install command and one unused package. |
| B. Add only Ralph Loop, as a Claude-only entry | Still needs a plugin item type. |
| C. No entries; point to the native install in docs | No code. Users who want Ralph run one Claude Code command. |

## Recommendation

**Option C.** Do not add right-hooks. Do not add Ralph Loop until the catalog
has a Claude Code plugin item type for its own reasons; the native
`claude plugin install` command is one step, and `/goal` with `run-goal`
covers the loop use case. If `catalog-plugin-bundle-primitive` adds plugin
items, add `ralph-loop@claude-plugins-official` then.

## Update 2026-10-25: the plugin item type exists

The catalog now has a `claude_plugins:` item type (`src/catalog/claude-plugin.ts`).
An entry names a repo, a full 40-character commit, and `plugin@marketplace`.
agentbrew clones the repo at that commit, registers the checkout as a directory
marketplace, and enables the plugin through the `claude` CLI. Claude Code alone
pins a marketplace only to a branch or tag, which can move.

The first entry is `agent-usage-guard`. Ralph Loop can now be added the same
way, from `anthropics/claude-plugins-official` at a reviewed commit, if someone
needs it. `/goal` with `run-goal` still covers the loop use case. right-hooks
stays out for the reasons above.
