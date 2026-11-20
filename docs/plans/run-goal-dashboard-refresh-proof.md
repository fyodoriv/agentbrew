# Prove a deployed dashboard refreshes its data

Registered on 2026-11-20. Initial target: `a8d04af5`. Task: [#1042](https://github.com/fyodoriv/agentbrew/issues/1042).

- **Hypothesis**: Requiring a working refresh method and a fresh read of served values keeps delivery open when a dashboard serves an old snapshot.
- **Measurement**: Run `npx vitest run src/skills/run-goal-dashboard-refresh-proof.test.ts` on hosted CI. Independently derive freshness from the synthetic panel's as-of time and the refresh evidence for both paths.
- **Success**: Keep the snapshot-only case open. Accept one completed authorized refresh and one observed served-panel age of at most 30 minutes. Preserve both values and the read time in the proof. Change zero earlier cases.
- **Pivot**: Stop after one acceptance with an absent refresh, stale timestamp, or missing served readback. Also stop after one unexpected live action or changed historical case.
- **Anchor**: [Task #1042](https://github.com/fyodoriv/agentbrew/issues/1042) and the existing [served-data checks](../../skill-plugins/workflow/run-goal/references/execution.md#served-output).

The dashboard, refresh and panel results are synthetic. This evaluates
freshness rather than the separate row-count or target-environment checks.
