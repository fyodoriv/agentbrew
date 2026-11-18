# Use controlled durations in perf gate fixtures

On 2026-11-10, the hosted macOS gate reported an unchanged 63.0 ms tool
at 108.1 ms in the other tree. The affected tests compare real sleeps.
Heavy load changed the ratios even with retries. The groups are skipped
on macOS today.

- **Hypothesis**: A timing child owned by the fixture can use durations
  the synthetic commands declare. The tests will still launch each
  command and check the real gate's Git, exit code and verdict.
- **Measurement**: Run the whole test file on hosted Linux once and in
  20 independent hosted macOS test processes, with retries disabled.
  Require the exact base and head durations in the slowdown control.
- **Success**: 20 of 20 macOS passes with all timing groups enabled,
  one Linux pass, and green repository gates. Production clock and
  decision code stay unchanged.
- **Pivot**: Any missed verdict or failing macOS run keeps the task
  open. If the fixture requires a production clock switch, isolate the
  file in its own hosted job instead.
- **Anchor**: TASKS.md, `perf-gate-tests-hosted-noise`; Luo et al. 2014
  on asynchronous test waits.

## Results

The [hosted macOS run](https://github.com/fyodoriv/agentbrew/actions/runs/44202522089)
passed 20 of 20 independent processes, with 53 tests per process and
retries disabled. Linux also passed. The clock injection remains in the
test fixture. The real gate still launches the synthetic commands and
uses its ordinary decision rules.
