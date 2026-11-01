# Trusted rule rewrite provenance experiment

## Record integrity

This clean record preserves the prediction first written in local commit
0e31920. That commit used a hook override and will not be published. Before
this replacement record was checked and committed normally, the author had
already observed one failing stale-rule fixture and two passing manual-edit
controls, edited an implementation, and started a narrow check. That work is
preserved separately and stopped. This replacement does not claim a fresh,
unseen baseline. Further implementation waits for this record's normal gate
and commit. The final combined source still requires its normal full gate.

## Hypothesis

Goal: removed checkouts leave no source-owned instructions after automatic
deduplication. Question: can a trusted rewrite update hashes only for blocks
whose pre-rewrite bodies still match their recorded hashes? Metric: one
apply → sync/dedupe → remove checkout → sync fixture changes from one stale
block to zero. Two manual-edit controls retain their text and never acquire
a hash for an edited body.

## Measurement

`npx vitest run src/sync/stale-team-rules-repro.test.ts`

The fixtures use real scratch Agentfiles, saved state, and sync. The automatic
rewrite fixture changes source rules before the second apply so that applying
the first source introduces a short line also present in the second source.
This exercises deduplication after both sources have captured their hashes.

## Success

Zero stale owned blocks after checkout removal; both manual-edit controls
remain intact. All three composition fixtures pass. The final combined
agentbrew source must also pass its required full gate.

## Pivot

Abandon a refresh that retains at least one generated stale block, deletes
at least one manual edit, or refreshes at least one already-mismatched hash.
Keep unknown or modified content rather than adopting it as generated.

## Anchor

Basili, Caldiera, and Rombach (1994), Goal Question Metric; Munafò et al.
(2017), pre-registration. A before/after composition test measures the
lifecycle behavior rather than testing only the hash helper in isolation.
