# Restore existing run-goal eval ordering

- **Hypothesis**: Moving eval 400 to the end restores the previous ordered eval list while keeping the new scenario. The 11 failed integrity tests pass.
- **Measurement**: Run `npx vitest run src/skills/run-goal-live-task-intake.test.ts src/skills/run-goal-owner-and-proof.test.ts src/skills/run-goal-recipe-status-evals.test.ts`. Compare the repaired array minus its final item with the last pre-merge array. Compare eval 400 with its merged object.
- **Success**: Zero failing tests, zero changes to the previous evals and exactly one unchanged copy of eval 400.
- **Pivot**: One failing test, one changed previous eval or an absent or modified eval 400 rejects the move. Inspect the next failing assertion before editing.
- **Anchor**: [Linux job for PR 1177](https://github.com/fyodoriv/agentbrew/actions/runs/44682934959/job/136110399143) and the existing ordered-prefix integrity tests.

PR 1177 inserted the new case at index 1. The existing tests check the
order and content of earlier cases. New cases go at the end of the array.
