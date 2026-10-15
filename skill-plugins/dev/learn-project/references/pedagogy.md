# Pedagogy layer

learn-project applies these rules on top of `tutor-setup` and `tutor`. Apply them while
you drive those skills. Do not edit the upstream skill files.

Each rule names the phase where it runs.

## 1. Question verification + misconception tags (Phase 5c, Phase 6)

**Verify before you ask.** Answer each question from the vault notes only. Keep it only
if the notes support exactly one option and rule out every distractor. Otherwise rewrite
it. The Phase 5c gate does this for practice files; do the same for every question you
write live in Phase 6.

**Tag every distractor.** Each wrong option targets one named misconception, for example
`misconception: "422 means malformed JSON"`. Keep tags in your working notes. Never show
them in labels or descriptions. Build distractors from:

- confusions in `concepts/*.md` error notes
- Exam Traps entries
- common errors the staged sources warn about

**Name it on a miss.** When the user picks a tagged distractor, say: "You may be thinking
{misconception}. The notes say {fact} ({vault note})."

## 2. Open recall with a rubric (Phase 6)

Recognition (multiple choice) is weaker than recall. Once a section has data, offer an
**Open recall** round:

- Ask 1–2 "explain", "why", or "what happens when" questions. Ask one at a time as a plain
  message and wait for a prose answer. Do not show options.
- Before you ask, write 2–4 rubric points. Each point is a key idea that a vault note
  states, with that note cited. Drop any point the notes do not cover.
- Grade by meaning, not keywords. A correct paraphrase meets the point.
- Show the score (for example 2/3). Quote the vault note for each missed point.
- Count the answer as correct only when every point is met. Otherwise record the missed
  points in the concept's error note.

Keep the rubric hidden until the user answers.

## 3. Bloom levels and the ladder (Phase 5 audit, Phase 6)

Tag every question with one Bloom level: `remember` · `understand` · `apply` · `analyze` ·
`evaluate` · `create`.

| tutor-setup tag | Bloom level |
|-----------------|-------------|
| `[recall]` | remember / understand |
| `[application]` | apply |
| `[analysis]` | analyze |

Applied tasks (locate-owner, where-to-add, trace-the-bug, blast-radius) are `apply` or
`analyze`.

- **Diagnostic:** start at `understand` / `apply`.
- **Drill:** ask one level above the highest level the user has answered correctly for
  that concept.
- **Gate:** a concept is 🟢 only after a correct answer at `apply` or higher. This is the
  "at least one applied/analysis" part of the mastery threshold.
- **Record:** in `concepts/*.md`, keep the highest correct level per concept in a `Level`
  column. If the table has no such column, add it and set old rows to `-`.

## 4. Confidence calibration (Phase 6)

After the user answers and **before** you reveal results, ask confidence: Low / Medium /
High. For multiple choice, ask it in one extra AskUserQuestion with one item per question.

| Confidence | Result | Meaning | Action |
|------------|--------|---------|--------|
| High | Wrong | Misconception | Add `Misconception: yes (high confidence)` to the error note. Drill it first next round. |
| Low | Correct | Fragile | Keep the status. Count it as 🟡, not toward 🟢, until a later correct answer. |
| High | Correct | Known | Normal update. |
| Low / Medium | Wrong | Gap | Normal update. |

Show misconception flags in the round's results table.

## 5. Learning Path: objectives + prerequisites (Phase 5d, Phase 6)

After the concept maps, write `StudyVault/00-Dashboard/Learning Path.md`:

```markdown
# Learning Path

## Objectives
| Section | By the end you can … |
|---------|----------------------|
| [[01-Section]] | explain X; choose between Y and Z |

## Prerequisites
| Learn first | Before | Source |
|-------------|--------|--------|
| [[Concept A]] | [[Concept B]] | sources/docs/repos/app/ARCHITECTURE.md §Data flow |

## Study Order
1. [[Concept A]]
2. [[Concept B]]
```

- **Objectives** use action verbs (explain, compare, choose, debug, locate), not
  "understand X".
- **Cite every edge.** Each prerequisite edge cites a staged path or vault note. Drop any
  edge you cannot cite.
- **No cycles.** Study Order is a topological sort of the edges.
- The concept-map Mermaid edges and the Prerequisites table must agree.

**In Phase 6:**

- Within weakest-first selection, ask a concept only after its prerequisites are tested.
- Skip a concept while any of its prerequisites is 🔴. Teach the prerequisite first.

## Sources

- Dhuliawala et al. 2023 — Chain-of-Verification (rule 1)
- Roediger & Karpicke 2006 — retrieval practice (rule 2)
- Anderson & Krathwohl 2001 — revised Bloom's taxonomy (rule 3)
- Hestenes et al. 1992 — Force Concept Inventory, misconception distractors (rule 1)
- Butterfield & Metcalfe 2001 — hypercorrection of high-confidence errors (rule 4)
- Wiggins & McTighe 2005 — Understanding by Design (rule 5)
