# Reviewer request classifier preparation: issue 822

Goal: recognize a narrow reviewer-request command without executing shell or
sending a message. Question: can the existing bounded PR parser distinguish
two explicit add-reviewer forms from eight unrelated or ambiguous inputs?
Predict 2/2 positives and 0/8 false positives, with zero process or network
calls and no command or reviewer text in output. This is synthetic preparation
only: it is not a hook, does not prove the command succeeded, and does not
support MCP or any agent event yet.

Reuse `hooks/lib/pr-command-target.py` and preserve its existing return shape
and behavior. Any optional classification result must be opt-in. The ten
independent fixtures in `hooks/lib/review-request-classifier-test.py` are:

| Name | Synthetic command | Decision |
| --- | --- | --- |
| positive_separate | `gh pr edit 123 --add-reviewer reviewer_marker_822` | true |
| positive_equals | `gh pr edit 123 --add-reviewer=reviewer_marker_822` | true |
| view | `gh pr view 123` | false |
| remove | `gh pr edit 123 --remove-reviewer reviewer_marker_822` | false |
| assignee | `gh pr edit 123 --add-assignee reviewer_marker_822` | false |
| quoted_body | `gh pr edit 123 --body 'mention --add-reviewer reviewer_marker_822'` | false |
| compound | `gh pr edit 123 --add-reviewer reviewer_marker_822 && true` | false |
| expansion | `gh pr edit 123 --add-reviewer $PERSON` | false |
| empty | `gh pr edit 123 --add-reviewer=` | false |
| unknown_flag | `gh pr edit 123 --add-reviewer reviewer_marker_822 --unknown` | false |

No shell command runs: pass strings to the parser directly. A monkeypatched
canary must prove interception of `subprocess.Popen`, `subprocess.run`,
`os.system` and `socket.socket`; all four must record zero attempts in every
fixture. Independent source review must check for uninstrumented launch paths;
the canary alone does not prove their absence. Capture stdout/stderr, require them empty, and use a
synthetic reviewer marker to detect any leak. Preserve the old parser tests.

Commit this prediction before the test file or implementation. First run an
explicit unimplemented placeholder. The red command requires its fixed
diagnostic, not a setup error:

```sh
bash <<'BASH'
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
python3 hooks/lib/review-request-classifier-test.py ReviewRequestTests.test_positive_separate >"$log" 2>&1
status=$?
[ "$status" -eq 1 ] && grep -Fq 'AssertionError: classifier unimplemented' "$log" && grep -Fq 'FAILED (failures=1)' "$log"
BASH
```

Then run the exact green oracle and existing consumer suite:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
JOBS=1 heavy-run python3 hooks/lib/review-request-classifier-test.py -v 2>&1 | tee "$log" || exit 1
names='positive_separate positive_equals view remove assignee quoted_body compound expansion empty unknown_flag'
for name in $names; do
  line="test_$name (__main__.ReviewRequestTests.test_$name) ... ok"
  [ "$(grep -Fxc "$line" "$log")" -eq 1 ] || exit 2
done
grep -Eq '^Ran 10 tests in ' "$log" && grep -Fxq 'OK' "$log" || exit 2
JOBS=1 heavy-run bash hooks/checks/a-pr-is-not-ready.test.sh
BASH
```

Require exactly 10 named tests, zero failures or skips, and the existing
parser-dependent suite green. Then run independent review and the ordinary
full gate on the final tree. Any missed positive, false positive, output leak,
process/network call, changed default parser contract or missing control
rejects this classifier. This does not authorize a live event or message.

Before a real PostToolUse hook, separately qualify the agent's actual event
and command-success semantics. The public Claude reference gives a structured
Bash response example but does not establish an exit-code field. MCP names,
arguments, success envelopes, Codex delivery and optional channel settings
also need their own evidence and predictions. Unknowns must not become success.

Anchors: existing `pr-command-target.py`; [Claude hooks reference](https://code.claude.com/docs/en/hooks);
Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al.
(2017), preregistration.
