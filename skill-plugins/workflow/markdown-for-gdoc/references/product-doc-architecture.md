# Product document information architecture (PM/PD)

When a product manager or product designer is joining a project, organize the
document around the decisions they need to make, not the chronology of the work,
repository boundaries, or the order in which research happened.

### Audit before editing

Build a short content map before changing the document:

1. Identify the primary audience and the first decision they need to make.
2. List every current heading with a one-line purpose.
3. Record duplicated claims and choose one canonical home for each.
4. Separate confirmed decisions, open questions, evidence, and implementation
   detail.
5. Flag contradictions instead of silently reconciling them.

Do not start rewriting until the target outline and duplicate ledger are clear.

### Recommended reading order

Use this order unless the document has a stronger audience-specific reason:

1. **Orientation** — title, current status, why the project matters, current
   milestone, and the next decision or review.
2. **Product definition** — user problem, target experience, scope, non-goals,
   and success signals.
3. **Decisions and open questions** — confirmed decisions first; unresolved
   questions separately with an owner and decision point.
4. **Milestone roadmap** — outcome, scope, and exit signal for each milestone.
   Define each milestone once.
5. **Experience and review plan** — scenarios, demo/review cadence, and how
   feedback changes the next milestone.
6. **Delivery and validation** — implementation sequence, release controls,
   evidence, and rollback.
7. **Technical contracts and dependencies** — architecture, repositories,
   APIs, owners, and constraints needed by delivery teams.
8. **References and history** — source links, research evidence, and archived
   detail that should not interrupt the first read.

Put product intent before architecture. Put architecture before repo-level task
detail. Keep historical research after the current plan.

### One fact, one canonical home

- State each milestone definition, scope boundary, dependency, and decision in
  one canonical section.
- A top summary may repeat the outcome in one sentence, but it must point to the
  canonical section instead of restating the details.
- If two sections answer the same reader question, merge them or keep the
  stronger section and replace the other with a short pointer.
- Keep decisions separate from supporting evidence. A decision says what the
  team will do; evidence explains why.
- Delete stale alternatives only after confirming they are superseded and do
  not carry anchored comments. Otherwise label them as historical.

### Information accents

- At the top, make **current status**, **current milestone**, **next review**,
  and **open asks** visually easy to scan.
- Use headings for reader questions and bold for short labels or decisions.
  Do not bold full paragraphs.
- Put exit criteria immediately under the milestone they close.
- Use bullets for parallel facts and steps; use prose for rationale.
- Use tables only for genuine comparisons. Do not turn narrative or task lists
  into tables.
- Keep implementation names, repo paths, and acronyms out of the first-read
  summary unless a reader needs them to make a decision.

### Clear product language

- Lead with outcomes before mechanisms.
- Define an acronym or internal term on first use.
- Prefer active voice and one idea per bullet.
- Name the actor: product, design, engineering, an owner team, or a reviewer.
- Replace vague phrases such as "hybrid", "bridge", "seam", or "iteration"
  with the concrete behavior they mean.
- Distinguish **current decision**, **proposal**, **assumption**, and
  **open question** explicitly.

### Reorganize surgically

For an existing collaborative document, improve the information architecture
without moving or replacing broad anchored ranges. Prefer:

1. Rename headings so their purpose is clear.
2. Consolidate duplicated paragraphs into the strongest existing section.
3. Replace secondary copies with one-line pointers.
4. Insert short orientation or open-question blocks at precise indices.
5. Move large sections only when comment-anchor inspection proves it is safe.

After each reorganization batch, run the structured-read and live visual checks
in this skill. Verify the outline, list boundaries, emphasis, and scan order,
not only the words.
