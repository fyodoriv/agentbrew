# Built-in dev skills

General-purpose agent skills shipped with agentbrew. Deployed to all agents
via `agentbrew init` (symlinks under `~/.*/skills/<name>/SKILL.md`).

> **Curator, not host — these are a narrow exception.** Per
> [docs/VISION.md](../../docs/VISION.md) and [AGENTS.md rule 8a](../../AGENTS.md),
> agentbrew references skill content; it does not host it. Built-in skills
> are tolerated for one of two reasons: (1) they document agentbrew itself,
> or (2) they predate the source-repo norm and are queued to migrate out.
> A new SKILL.md under `skill-plugins/dev/` lands only if it falls in
> bucket 1. Everything else commits to a source repo and lands here via
> a `src/catalog.yaml` pointer.

Every skill in this directory must ship a spec-valid `evals/evals.json`.
`npm run skills:coverage` is part of `npm run verify` and hard-fails any
missing or invalid eval file for these in-repo custom skills.

## Bucket 1 — permanent built-ins (document agentbrew itself)

These skills will stay built-in forever. They explain how to use agentbrew
from inside an agent session — there is no external source repo where they
would naturally live.

| Skill | Description |
|-------|-------------|
| **agentbrew-add-catalog-source** | Add a new skill, MCP server, or rule to the shipped catalog so every agentbrew user sees it. |
| **agentbrew-add-command** | Add a slash command or workflow to agentbrew so it deploys to all agents. |
| **agentbrew-add-mcp** | Add an MCP server to agentbrew so all agents can use it. |
| **agentbrew-add-skill** | Add a skill source to agentbrew so it deploys to all agents. |
| **agentbrew-manage-permissions** | Manage Claude Code tool permissions. Review allowed/denied tools, add MCP server permissions. |
| **agentbrew-status** | Check agentbrew health: agents, MCP servers, drift. |
| **context-budget** | Investigate agentbrew + Cursor context budget via `~/.config/agentbrew/metrics/latest.json` and `agentbrew measure context`. |
| **cursor-token-playbook** | Daily Cursor token habits — model mix, new chat vs continue, @ scoping, MCP discipline, `.cursorignore`, measure context workflow. |
| **agentfile-init** | Generate an `Agentfile.yaml` for the current project. |
| **load-project-context** | Run the canonical-doc discovery script + read every VISION / ARCHITECTURE / MILESTONES / user-stories / competitors file the agentbrew `load-project-context` catalog rule expects. The invokable companion to the rule + Claude Code SessionStart hook shipped from `~/.config/agentbrew/`. |
| **sync-agent-config** | Syncs all agent rules, memories, skills, and config across tools (Windsurf, Cursor, Claude Code). |
| **prefer-reuse-over-reinvent** | GET-don't-IMPLEMENT decision discipline — VISION cites this skill as the operational wrapper for the delegate/contribute/absorb strategy. |
| **verify-vision-trace** | Validates PR bodies against the `pr-vision-trace` CI gate (Vision goal, User story, Competitor prior art). |
| **competitor-spot-check** | Queries the loaded competitor corpus to produce the Competitor prior art line for vision-trace PR bodies. |
| **detect-task-backend** | Implements the agentbrew task-backend contract (file vs git-native vs github-issues) so task-aware skills write to the right place. |
| **write-vision** | Writes a project's `docs/VISION.md` using agentbrew's VISION schema — canonical reference: `agentbrew/docs/VISION.md`. |

## Migrated skills

Generic methodology skills do not remain in this directory. Their catalog
entries point to maintained upstream repositories or to the opt-in
[`skill-plugins/workflow/`](../workflow/README.md) directory, which records
provenance and local deltas in its `SOURCES.md`.

- Upstream equivalents: `grill-with-docs`, `improve-codebase-architecture`,
  `doubt-driven-development`, `spec-driven-development`, and `prototype`.
- Workflow skills: `skill-plugins/workflow/` owns the owner's workflow skills,
  including `writing-plans`, `task-command-center`, and the consolidated
  `iterate` loop. They moved there from the former `fyodoriv/dev-skills`
  repository on 2026-10-07. Unlike this directory, they deploy only when
  selected by name.
- Removed duplicate: `autoresearch` is intentionally folded into `iterate`;
  it has no separate catalog entry.

When migrating a skill, update its `src/catalog.yaml` source pointer and remove
the local directory in the same change. This keeps the catalog as a reference
and prevents two copies from drifting.
