# Record MCP checkout lag probe outcomes when its test fails

On Nov 20, 2026, [macOS job 136187967909](https://github.com/fyodoriv/agentbrew/actions/runs/44706661566/job/136187967909)
expected one lagging checkout in `src/mcp/git-checkout-lag.test.ts:87`
and received none. Its assertion had no child outcome. The same fixture
passed under an isolated local environment. Keep the cause unknown.

- **Hypothesis:** A test-only receipt identifies which Git probe call exited, timed out or failed without exposing the Git arguments, path or child output.
- **Measurement:** Run `npx vitest run src/mcp/git-checkout-lag.test.ts`. Confirm the actual fixture receives the original results and exercise 5 synthetic outcome classes.
- **Success:** All 5 synthetic classifications match. The real fixture still passes and invokes the existing bounded offline probe. The displayed receipt has 0 input canary strings.
- **Pivot:** Stop if 1 production command, option, timeout, test decision, or private input changes when the recorder is attached.
- **Anchor:** The [hosted macOS assertion](https://github.com/fyodoriv/agentbrew/actions/runs/44706661566/job/136187967909) and the bounded offline probe in `src/mcp/git-checkout-lag.ts`.

The five classes are successful exit, nonzero exit, timeout, another
spawn error, and signal. The test reports the call position, operation
category and outcome. It does not emit the child error text, command
arguments, environment, or output. Keep the original assertion.

## Identify the expected checkout across enumeration order

- **Hypothesis:** Every observed call identifies its known fixture role. A failure can distinguish the expected behind checkout from intentional negative controls.
- **Measurement:** Run `heavy-run npx vitest run src/mcp/git-checkout-lag.test.ts` and the registered fixture with an isolated synthetic tracking timeout for the behind checkout.
- **Success:** All 9 natural probe receipts have known roles, the expected behind fixture has 2 real calls, the injected failure names the behind tracking timeout, and 0 fixture paths appear in the receipt. A missing behind call yields an explicit note.
- **Pivot:** Stop on 1 wrong role, ambiguous missing call, leaked path or changed production behavior.
- **Anchor:** The [hosted assertion](https://github.com/fyodoriv/agentbrew/actions/runs/44706661566/job/136187967909) and the fixture's independently reviewed enumeration boundary.

## Hosted finding and fixture repair

[macOS job 136262123680](https://github.com/fyodoriv/agentbrew/actions/runs/44728517625/job/136262123680)
reported a timeout resolving the behind checkout's tracking refs. The
positive result was absent. The other observed Git calls completed.
The production check gave the intended unknown result at its deadline.

- **Hypothesis:** Give only the real Git fixture a bounded 5-second subprocess budget. One deliberate 1.2-second fixture delay still yields the expected behind result. The production deadline remains 1 second.
- **Measurement:** Run `heavy-run npx vitest run src/mcp/git-checkout-lag.test.ts` plus a disposable copy with a 1.2-second tracking delay on the behind fixture. Verify the same input before and after. Exercise a synthetic production timeout separately.
- **Success:** The prior fixture loses 1 expected result. The repaired fixture keeps that result, the 9 expected calls and all offline checks. The production control requests 1000 ms, returns no confirmed lag and makes 0 retry calls. Both hosted platform gates pass.
- **Pivot:** Reject on 1 altered production option, 1 retry, 1 offline or preservation regression, or 1 expected result missing on the controlled delay.
- **Anchor:** The [classified hosted failure](https://github.com/fyodoriv/agentbrew/actions/runs/44728517625/job/136262123680) and the isolated Git probe fixture.

## Local regression result

The old fixture returned no confirmed lag after the controlled delay,
matching the hosted assertion. The same delayed fixture passed after
the test-only budget change. The three focused tests preserved the
1000 ms production request, no retry, and all original offline checks.
