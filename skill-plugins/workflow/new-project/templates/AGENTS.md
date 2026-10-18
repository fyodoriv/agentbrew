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
| One-line setup (idempotent) | `scripts/setup.sh` |
| Health check | `scripts/doctor.sh` |
| Checkup (whole repo: health, cached gate, broken stories, speed, P0s, monthly audit) | `scripts/checkup.sh` |
{{COMMANDS_TABLE}}
| Fast gate (each commit) | `scripts/check.sh fast` |
| Full gate with e2e (before you say done; cached by input hash) | `scripts/check.sh` (`NO_CACHE=1` for a full rerun) |
| E2E tests only | `scripts/e2e.sh` |
| Speed report | `scripts/metrics.sh` |

## Where to change what

| I want to… | Change | Update this doc too |
|---|---|---|
| Add a feature | the code, a story in `docs/user-stories.md`, and its tests in `tests/e2e/` | `README.md` if users see it |
| Add a log event or metric | the code | `docs/observability.md` event or metric table |
| Add a dependency | the manifest, plus a check in `scripts/doctor.sh` | `README.md` if setup changes |
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
7. Every user story has an e2e test per case in `tests/e2e/`, named after its id.
8. Log content-free JSONL events ([`docs/observability.md`](docs/observability.md)). Errors name the story they break; a broken story is fixed first.
9. A rule a machine can check becomes a step in `scripts/check.sh`, not a sentence here.
10. Key costly outputs by a hash of their inputs, so nothing is computed twice.
{{PROFILE_RULES}}

## Gotchas

A trap that cost time gets a dated row here, or becomes a check.

| Date | Symptom | Fix |
|---|---|---|
| FILL | FILL | FILL |

## Delivery

1. Branch `type/short-description` from `main`.
2. Write the task's Hypothesis, Measurement, Success, and Pivot before the code.
3. Make the change with its tests and docs. Run `scripts/check.sh fast` per commit and `scripts/check.sh` once before merge.
4. Commit with a conventional header (`feat:`, `fix:`, `docs:`, `chore:`).
5. Open a PR with `## Summary`, `## Details`, `## Docs`, and Predicted / Observed / Lesson. Add the row to `docs/learnings.md`. Merge when the gate is green.

## Task Management

Tasks live in `TASKS.md` ([tasks.md format](https://github.com/tasksmd/tasks.md)).
Pick the highest-priority unblocked task, claim it, and remove its block when it is done.

## Docs upkeep

- A behavior change updates its doc in the same PR. The routing table names the doc.
- A gotcha that cost time goes into `## Gotchas`, or becomes a test when a machine can check it.
- A new top-level `docs/*.md` file gets a row in [`docs/README.md`](docs/README.md).
