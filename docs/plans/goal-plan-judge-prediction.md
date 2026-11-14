# Goal plan reviewer prediction

- **Hypothesis:** A dedicated independent review procedure will distinguish a
  visible, timely, continuously updated goal plan from unsupported claims.
- **Measurement:** `npx vitest run src/skills/run-goal-plan-artifact.test.ts`
  and independent review of the procedure and scenario expectations.
- **Success:** All focused checks pass; the review covers missing output,
  unverifiable order, a replaced plan, missing milestone evidence, and the
  authorized private fallback without treating unknown evidence as a pass.
- **Pivot:** Revise or withdraw the procedure if any of those five cases is
  accepted incorrectly, or if it blocks the authorized private fallback.
- **Anchor:** The goal report requires one visible plan after the contract,
  before execution, updated at each milestone; its documented private
  fallback must not block work (`skill-plugins/workflow/run-goal/references/goal-report.md`).
- **Scope:** This changes the source-owned goal workflow. The external native
  goal evaluator has no tool access and is not changed by this work.
