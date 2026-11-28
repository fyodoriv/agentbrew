# Check guard time and process budgets in fixtures

## Prediction

- **Hypothesis:** A guard check can distinguish a timely result, a missing result at its deadline, and an over-budget launch count using three harmless scratch controls. The existing allow and block decisions keep their exit codes.
- **Measurement:** Run `npx vitest run src/hooks/runtime-startup.test.ts` on the hosted Ubuntu and macOS runners. Check a 1,000 ms deadline against a 2,000 ms synthetic delay. Use a launch budget of 2 when a recording shim is called 3 times.
- **Success:** The 3 control outcomes match. The synthetic runner times out at the test deadline, the excess launch case reports the exact count, and both real decision controls pass without running their command text.
- **Pivot:** If 1 timed-out case still looks like a normal verdict, 1 valid decision changes, or the launch check depends on private host configuration, keep the guide change in review and refine the fixture runner. Keep the deployed timeout settings unchanged.
- **Anchor:** [Guard timing report](https://github.com/fyodoriv/agentbrew/issues/1365) and the existing `src/hooks/runtime-startup.test.ts` fixture runner.

Use scratch scripts and inert input. The fixture counts calls to the named
recording shims and observes when the runner stops. Field timing for a real
managed session is separate evidence.
