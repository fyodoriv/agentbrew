# Goal plan artifact prediction

- **Hypothesis:** Requiring a visible plan at goal start and updates to the same artifact at milestones makes goal progress reviewable throughout the run.
- **Measurement:** `npx vitest run src/skills/run-goal-plan-artifact.test.ts` checks the workflow and three scenario evaluations, including resume and private-output fallback.
- **Success:** All checks pass and the three evaluations require an initial plan, milestone updates, and reuse of the same artifact.
- **Pivot:** If any scenario cannot use an output artifact, use a private local report and name the availability gap; do not block goal work or claim it was published. If any check fails, revise the workflow before shipping.
- **Anchor:** User instruction on 2026-11-12: start goals with a plan artifact in outputs and update it at every milestone. Existing goal contract ordering is in `skill-plugins/workflow/run-goal/SKILL.md`.
