# Reviewer event: owned in-process runner preparation

Do not run this preparation until #855 merges and its parser identity is
recorded. The previous shell-wrapper design did not establish child cleanup.
This distinct test-only runner loads the reviewed synthetic event tests into
one owned interpreter, runs the real unittest suite in-process, and validates
the actual report with #855's fixed imported-label parser. It is not a hook and
does not qualify real event or message delivery.

Freeze the reviewed event files before copying from the preserved worktree:
`review_ask_event.py` SHA-256
`40d849a8da4af2c9921928a8007674266becf1c4c1e3006b4fdfe6e4742321f8`, and
`review_ask_event_test.py` SHA-256
`d5ecfa9900449c59ef3ea0e9814249a5d12b328b57fe7e98ee96c6a4df11dc84`.
Their hashes must match before and after copying. Preserve their source and
existing no-network/process sentinels; do not expose actual case data or call
an external service.

Goal: distinguish a real six-case synthetic suite from incomplete or failed
execution, while bounding the directly owned test interpreter. Predict 8/8
new controls pass. The runner imports the fixed event test path under the
fixed module name `review_ask_event_fixture` and loads only
`ReviewAskEventTest` using `unittest.TestLoader`. It runs a real
`TextTestRunner` into private memory, derives status from the returned
`TestResult`, and sends the actual report and status to
`valid_imported_report`. It must not alter class labels or manufacture a
success report. Require `testsRun == 6`, `wasSuccessful()`, and empty skipped,
errors, failures and unexpected-success lists before status zero. Pass the
unmodified captured report to the parser. Reject import or discovery exceptions.
Capture stdout and stderr; on failure print only a fixed
diagnostic. The main entry accepts no user-supplied test path and exits after
the run, so partial import failure cannot leave patches in a shared process.
The actual event-file import occurs only in a disposable owned interpreter;
the parent test process never imports it. Unit-test seams may accept owned
scratch suites but the entrypoint accepts no substitute path or suite. Restore
captured streams in `finally` and never call global `patch.stopall()`.

Before implementing the runner, add eight named tests:
`test_actual_event_suite`, `test_failing_suite`, `test_skipped_suite`,
`test_missing_case`, `test_extra_case`, `test_import_failure`,
`test_private_output`, and `test_direct_child_timeout`. The first requires
the real frozen six-case event suite to pass. The next four run genuine
scratch unittest suites through the same runner and reject a real failure,
skip, missing case and extra case. Each scratch suite has the six registered
method names and `review_ask_event_fixture.ReviewAskEventTest` label; the
failing case uses one real assertion failure, the skip uses a real unittest
skip, the missing case omits one method and the extra case adds a seventh.
The test-only suite builder can set this label for scratch controls; the real
event class label is set only by its fixed import name. Import failure runs in
an owned scratch copy of the runner and parser whose fixed event file throws.
The privacy control injects distinct synthetic markers into stdout, stderr and
an exception and proves its capture canaries see each marker before requiring
that none appears in the runner's fixed outward diagnostic. The last test
starts an owned `/bin/bash` fixture under an explicit `env -i` environment
without `BASH_ENV`; the script uses only builtin `exec` with an absolute
trusted fake interpreter path, replacing itself in the same PID. The fixed
childless fake records its PID and blocks in a shell builtin loop. After a
one-second timeout, the test verifies the sentinel equals the retained
`Popen.pid`, kills and waits for that owned unreaped direct PID, and never
signals a process group. This proves direct-child
cleanup only; source review and existing sentinels must rule out descendants
and network calls in the selected runner and event files.

Immediately after each owned `Popen`, register cleanup before reading a
sentinel or asserting anything. In `finally`, kill only that still-owned
direct child if alive and wait/reap it with a bound. Apply the same cleanup to
the actual-suite and import-failure disposable interpreters. All pre-exec
wrapper work is shell-builtin only. After #855 merges and before admission,
record the landed parser's hash and the absolute trusted interpreter path and
identity in a separate committed supplement; verify them before each run.

Use a test-only placeholder returning failure for the first case. The named
red must show `runner placeholder` before implementation. Use the exact
self-checking commands below. Require 8/8 named passes, no skipped
controls, no marker disclosure, no spawned descendants or network calls and
independent review. Any accepted failed/incomplete suite, missing cleanup,
disclosure or false success rejects this approach. Gate discovery and a full
unfiltered gate must be separately registered before merging.

