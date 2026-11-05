# Delivery-session goal eval (#775)

## Prediction before changes

Goal: retain the user's explicit request for one new delivery chat while
coordinating all owned open PR work. Question: does the eval cover inventory,
scoped delegation and safe recovery of a dead session binding?

Add eval234 after checking the live maximum and reserving233 for issue774.
The synthetic fixture spans related repos, existing live chats, a conflicting
registry record and both authoritative terminal/missing-handle outcomes.
Unknown status must not authorize retirement or duplicate PR ownership.
This adds no new runtime feature, settings or schema.

Hypothesis: three missing deterministic eval-contract checks fall from three
to zero after adding the self-contained scenario. Freeze and run the guard
before changing evals. A missing dependency or fixture setup error is not a
semantic red. The checks validate the declared scenario, not actual agent
behavior, chat creation or a live registry recovery.

Measurement from the repo root with qualified dependencies:

```sh
JOBS=1 heavy-run npm exec -- vitest run src/skills/run-goal-eval-234.test.ts --maxWorkers=1
JOBS=1 heavy-run npm run verify:changed
```

Success: zero focused failures, all owned PR links present in the single
new-chat brief, existing-chat handoff required before conflicting delivery,
and authoritative dead-host evidence required before ending only the stale
record with a handoff note. Pivot on any missing scope or unsafe recovery,
including timeout/age alone treated as proof of death, or a second chat used
to evade the bind. Preserve tool-unavailable truth. Run the repo-required
verification before delivery; no live session or registry action is part of
this eval patch.

Commit this docs-only prediction after its changed gate, before test/eval
implementation or results. Keep the original failed guard and repeat the
same assertions after the eval is added. Root owns publication.

Anchor: Basili, Caldiera and Rombach (1994), GQM; Munafò et al. (2017),
preregistration. Issue775 supplies the inventory, single-session handoff and
confirmed-dead-record recovery requirements.

## Focused evidence

The unchanged eval registry failed all three new contract checks. Adding the
scenario passed the same frozen assertions. This validates the fixture and
expected outcomes only; no chat was created and no registry was modified.
