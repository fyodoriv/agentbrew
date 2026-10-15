# Iterate: completion report and example metrics

Load this file at Phase 3, or when you pick a verify and guard command.

## Completion report

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

## Example use cases

| Goal | Verify | Guard |
|------|--------|-------|
| Eliminate `any` types | `grep -rwc 'any' src/ \| wc -l` | `npx tsc --noEmit` |
| Increase test coverage to 90% | `jest --coverage 2>&1 \| grep Statements` | `yarn test` |
| Reduce lint warnings | `eslint src/ 2>&1 \| grep problems \| awk '{print $2}'` | `yarn test` |
| Reduce bundle size | `yarn build 2>&1 \| grep 'bundle size'` | `yarn build` |
| Fix all TODO comments | `grep -r 'TODO' src/ \| wc -l` | `yarn test` |
| Reduce cyclomatic complexity | `npx complexity-report src/ \| grep Average` | `yarn test` |
