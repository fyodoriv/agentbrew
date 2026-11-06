# Fast gate: strict task schema and conflict checks

Register before regression or script edits. Scope is the existing changed
verification script, its execution fixture and documentation. Keep full-gate
routing, source limits, test oracles and all owner security controls.

## Problem and hypothesis

The fast gate runs a task priority check, but omits the pinned strict parser
used by the full gate. A real new task passed the fast gate, then failed the
full parser because its parent checkbox/title was absent. A separate staged
conflict also passed a documentation-only gate. Those are boundary defects;
a source-file diff still requiring a full gate does not protect task-only PRs.

Predict four invalid-input false approvals to zero, retaining both valid
controls. Reuse `npx --yes @tasks-md/lint@0.10.2 --require-prereg TASKS.md`
and `git diff --check "$base"`; do not add a parser, change the pinned version,
ignore input or relax merge-ready classification. Failure must stop before
later test helpers and before the final success verdict.

## Frozen input and observation contract

Four invalid variants: orphan fields without a parent task; two distinct
checkbox tasks with the same ID; a P1 task missing Hypothesis; and Git conflict
markers in a tracked task-file edit. Two valid variants: a complete P1 task
with every existing field and a valid empty queue. Freeze full bytes before
baseline. Other standard checks are successful fixture stand-ins. The strict
schema check must invoke the actual pinned CLI offline, not a parser stub.

Each fixture is a real scratch Git repository with a tracked clean baseline
and a subsequent task edit. Run the real verification shell script. Record
exit status, exact schema command invocation, downstream sentinel presence and
merge-ready output. The baseline must complete rather than fail on missing
fixture tools. A missing cached tool or fixture setup failure is not RED.

The script/execution fixture may stub unrelated successful checks. Existing
dry-run and source/full-routing tests stay unchanged. This evidence proves
wiring and fail-closed gate behavior; it is not a new upstream parser or a
model-quality result. Private owner files and real customer data are excluded.
Mutable scratch state belongs to one test case and is cleaned after it.

## Measurements and thresholds

```sh
JOBS=1 heavy-run npm exec -- vitest run src/verify-changed.test.ts --maxWorkers=1
```

Run RED against the unchanged verification script, inspect the exact four
false approvals, then keep the fixture assertions while adding the existing
checks. Success requires all six decisions, zero downstream execution after
invalid input, and all earlier routing/reader tests. Any unsafe approval or
valid refusal rejects the method. Follow focused proof with independent
review and the normal repository gates; a dry-run listing alone is insufficient.

Anchor: the existing full task gate; [Git diff check](https://git-scm.com/docs/git-diff);
Basili, Caldiera and Rombach (1994), GQM; Munafò et al. (2017), preregistration.
Estimate: active effort 30–60 minutes plus normal gate and queue time. Do not
merge this pipeline change ahead of runtime PRs already qualifying if that
would force unnecessary whole-suite repeats.
