# PR title
feat(tutor): Bloom-level tags + confidence calibration in quiz flow

## Why this is needed
Question difficulty should ladder (Bloom's taxonomy). Confidence calibration separates "lucky guess" from mastery and flags high-confidence errors as misconceptions worth prioritizing.

## Summary
Tag each practice question with a Bloom level; ask confidence after each answer; flag high-confidence wrong as misconception in concept tracker.

## Delivery plan
1. **`tutor-setup/references/templates.md`** (or practice frontmatter template) — add `bloom: remember|understand|apply|analyze|evaluate|create` on each practice question block.
2. **`tutor/SKILL.md` Phase 3** — respect Bloom ladder: diagnostic starts understand/apply; climb before marking concept mastered.
3. **`tutor/SKILL.md` Phase 5** — after grading, AskUserQuestion confidence: low / medium / high.
4. **`tutor/SKILL.md` Phase 6** — high confidence + wrong → set misconception flag + error note; low confidence + correct → note partial mastery (may still need retention).
5. **`tutor/references/quiz-rules.md`** — document Bloom tagging + confidence rules.

## Test plan
- [ ] Manual: concept with apply-level miss stays 🟨 until apply-level correct
- [ ] High-confidence wrong appears as prioritized 🔴 in next drill
- [ ] Bloom tag stored in concept file metadata

## Pairs with
agentbrew `learn-project` mastery threshold (two corrects incl. one applied).
