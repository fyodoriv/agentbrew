# Accept explicit incomplete goal results

- **Hypothesis**: The five incomplete results in the task pass the claim
  classifier while each existing success claim still requires judging.
- **Measurement**: Run `timeout 120 heavy-run bash hooks/checks/goal-judge-claims.test.sh`.
  Record the five exact rows before implementation, then rerun the same fixture
  and the packaged Stop route in hosted CI.
- **Success**: All five newly reproduced incomplete lines allow. All existing
  classifier and prompt assertions pass. Added success variants with the same
  punctuation still require judging.
- **Pivot**: If one earlier claim can pass, keep the stricter classifier and
  improve its hint instead.
- **Anchor**: Nygard, *Release It!* (2018), and
  [the current goal claim classifier fixture](https://github.com/fyodoriv/agentbrew/blob/110544b4bb2c19df4048211864c0161000db0417/hooks/checks/goal-judge-claims.test.sh).

The task names a possessive apostrophe, a PR number, an approval reason
after a colon, a criterion range, and an explicitly low judge score.
Use those exact cases. Preserve the existing treatment of bare scores,
completed totals, and success claims inside or after incomplete statements.
