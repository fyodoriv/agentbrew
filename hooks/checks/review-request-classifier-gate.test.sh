#!/bin/bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
wrapper="$script_dir/review-request-classifier.test.sh"
root=$(mktemp -d) || exit 1
trap 'rm -rf "$root"' EXIT
chmod 700 "$root"
mkdir "$root/bin" "$root/work"
cat > "$root/bin/python3" <<'FAKE'
#!/bin/bash
printf '%s\n' "$FAKE_MODE" >> "$FAKE_LOG"
names='positive_separate positive_equals view remove assignee quoted_body compound expansion empty unknown_flag'
for name in $names; do
  if [ "$FAKE_MODE" = missing ] && [ "$name" = view ]; then continue; fi
  if [ "$FAKE_MODE" = skipped ] && [ "$name" = view ]; then
    printf "test_%s (__main__.ReviewRequestTests.test_%s) ... skipped 'fixture'\n" "$name" "$name"
  elif [ "$FAKE_MODE" = valid_stock ]; then
    printf 'test_%s (__main__.ReviewRequestTests) ... ok\n' "$name"
  else
    printf 'test_%s (__main__.ReviewRequestTests.test_%s) ... ok\n' "$name" "$name"
  fi
done
if [ "$FAKE_MODE" = extra ]; then printf 'test_extra (__main__.ReviewRequestTests.test_extra) ... ok\n'; fi
printf '\nRan 10 tests in 0.001s\n\nOK\n'
if [ "$FAKE_MODE" = forged ]; then printf 'Ran 11 tests in 0.001s\n'; fi
if [ "$FAKE_MODE" = forged_failed ]; then printf 'FAILED (failures=1)\n'; fi
if [ "$FAKE_MODE" = nonzero ]; then exit 7; fi
FAKE
chmod +x "$root/bin/python3"
for mode in valid nonzero missing skipped extra forged; do
  status=0
  : > "$root/invoked"
  (cd "$root/work" && env -i HOME="$root" FAKE_LOG="$root/invoked" FAKE_MODE="$mode" PATH="$root/bin:/usr/bin:/bin" /bin/bash "$wrapper" >"$root/out" 2>&1) || status=$?
  [ "$(grep -Fxc "$mode" "$root/invoked")" -eq 1 ] || exit 1
  if [ "$mode" = valid ]; then [ "$status" -eq 0 ] || exit 1; else [ "$status" -ne 0 ] || exit 1; fi
  if [ "$mode" = valid ]; then
    : > "$root/invoked"
    (cd "$root/work" && env -i HOME="$root" FAKE_LOG="$root/invoked" FAKE_MODE=valid_stock PATH="$root/bin:/usr/bin:/bin" /bin/bash "$wrapper" >"$root/out" 2>&1) || exit 1
    [ "$(grep -Fxc valid_stock "$root/invoked")" -eq 1 ] || exit 1
  fi
  if [ "$mode" = forged ]; then
    status=0
    : > "$root/invoked"
    (cd "$root/work" && env -i HOME="$root" FAKE_LOG="$root/invoked" FAKE_MODE=forged_failed PATH="$root/bin:/usr/bin:/bin" /bin/bash "$wrapper" >"$root/out" 2>&1) || status=$?
    [ "$(grep -Fxc forged_failed "$root/invoked")" -eq 1 ] || exit 1
    [ "$status" -ne 0 ] || exit 1
  fi
  printf 'ok - %s\n' "$mode"
done
printf 'review request classifier gate: 6 passed\n'
