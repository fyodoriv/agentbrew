# learn-project — upstream tutor contribution spec

Draft for contribution to [`bevibing/tutor-skills`](https://github.com/bevibing/tutor-skills).
**Publish gate:** opening the upstream PR requires explicit user approval (TASKS.md
publishing policy). agentbrew owns orchestration in `learn-project`; these mechanics
belong in `tutor-setup` / `tutor`.

**90-day window:** if upstream rejects or ignores, absorb into `learn-project` as
P0(d) fallback per VISION delegate-contribute-absorb.

**Ready-to-paste PR bodies:** [`learn-project-tutor-upstream-pr-drafts/`](learn-project-tutor-upstream-pr-drafts/README.md) (publish still gated).

---

## 1. Question-generation self-verification (CoVe)

**Skill:** `tutor` (quiz generation phase)

**Behavior:** After authoring each question, run a self-check before writing it to
the vault:

1. Attempt to answer the question using **only** the generated vault notes.
2. If no unique correct answer is supported, discard and regenerate.
3. Log discarded count in the tutor session summary.

**Why upstream:** Generation-time check is intrinsic to the question generator;
`learn-project` already runs an orchestration-layer gate (Phase 5c) on the assembled
vault — both layers are complementary.

---

## 2. Free-recall / rubric-graded open answers

**Skill:** `tutor` (assessment modes)

**Behavior:**

- Add an **open-answer** question type alongside MCQ.
- User explains a concept in prose; tutor grades against a **rubric** derived from
  vault notes (key points checklist, not keyword matching).
- Partial credit + specific misconception feedback when a rubric point is missed.

**Why upstream:** Grading mechanics and prompt templates live in the tutor engine;
`learn-project` selects when to invoke open-answer vs MCQ.

---

## 3. Bloom-level tagging + laddering

**Skill:** `tutor-setup` (practice question authoring) + `tutor` (selection)

**Behavior:**

- Tag each practice question with a Bloom level: remember → understand → apply →
  analyze → evaluate → create.
- `tutor` progression: start at understand/apply for diagnostics; climb the ladder
  before marking a concept mastered.
- Store tags in practice frontmatter or concept tracker metadata.

**Pairs with:** agentbrew `learn-project` mastery threshold (two corrects incl. one
applied) — Bloom "apply" satisfies the applied/analysis requirement.

---

## 4. Confidence calibration

**Skill:** `tutor` (every question)

**Behavior:**

- After each answer, ask confidence: low / medium / high.
- **High confidence + wrong** → flag as **misconception** (not just a miss); add to
  concept tracker with a dedicated error note; prioritize in next drill.
- **Low confidence + correct** → partial credit signal; may still need retention
  re-test.

**Why upstream:** UI flow and scoring live in tutor; `learn-project` reads misconception
flags from the vault tracker.

---

## 5. Misconception-based distractors

**Skill:** `tutor` (MCQ authoring)

**Behavior:**

- When generating distractors, name the **misconception** each distractor targets
  (stored in question metadata, not shown to user).
- On miss, feedback cites the misconception: "You may be thinking X; the vault says Y
  because …"
- Build distractors from common errors in concept inventories / prior session error
  notes when available.

---

## 6. Learning objectives + prerequisite DAG

**Skill:** `tutor-setup` (vault structure)

**Behavior:**

- Emit a short **objectives contract** per section ("By the end you can …").
- Build a **prerequisite DAG** across concepts (edges = "learn A before B").
- `tutor` question order respects the DAG (topological sort), not arbitrary note order.

**Pairs with:** agentbrew `learn-project` Mermaid concept maps (Phase 5a) — DAG can
feed diagram edges; both must be cite-or-refuse grounded.

---

## Proposed upstream PR split

| PR | Repo | Scope |
|----|------|-------|
| 1 | tutor-skills | CoVe self-check at question authoring + misconception metadata on distractors |
| 2 | tutor-skills | Open-answer + rubric grading mode |
| 3 | tutor-skills | Bloom tags + confidence calibration in quiz flow |
| 4 | tutor-skills | Objectives contract + prerequisite DAG in tutor-setup output |

## agentbrew non-goals (stay in learn-project)

- Multi-source staging, freshness hashing, MCP gathering
- Orchestration verification gate (Phase 5c), mastery %, interleave selection
- Applied/transfer task types graded against staged repos
