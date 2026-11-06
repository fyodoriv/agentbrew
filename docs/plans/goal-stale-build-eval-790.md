# Goal stale-build evaluation

Issue #790 describes a goal that fast-forwarded a checkout but synced an old
CLI build. The report is one incident, not a measured recurrence rate.

Goal: make the stale-build handoff independently gradeable. Question: does a
synthetic goal name the rebuild and its prerequisites before its contract,
sync only after rebuilding, and park a blocked download once? Metric: one
registered case contains all five issue outcomes and a fresh-context judge
accepts all five without inventing a completed rebuild.

Predict 0/1 to 1/1 registered cases. Measure with `jq -e '.evals[] |
select(.id == 257) | (.expectations | length >= 5)'
skill-plugins/workflow/run-goal/evals/evals.json`, the repository skill gate,
and independent judgment. Success requires the case and all five outcomes;
any missed outcome or false completion rejects the scenario. This measures
the evaluation artifact, not live agent reliability.

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et
al. (2017), preregistration; the reported incident in #790.
