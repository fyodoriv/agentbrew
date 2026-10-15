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

Inspired by [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) and generalized by [codex-autoresearch](https://github.com/leo-lilinxiao/codex-autoresearch).

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

Use a [Conventional Commits](https://www.conventionalcommits.org/) type, not an `iterate:` prefix. Each commit is a clean revert point.

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

Log each iteration in one line, for example `Iteration 3: replaced any in auth.ts → 47→44 ✅ kept`.

### 2.8 Stuck recovery

If progress stalls:

- **3 consecutive discards** → **REFINE**: step back, re-read the code, try a different approach to the same area
- **5 consecutive discards** → **PIVOT**: switch to a completely different part of the scope or a different strategy
- **2 PIVOTs without progress** → **STOP**: report what was achieved and what's blocking further progress

A single successful keep resets all counters.

## Cross-Run Learning and Parallel Experiments

After every keep and every pivot, record a lesson in the local, untracked
`.orchestrator/autoresearch-lessons.md`. Read it before the first hypothesis of a
later run. Keep at most 50 lessons. For the file format and for testing
independent hypotheses in parallel worktrees, read
[`references/lessons-and-parallel.md`](references/lessons-and-parallel.md).

## Phase 3: Completion

When the target is reached or a stop condition is hit:

1. Run the full guard command one final time
2. Summarize: starting → ending metric, iterations (kept / discarded), key lessons, and remaining items that need a human.

Write a report to `.orchestrator/<pipeline-id>/iterate.md`, or to
`.orchestrator/iterate.md` for a standalone run. Use the template and example
verify/guard pairs in [`references/report-and-examples.md`](references/report-and-examples.md).

## Related Skills

- **Superpowers refactor-under-TDD** — structural changes without metric targets (rename, extract, move)
- **Superpowers systematic-debugging** — single-pass bug investigation and fixing
- **`project-audit`** — discover what metrics need improvement

## Constraints (Do NOT)

- **Do NOT batch multiple hypotheses into one commit** — one change per iteration
- **Do NOT use subjective judgment for verify/guard** — both commands must be deterministic shell commands with numeric output
- **Do NOT modify the guard command** to make it pass — fixing the guard is a separate task
- **Do NOT skip the pre-verify commit** or stage broadly (see 2.4)
- **Do NOT manually undo a failed change** — use `git revert --no-edit HEAD` to keep history clean
- **Do NOT make unrelated changes** during the loop — note bugs, fix them after the loop
- **Do NOT keep a change that improves the metric by under 1%** if it adds disproportionate complexity
- **Do NOT ask the user mid-loop** — once they say "go", apply best judgment and keep iterating until a hard stop condition
