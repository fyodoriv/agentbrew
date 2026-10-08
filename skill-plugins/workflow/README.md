# Workflow skills

Opt-in methodology skills maintained in agentbrew. They moved here from the
former `fyodoriv/dev-skills` repository on 2026-10-07 (owner decision).

These skills are **not** deployed by default. That is the difference from
`skill-plugins/dev/`, whose agentbrew built-ins deploy to every agent.

## Install

Select a skill by name. Either:

- list it under `skills:` in an Agentfile, or
- run `agentbrew install <skill-name>` (catalog source `fyodoriv/agentbrew`).

The agentbrew repo's own `Agentfile.yaml` registers this directory as a local
source (`./skill-plugins/workflow`).

## Rules for skills in this directory

- Every skill ships a spec-valid `evals/evals.json`.
- Record provenance and local deltas in [SOURCES.md](SOURCES.md).
- Prefer an upstream skill when it covers the use case. Move a skill out when
  upstream closes the gap.
- Windsurf, Devin, and Augment are frozen. Leave their existing mentions as
  they are, and add no fixes or features for them.
