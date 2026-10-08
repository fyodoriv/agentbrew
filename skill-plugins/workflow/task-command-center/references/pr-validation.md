# PR validation block (task-command-center)

Every **`gh pr create`** / **`gh pr edit`** body must include these three sections (hook: `gh-pr-body-requires-validation`):

| Section | Purpose |
|---------|---------|
| **## Requirements checklist** (alias: **## What this PR delivers**) | Checkboxes for requirements **this PR alone** implements — every box should be `[x]` when ready for review. Epic / initiative tracking belongs in **Jira**, not unchecked boxes for sibling PRs. |
| **## Previous state** | Bugfix: repro steps. Feature: reach **this PR's** change surface |
| **## Validation steps** | Reviewer commands + manual checks for **this PR** (not the whole epic) |

Aliases: `## What this change is about`, `## How to see previous state`, `## How to validate` / `## How to validate this PR delivers the whole task`.

## PR body anti-patterns (IRON LAW)

| Forbidden | Do instead |
|-----------|------------|
| **`Status:`** lines (`**Status: Ready for review.**`, `Status: Draft`, etc.) | Use GitHub **draft** vs **ready** on the PR itself — draft state is the status |
| Epic-wide requirement checkboxes with `[ ]` for other PRs / E2E / config portal | Track initiative scope in **Jira**; checklist here lists only what **this PR** ships (all `[x]` when ready) |
| Duplicate **Summary** / **Test plan** sections | One of each; hook validation block + optional Summary is enough |

## Draft vs ready (IRON LAW)

- **Default:** open cross-repo chain PRs as **`gh pr create --draft`**.
- **Stay draft** until **all merge blockers** for this PR are merged **and** the PR is ready for human review.
- **Convert to ready** (`gh pr ready`) only when this PR can merge immediately after approval — not when upstream chain PRs are still open.
- **Blocked PRs** say at the top: `⚠️ Draft — blocked on [#NNN](url) merging first.` (list every direct blocker; no `Status:` prefix).
- **First PR in a chain** with no blockers may be marked ready when CI-green and review-ready.

Cross-repo chains also include **`## Merge / deployment order`** — not a substitute for Jira epic tracking.

## Template

```markdown
## Requirements checklist
What **this PR** delivers (all `[x]` when ready for review). Initiative / sibling-PR scope → Jira ticket.

- [x] Requirement this PR implements
- [x] Another requirement in this diff only

## Previous state
1. …

## Validation steps
1. …

## Summary
One paragraph: why needed.

## Test plan
- [x] `exact verify command` — pass
```

**Bypass (emergency):** `HOOK_BYPASS_GH_PR_BODY_REQUIRES_VALIDATION=1` — file follow-up.

## Stacked skill carve-out

Greenfield skill/wizard stacks use **Summary + Delivery plan + Test plan** only — not Requirements/Previous/Validation. Phase-delta branches: one commit, paths from `git diff prev..child` only; `check-stack-pr-overlap.sh` before `[#A, #B]`. Refresh delivery plan on every chain merge (same session).

## Delivery plan refresh

When any chain PR merges: update every open chain PR body + README **## Status** in the same session.
