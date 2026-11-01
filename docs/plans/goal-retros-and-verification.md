# Goal-retro and verification experiment

## Hypothesis

Goal: preserve runtime, permission and deployed-state lessons in the owned
workflow sources. Question: do the requested scenario cases exist and do the
instructions handle them? Metric: all applicable scenarios from issues #636,
#637, #643, #654, #666 have an explicit eval expectation, with zero duplicate
ids; #663 preserves correction and issue filing before handoff, #665 owns
verification in core, and #667 uses browser proof for whole-line bold.

## Measurement

Run `npm run verify:changed`, JSON parsing of the changed eval files, and
`npx vitest run src/skills/run-goal-evals-loop-counts.test.ts`.

## Success

All requested scenarios covered exactly once or linked to an existing case;
the changed gate exits 0 with merge-ready. Eval cases are test inputs for
future agent runs, not claims that an agent benchmark already passed.

## Pivot

If a requested case contradicts current approval boundaries, preserve those
boundaries and rewrite the scenario rather than training unsafe behavior.
If a command cannot determine a repo gate safely, stop with an explicit
unsupported-project result instead of guessing commands.

## Anchor

Basili, Caldiera, Rombach (1994), Goal Question Metric. Coverage is a structural
metric only. It does not measure task success without running the agent eval.
