# Iterate: lessons file and parallel experiments

Load this file when you write the lessons file or run hypotheses in parallel.

## Cross-run learning

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

## Parallel experiments (optional)

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
