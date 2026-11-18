# Keep the concurrent chat receipt test within a fixture-owned watchdog

During the [build guard gate](https://github.com/fyodoriv/agentbrew/actions/runs/44204695450/job/134467513176),
the concurrent fixture expected exit statuses 0 and 1. It received 1 and
null. The test wrapper kills children after 3.8 and 4.2 seconds and only
reports the numeric exit status. No changed code from the build guard
participates in this fixture. The record does not identify the signal or
why the successful child missed the deadline.

- **Hypothesis**: A fixture that holds one claimant inside a fake
  request can check that the other claimant exits 1 while the winner
  remains active. A separate bounded watchdog leaves time for a slow
  runner and reports an actual signal if the child is interrupted.
- **Measurement**: Run the concurrent fixture once with a forced 4.5
  second fake request delay, on the existing watchdog and on the
  candidate. Repeat the normal named fixture 20 times on hosted Linux,
  then run the complete receipt and schema checks.
- **Success**: The baseline fails with a terminated child. The candidate
  finishes 1/1 delayed and 20/20 ordinary runs with exit statuses 0
  and 1, four generation requests, and two metadata requests. The
  existing timeout and receipt controls all pass.
- **Pivot**: If either child can publish twice, the contender can pass
  before the winner reserves the fixture receipt, or any repetition
  fails, retain the control and leave this change open.
- **Anchor**: The hosted assertion at
  `scripts/eval-chat-message-rule-821.test.mjs:328` and the existing
  exclusive receipt tests.

Keep all model transport fake. The registered model decision protocols,
production evaluation, and real receipts do not change.

## Hosted result

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44207442869)
reproduced statuses 1 and null with a forced 4.5 second delay. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44207865828)
passed the same delay, all 20 ordinary runs, 16 receipt controls and ten
schema controls. The second child must now report the exclusive open
conflict on the exact scratch receipt while the first is paused. Only
the first may finalize it. The original uncontrolled runner delay
remains unexplained.
