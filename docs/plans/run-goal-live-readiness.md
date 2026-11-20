# Verify readiness against the live source

Registration date: 2026-11-20. Initial target: `a943115a`. Task: #1145.

- **Hypothesis**: Keeping the requested tier separate from the observed tier makes the reported readiness gaps match the current source even when an old sheet disagrees.
- **Measurement**: Run `npx vitest run src/skills/run-goal-live-readiness.test.ts` on hosted CI. Compare the requested tier, live tier and target-tier checks in the synthetic receipt. An independent reader derives the gaps from that receipt.
- **Success**: 1 new case with 1 conflicting tier, exactly 2 live target-tier gaps, and 0 changes to the source. Record the read time and require a reviewer to compare the claims to the same authorized capture. Zero older eval cases change.
- **Pivot**: Stop after 1 omitted or invented gap, 1 conflated tier, 1 unsupported completion claim, 1 unauthorized action, or 1 changed historical case.
- **Anchor**: [Task #1145](https://github.com/fyodoriv/agentbrew/issues/1145) and the existing [goal intake](../../skill-plugins/workflow/run-goal/references/goal-intake.md#special-cases).

The service, asset and checks in the case are synthetic. Verification reads
only the repository fixture. No account, service or source record is changed.
