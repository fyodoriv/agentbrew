# Read the finished worker's evidence before waiting again

Registration date: 2026-11-20. Initial target: `f5459a03`. Task: #1155.

- **Hypothesis**: An explicit handoff rule can distinguish a finished report from a live wait or missing evidence. A bounded review can preserve independence and use the same authorized sources.
- **Measurement**: Run `npx vitest run src/skills/run-goal-finished-worker.test.ts` on hosted CI. Verify the three synthetic dispositions for a finished report, a live worker, and unavailable report evidence. Require a review brief with 2 rounds per judge, the authorized source list, and a source reference for each verdict claim.
- **Success**: The 3 dispositions match. A finished worker's report is read before any more waiting. There are 0 repeat waiting messages for unchanged input, at most 2 rounds per judge for the same review, and 0 unsupported claims counted as proof. Existing eval cases remain unchanged.
- **Pivot**: Stop after 1 false wait, 1 missed real blocker, 1 unauthorized source read, 1 extra judge round, or 1 altered historical case.
- **Anchor**: [Task #1155](https://github.com/fyodoriv/agentbrew/issues/1155) and the existing [quiet external wait](../../skill-plugins/workflow/run-goal/references/external-waits.md#start-or-reuse-an-owned-wait).

Use invented reports and source labels. The test checks the written guidance
and synthetic eval. It does not read real worker transcripts or change host
watch behavior.
