# tutor-skills upstream PR drafts

Ready-to-paste PR bodies for [`bevibing/tutor-skills`](https://github.com/bevibing/tutor-skills).
**Publish gate:** push + `gh pr create` requires explicit user approval per session.

Parent spec: [`../learn-project-tutor-upstream-contribution.md`](../learn-project-tutor-upstream-contribution.md)

## 90-day contribution window

| Milestone | Date | Status |
|-----------|------|--------|
| Local spec + PR drafts complete | 2026-07-08 | done |
| First upstream PR opened | — | pending approval |
| Window closes (first PR + 90 days) | T+90 from first PR | — |
| Absorb-if-rejected decision | on close | fallback → P0(d) in agentbrew `learn-project` |

**Absorb trigger:** upstream rejects all four PRs, or no maintainer response within 90 days of the first PR.

## PR sequence

| # | File | Target skill | Depends on |
|---|------|--------------|------------|
| 1 | [pr-01-cove-misconception-distractors.md](./pr-01-cove-misconception-distractors.md) | `tutor` | — |
| 2 | [pr-02-open-answer-rubric.md](./pr-02-open-answer-rubric.md) | `tutor` | — |
| 3 | [pr-03-bloom-confidence.md](./pr-03-bloom-confidence.md) | `tutor` + `tutor-setup` | 1 (metadata shape) |
| 4 | [pr-04-objectives-prerequisite-dag.md](./pr-04-objectives-prerequisite-dag.md) | `tutor-setup` | — |

## Publish commands (after approval)

```bash
# Fork + clone bevibing/tutor-skills, then one branch per PR:
git checkout -b feat/cove-misconception-metadata
# apply edits per pr-01 body, commit, push, gh pr create --body-file docs/.../pr-01-....md
```

Do **not** edit agentbrew's symlinked `~/.claude/skills/tutor*` — changes land upstream only.
