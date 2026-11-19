---
name: rule-to-lint
description: Turn a prose rule from AGENTS.md, shared rules, CLAUDE.md, or a skill into a deterministic check - a hook, lint, or test with a red fixture from a real violation and an allowed near-miss fixture - then shrink the prose to one line that names the check. Use when a rule keeps getting broken, when always-loaded instructions grow, or when you add a new rule. Don't use for judgment calls no script can decide (keep them as prose or a skill), one-off reminders, or style a formatter already enforces.
---

# Rule to lint

A rule that only lives in prose is a hope. A check enforces it every time
and costs no always-loaded context. Move each decidable rule into a check,
then cut its prose to one line.

Adapted from minsky rule #10: every rule is a CI lint, not a hope, and no LLM
is the only load-bearing gate.
Anchors: Bessey et al. 2010 (*A few billion lines of code later*, CACM);
Sadowski et al. 2018 (*Lessons from building static analysis tools at Google*, CACM).

## When to use

- A rule in AGENTS.md, shared rules, CLAUDE.md, or a skill keeps getting broken.
- Always-loaded instructions grow and you want to cut them.
- You are about to add a new rule.

Do not use it for judgment calls, one-off reminders, or formatting that a
formatter already enforces.

## Steps

### 1. Decide if a script can judge it

- Ask: can a script decide pass or fail from command text, files, a diff, a PR body, or command output?
- Yes: continue.
- No (taste, tone, design quality): keep it as prose or move it into a skill. Stop here.
- Mixed: split it. Check the decidable part. Keep the rest as prose.
- An LLM judge may advise. It is never the only merge gate.

### 2. Pick the enforcement point

Pick the earliest point that sees the input. Prefer the cheapest point that cannot be skipped.

| Input the check needs | Enforcement point |
|---|---|
| Command text an agent runs | Agent PreToolUse hook |
| Staged files | Pre-commit hook |
| Whole repo, or a PR body | CI lint |
| Runtime behavior | Test |

In agentbrew, a hook lives in `hooks/manifest.yaml` with
`hooks/checks/<id>.sh` and `hooks/checks/<id>.test.sh`. Other repos use
their own hook, lint, or test location.

### 3. Red first

- Find a real past violation (a commit, a transcript line, a PR).
- Turn it into a fixture.
- Run the check on it before the check exists, or with the check stubbed. It must fail (red).

### 4. Add allowed fixtures

- Add at least one near-miss that must pass. Example: a placeholder `~/` path next to a real home path.
- Near-misses guard against false blocks.

### 5. Write the check

- Keep it small and dependency-free when you can.
- The error message says what is wrong, where (file:line), and how to fix it.
- Exit non-zero on a violation. Exit 0 otherwise.

### 6. Wire it

- Register it where it runs: hook manifest, lefthook or pre-commit, CI workflow, or the repo's verify script.
- Prove it runs there: trigger it once through the real entry point and quote the output.

### 7. Shrink the prose

- Measure the always-loaded file first: `wc -c <file>`.
- Replace the rule's paragraph with one line: `<rule> — enforced by <check path>`.
- Measure again with `wc -c <file>`. Report both numbers.

### 8. Pre-register

Write these in the PR body or the commit message before you see the result:

- **Hypothesis**: violations of the rule go to zero.
- **Measurement**: the fixture command, for example `bash hooks/checks/<id>.test.sh; echo exit=$?`.
- **Success**: every red fixture fails and every allowed fixture passes.
- **Pivot**: more than N false blocks per week means loosen the check or revert it.
- **Anchor**: a primary source for the method.

## Worked example

Rule in prose: "Never put a home path in docs."

1. Decidable: a regex on Markdown files finds it.
2. Point: pre-commit for staged `*.md`, plus a CI lint for the whole repo.
3. Red fixture: `docs/setup.md` with a real home path (the macOS users folder, then a user name). The check exits 1.
4. Allowed fixture: `~/apps/tool` and a `<you>` placeholder in place of the user name. The check exits 0.
5. Check (exits 1 on a match, 0 when clean or when no Markdown is staged):

   ```sh
   files=$(git diff --cached --name-only --diff-filter=d -- '*.md')
   [ -z "$files" ] && exit 0
   status=0
   grep -nE '/(Users|home)/[a-z][a-z0-9_-]+/' $files || status=$?
   [ "$status" -eq 1 ]
   ```

   `grep` exits 0 on a match, 1 when clean, and 2 on an error, so only 1 passes.
   `--diff-filter=d` leaves out staged deletions, which `grep` cannot read.
   Message: `docs/setup.md:12: home path; write ~/ instead`.
6. Wire: add it to the pre-commit config and the CI lint job; commit the red fixture once to see it block.
7. Shrink: the AGENTS.md paragraph becomes `No home paths in docs — enforced by scripts/check-home-paths.sh`.
   Report `wc -c AGENTS.md` before and after.
8. Pre-register as in step 8.

## Done when

- The red fixture fails and every allowed fixture passes.
- The check runs from its real entry point, with quoted output.
- The prose is one line that names the check, with before and after byte counts.
