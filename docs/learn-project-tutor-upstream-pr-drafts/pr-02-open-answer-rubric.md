# PR title
feat(tutor): open-answer questions with vault-grounded rubric grading

## Why this is needed
MCQ-only assessment overfits recognition over recall. Free-recall with a rubric derived from vault notes measures understanding closer to retrieval practice (Roediger & Karpicke).

## Summary
Add an **open-answer** session mode alongside MCQ: user explains in prose; tutor grades against a checklist rubric from vault notes with partial credit and misconception feedback.

## Delivery plan
1. **`tutor/SKILL.md` Phase 2** — add "Open recall" session option when user selects drill or section study.
2. **`tutor/SKILL.md` Phase 3** — for open-answer rounds, emit 2–4 rubric items per question (key points from vault, not keywords).
3. **`tutor/SKILL.md` Phase 4** — use free-text input (or structured multi-field) instead of AskUserQuestion MCQ when mode is open-answer.
4. **`tutor/SKILL.md` Phase 5** — grade each rubric point met/missed; partial score; cite vault span for missed points.
5. **`tutor/references/quiz-rules.md`** — new **Open-answer rubric** section: rubric must be derivable from vault only; no keyword matching.

## Test plan
- [ ] Manual: open-answer round on one section; rubric visible to grader logic, not leaked to user pre-answer
- [ ] Partial credit updates concept file correctly
- [ ] MCQ path unchanged when user picks diagnostic/drill MCQ modes
