# PR title
feat(tutor-setup): add Learning Path with objectives and prerequisites

## Summary
Tutor currently asks about concepts in folder order, so it can quiz a topic before its prerequisites. This PR makes tutor-setup write a `Learning Path` note with per-section objectives and cited prerequisite edges. Tutor then orders questions by that path (Understanding by Design, Wiggins & McTighe).

## Details
- `tutor-setup/SKILL.md` D2: dependency mapping now produces cited prerequisite edges.
- D5: `00-Dashboard/` gains a Learning Path note.
- `templates.md`: new **Learning Path Template** (Objectives, Prerequisites with source, Study Order) and rules: every edge cites a source, no cycles, action-verb objectives.
- `quality-checklist.md`: one new Document Mode check for the Learning Path.
- `tutor/SKILL.md` Phase 3: if a Learning Path exists, ask about prerequisites first and skip concepts whose prerequisites are still 🔴.
- Codebase Mode is unchanged (it already has an Onboarding Path).
- Stacked on PR 3. Patch: [`patches/0004-*.patch`](patches/).

## Docs
Docs: the skill files are the docs; README unchanged because no new command or install step.

---
_🤖 Written by an agent, not Fyodor. Ping me if this looks off._

