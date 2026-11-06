# Deployment readback evidence experiment

Issue #811 records one strict readback failure when a managed source advanced.
The failure remains part of the evidence; the later readback was separate.

Goal: distinguish exact revision from inspected content provenance. Question:
can a fixed synthetic matrix preserve the failure while rejecting uninspected
or inconsistent states? Metric: the five registered cases classify exact
match, inspected descendant, non-ancestor, pin mismatch and unavailable
evidence correctly. No case changes a source or claims unknown bytes match.

Predict 0/5 to 5/5 registered controls. Measure with `jq -e '.evals[] |
select(.id == 258) | (.expectations | length >= 5)'
skill-plugins/workflow/run-goal/evals/evals.json`, the repository skill gate,
and a fresh independent review of each case. Success requires all five and
preserved failure evidence. Any false qualification, suppressed failure or
source reset rejects the guidance. This is a manual evidence procedure and
synthetic evaluation, not an automatic classifier or live deployment result.

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et
al. (2017), preregistration; the original and subsequent receipts in #811.
