# Imported event-test report: synthetic parser preparation

The earlier event wrapper could leave a descendant interpreter after timeout.
Do not use that design. A separately reviewed alternative runs the genuine
event unittest suite in one owned interpreter and validates its captured
result. This preparation only extends #854's parser for one exact imported
module label; it does not run the event suite or install a hook.

Goal: recognize the fixed imported unittest format without weakening the
existing default report contract. Predict 6/6 synthetic controls pass, with
zero accepted wrong-module, incomplete or failed reports. Add a separate
test file `hooks/lib/review_ask_imported_report_test.py`. Its fixed synthetic
report uses the same six case names and order as #854, with exactly the module
name `review_ask_event_fixture` and class `ReviewAskEventTest`. Controls are:
`test_imported_new`, `test_imported_stock`, `test_wrong_module`,
`test_skipped`, `test_extra`, and `test_failed_status`. The first two accept
the two known unittest name formats. The other four must reject respectively
another module name, a skipped case, an extra or duplicate case, and a
nonzero or invalid status. The wrong-module case also requires the old API to
reject imported labels and the new API to reject `__main__`. The extra case
also tests a missing result. The failed-status case rejects booleans and
invalid statuses, conflicting `Ran` counts and `OK` plus `FAILED` even with
status zero. Each test uses only fixed strings.

Before implementation, a test-only absent-function fallback returns false.
The first case must fail with diagnostic `imported report placeholder`.
Run the self-checking red command below. Add a separate exported
`valid_imported_report` that accepts only the fixed module name. Keep the
default `valid_report` and its existing exact `__main__` semantics unchanged;
share validation logic without accepting the imported name in the old API.
Source-review the parser and controls for network and process paths. No model,
network, real event, subprocess or message is allowed in the parser.

```sh
bash <<'BASH'
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
python3 hooks/lib/review_ask_imported_report_test.py ImportedReportTest.test_imported_new -v >"$log" 2>&1
result=$?
[ "$result" -eq 1 ] && [ "$(grep -Ec '^test_imported_new \(__main__\.ImportedReportTest(\.test_imported_new)?\) \.\.\. FAIL$' "$log")" -eq 1 ] && grep -Fq 'imported report placeholder' "$log"
BASH
```

After implementation, run the self-checking green command below, the existing
`JOBS=1 heavy-run bash hooks/checks/review-ask-report.test.sh` and its gate
counterpart, and an independent source review. Green requires exactly 6/6 new
cases, all seven existing parser controls and six existing gate cases; any
accepted wrong label or invalid report, changed default API, disclosure, or
missing control rejects this approach. A separate registered discovery and
full gate are required before merging. The future runner, real hook semantics,
session identity and delivery need separate proof.

```sh
bash <<'BASH'
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
JOBS=1 heavy-run python3 hooks/lib/review_ask_imported_report_test.py -v >"$log" 2>&1 || exit 1
for name in imported_new imported_stock wrong_module skipped extra failed_status; do
  [ "$(grep -Ec "^test_$name \\(__main__\\.ImportedReportTest(\\.test_$name)?\\) \\.\\.\\. ok$" "$log")" -eq 1 ] || exit 2
done
[ "$(grep -Ec '^test_.* \.\.\. (ok|FAIL|ERROR|skipped)' "$log")" -eq 6 ] || exit 2
grep -Eq '^Ran 6 tests in [0-9.]+s$' "$log" && grep -Fxq OK "$log" && ! grep -Eq '^(FAILED|ERROR)| \.\.\. (FAIL|ERROR|skipped)' "$log"
BASH
```

Anchors: #854's strict report parser; Basili, Caldiera and Rombach (1994), Goal
Question Metric; Munafò et al. (2017), preregistration.
