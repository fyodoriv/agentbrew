# Imported report: synthetic gate discovery

The imported-label parser controls are separate from the existing default
report tests. Goal: discover them in the stock hook suite without accepting a
counterfeit report. Predict six wrapper controls and six parser controls pass;
both valid unittest formats pass, while nonzero status, missing, skipped,
extra/duplicate and forged summaries fail. Existing #854 controls remain green.
No event suite, model or network is involved.

Before adding `hooks/checks/review-ask-imported-report.test.sh`, add
`hooks/lib/review_ask_imported_report_gate_test.py` with six tests named
`test_valid`, `test_nonzero`, `test_missing`, `test_skipped`, `test_extra`,
`test_forged`. Reuse #854's independent Python-case pattern: private scratch
HOME, fixed synchronous childless fake interpreter, restricted environment,
five-second direct-child timeout, and exactly one mode-matched invocation
sentinel. The valid test checks both known Python formats; extra checks both an
extra and duplicate case; forged checks conflicting `Ran`, duplicate `OK` and
`FAILED`. Each case owns its own mode and scratch tree. Before the wrapper
exists, this red oracle must fail the named valid test with the fixed message:

The timeout kills and waits for the directly owned shell wrapper. Its fixed,
synchronous, childless fake interpreter is a child of that wrapper and may
briefly outlive it on timeout; this is not descendant-cleanup proof. The fake
does not exec a real interpreter. The parser control names are
`test_imported_new`, `test_imported_stock`, `test_wrong_module`,
`test_skipped`, `test_extra`, and `test_failed_status`.

```sh
bash <<'BASH'
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
[ ! -e hooks/checks/review-ask-imported-report.test.sh ] || exit 2
python3 hooks/lib/review_ask_imported_report_gate_test.py GateTest.test_valid -v >"$log" 2>&1
result=$?
[ "$result" -eq 1 ] && [ "$(grep -Ec '^test_valid \(__main__\.GateTest(\.test_valid)?\) \.\.\. FAIL$' "$log")" -eq 1 ] && grep -Fq 'imported report wrapper missing' "$log"
BASH
```

The new stock-Bash-compatible wrapper resolves the six-case parser test
relative to itself and accepts exactly its six named passes in alphabetical
order, one six-test summary and one `OK`, with zero skips, extra, duplicate or
conflicting summaries and a zero child exit status. Fail if the interpreter, test or
report is missing. A second shell fixture runs the six wrapper tests and checks
their exact names and summary. Both wrappers must work from another cwd under
the stock fixture runner's restricted PATH. Preserve #854's wrappers and tests.

After implementation run this self-checking oracle, then both existing #854
fixtures and the ordinary unfiltered full gate with `VERIFY_PLAN` unset.
Require independent review. Any accepted invalid report, missing fixture,
changed old contract, test failure or full-gate regression rejects the
approach. This prepares discovery only; it does not qualify the future runner,
real event semantics or delivery.

```sh
bash <<'BASH'
gate=$(mktemp) || exit 2
unit=$(mktemp) || exit 2
stock=$(mktemp) || exit 2
trap 'rm -f "$gate" "$unit" "$stock"' EXIT
JOBS=1 heavy-run bash hooks/checks/review-ask-imported-report-gate.test.sh >"$gate" 2>&1 || exit 1
JOBS=1 heavy-run bash hooks/checks/review-ask-imported-report.test.sh >"$unit" 2>&1 || exit 1
[ "$(grep -Fxc 'imported report gate: 6 passed' "$gate")" -eq 1 ] || exit 2
[ "$(grep -Fxc 'imported report: 6 passed' "$unit")" -eq 1 ] || exit 2
JOBS=1 heavy-run bash scripts/run-hook-fixtures.sh >"$stock" 2>&1 || exit 1
for name in review-ask-imported-report-gate.test.sh review-ask-imported-report.test.sh; do
  [ "$(grep -Fxc "  ✓ hooks/checks/$name" "$stock")" -eq 1 ] || exit 2
done
[ "$(grep -Fxc 'Hook fixture tests: all passed' "$stock")" -eq 1 ]
BASH
```

Anchors: #854's report discovery contract; Basili, Caldiera and Rombach
(1994), Goal Question Metric; Munafò et al. (2017), preregistration.
