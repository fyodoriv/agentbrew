# PR title
feat(tutor): add open recall mode with rubric grading

## Summary
Multiple choice tests recognition, but free recall builds stronger retention (Roediger & Karpicke 2006). This PR adds an "Open recall" session where the learner explains a concept in prose. The tutor grades the answer against a hidden 2–4 point rubric taken from the vault notes.

## Details
- `tutor/SKILL.md` Phase 2: new "Open recall" option once any area has data (menu still has at most 4 options).
- Phase 3: open recall crafts 2 questions, each with a 2–4 point rubric.
- Phase 4: asks one question at a time as a plain message; the rubric stays hidden until the answer.
- Phase 5: marks each rubric point met or missed, shows the score, and quotes the note for each missed point.
- Phase 6: counts as correct only when every point is met; missed points go into the error note.
- `quiz-rules.md`: new **Open-answer Rubric** section (meaning, not keywords; every point cites a note).
- MCQ modes are unchanged.
- Stacked on PR 1 (both edit Phase 3/5 lists). Patch: [`patches/0002-*.patch`](patches/).

## Docs
Docs: the skill files are the docs; README unchanged because no new command or install step.

---
_🤖 Written by an agent, not Fyodor. Ping me if this looks off._

