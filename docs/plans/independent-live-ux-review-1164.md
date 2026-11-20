# Require independent live UX review

[Issue #1164](https://github.com/fyodoriv/agentbrew/issues/1164) asks for an
independent UX decision before review requests and UI goal completion. The
existing design panel and browser rules provide the review procedure.

- **Hypothesis**: Cover both missing hold points, from 0 of 2 to 2 of 2.
  Preserve the ordinary delivery path when a goal changes no interface.
- **Measurement**: Run `npx vitest run src/skills/run-goal-live-ux-review.test.ts`
  and the existing run-goal budget checks. Check the new skill eval for
  green automated checks, a failed UX verdict, and a later independent pass.
- **Success**: All three controls pass. A FAIL holds the review request
  and completion. A current PASS allows the ordinary review path.
  The non-UI path still uses its existing gate.
- **Pivot**: Any premature request, stale PASS accepted after a fix,
  extra gate for non-UI work, or skill budget failure rejects the patch.
- **Anchor**: [Issue #1164](https://github.com/fyodoriv/agentbrew/issues/1164)
  and the current principal design panel in `ui-ux-rankings`.
