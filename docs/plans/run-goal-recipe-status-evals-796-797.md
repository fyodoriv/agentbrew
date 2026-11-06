# Evidence-based recipe and status eval composition

## Prediction

- Hypothesis (GQM): correcting the two contributed cases removes unsupported diagnosis and unconditional status-driven tool calls. Keep all earlier cases unchanged. The combined candidate has zero duplicate IDs and zero cases below the existing three-check minimum.
- Measurement: `heavy-run npm run verify:changed -- e0cf8c0759a8fc60835d0c4a418dd2724c6b1551`. Before corrections, inspect each contributed case with the existing validator contract in `src/skills/validate.ts`; compare the first 241 case objects with the base. The same gate must pass after corrections.
- Success: zero schema failures; zero duplicate IDs; all 241 earlier cases unchanged; both distinct new cases retained. The status case has at least three independent checks covering reply, continuation/wait and verified completion.
- Pivot: any lost earlier case, duplicate ID, schema failure, unsupported causal assertion or required busy polling rejects this composition. Investigate the actual assertion before another change.
- Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al. (2017), pre-registration; repository validator contract and the existing quiet external-wait procedure.

## Scope and provenance

Main starts at `e0cf8c0759a8fc60835d0c4a418dd2724c6b1551`. Preserve author commits `df5b3489f2b6be298b239e1687696fdd06da6070` (PR796) and `0812f0e7143af9baa13938053449437f592c5c20` (PR797) through normal merges. Keep the recipe case as242 and status case as243. Recheck public heads before delivery.

Recipe diagnosis must follow supplied observations. A specific import or publish-hash defect cannot be presumed from the request alone. Saved artifacts and configured memory follow the user's correction; persistence needs readback.

A status nudge is steering within the active goal. Answer briefly, then continue actionable work. When only a verified external wait remains, reuse the supported quiet-wait route. A printed check line does not establish completion; original criteria still need fresh evidence. No host scheduling or live model agreement is established by schema/fixture checks.

This changes only skill guidance and eval data. Existing guidance is its documentation. No runtime or host behavior change is claimed. The docs-only prediction is gated and committed before behavior corrections. Final independent review and normal delivery checks remain required.

## Allocation supplement after upstream PR799 (2026-11-06)

Main `2b8e1a56b38a3b89018b4e1e5065efb3abb41ba2` includes the unchanged
PR799 cases243 and244. The status case must move from243 to245 to retain
those objects. This is a no-op metadata move covered by the existing schema
gate, exempt from a new semantic prediction. Prediction31adcc39 and its
success/pivot thresholds remain unchanged. State this exemption in the final
commit. Preserve the earlier prefix, both contributor prompts, all six
semantic guards and the exact upstream objects. Only allocation metadata
assertions change; upstream-object hash guards strengthen preservation.

Before the one-field ID move, run the same focused tests against the composed
candidate with status243: expect duplicate-ID/schema and expected245/got243
failures only, with all semantic guards passing. Then change only that status
ID to245 and rerun the unchanged tests; require zero schema/ID failures and
all focused guards passing. Use `heavy-run npm exec -- vitest run
src/skills/run-goal-recipe-status-evals.test.ts
src/skills/run-goal-external-waits.test.ts --maxWorkers=1`. This is source and
schema evidence, not a live model or host evaluation. Earlier13/13GREEN
remains bound to its original255daa99 composition, not this new main.

The follow-up `eval-id-composition-observation` in TASKS.md registers a
measurement-first preparation task. It does not claim a collision-prevention
mechanism or an existing observation harness.
