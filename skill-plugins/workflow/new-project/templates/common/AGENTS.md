# AGENTS.md — {{NAME}} guide for agents

## Start here

{{NAME}} is a {{PROFILE_LABEL}}. {{DESCRIPTION}}
The canonical branch is `main`.

Read this file first. Then open only the doc that the routing table names.
`CLAUDE.md` is a symlink to this file. The docs map is [`docs/README.md`](docs/README.md).
Before you propose a feature, read [`docs/VISION.md`](docs/VISION.md): its
non-goals and kill criteria decide every trade-off.

## Commands

Run every command from the repo root.

| Task | Command |
|---|---|
{{COMMANDS_TABLE}}
| Full gate (run before you say done) | `scripts/check.sh` |

## Where to change what

| I want to… | Change | Update this doc too |
|---|---|---|
| Add a feature | the code, plus a story in `docs/user-stories.md` | `README.md` if users see it |
| Record a decision that is hard to undo | a new `docs/decisions/NNNN-*.md` | none |
| Plan a change bigger than one PR | `docs/plans/YYYY-MM-DD-<topic>.md` | none |
| Add or close a task | `TASKS.md` | none |
{{ROUTING_ROWS}}

## Rules

1. Run `scripts/check.sh` before you say a change is done. Show its output.
2. A bug fix starts with a failing test that reproduces it.
3. Each change updates its docs in the same commit (see `## Docs upkeep`).
4. Touch only what the task needs. Note other problems as tasks in `TASKS.md`.
5. Never commit secrets. Real values go in `.env` (ignored); names go in `.env.example`.
6. Prefer a maintained library or tool to new code. Wrap it behind a small adapter.
{{PROFILE_RULES}}

## Gotchas

- FILL: add each environment fact that costs an agent time, with its fix.

## Delivery

1. Branch `type/short-description` from `main`.
2. Make the change with its tests and docs. Run `scripts/check.sh`.
3. Commit with a conventional header (`feat:`, `fix:`, `docs:`, `chore:`).
4. Open a PR with `## Summary`, `## Details`, and `## Docs`. Merge when the gate is green.

## Task Management

Tasks live in `TASKS.md` ([tasks.md format](https://github.com/tasksmd/tasks.md)).
Pick the highest-priority unblocked task, claim it, and remove its block when it is done.

## Docs upkeep

- A behavior change updates its doc in the same PR. The routing table names the doc.
- A gotcha that cost time goes into `## Gotchas`, or becomes a test when a machine can check it.
- A new top-level `docs/*.md` file gets a row in [`docs/README.md`](docs/README.md).
