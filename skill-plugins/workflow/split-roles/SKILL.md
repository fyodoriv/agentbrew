---
name: split-roles
description: Build one code change with three separate roles so the code, its tests, and its grade come from different agent contexts - a builder writes the code, a fresh tester writes failing tests from the spec only, and a fresh judge grades the result and blocks the merge on any open defect. Use when a feature or bugfix could hide a wrong implementation behind a wrong test, and a subagent tool exists. Don't use for typos, docs-only or config-only changes, or when no subagent tool exists (then use review-pr after the fact).
---

# Split roles

The agent that writes the code must not write its acceptance tests or grade
its own work. Tests written by the same context copy the code's mistakes.
Split the change across three contexts: tester, builder, judge.

Adapted from minsky's developer, QA, and reviewer personas.
Anchors: Myers 1979 (*The Art of Software Testing*: a programmer should avoid
testing their own program); Beck 2002 (*Test-Driven Development by Example*).

Composes with `test-driven-development` (red, green, refactor inside the
builder role) and `review-pr` (the review after the judge passes).

## When to use

- A feature or bugfix where a wrong test would hide a wrong implementation.
- A subagent tool exists, so the tester and the judge can start fresh.

Do not use it for a typo, a docs-only change, or a config-only change.
With no subagent tool, build normally and run `review-pr` after the fact.

## Roles

| Role | Context | May edit | Reads |
|---|---|---|---|
| Tester | Fresh subagent | Test files only | Spec + public interface |
| Builder | Main agent | Source files | Spec + tester's tests |
| Judge | Fresh subagent | Nothing | Spec + full diff + test output |

## Steps

### 1. Spec first

- Write the acceptance criteria before any code.
- State each criterion as observable behavior: input, then expected output.
- List the failure cases: bad input, missing file, network error, empty data.
- Save the spec in a handoff file, for example `$TMPDIR/<slug>/spec.md`, or in the PR draft.
- Number the criteria (C1, C2, ...). The judge maps each one to a test.

### 2. Tester (fresh subagent)

- Give the tester only the spec and the public interface: signatures, CLI usage, routes.
- Never give it the implementation, the builder's plan, or the source files.
- Check the brief before you send it. Remove any implementation file or plan text.
- The tester writes tests that fail on the current code (red).
- The tester edits test files only.
- The tester records the red output and the test-to-criterion map in `tester.md`.

### 3. Commit the tests first

- Commit the tester's tests before any source change.
- Record the commit as `<tests-commit>`.
- This commit proves who wrote which lines.

### 4. Builder (main agent)

- Implement until the tester's tests pass.
- Do not weaken, delete, skip, or rewrite the tester's assertions.
- Do not add `.skip`, `.only`, `xfail`, or looser matchers to those tests.
- If you believe a test is wrong, write a dispute in `builder.md`:
  the test name, why it is wrong, and the evidence (spec line, real output).
- Leave the test as it is. The judge decides the dispute.
- You may add more tests of your own. Keep them in separate test cases.

### 5. Judge (fresh subagent)

- Give the judge the spec, the full diff, and the test output.
- The judge checks that every criterion has at least one test.
- The judge runs the tests itself. It does not trust pasted output.
- The judge runs `git diff <tests-commit>..HEAD -- <test files>`.
  The result must be empty, or every change must be a tester commit for an approved dispute.
- The judge decides each dispute: approve (the test changes) or reject (the code changes).
- For an approved dispute, the tester (a fresh subagent) makes the test change in its own
  commit. The judge then reviews that commit before it can pass the change.
- The judge writes `judge.md`: PASS or FAIL, plus the list of open defects.
- Any open defect is FAIL. FAIL blocks the merge.

### 6. Halt rules

Any role stops and reports instead of guessing when it finds:

- A phantom change: a file or function named in a handoff does not exist.
- An ambiguous spec: two readings give different tests.
- A blocked slice: a missing dependency or a failing setup it cannot fix.

Do not ship half a slice. Report the blocker, the evidence, and the question.

## Brief templates

Tester brief:

```text
Role: tester. You write tests only. Do not edit source files.
Spec: <paste spec.md: numbered criteria and failure cases>
Public interface: <signatures, CLI usage, or routes; no implementation>
Test location and runner: <path>, <command>
Do:
1. Write one or more tests per criterion. Name each test with its criterion id.
2. Run them. They must fail on the current code (red).
3. Write tester.md: test-to-criterion map and the red output.
Stop and report if the spec is ambiguous or a named interface does not exist.
```

Builder handoff:

```text
Role: builder. Tests from <tests-commit> are fixed.
Make them pass. Do not weaken, delete, skip, or rewrite their assertions.
If a test looks wrong, write a dispute in builder.md:
test name, why it is wrong, evidence. Then continue with the other tests.
```

Judge brief:

```text
Role: judge. You edit nothing.
Spec: <spec.md>
Diff: <full diff from base>
Tests commit: <tests-commit>; test files: <paths>; disputes: <builder.md>
Do:
1. Map every criterion to at least one test. List any criterion with no test.
2. Run the tests yourself with <command>. Quote the result lines.
3. Run git diff <tests-commit>..HEAD -- <test files>. Every change must match an approved dispute.
4. Decide each dispute: approve or reject, with the reason.
5. Write judge.md: PASS or FAIL, then the open defects.
Any open defect or any criterion with no test is FAIL.
```

## Done when

- `judge.md` says PASS with no open defects.
- `git diff <tests-commit>..HEAD -- <test files>` is empty or shows only approved disputes.
- The PR body links the spec and names the tests commit.
