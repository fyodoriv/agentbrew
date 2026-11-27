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
