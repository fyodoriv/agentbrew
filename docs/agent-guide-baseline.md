# Agent Guide Baseline

Use this checklist when creating or refreshing an `AGENTS.md` file for an
agent-tool repo. Keep the guide repo-specific: link to this baseline for shape,
then write the local facts agents need to work safely without copying generic
boilerplate.

## Required Sections

- **Purpose**: Say what the repo ships, who uses it, and which problems are out
  of scope.
- **Layout**: Map the important directories and generated outputs. Identify
  source-of-truth files versus generated mirrors.
- **Development commands**: List install, dev, build, test, lint, typecheck, and
  full verification commands from the repo root.
- **Editing rules**: Capture repo-specific invariants, API boundaries, deletion
  preferences, generated-file rules, and any security or data-handling limits.
- **Task queue policy**: Explain how to read `TASKS.md`, claim work, respect
  policy comments, handle blocked work, and remove completed task blocks.
- **Agentfile lifecycle**: Document whether the repo owns a root
  `Agentfile.yaml`, what it declares, when to run `agentbrew sync --dry-run`
  versus `agentbrew sync`, and how it differs from generated per-agent config.
- **Skill and source ownership**: Name canonical skill, command, rule, and MCP
  source repos. Warn agents not to edit installed symlink mirrors.
- **Verification gate**: State the smallest acceptable gate by change type and
  the full gate required before shipping.

## Adoption Steps

1. Create or update `Agentfile.yaml` first so the repo declares its agent
   dependencies.
2. Audit the current `AGENTS.md` against the required sections above.
3. Fill gaps with repo-specific facts, not copied prose from this file.
4. Reference this baseline from the repo guide or its setup skill so future
   refreshes start from the same checklist.
5. Run the repo's docs or task linter if the guide edits include `TASKS.md`
   examples, command snippets, or policy changes.

## Agentbrew-Specific Notes

- The root `Agentfile.yaml` declares the MCP servers, catalog skills, and local
  skill source needed to work on agentbrew itself.
- Generated per-agent outputs live under user config directories such as
  `~/.claude/`, `~/.cursor/`, and `~/.config/devin/`; they are deployment
  targets, not source files.
- `templates/AGENTS.md` is the global instruction template deployed by
  agentbrew. `AGENTS.md` is the repo-specific contributor guide for this
  codebase. Update them separately and only when the same rule applies in both
  scopes.
