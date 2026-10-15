# PR title
feat(tutor): add Bloom ladder and confidence calibration

## Summary
Today a concept counts as known after one correct recall answer, and a lucky guess looks the same as real knowledge. This PR tags every question with a Bloom level and requires a correct `apply`-level answer before a concept turns 🟢. It also asks for confidence before grading, so a high-confidence wrong answer is flagged as a misconception and drilled first.

## Details
- `tutor/SKILL.md` Phase 3: tag each question with a Bloom level; drills put `Misconception: yes` concepts first.
- Phase 4: a second AskUserQuestion asks confidence (Low / Medium / High) per question before grading.
- Phase 5: high-confidence wrong answers are flagged in the results table.
- Phase 6: Bloom ladder gate for 🟢, a new `Level` column (old tables get the column with `-`), misconception and fragile-knowledge rules.
- `quiz-rules.md`: new **Bloom Ladder** and **Confidence Calibration** sections; maps tutor-setup's `[recall]/[application]/[analysis]` tags to Bloom levels, so tutor-setup templates do not change.
- Stacked on PR 2. Patch: [`patches/0003-*.patch`](patches/).

## Docs
Docs: the skill files are the docs; README unchanged because no new command or install step.

---
_🤖 Written by an agent, not Fyodor. Ping me if this looks off._

