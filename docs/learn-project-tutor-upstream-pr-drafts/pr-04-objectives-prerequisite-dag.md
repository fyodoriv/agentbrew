# PR title
feat(tutor-setup): learning objectives contract + prerequisite DAG in vault output

## Why this is needed
Section order from source files is arbitrary. A prerequisite DAG ensures tutor questions respect concept dependencies (Understanding by Design / topological teaching order).

## Summary
During vault generation, emit per-section **objectives** ("By the end you can …") and a **prerequisite DAG** across concepts; tutor reads DAG for question ordering.

## Delivery plan
1. **`tutor-setup/SKILL.md` Phase D3/D4 or codebase equivalent** — after topic hierarchy, write `StudyVault/objectives.md` with section-level objectives.
2. **`tutor-setup/references/templates.md`** — add `StudyVault/concepts/_dag.md` (or frontmatter block) listing nodes + edges `A → B` ("learn A before B").
3. **`tutor/SKILL.md` Phase 3** — when building question order, topological-sort concepts using `_dag.md` before arbitrary note order.
4. **`tutor-setup/references/quality-checklist.md`** — verify every edge cites vault spans; refuse edges without grounding.

## Test plan
- [ ] Manual: vault with A→B edge quizzes A before B even if B's notes appear first in folder
- [ ] Objectives file present for each section after tutor-setup
- [ ] cite-or-refuse: no DAG edge without vault citation

## Pairs with
agentbrew `learn-project` Mermaid concept maps (Phase 5a) — diagram edges may mirror DAG; both must stay vault-grounded.
