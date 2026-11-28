# Keep live hook criteria open through installation

**Hypothesis:** The existing release case will require both decisions:
record a known operator approval in the initial contract and hold the live
criterion until the installed copy is verified.

**Measurement:** Run `npx vitest run src/skills/run-goal-live-hook-proof.test.ts`
in hosted CI. Compare eval 428 and the delivery guidance with the baseline.
Check an independent answer to the simulated case.

**Success:** Both decisions are explicit. Eval 428 still covers manifest
validation, signed install, and installed behavior. All other evals stay
unchanged, and the hosted fixture passes.

**Pivot:** If 1 prior release check is lost or a reader counts a merge as
live proof, leave the issue open and tighten the guidance.

**Anchor:** [Issue 1350](https://github.com/fyodoriv/agentbrew/issues/1350)
and [existing installed-evidence coverage](https://github.com/fyodoriv/agentbrew/pull/1318).

## Operator handoff check

Two initial scratch answers named the operator approval without placing it
under the existing `Needed from you` label.

**Hypothesis:** One explicit sentence beside the capability prompt will
put the approval under that label in a fresh simulated delivery.

**Measurement:** Check that the hosted contract test requires the label.
Give a fresh reader the signed-release scenario and the skill, without the
expected answer. Count the five existing expectations in eval 428.

**Success:** The new contract check passes and the fresh response meets
all 5 expectations, including the labeled operator action. The eval is
unchanged from the initial candidate.

**Pivot:** If 1 expectation remains unmet, leave issue #1350 open and
record the gap. Keep the already verified installed-proof guidance.

**Anchor:** The operator handoff expectation in eval 428 and the
`Needed from you` rule in the run-goal skill.
