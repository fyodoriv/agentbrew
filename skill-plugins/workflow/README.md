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
- Windsurf and Devin support was removed on 2026-10-08. Augment stays frozen.
  Leave its existing mentions as they are, and add no fixes or features for it.
- Keep inventory counts (agents, skills, tests, packages) out of SKILL.md and
  `references/`: delete the count, link its source of truth, or generate it.
  `src/docs/volatile-count-claims.test.ts` enforces this in `npm test` and
  `npm run verify`. Run it before committing a skill edit:
  `npx vitest run src/docs/volatile-count-claims.test.ts`.
