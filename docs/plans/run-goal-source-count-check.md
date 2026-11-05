# Dashboard source-count verification (#774)

## Prediction before changes

Goal: prevent a clean dashboard query from being treated as proof that its
headline counts are correct. Question: does the goal require comparison with
the system being counted? Extend the existing run-goal Served output guidance,
not a new skill or dashboard engine.

Hypothesis: the focused deterministic contract has three missing requirements
on the unchanged skill/evals. Add a source-count done-criterion and one
self-contained undercount eval to reduce those failures from three to zero.
The existing served-output requirement must stay passing. The fixture shows
Requests5 versus six raw request events, including one valid request with no
requester name; Resolved2 is correct. Query/filter execution still passes.

Measurement, from the repo root with its qualified dependencies:

```sh
JOBS=1 heavy-run npm exec -- vitest run src/skills/run-goal-evals-source-count.test.ts --maxWorkers=1
JOBS=1 heavy-run npm run verify:changed
```

Commit this prediction after the docs-only changed gate, before adding the
test, eval or skill change. Freeze the focused test and run it against the
unchanged skill/evals before implementation. Preserve that semantic red and
repeat exactly after the fix. Missing dependencies or test setup are not a
behavioral baseline.

Success: zero focused failures, the existing served-output control still
passes, and the required changed gate passes. Pivot on any failed requirement
or loss of the existing control. Do not weaken the fixture or substitute
"every query runs" for the source comparison.

The eval fixture and deterministic guard prove contract coverage only. They
do not prove an agent or a live dashboard performed the cross-check. No live
source access, model call, owner data change or dashboard mutation is part of
this patch. Source-unavailable outcomes must stay unverified, not inferred.

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric;
Munafò et al. (2017), preregistration. Product evidence: issue774 describes
an independent source comparison finding a missed request after all queries
ran clean. The existing Served output reference owns this verification step.
