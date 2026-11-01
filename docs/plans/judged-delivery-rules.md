# Judged delivery rules experiment

## Hypothesis

Goal: prevent unproved feature claims and drafts that commit the user.
Question: can optional rules deploy all requested safeguards through existing sync?
Metric: missing safeguards fall from six to zero in
`npx vitest run src/sync/judged-delivery-rules.test.ts`.

## Measurement

Run that contract and sync test, then `npm run verify:changed` and the full
`npm run verify` when required by the changed gate.

## Success

Keep when all six rule contracts pass and the enabled rule text reaches the
scratch target agent file; all required repo gates exit 0.

## Pivot

Abandon text-only delivery if any rule cannot be selected and synced, or if
review finds a missing approval boundary. Move enforcement to the existing
readiness owner rather than adding another parallel workflow.

## Anchor

Basili, Caldiera, Rombach (1994), Goal Question Metric: measure the requested
behavior against an explicit goal. These contracts measure availability and
routing; they do not claim measured human compliance.

## Scope

Issues #640, #655, #657, #658, #659, #661. Optional catalog rules reuse rules
sync. Core review-pr guidance owns the draft judge and readiness references.
No org-specific content, new state, or new external service is needed.
