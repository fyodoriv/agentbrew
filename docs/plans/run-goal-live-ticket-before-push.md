# Check the current ticket before the first push

Registered on 2026-11-20. Initial target: `d4a52ad2`. Task: [#1022](https://github.com/fyodoriv/agentbrew/issues/1022).

- **Hypothesis**: Reading the ticket tracker before first push keeps a finished ticket from failing an in-progress-only pull request check.
- **Measurement**: Run `npx vitest run src/skills/run-goal-live-ticket-before-push.test.ts` on hosted CI. Independently derive the allowed ticket, order of actions, and fallback from the synthetic tracker and gate receipts.
- **Success**: Refuse the one Done ticket. Read back one approved replacement in progress with the correct owner before the simulated first push. Name that ticket in both delivery titles. Hold push when permission is missing. Change zero earlier cases.
- **Pivot**: Stop after one push with a stale ticket, one unauthorized tracker change, one missing readback, one title with the old key, or one changed historical case.
- **Anchor**: [Task #1022](https://github.com/fyodoriv/agentbrew/issues/1022) and the goal intake’s existing ticket gate.

The tracker, gate, state changes and push are simulated. The existing eval
for a wrapper that masks a gate failure remains in the corpus.
