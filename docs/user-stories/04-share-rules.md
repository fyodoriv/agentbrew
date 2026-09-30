# Share Rules Across Agents

> I write one set of rules and every agent follows them — whether the agent stores rules in one big file or in a directory of per-file rules.

```bash
agentbrew rules init           # create ~/.config/agentbrew/shared-rules.md
$EDITOR ~/.config/agentbrew/shared-rules.md

# Per-file rules — one rule per file, with optional glob triggers
mkdir -p ~/.config/agentbrew/rules
$EDITOR ~/.config/agentbrew/rules/typescript.md

agentbrew sync                 # deploys both shapes to every agent that supports them
```

## Two shapes of rules, one source of truth

Different agents store rules differently. Some want a single big Markdown file. Others want a directory of smaller files, one rule per file, optionally scoped to a glob pattern. AgentBrew writes both from the same source tree on your machine:

| Source on your machine | Deployed as | Agents that consume it |
|---|---|---|
| `~/.config/agentbrew/shared-rules.md` | Marker-injected section in each agent's instruction file | Claude Code, Windsurf, Augment, Codex, Devin, and any other agent with a single rules file |
| `~/.config/agentbrew/rules/*.md` | One file per rule, copied into the agent's per-file rules directory | Cursor (`~/.cursor/rules/`), Windsurf (`~/.windsurf/rules/`) |

Pick whichever matches your mental model for the rule — if it's a short project convention with a glob (e.g. "in TypeScript files, do X"), put it in `~/.config/agentbrew/rules/typescript.md`. If it's a broader set of coding standards that should always be in context, put it in `shared-rules.md`. Both sync on every `agentbrew sync`; both survive auto-repair.

## Global rules: marker-injected section

`~/.config/agentbrew/shared-rules.md` is a single Markdown file you edit by hand. Its content lands between `<!-- agentbrew:start -->` and `<!-- agentbrew:end -->` in each agent's rules file. Everything outside the markers — your personal notes, agent-specific tweaks, hand-added memory entries — stays intact across every sync and auto-repair cycle.

| Agent | Rules file |
|-------|-----------|
| Claude Code | `~/.claude/CLAUDE.md` |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` |
| Augment | `~/.augment/guidelines.md` |
| Codex | `~/.codex/AGENTS.md` |
| Devin | `~/.config/devin/AGENTS.md` |

Edit `shared-rules.md` once, `agentbrew sync` deploys to all. The background scheduler also picks up changes automatically.

## Strict attention-friendly language

AgentBrew deploys a strict attention-friendly rule through its managed sync
surfaces. Agents must write all agent-authored natural-language text for an ADHD
audience. The rule is always active and is not overridden by a user request for
another style.

Agents must put the answer first, use short paragraphs and direct sentences,
keep one idea per sentence or bullet, and use headings, bullets, or numbered
steps when they improve scanning. They must surface blockers and the next
action. Required formats and verbatim code, commands, logs, JSON, and user text
stay unchanged. The rule does not ask agents to add comments when the code is
already clear.

The shared rule reaches agents with one rules file. The always-applied
`plain-language-output.mdc` rule reaches agents with per-file rule support.

An explicit user request or a required artifact format can override the default.

## Per-file rules: one rule per file with optional glob triggers

Some agents — Cursor and Windsurf today — support a per-file rules directory where each `.md` file is a standalone rule with optional activation triggers (a file glob, a description, a priority). AgentBrew mirrors `~/.config/agentbrew/rules/` into every supporting agent's per-file rules directory on sync.

A typical per-file rule:

```markdown
---
description: "TypeScript conventions"
globs: ["**/*.ts", "**/*.tsx"]
---

Use strict TypeScript. No `any`. Prefer `unknown` + type guards.
Use `import type` for type-only imports.
```

Place that file at `~/.config/agentbrew/rules/typescript.md` and `agentbrew sync` deploys it to:

- `~/.cursor/rules/typescript.md`
- `~/.windsurf/rules/typescript.md`

Frontmatter is passed through untouched — agents that understand `globs`, `description`, and other fields activate the rule accordingly. Agents that don't support per-file rules receive the global `shared-rules.md` instead; they're never forced to consume a format they don't understand.

## When to use which

| Use global (`shared-rules.md`) when… | Use per-file (`rules/*.md`) when… |
|---|---|
| The rule always applies (language-agnostic) | The rule applies to a subset of files |
| The rule is short and doesn't need activation metadata | The rule has a file glob or trigger condition |
| You want every agent to see the rule, including those without per-file support | You're happy with Cursor/Windsurf-only distribution today |

Both sync together. You can use both. If the same content ends up in both places, the agent's own deduplication rules decide what gets shown — agentbrew doesn't block you from mixing.

## Data safety

Rules sync is covered by the [US 10: Data safety](10-data-safety.md) guarantee:

- Content outside the `<!-- agentbrew:start/end -->` markers in instruction files is never touched.
- Per-file rules you authored manually in `~/.cursor/rules/` or `~/.windsurf/rules/` are preserved; agentbrew only manages files that match entries in `~/.config/agentbrew/rules/`.
- Before sync writes a managed section, it snapshots the file — `agentbrew sync --rollback` restores the previous state if something goes wrong. See [US 26: Rollback](26-rollback.md).
