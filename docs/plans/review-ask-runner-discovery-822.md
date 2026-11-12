# Owned reviewer runner: gate discovery

The pinned local runner's red placeholder failed and its eight synthetic
controls passed under the registered Python identity. Independent review
confirmed direct-child cleanup and scope. Goal: make the stock hook suite run
those controls and reject counterfeit reports. Predict 6/6 wrapper controls
and 8/8 runner controls pass; invalid report or nonzero status is never
accepted. This remains preparation, not a live hook or delivery proof.

Before adding `hooks/checks/review-ask-event-runner.test.sh`, add
`hooks/lib/review_ask_event_runner_gate_test.py` with `test_valid`,
`test_nonzero`, `test_missing`, `test_skipped`, `test_extra`, and `test_forged`.
Reuse #854's independent Python-case pattern: private scratch HOME, restricted
environment without `BASH_ENV`, fixed finite synchronous childless fake
interpreter, five-second direct-wrapper timeout and exactly one mode-matched
invocation sentinel. Check both Python report formats; extra includes both an
extra and duplicate result; forged includes conflicting `Ran`, duplicate `OK`
and `FAILED` summaries. On timeout the driver kills and waits for its direct
shell wrapper; its finite fake child can briefly outlive that wrapper. This is
not descendant-cleanup proof and the fake never execs a real interpreter.

The absent wrapper must make `test_valid` fail with the fixed diagnostic
`event runner wrapper missing`. Run this red oracle before adding the wrapper:

```sh
bash <<'BASH'
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
[ ! -e hooks/checks/review-ask-event-runner.test.sh ] || exit 2
/Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9 hooks/lib/review_ask_event_runner_gate_test.py GateTest.test_valid -v >"$log" 2>&1
result=$?
[ "$result" -eq 1 ] && [ "$(grep -Ec '^test_valid \(__main__\.GateTest(\.test_valid)?\) \.\.\. FAIL$' "$log")" -eq 1 ] && grep -Fq 'event runner wrapper missing' "$log"
BASH
```

The new wrapper runs `review_ask_event_runner_test.py` relative to itself,
with `PYTHONDONTWRITEBYTECODE=1`, and requires its eight exact named passing
results in alphabetical order, one eight-test summary, one `OK`, zero skips,
extra, duplicate or conflicting results and zero child exit. The names are
`actual_event_suite`, `direct_child_timeout`, `extra_case`, `failing_suite`,
`import_failure`, `missing_case`, `private_output`, `skipped_suite`. A second
stock-Bash-compatible fixture runs and verifies the six exact gate tests.
Missing interpreter, test, report or producer success refuses. Both fixtures
must work from another cwd and be discovered by the stock restricted-PATH hook
runner; existing #855 fixtures remain unchanged.

Before any real runner control in this experiment, verify all four source
hashes and the interpreter metadata/hash from the separately committed
identity supplement. Run the wrapper controls under clean scratch HOME and
`PATH=/usr/bin:/bin` with no `BASH_ENV` or Python loader overrides. Confirm
that clean PATH resolves to the pinned interpreter; the stock fixture runner
uses that restricted PATH. Run the registered eight-case runner oracle, the
two new fixtures and the stock hook suite. Require each fixture's exact
success marker and one successful stock-suite discovery line. Then run the
ordinary unfiltered full gate with research-cohort variables unset, verify the
closed controlled source-lease describe is absent, and request independent
review. Any false pass, missing control, unowned process cleanup, marker leak,
discovery failure or full-gate regression rejects this approach. Register
self-checking green and stock commands before running them.

This qualifies only synthetic runner and discovery. Actual hook activation,
real event semantics, MCP, channel configuration and delivery remain separate.
Anchors: #855's stock discovery pattern; Basili, Caldiera and Rombach (1994),
Goal Question Metric; Munafò et al. (2017), preregistration.

Registered green and discovery oracle (run from the candidate root; the
identity preflight runs before any real runner control):

```sh
bash <<'BASH'
set -eu
p=/Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9
[ -f "$p" ] && [ ! -L "$p" ]
[ "$(stat -f '%u %Lp %z' "$p")" = '0 755 102352' ]
[ "$(shasum -a 256 "$p" | cut -d ' ' -f 1)" = c5a13e37785524fbc0384539d3c99aa4f888cb7c89e13e0bf0018436378b13bc ]
[ "$(env -i PATH=/usr/bin:/bin /bin/bash -c 'python3 -c "import os,sys; print(os.path.realpath(sys.executable))"')" = "$p" ]
[ "$(env -i PATH=/usr/bin:/bin "$p" -c 'import sys; print(sys.version.split()[0])')" = 3.9.6 ]
printf '%s  %s\n' \
  40d849a8da4af2c9921928a8007674266becf1c4c1e3006b4fdfe6e4742321f8 hooks/lib/review_ask_event.py \
  d5ecfa9900449c59ef3ea0e9814249a5d12b328b57fe7e98ee96c6a4df11dc84 hooks/lib/review_ask_event_test.py \
  20cd19b406d367b17b98916b40ad06bd4854f11df4b77879497db0642160c249 hooks/lib/review_ask_report.py \
  1983e66e2a040fe9b4d246e44dc44577a5095513cf4b9ef58f815238cafb45ee hooks/lib/review_ask_imported_report_test.py | shasum -a 256 -c
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
for fixture in review-ask-event-runner.test.sh review-ask-event-runner-gate.test.sh; do
  env -i HOME="$scratch" PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 /bin/bash "$PWD/hooks/checks/$fixture" >"$scratch/$fixture.log" 2>&1
done
grep -Fxq 'review ask event runner: 8 passed' "$scratch/review-ask-event-runner.test.sh.log"
grep -Fxq 'review ask event runner gate: 6 passed' "$scratch/review-ask-event-runner-gate.test.sh.log"
env -i HOME="$scratch" PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 /bin/bash scripts/run-hook-fixtures.sh >"$scratch/stock.log" 2>&1
for fixture in review-ask-event-runner.test.sh review-ask-event-runner-gate.test.sh; do
  [ "$(grep -Fxc "  ✓ hooks/checks/$fixture" "$scratch/stock.log")" -eq 1 ]
done
grep -Fxq 'Hook fixture tests: all passed' "$scratch/stock.log"
printf '%s\n' 'registered runner and stock discovery passed'
BASH
```
