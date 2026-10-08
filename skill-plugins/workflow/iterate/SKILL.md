---
name: iterate
description: >
  Autonomous iterative improvement loop: modify → verify → keep/discard → repeat.
  Drives a measurable metric toward a target using atomic changes with automatic rollback,
  cross-run lessons, and optional parallel experiments. Use when you have a quantifiable
  goal (reduce lint warnings, increase test coverage, eliminate type errors, improve
  performance). Don't use for one-shot fixes or structural refactoring.
---

## Core Concept

Inspired by [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) and generalized by [codex-autoresearch](https://github.com/leo-lilinxiao/codex-autoresearch). If a goal has a number, this skill can iterate toward it autonomously.

```
baseline → change → verify → keep or discard → repeat
```

Every kept change stacks. Every failed change reverts. Progress is monotonic.

## Phase 1: Setup

### 1.1 Establish the goal

From the user's request, infer:

- **Goal** — what we're improving ("eliminate `any` types", "increase test coverage to 90%")
- **Scope** — which files/directories are in play
- **Metric** — the number we're tracking (count, percentage, duration)
- **Direction** — `lower` or `higher`
- **Verify command** — shell command that outputs the metric (e.g., `grep -r 'any' src/ | wc -l`)
- **Guard command** — shell command that must stay green (check `package.json` scripts, e.g. `yarn test`, `yarn verify`)

If any required field is ambiguous, ask ONE round of clarifying questions. Then start.

### 1.2 Take the baseline

Run the verify command. Record the starting metric value. Run the guard command to confirm it passes. If the guard fails before we start, stop — fix the guard first.

### 1.3 Confirm with user

Show the inferred config and baseline in a compact summary:

```
Goal:    Eliminate `any` types in src/
Metric:  `any` count → 47 (target: 0, direction: lower)
Verify:  grep -rw 'any' src/**/*.ts | wc -l
Guard:   npx tsc --noEmit
Scope:   src/**/*.ts
```

Ask: "Go?" — then start immediately on approval.

## Phase 2: The Loop

Repeat until the target is reached, the user interrupts, or a hard stop condition is hit:

### 2.1 Assess current state

Read the metric, recent git history, and any lessons from prior iterations.

### 2.2 Pick ONE hypothesis

Choose the single most promising change. Consider:
- What has worked in previous iterations (if any)
- What has failed (avoid repeating)
- Which files have the most remaining metric contribution

### 2.3 Make ONE atomic change

Edit the minimum code needed to test the hypothesis. One file if possible. Small diff.

### 2.4 Commit before verification

Stage only the files you changed in this iteration — never `git add -A`, `git add .`, or other broad staging:

```bash
git add path/to/changed-file.ts
git commit -m "refactor: narrow description of the atomic change"
```

Use a [Conventional Commits](https://www.conventionalcommits.org/) type (`fix`, `refactor`, `test`, `perf`, …) — not a custom `iterate:` prefix. This gives a clean revert point per iteration.

### 2.5 Dual-gate verification

Run both gates in order:

1. **Verify** — did the metric improve? Run the verify command, compare to previous value.
2. **Guard** — did anything else break? Run the guard command.

### 2.6 Decide

| Verify | Guard | Action |
|--------|-------|--------|
| ✅ improved | ✅ passes | **Keep** — log the win, extract lesson |
| ✅ improved | ❌ fails | **Rework** — fix the guard regression (up to 2 attempts), then re-verify. If still failing, discard. |
| ❌ no improvement | ✅ passes | **Discard** — `git revert --no-edit HEAD`. Log what didn't work. |
| ❌ no improvement | ❌ fails | **Discard** — `git revert --no-edit HEAD`. Log the failure. |

### 2.7 Log the result

Track each iteration mentally or in commit messages:

```
Iteration 3: replaced `any` in auth.ts → count 47→44 ✅ kept
Iteration 4: replaced `any` in db.ts → tsc failed ❌ discarded
```

### 2.8 Stuck recovery

If progress stalls:

- **3 consecutive discards** → **REFINE**: step back, re-read the code, try a different approach to the same area
- **5 consecutive discards** → **PIVOT**: switch to a completely different part of the scope or a different strategy
- **2 PIVOTs without progress** → **STOP**: report what was achieved and what's blocking further progress

A single successful keep resets all counters.

## Cross-Run Learning

Record reusable lessons after every successful keep and every pivot in a local,
untracked `.orchestrator/autoresearch-lessons.md` file:

```markdown
## What Worked
- [Lesson]: [why the hypothesis improved the metric without breaking the guard]

## What Failed
- [Lesson]: [why the hypothesis failed or was discarded]

## Strategic
- [Lesson]: [what changed after a refine or pivot]
```

Read this file before choosing the first hypothesis in a later run. Keep at most
50 lessons and summarize older entries instead of allowing the log to grow
without bound.

## Parallel Experiments (Optional)

When multiple hypotheses are equally promising, test them in isolated worktrees:

```
Main agent (orchestrator)
├── Worktree A → hypothesis 1
├── Worktree B → hypothesis 2
└── Worktree C → hypothesis 3
```

Use parallel experiments only when the hypotheses are independent and the metric
is deterministic. Keep the best verified result, integrate it into the main
branch, and discard the other worktrees without merging their unrelated commits.

## Phase 3: Completion

When the target is reached or a stop condition is hit:

1. Run the full guard command one final time
2. Summarize results:
   - Starting metric → ending metric
   - Number of iterations (kept / discarded)
   - Key lessons learned
   - Any remaining items that couldn't be automated

Write a report to `.orchestrator/<pipeline-id>/iterate.md` when the run has a
pipeline identifier, or to `.orchestrator/iterate.md` for a standalone run:

```markdown
## Iterate Report

### Goal
[What was the target]

### Results
- Baseline: [starting metric]
- Final: [ending metric]
- Improvement: [delta and percentage]
- Iterations: [total] (kept: [N], discarded: [N])

### Key Lessons
- [Top insights from the run]

### Remaining Work
- [What could not be automated or needs human judgment]

### Verdict
<!-- VERDICT: PASS -->
Target achieved / Target partially achieved / Target not achieved
```

## Example Use Cases

| Goal | Verify | Guard |
|------|--------|-------|
| Eliminate `any` types | `grep -rwc 'any' src/ \| wc -l` | `npx tsc --noEmit` |
| Increase test coverage to 90% | `jest --coverage 2>&1 \| grep Statements` | `yarn test` |
| Reduce lint warnings | `eslint src/ 2>&1 \| grep problems \| awk '{print $2}'` | `yarn test` |
| Reduce bundle size | `yarn build 2>&1 \| grep 'bundle size'` | `yarn build` |
| Fix all TODO comments | `grep -r 'TODO' src/ \| wc -l` | `yarn test` |
| Reduce cyclomatic complexity | `npx complexity-report src/ \| grep Average` | `yarn test` |

## Related Skills

- **Superpowers refactor-under-TDD** — structural changes without metric targets (rename, extract, move)
- **Superpowers systematic-debugging** — single-pass bug investigation and fixing
- **`project-audit`** — discover what metrics need improvement

## Constraints (Do NOT)

- **Do NOT use `git add -A`, `git add .`, or other broad staging** — stage only the paths changed in the current iteration
- **Do NOT use a custom `iterate:` commit type** — use Conventional Commits (`fix`, `refactor`, `test`, …)
- **Do NOT batch multiple hypotheses into one commit** — one change per iteration so you know exactly what worked or failed
- **Do NOT use subjective judgment for verify/guard** — both commands must be deterministic shell commands with numeric output
- **Do NOT modify the guard command** to make it pass — if the guard needs fixing, that's a separate task outside the loop
- **Do NOT skip the pre-verify commit** — always commit before running gates so you have a clean revert point
- **Do NOT manually undo a failed change** — use `git revert --no-edit HEAD` to keep history clean
- **Do NOT make unrelated changes** during the loop — note discovered bugs, fix them after the loop completes
- **Do NOT keep a change that improves the metric by under 1%** if it adds disproportionate complexity
- **Do NOT ask the user mid-loop** — once they say "go", apply best judgment and keep iterating until a hard stop condition
