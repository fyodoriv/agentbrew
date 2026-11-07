# Reviewer event report: pure-parser pivot

The shell gate in the earlier plan failed its six-name oracle. Preserve that
attempt and do not rerun it for qualification. This distinct approach parses
a supplied report in a pure Python function. It does not launch the event
tests, choose a shell mode, install a hook, or claim gate discovery.

Goal: validate evidence from the six registered event tests. Predict 7/7
synthetic controls pass: both known complete unittest formats are accepted;
nonzero process status, a missing case, a skipped case, an extra or duplicate
case, and conflicting summaries are rejected. The function accepts report
text and explicit exit status, and returns only a boolean. Require exactly
the six names and their registered alphabetical order, one matching `Ran 6
tests in <time>s`, one `OK`, and no failure, skip, extra result or conflicting
summary. Each case accepts only the two documented Python name formats.
Reject invalid types and absent status as part of the nonzero case.
Require `type(status) is int`; boolean false is not an exit status. Test an
invalid report type and missing, boolean and string statuses. The extra case
tests both a new result and a duplicate result. The forged case tests an `OK`
plus `FAILED` summary and conflicting `Ran` counts separately.

Before implementation add seven named tests:
`test_valid_new`, `test_valid_stock`, `test_nonzero`, `test_missing`,
`test_skipped`, `test_extra_duplicate`, `test_forged_summary`. Use fixed
synthetic reports for the six event names from the earlier plan. The first
test must fail against a test-only placeholder returning false. Use the
following self-checking red oracle before implementation:

```sh
bash <<'BASH'
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
python3 hooks/lib/review_ask_report_test.py ReportTest.test_valid_new -v >"$log" 2>&1
result=$?
[ "$result" -eq 1 ] && [ "$(grep -Ec '^test_valid_new \(__main__\.ReportTest(\.test_valid_new)?\) \.\.\. FAIL$' "$log")" -eq 1 ] && grep -Fq 'False is not true' "$log"
BASH
```

After implementation run this exact self-checking green oracle:

```sh
bash <<'BASH'
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
JOBS=1 heavy-run python3 hooks/lib/review_ask_report_test.py -v >"$log" 2>&1 || exit 1
for name in valid_new valid_stock nonzero missing skipped extra_duplicate forged_summary; do
  [ "$(grep -Ec "^test_$name \\(__main__\\.ReportTest(\\.test_$name)?\\) \\.\\.\\. ok$" "$log")" -eq 1 ] || exit 2
done
[ "$(grep -Ec '^test_.* \.\.\. (ok|FAIL|ERROR|skipped)' "$log")" -eq 7 ] || exit 2
grep -Eq '^Ran 7 tests in [0-9.]+s$' "$log" && grep -Fxq OK "$log" && ! grep -Eq '^(FAILED|ERROR)| \.\.\. (FAIL|ERROR|skipped)' "$log"
BASH
```

Success requires all seven controls, zero accepted incomplete or forged
reports, zero process or network calls during parser import and calls, and
independent review. The test driver itself starts Python.
Any accepted invalid report rejects this design. Tests must canary and reset
sentinels for `subprocess.Popen`, `os.system`, `socket.create_connection` and
`socket.socket.connect` before importing the parser, and assert zero calls.
Inspect for alternate launch paths. Gate integration requires its own
registered wrapper and discovery experiment before this can merge.

Anchors: #851's strict classifier gate; Basili, Caldiera and Rombach (1994),
Goal Question Metric; Munafò et al. (2017), preregistration.
