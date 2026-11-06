# PR 801: live task selection before a goal contract

Register before target regression code or measurements. The fixture and
commands below are proposed checks, not executed results.

## Source and provenance

Author head: `b2e738f9f7d720e84ff2d77d216dcf589cc130d6`.
Current main: `a5560dea81f3fb60a7e9de2d5b8b85bbc1ed115b`.
The author preserves every existing eval object from source base
`2b8e1a56b38a3b89018b4e1e5065efb3abb41ba2`.

Retain the original prompt as provenance:

> /goal implement all unblocked tasks in this repo. Synthetic scenario: the agent runs in a worktree created two days ago; origin/main has since closed three of the tasks and added two new ones.

The original expectations require fetching, reading `origin/main:TASKS.md`,
omitting the closed tasks and including the additions. They do not supply
task identities. Current main already assigns 245 to the status case.
Allocate the new case as 246 only after another live default-branch check.

Preserve the current first-245-object JSON.stringify SHA256:
`74399b8e25d08d78f26587fac484820b7932e4887d34ccc4a73f70a0303b5ffc`.
This includes the current corrections to recipe 242 and status 245. Do not
restore the author's stale recipe object from its base during composition.

## Scope

Keep this as intake-evaluation coverage. Do not build a task synchronizer,
change task backends, delete local work, or claim that fixture guards prove
live agent selection or model-call savings.

The synthetic fixture names a tasks-md backend, a discovered remote and a
discovered non-main default branch. Expected behavior first discovers the
declared backend and upstream/default ref, then reads that authoritative
source before contracting. It does not assume TASKS.md or origin/main for
every repo. An issue backend uses its declared issue CLI; this correction
does not need a second backend fixture or a network implementation.

Freeze these concrete synthetic controls:

| Control | Local unblocked IDs | Fresh authoritative read | Required intake result |
| --- | --- | --- | --- |
| stale | old-a, old-b, old-c, keep-d | keep-d, new-e, new-f | keep-d, new-e, new-f; none of old-a/old-b/old-c |
| already current | keep-d, new-e, new-f | keep-d, new-e, new-f | Same identities; fresh source provenance still required |
| unchanged | keep-d | keep-d | keep-d; no invented additions or closures |
| unavailable | old-a, old-b, old-c, keep-d | Explicit fetch/read failure | Current selection unverified; report failure; no stale list presented as fresh |

No fixture grants destructive cleanup. Preserve local changes and separately
reconcile owned work already in progress. An unavailable freshness check does
not permit dropping the broad goal or declaring completion.

## Hypothesis, measurement and thresholds

Goal → Question → Metric: intake evals must discriminate stale and current
task evidence. Can the schema and source contracts admit this contribution
without losing prior cases, duplicating IDs or using an ungradeable oracle?

Predict zero schema, identity, preservation and fixture-contract violations
against the frozen matrix after correction. Predict that the historical
recipe/status preservation guard accepts a valid additive eval; its current
closed-tail length assertion rejects every addition. These are coverage and
composition outcomes. Live agent error rate remains unmeasured.

Success requires every registered contract assertion to pass, every control
to be explicit and independently decidable, zero duplicate IDs, every prior
object to match its frozen prefix, and acceptance of a valid addition while
a historical-object mutation remains rejected. Required repo gates exit zero.

Pivot away from this representation if any control lacks decisive input,
if correction requires relaxing schema, uniqueness or preservation, or if no
discriminating RED can be produced. A JSON parse is not a behavioral measure.
A live model-selection claim needs its own registered forward evaluation.

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric;
Munafò et al. (2017), pre-registration and reproducibility.

## RED and correction order

1. Commit this prediction before target regression code or new fixture
   measurements. Follow normal pre-commit checks. Do not relabel the author's
   already observed JSON parse as a prospective result.
2. Add a focused source-contract regression for the new case and matrix.
   Confirm missing-fixture/contract RED against unchanged main guidance/data.
3. Compose the author's contribution normally, with a separate no-op ID
   allocation correction. Preserve every original prior case. Before fixing
   the historical guard, capture its false refusal on the valid new case:
   expected length 4, received 5.
4. Correct only the closed-tail scope at
   `src/skills/run-goal-recipe-status-evals.test.ts`: bind preservation to the
   historical `slice(241,245)`, rather than every future tail entry. Keep the
   schema, unique-ID, semantic and upstream-hash assertions. Add a regression
   that accepts additions and rejects a changed historical object. Do not
   remove preservation to make the new case pass.
5. Correct the contributed case with concrete synthetic input and expected
   outcomes. Update the linked intake reference only if needed to state the
   fresh authoritative read. Do not expand SKILL.md's size.
6. Run focused GREEN and the required gate. Keep RED and GREEN logs with
   exact source revisions, hashes and real exit receipts.

## Commands and gate scope

After the prediction commit and proposed regression exist:

```sh
test -f src/skills/run-goal-live-task-intake.test.ts
JOBS=1 heavy-run npm exec -- vitest run src/skills/run-goal-live-task-intake.test.ts src/skills/run-goal-recipe-status-evals.test.ts --maxWorkers=1
JOBS=1 CARGO_BUILD_JOBS=1 VITEST_MAX_WORKERS=2 LOCKFILE_SYNC_NPM=npm@10.9.2 heavy-run npm run verify:changed
```

The author's eval-only path can use the repo's merge-ready changed-file gate.
Correcting a src test means the composed candidate is not docs-only. Unless
that independently qualified base correction lands first, the final candidate
also needs:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 VITEST_MAX_WORKERS=2 LOCKFILE_SYNC_NPM=npm@10.9.2 NO_CACHE=1 heavy-run npm run verify
```

The delivery orchestrator owns composition and publication. The PR body needs
the registered hypothesis, required validation headings, terminal proof and
the agent attribution footer. Remove tool-specific generated attribution.

## Focused qualification record

Prediction commit `b6466ed` preceded the target regressions. Against its
unchanged data, the focused cohort reported 5 failures and 8 passes: every
failure identified the missing registered case 246. After normal composition
of author `b2e738f9`, allocation 245 → 246 preserved the author's new object
apart from that identifier and retained the frozen historical prefix.

The unchanged historical preservation guard then reported 1 failure and 5
passes, with `expected length 4, received 5` at its closed-tail assertion.
Its correction bounds that historical slice without changing its threshold,
upstream object hashes, schema checks or semantic assertions.

Before GREEN, review identified that putting selection decisions beside the
actor's source snapshots would disclose the answers. The registered control
values stayed unchanged; actor input now contains only source evidence, and
the decision oracle lives in grader-only `expected_output`. A separate guard
rejects answer keys in the actor prompt. This representation correction was
approved before measuring GREEN.

The focused cohort then passed 14 checks with actual exit zero. These checks
qualify fixture evidence, historical preservation and guidance contracts.
They do not establish live selection accuracy, checker scheduling gains or
completed full qualification. Original source serialization was retained so
the historical objects have no unrelated escaping changes.

The first full qualification stopped at Biome before its test suite ran.
Build and typecheck passed. Biome required the new prefix-hash expression to
wrap its chained calls; a targeted check reproduced that formatting error.
Only that line wrapping changed. The unchanged focused assertions then
passed again, and targeted Biome exited zero. The failed full result remains
retained; it is not a full-gate pass.
