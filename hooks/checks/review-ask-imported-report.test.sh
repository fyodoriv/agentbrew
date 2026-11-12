#!/bin/bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
test_file="$script_dir/../lib/review_ask_imported_report_test.py"
command -v python3 >/dev/null 2>&1 || exit 1
[ -f "$test_file" ] || exit 1
log=$(mktemp) || exit 1
trap 'rm -f "$log"' EXIT
python3 "$test_file" -v >"$log" 2>&1 || { cat "$log"; exit 1; }
[ -f "$log" ] || exit 1
names='extra failed_status imported_new imported_stock skipped wrong_module'
index=0
for name in $names; do
  index=$((index + 1))
  pattern="^test_$name \\(__main__\\.ImportedReportTest(\\.test_$name)?\\) \\.\\.\\. ok$"
  [ "$(grep -Ec "$pattern" "$log")" -eq 1 ] || exit 1
  grep '^test_' "$log" | sed -n "${index}p" | grep -Eq "$pattern" || exit 1
done
[ "$(grep -Ec '^test_.* \.\.\. ' "$log")" -eq 6 ] || exit 1
[ "$(grep -Ec '^Ran [0-9]+ tests? in ' "$log")" -eq 1 ] || exit 1
grep -Eq '^Ran 6 tests in [0-9.]+s$' "$log" || exit 1
[ "$(grep -Ec '^OK' "$log")" -eq 1 ] && grep -Fxq OK "$log" || exit 1
if grep -Eq ' \.\.\. (skipped|FAIL|ERROR)|^(FAILED|ERROR|FAIL)|^OK \(' "$log"; then exit 1; fi
printf 'imported report: 6 passed\n'