```sh
bash <<'BASH'
scratch=$(mktemp -d) || exit 2
trap 'rm -f "$scratch/report"; rmdir "$scratch"' EXIT
log="$scratch/report"
interpreter=/Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9
[ -f "$interpreter" ] && [ ! -L "$interpreter" ] && [ "$(stat -f '%u:%Lp:%z' "$interpreter")" = '0:755:102352' ] || exit 2
[ "$(shasum -a 256 "$interpreter" | awk '{print $1}')" = 'c5a13e37785524fbc0384539d3c99aa4f888cb7c89e13e0bf0018436378b13bc' ] || exit 2
printf '%s\n' '20cd19b406d367b17b98916b40ad06bd4854f11df4b77879497db0642160c249  hooks/lib/review_ask_report.py' '1983e66e2a040fe9b4d246e44dc44577a5095513cf4b9ef58f815238cafb45ee  hooks/lib/review_ask_imported_report_test.py' '40d849a8da4af2c9921928a8007674266becf1c4c1e3006b4fdfe6e4742321f8  hooks/lib/review_ask_event.py' 'd5ecfa9900449c59ef3ea0e9814249a5d12b328b57fe7e98ee96c6a4df11dc84  hooks/lib/review_ask_event_test.py' | shasum -a 256 -c >/dev/null || exit 2
env -i HOME="$scratch" PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 "$interpreter" hooks/lib/review_ask_event_runner_test.py RunnerTest.test_actual_event_suite -v >"$log" 2>&1
result=$?
[ "$result" -eq 1 ] && [ "$(grep -Ec '^test_actual_event_suite \(__main__\.RunnerTest(\.test_actual_event_suite)?\) \.\.\. FAIL$' "$log")" -eq 1 ] && grep -Fq 'runner placeholder' "$log"
BASH
```

```sh
bash <<'BASH'
scratch=$(mktemp -d) || exit 2
trap 'rm -f "$scratch/report"; rmdir "$scratch"' EXIT
log="$scratch/report"
interpreter=/Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9
[ -f "$interpreter" ] && [ ! -L "$interpreter" ] && [ "$(stat -f '%u:%Lp:%z' "$interpreter")" = '0:755:102352' ] || exit 2
[ "$(shasum -a 256 "$interpreter" | awk '{print $1}')" = 'c5a13e37785524fbc0384539d3c99aa4f888cb7c89e13e0bf0018436378b13bc' ] || exit 2
printf '%s\n' '20cd19b406d367b17b98916b40ad06bd4854f11df4b77879497db0642160c249  hooks/lib/review_ask_report.py' '1983e66e2a040fe9b4d246e44dc44577a5095513cf4b9ef58f815238cafb45ee  hooks/lib/review_ask_imported_report_test.py' '40d849a8da4af2c9921928a8007674266becf1c4c1e3006b4fdfe6e4742321f8  hooks/lib/review_ask_event.py' 'd5ecfa9900449c59ef3ea0e9814249a5d12b328b57fe7e98ee96c6a4df11dc84  hooks/lib/review_ask_event_test.py' | shasum -a 256 -c >/dev/null || exit 2
JOBS=1 heavy-run env -i HOME="$scratch" PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 "$interpreter" hooks/lib/review_ask_event_runner_test.py -v >"$log" 2>&1 || exit 1
for name in actual_event_suite failing_suite skipped_suite missing_case extra_case import_failure private_output direct_child_timeout; do
  [ "$(grep -Ec "^test_$name \\(__main__\\.RunnerTest(\\.test_$name)?\\) \\.\\.\\. ok$" "$log")" -eq 1 ] || exit 2
done
[ "$(grep -Ec '^test_.* \.\.\. (ok|FAIL|ERROR|skipped)' "$log")" -eq 8 ] || exit 2
grep -Eq '^Ran 8 tests in [0-9.]+s$' "$log" && grep -Fxq OK "$log" && ! grep -Eq '^(FAILED|ERROR)| \.\.\. (FAIL|ERROR|skipped)' "$log"
BASH
```

This preparation cannot prove the source or semantics of a real Claude event,
shell success, plugin identity, channel setting, or message delivery. Real
agent and MCP proof remain separate.

Anchors: #855's fixed report parser; Basili, Caldiera and Rombach (1994), Goal
Question Metric; Munafò et al. (2017), preregistration.
