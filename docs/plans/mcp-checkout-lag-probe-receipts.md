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
