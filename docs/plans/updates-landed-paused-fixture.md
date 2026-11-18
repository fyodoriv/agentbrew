# Check the updates-landed timeout through a paused test driver

The 2026-11-10 run failed Test 5 at 11 seconds after heavy-run paused the
test. The assertion used the wall clock of the test driver. The hook owns
a three-second timer and kills its command's process group when it expires.

- **Hypothesis**: Waiting for the hook to return silently will give zero
  failures across ten 10-second pauses of the fixture driver. A script that
  reaches its late output still fails the fixture.
- **Measurement**: On hosted Linux, pause the fixture driver when its
  synthetic hung child announces startup. Run the current fixture once
  (expected failure), the candidate ten times (expected passes), and the
  candidate once with the hook's timer disabled in a scratch copy
  (expected failure).
- **Success**: One observed baseline failure, 10/10 paused candidate
  passes, 1/1 timeout-disabled rejection, and green Linux and macOS gates.
- **Pivot**: Any candidate failure or accepted timeout-disabled run rejects
  this fixture. Add an explicit process-completion check independent of the
  test driver's wall clock.
- **Anchor**: TASKS.md, `updates-landed-fixture-wall-clock-limit`;
  Luo et al. 2014, An Empirical Analysis of Flaky Tests.
