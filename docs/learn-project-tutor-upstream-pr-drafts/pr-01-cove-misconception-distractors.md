# PR title
feat(tutor): CoVe self-check at question authoring + misconception distractor metadata

## Why this is needed
MCQ generation can produce questions answerable without vault knowledge or distractors that don't target real misconceptions. Chain-of-Verification at author time catches ungrounded questions before they reach the user; misconception metadata improves feedback quality.

## Summary
Add a mandatory self-verification step in Phase 3 (Build Questions) and extend quiz metadata so each distractor records the misconception it targets.

## Delivery plan
1. **`tutor/SKILL.md` Phase 3** — after crafting each question, attempt to answer using **only** section vault notes; discard and regenerate if no unique grounded answer exists; log `discarded_ungrounded` count in session summary.
2. **`tutor/references/quiz-rules.md`** — new section **Author-time verification (CoVe)** with the three-step loop above.
3. **`tutor/references/quiz-rules.md`** — extend **Plausible distractors** with required `misconception:` frontmatter or inline comment per wrong option (not shown to user).
4. **`tutor/SKILL.md` Phase 5** — on miss, feedback cites misconception when metadata present: "You may be thinking {misconception}; the vault says …"

## Test plan
- [ ] Manual: generate 10 questions from a sample StudyVault; verify discarded count logged when notes are thin
- [ ] Manual: wrong-answer feedback references misconception text when metadata set
- [ ] Existing zero-hint / randomization rules unchanged

## Pairs with
agentbrew `learn-project` Phase 5c orchestration gate (complementary, not duplicate).
