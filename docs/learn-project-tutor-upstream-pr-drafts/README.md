# tutor-skills upstream PR drafts

Ready-to-publish patches and PR bodies for [`bevibing/tutor-skills`](https://github.com/bevibing/tutor-skills).
**Status:** published 2026-10-15 as stacked PRs #8–#11; merge is up to the upstream maintainer.

Parent spec: [`../learn-project-tutor-upstream-contribution.md`](../learn-project-tutor-upstream-contribution.md)

## 90-day contribution window

| Milestone | Date | Status |
|-----------|------|--------|
| Local spec + PR drafts complete | 2026-07-08 | done |
| Upstream patches written and replay-verified | 2026-10-15 | done |
| Upstream PRs [#8](https://github.com/bevibing/tutor-skills/pull/8), [#9](https://github.com/bevibing/tutor-skills/pull/9), [#10](https://github.com/bevibing/tutor-skills/pull/10), [#11](https://github.com/bevibing/tutor-skills/pull/11) opened (fork `fyodoriv/tutor-skills`) | 2026-10-15 | done |
| Window closes (first PR + 90 days) | 2027-01-13 | open |
| Absorb-if-rejected decision | on close | fallback → P0(d) in agentbrew `learn-project` |

**Absorb trigger:** upstream rejects all four PRs, or no maintainer response within 90 days of the first PR.

**Upstream activity (2026-10-15):** last push 2026-02-28; zero PRs ever opened. A silent window is likely.

## PR stack

The patches form one linear stack on upstream `main` at `397110c`. All four edit the Phase 3 / Phase 5 lists in `tutor/SKILL.md`, so independent branches conflict. Open them in order; each later PR says "stacked on #N".

| # | Body | Patch | Target skill |
|---|------|-------|--------------|
| 1 | [pr-01](./pr-01-cove-misconception-distractors.md) | `patches/0001-*.patch` | `tutor` |
| 2 | [pr-02](./pr-02-open-answer-rubric.md) | `patches/0002-*.patch` | `tutor` |
| 3 | [pr-03](./pr-03-bloom-confidence.md) | `patches/0003-*.patch` | `tutor` |
| 4 | [pr-04](./pr-04-objectives-prerequisite-dag.md) | `patches/0004-*.patch` | `tutor-setup` + `tutor` |

## Publish commands (after approval)

Run from an empty scratch directory. Each body file starts with a 3-line `# PR title` header; `sed 1,3d` strips it.

```bash
DRAFTS=~/apps/tooling/agentbrew/docs/learn-project-tutor-upstream-pr-drafts
gh repo fork bevibing/tutor-skills --clone && cd tutor-skills
git checkout -b feat/cove-misconception-metadata 397110c && git am "$DRAFTS"/patches/0001-*.patch
git checkout -b feat/open-answer-rubric && git am "$DRAFTS"/patches/0002-*.patch
git checkout -b feat/bloom-confidence && git am "$DRAFTS"/patches/0003-*.patch
git checkout -b feat/objectives-prerequisite-dag && git am "$DRAFTS"/patches/0004-*.patch
git push -u origin feat/cove-misconception-metadata feat/open-answer-rubric feat/bloom-confidence feat/objectives-prerequisite-dag
gh pr create -R bevibing/tutor-skills --base main --head fyodoriv:feat/cove-misconception-metadata \
  --title "$(sed -n 2p "$DRAFTS"/pr-01-*.md)" --body "$(sed 1,3d "$DRAFTS"/pr-01-*.md)"
```

Open PRs 2–4 only after PR 1 gets a maintainer response; rebase each onto upstream `main` once its parent merges.

Do **not** edit agentbrew's symlinked `~/.claude/skills/tutor*` — changes land upstream only.
