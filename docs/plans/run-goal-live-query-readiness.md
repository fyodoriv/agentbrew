# Keep unverified dashboard queries open

Registration date: 2026-11-20. Target: `643e1b5d`. Task: #1207.

- **Hypothesis**: The existing served-output check can distinguish green CI and a passing test-environment query from a checked query in the environment that contains the target data. A synthetic target query with one dropped row must still hold the review request.
- **Measurement**: Run `npx vitest run src/skills/run-goal-evals-source-count.test.ts` on hosted CI. Verify the chosen environment, source IDs, returned IDs, reported discrepancy, required evidence, review hold, and an independently read fixture. Verify that all pre-existing evals remain in order and unchanged.
- **Success**: 1 new case. Exactly 1 eligible target row is missing and the test environment has 0 missing rows. The expected response requires the approved target query, identifies the mismatch and keeps the review request open. Zero existing eval cases change.
- **Pivot**: Stop after 1 wrong environment, 1 missed row, 1 claim of readiness while the query is unchecked, 1 unauthorized operation, or 1 changed historical case.
- **Anchor**: [Task #1207](https://github.com/fyodoriv/agentbrew/issues/1207) and the existing [served-output checks](../../skill-plugins/workflow/run-goal/references/execution.md#served-output).

The fixture uses invented environment names and rows. The gate verifies the
skill and the eval contract. It does not contact a telemetry service.
