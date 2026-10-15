# PR title
feat(tutor): verify questions against notes, tag misconceptions

## Summary
Generated quiz questions can need knowledge that is not in the vault, and wrong options often do not target a real confusion. This PR adds a Chain-of-Verification check before each question is shown, and tags each distractor with the misconception it targets. Wrong-answer feedback can then name the likely confusion.

## Details
- `tutor/SKILL.md` Phase 3: new step 4 verifies each question against the section notes, discards unsupported ones, and counts the discards.
- `tutor/SKILL.md` Phase 5: wrong-answer feedback names the tagged misconception; the discard count is reported in one line.
- `quiz-rules.md`: distractor rule now requires a hidden misconception tag per wrong option and reuses concept-file Error Notes.
- `quiz-rules.md`: new **Author-time Verification (CoVe)** section (answer from notes only, exactly one supported option, else rewrite).
- Zero-hint, randomization, and file-update rules are unchanged.
- Patch: [`patches/0001-*.patch`](patches/) (base `397110c`).

## Docs
Docs: the skill files are the docs; README unchanged because no new command or install step.

---
_🤖 Written by an agent, not Fyodor. Ping me if this looks off._

