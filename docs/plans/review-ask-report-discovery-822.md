# Reviewer report parser: gate discovery

The earlier shell mode loop failed its registered oracle. This experiment uses
independent Python unittest cases to exercise a new shell wrapper; it does not
reuse the failed loop or test event delivery. Goal: discover the seven pure
report-parser controls in the stock hook suite and reject counterfeit output.
Predict 6/6 wrapper controls pass: both Python unittest report formats work,
while nonzero exit, missing, skipped, extra/duplicate and conflicting summaries
are refused. The parser's seven controls stay passing. Event controls remain a
separate integration and are not claimed here.

Before adding `hooks/checks/review-ask-report.test.sh`, write a Python gate
driver with six tests named `test_valid`, `test_nonzero`, `test_missing`,
`test_skipped`, `test_extra`, `test_forged`. Each test creates a private scratch
directory with a fake `python3`, runs the wrapper under `env -i` and restricted
PATH, and verifies a one-line fake-interpreter invocation sentinel. The valid
case checks both known unittest formats. Extra checks an extra and a duplicate
result; forged checks conflicting `Ran`, duplicate `OK`, and `FAILED` summary.
Each Python test owns its own local mode and captures child output privately.
No real interpreter is used as the fake, and no network or live event is used.
Require the sentinel content to equal the intended mode exactly once. Run each
owned wrapper subprocess with a five-second timeout and wait for its direct
child on timeout. Fake interpreters are fixed, synchronous scripts and do not
start child processes. No process-group signal is used.

Before implementation, the valid case must fail because the wrapper is absent.
Its fixed diagnostic is `report wrapper missing`. Measure with this oracle:

```sh
bash <<'BASH'
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
[ ! -e hooks/checks/review-ask-report.test.sh ] || exit 2
python3 hooks/lib/review_ask_report_gate_test.py GateTest.test_valid -v >"$log" 2>&1
result=$?
[ "$result" -eq 1 ] && [ "$(grep -Ec '^test_valid \(__main__\.GateTest(\.test_valid)?\) \.\.\. FAIL$' "$log")" -eq 1 ] && grep -Fq 'report wrapper missing' "$log"
BASH
```

The wrapper resolves `review_ask_report_test.py` relative to itself, captures
the foreground Python process, and requires exactly its seven named passes in
alphabetical order, one seven-test summary, one `OK`, no skipped, duplicate,
extra or conflicting results and zero child exit. It fails if the interpreter,
test or report is absent. A second shell fixture runs the six gate tests and
requires their six exact names, one six-test summary and zero skips. Both
fixtures must be found and pass in `scripts/run-hook-fixtures.sh` with its
default stock Bash and restricted PATH. The existing classifier fixtures remain
unchanged. Both shell fixtures must work in `/bin/bash` 3.2 and resolve their
tests relative to the fixture file regardless of the caller's current directory.

Measurement: `JOBS=1 heavy-run bash hooks/checks/review-ask-report-gate.test.sh`,
then `JOBS=1 heavy-run bash hooks/checks/review-ask-report.test.sh`, then the
stock `JOBS=1 heavy-run bash scripts/run-hook-fixtures.sh`, and finally the
ordinary unfiltered full gate. The first two must report exactly six and seven
named passing cases respectively; the stock log must show one successful line
for each new fixture and end `Hook fixture tests: all passed`. Independent
review is required. Any accepted invalid report, missing fixture, test failure
or weakened old contract rejects this approach. The fixed event adapter and
actual hook behavior are outside this experiment.

The two fixtures must validate each named Python result exactly once in either
known unittest format, exactly the expected count, one matching `Ran` summary,
one `OK`, and no skip or contradictory summary. After their internal checks,
they print exactly `review ask report gate: 6 passed` and
`review ask report: 7 passed`, respectively. Use this self-checking oracle:

```sh
bash <<'BASH'
set -o pipefail
gate=$(mktemp) || exit 2
unit=$(mktemp) || exit 2
stock=$(mktemp) || exit 2
trap 'rm -f "$gate" "$unit" "$stock"' EXIT
JOBS=1 heavy-run bash hooks/checks/review-ask-report-gate.test.sh >"$gate" 2>&1 || exit 1
JOBS=1 heavy-run bash hooks/checks/review-ask-report.test.sh >"$unit" 2>&1 || exit 1
[ "$(grep -Fxc 'review ask report gate: 6 passed' "$gate")" -eq 1 ] || exit 2
[ "$(grep -Fxc 'review ask report: 7 passed' "$unit")" -eq 1 ] || exit 2
JOBS=1 heavy-run bash scripts/run-hook-fixtures.sh >"$stock" 2>&1 || exit 1
for name in review-ask-report-gate.test.sh review-ask-report.test.sh; do
  [ "$(grep -Fxc "  ✓ hooks/checks/$name" "$stock")" -eq 1 ] || exit 2
done
[ "$(grep -Fxc 'Hook fixture tests: all passed' "$stock")" -eq 1 ]
BASH
```

Anchors: #851's strict fixture contract; Basili, Caldiera and Rombach (1994),
Goal Question Metric; Munafò et al. (2017), preregistration.
