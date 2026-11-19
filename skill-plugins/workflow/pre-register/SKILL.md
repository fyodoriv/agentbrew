---
name: pre-register
description: Pre-register a non-trivial change as an experiment before you write code - Hypothesis, Measurement, Success, Pivot and Anchor, plus a baseline - then grade it afterwards with Predicted, Observed, Match and Lesson, and check both with a script. Use when you start a non-trivial bugfix, feature or refactor, write a task block, write a PR body, or finish a change and grade it. Don't use for typos, formatting or no-op moves that an existing CI gate covers (write "Exempt: <gate>" instead), or for pure research with no change.
---

# Pre-register

Write the prediction before you see the result. A metric picked afterwards
lets every change "succeed".

Adapted from minsky rule #9 and its `experiment-validate` lints.

## Check it

`<skill-dir>` is the folder that holds this SKILL.md.

```bash
node <skill-dir>/scripts/check-preregistration.mjs pr-body.md
node <skill-dir>/scripts/check-preregistration.mjs TASKS.md
gh pr view 123 --json body --jq .body | node <skill-dir>/scripts/check-preregistration.mjs - --self-grade
```

- Exit 0: every block passes.
- Exit 1: a field is missing or weak. Each line names the block and the field.
- Exit 2: usage error.
- `--self-grade` also requires Predicted, Observed, Match and Lesson.
- In a task file, each `- [ ]` block is checked on its own.

## Steps

### 1. Decide: exempt or not

- Exempt: a typo, formatting churn, or a no-op move that passing tests cover.
- Write `Exempt: <the CI gate that is the metric>` in the commit or PR body.
- Bugfixes are never exempt.
- Everything else gets the five fields.

### 2. Write the five fields

| Field | What to write |
|---|---|
| Hypothesis | Which observable behavior improves, by how much, and why. Frame it Goal, Question, Metric. |
| Measurement | The exact command that reads real output. Put it in backticks. No manual steps. |
| Success | The number at or above which you keep the change. |
| Pivot | The number below which you abandon the approach, not only revert the change. |
| Anchor | A primary source for the metric: author, year, title, or a DOI or link. |

Rules for the fields:

- Leave a margin between Success and Pivot. The gap is the inconclusive zone.
- A bugfix states its recurrence or stability metric: error rate, crash rate,
  p99 latency, or time to recover, from X to Y.
- If you cannot name that metric, you have not found the root cause yet.
- No vanity metrics: lines of code, commits, hours, files changed, task or PR counts.
- No post-hoc metrics. Pick the number now, not after the run.
- A command that only prints (`echo`, `true`, `exit 0`) is not a measurement.

### 3. Take the baseline

- Run the Measurement on the unchanged code.
- Record the number next to the Hypothesis.
- A failing baseline run is a finding. Fix or report its cause before you compare.

### 4. Commit the prediction first

- Put the fields in the task block, the PR body, or the commit body.
- Commit or post them before you see the result.
- Run the checker on that text.

### 5. Make the change

Work in small steps. Run the Measurement when a step can move it.

### 6. Grade it

Re-run the Measurement. Add this block to the PR body:

```markdown
## Hypothesis self-grade

- **Predicted**: p99 under 200 ms
- **Observed**: p99 240 ms (baseline 410 ms)
- **Match**: partial
- **Lesson**: the cache fixed reads; writes still wait on the lock.
```

- Match is `yes`, `partial`, or `no`. Say it plainly.
- At or above Success: keep the change.
- Between Pivot and Success: inconclusive. Say so and name the next probe.
- Below Pivot: abandon the approach. Do not retry the same idea with new numbers.
- Run the checker with `--self-grade`.

### 7. Nothing can measure it yet

- Land a preparation PR first. It adds the counter, log line, or harness.
- Then open the change PR with before and after numbers.
- Never "instrument later".

## Examples

Good:

```markdown
- **Hypothesis**: cold `sync --dry-run` drops from 9 s to under 5 s because the catalog read is cached.
- **Measurement**: `hyperfine --runs 10 'npm run dev -- sync --dry-run'` median.
- **Success**: median at or below 5 s.
- **Pivot**: median above 8 s.
- **Anchor**: Kohavi, Tang, Xu 2020 (Trustworthy Online Controlled Experiments).
```

Bad, and why:

```markdown
- **Hypothesis**: the code gets better; we merge more PRs.   <- vanity count
- **Measurement**: check manually that it feels faster.     <- manual, no command
- **Success**: faster.                                        <- no number
- **Pivot**: faster.                                          <- same as Success
- **Anchor**: common best practice.                           <- no primary source
```

## Sources

- Munafò et al. 2017, "A manifesto for reproducible science", Nature Human Behaviour.
- Basili, Caldiera, Rombach 1994, "The Goal Question Metric Approach".
