---
name: markdown-for-gdoc
description: >
  Rules for working with Google Docs from an agent context. Covers (1) writing
  markdown that renders correctly when pasted into a GDoc (diagrams, tables,
  code blocks, headings, links, formatting) and (2) editing an existing GDoc
  surgically without destroying paragraph styles, table widths, comment
  anchors, or list nesting. Also covers audience-first information architecture
  for PM/PD product documents and the absolute comment-protocol rules (preserve
  others' comments, never resolve them, never post under user's identity
  without per-action approval). Use when authoring RFCs or design
  docs for Google Docs, or when an agent must modify an existing GDoc. Don't
  use for general markdown or GitHub-only documents.
---

## When to invoke

**Yes:** authoring RFCs or design docs destined for Google Docs; converting
markdown so paste/converter output renders correctly; surgically editing an
existing GDoc without destroying styles, table widths, comment anchors, or list
nesting; replying to GDoc comments (only with per-action approval) after
verified doc changes.

**No:** GitHub-only READMEs or repo markdown with no GDoc destination; general
markdown linting without GDoc constraints (use `doc-check`); RFC authoring from
scratch when the deliverable stays in-repo only (use `rfc` without GDoc
formatting pass); posting GDoc comments or resolving threads without explicit
per-action approval.

## Purpose

Rules for writing markdown that displays correctly when copy-pasted into Google Docs. Google Docs does not natively render markdown — content is typically pasted via a markdown-to-gdoc converter or rich-text paste. These rules ensure the output looks right regardless of method.

## Product document information architecture (PM/PD)

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

## Diagrams

**Never use ASCII art or box-drawing characters** (─ │ ┌ ┐ └ ┘ ├ ┤ etc.). Google Docs uses proportional fonts — ASCII diagrams will always misalign.

Instead, use one of these alternatives (in order of preference):

1. **Nested bullet lists** — describe layout hierarchically:
   ```markdown
   The app UI has three main areas:
   - **TopNav** — horizontal bar at the top
     - **Menu** (top-left) — `primaryItems` and `secondaryItems`, each linking to a scene
     - **Tools** (top-right) — messaging, notes, tasks
   - **Scene** (main area) — full page views like engagement view, dashboard, case view
     - **Command Center** — toolbar with tool buttons, search, slash commands (AI Native only)
   ```

2. **Simple tables** — for grid-like layouts:
   ```markdown
   | Area | Position | Contents |
   |---|---|---|
   | Menu | Top-left | primaryItems, secondaryItems |
   | Tools | Top-right | messaging, notes, tasks |
   | Scene | Main area | engagementView, dashboard, caseView |
   ```

3. **Prose description** — when structure is simple enough to describe in a sentence or two.

## Tables

- Keep tables **simple** — max 4-5 columns. Wide tables break in Google Docs.
- Avoid long cell content. If a cell needs more than ~40 characters, use a shorter summary and explain in prose below the table.
- Always include a header row.
- Don't nest tables.

## Code Blocks

- **Code line length: 65 chars max.** Google Docs code blocks (when pasted) don't soft-wrap. Long lines get cut off or cause horizontal scrolling.
- Use 2-space indentation in all code blocks.
- Keep code blocks short (under 20 lines). For longer code, use `<details>` sections or link to the source.
- Use `jsonc` language tag for JSON with comments.

## `<details>` Tags

`<details>` / `<summary>` tags **do not collapse** in Google Docs. They render as flat content with the summary as a heading-like line. This is still useful — treat them as labeled collapsible sections that degrade gracefully to labeled sections.

- Use `<details>` for content that's useful but not critical for a first read (long examples, full config dumps, load chain details).
- Keep the `<summary>` text short and descriptive — it becomes a visible label in Google Docs.

## Headings

- Use `#` through `####` only. Google Docs heading levels map well to H1-H4.
- Don't skip levels (e.g., `#` then `###`).
- Keep heading text short (< 60 chars).

## Links

- Standard markdown links `[text](url)` work when pasted as rich text.
- Don't use reference-style links `[text][ref]` — they often don't convert.
- For internal GitHub links, use full URLs (not relative paths).

## Formatting

- **Bold** (`**text**`) and *italic* (`*text*`) convert well.
- `Inline code` converts well.
- Strikethrough (`~~text~~`) may not convert — avoid it.
- Nested lists work up to 2-3 levels. Deeper nesting often loses indentation.

## Images

- Markdown image syntax `![alt](url)` does NOT render in Google Docs paste.
- If you need images, note the location and the user must insert them manually in Google Docs.

## Line Length

- **Prose lines: no wrapping.** Let the editor handle soft-wrapping. Hard line breaks at 80 chars create awkward mid-sentence breaks in Google Docs.
- **Code lines: 65 chars max.** Break at logical boundaries.

## Checklist

Before finalizing a document for Google Docs:
1. No ASCII art or box-drawing characters anywhere in the file.
2. All code lines ≤ 65 chars.
3. All `<details>` tags balanced (open + close).
4. Tables have ≤ 5 columns and no cells wider than ~40 chars.
5. No reference-style links.
6. No strikethrough.
7. Headings don't skip levels.

## Editing an existing GDoc — surgical, never full-replace (ABSOLUTE)

When an agent must modify an existing Google Doc, **never full-tab-replace
the content** — even when the user approves the write. Full-tab replace
destroys paragraph styles, table column widths, comment anchors, list
nesting, named-range refs, and bookmark links. The reader sees "everything
moved/disappeared" instead of "this one cell got the new number."

**Surgical toolkit** (use one of these, never a `gdoc_replace_tab.py`-style
nuke):

1. `replaceAllText` for a unique sentence. Dry-run the match count first;
   abort if the count is not exactly 1.
2. `deleteContentRange + insertText + updateTextStyle` for cell rewrites
   that need hyperlinks. Operate cell-by-cell, never broader.
3. `insertText` for a new paragraph at a specific index.

**Dry-run discipline** before any batch of edits:

- Read the tab.
- Count occurrences of each find string. Match count must be deterministic
  (usually 1).
- Print the planned ops.
- Order ops descending by `startIndex` so earlier edits don't invalidate
  later indices.

## Tabbed-document list safety (ABSOLUTE)

Before any list edit, inspect the active MCP tool schema and identify the exact
target tab.

- Every write to a child or non-default tab must include its exact `tab_id`.
- Do not use `apply_bullets` or `remove_bullets` on a non-default tab when the
  active schema has no `tab_id`. A tab-less Google Docs range targets the
  default/legacy body and can silently reformat another tab.
- For a child or non-default tab, use `docs_update_paragraph_style` with the
  exact `document_id`, `tab_id`, `start_index`, `end_index`, and
  `bullets: "unordered" | "ordered" | "remove"`.
- If any tab-ambiguous list operation ran, stop the edit sequence. Audit both
  the intended tab and the default tab with `read_document`,
  `docs_get_structured`, and live browser checks; repair the unintended tab
  immediately before continuing.

**When the local → GDoc gap is too big to bridge surgically**: leave them
out of sync and surface the diff in `SYNC-STATUS.md` (or equivalent) for
human reconciliation. Don't full-replace as a shortcut.

**Sole legitimate full-replace case**: a tab with zero human content
(agent-generated dashboard rebuilt every run). Even then, list anchored
comments first; if any exist, fall back to surgical.

## Visual verification loop (ABSOLUTE)

MCP `read_document` / markdown export **misrepresents** GDocs — list
nesting, heading levels, bold boundaries, and empty numbered items often
look fine in export but wrong in the live doc. **Never** tell the user a
GDoc is done from MCP text alone.

After **every** edit batch, validate the complete edited tab, not only the
changed section:

1. **Structured read** — `docs_get_structured` on the edited range.
   Confirm: body text is `NORMAL_TEXT` (not `HEADING_*`); subsection titles
   are the intended heading level; numbered/bullet lists contain only the
   intended items; no empty `HEADING_*` paragraphs between title and body.
2. **Every-page screenshot sweep** — open the exact live document and tab in
   the browser, return to page 1, then capture and inspect a browser screenshot
   of every rendered page through the final page. For a pageless tab, capture
   each non-overlapping viewport segment from top to bottom. A DOM snapshot or
   structured read does not count as a screenshot, and spot-checking only the
   edited section does not satisfy this gate. Check numbering, headings,
   spacing, emphasis, bullets versus prose, clipping, table overflow, URLs, and
   unexpected blank or duplicated content on every screenshot.
3. **Fix** — typical repairs:
   - `bullets: "remove"` on paragraphs wrongly absorbed into a list
   - `docs_update_paragraph_style` with the exact `tab_id` and a **tighter**
     bullet range (lists often bleed one paragraph too far)
   - `docs_update_paragraph_style` → `NORMAL_TEXT` on body paragraphs
   - `delete_content_range` on empty styled paragraphs after headings
   - `docs_unbold_paragraph_range` when `find_and_replace` split bold mid-word
   Fix every safe formatting or presentation issue found anywhere in the tab,
   including outside the edited range. Preserve comments and substantive
   meaning; a content conflict remains a blocker rather than a silent rewrite.
4. **Repeat** steps 1–3 until structured read **and** visual check agree. After
   any fix, restart the full screenshot sweep from page 1 because pagination
   and downstream styling may have changed.
5. **Only after every page passes may you tell the user the document is ready
   for review**, or claim it is updated in Slack, Jira, or a comment.

If browser hits SSO, run the initial attach-first poll. If still blocked,
open the doc URL in a stable **headed** SSO session and bring that Chrome
window forward before asking the user to sign in. Never describe a headless
CDP tab as visible. Start the `sso-background-work` URL/title/HTML listener
immediately after the handoff; do not wait for the user to say “done.”
Keep fixing from structured reads, then return to visual verification as soon
as the listener emits `SSO_AUTH_COMPLETE`.

## Comments — three absolute rules (ABSOLUTE)

Any GDoc the agent touches under the user's identity is subject to three
absolute rules. These have no per-task carve-out — they apply every time.

1. **Preserve others' comments.** Comments anchor to quoted text. Full-tab
   rewrites or deletes spanning anchored text orphan comments. Banned
   without per-action approval: full-tab rewrites, batched writes that
   haven't listed affected anchors first.

2. **Never resolve comments.** Resolution is the commenter's decision.
   Sole exception: explicit user request with specific comment IDs.

3. **Never post comments or replies without per-action approval.** Posting
   under the user's identity is public impersonation. Draft locally, show
   the target tab + comment ID + exact text, wait for "yes, post it."

If a workflow the user requested needs forbidden comment access, stop and
ask — don't paper over it with a workaround.

## Comment-reply phrasing — never claim "done" before verification

When (with per-action approval) replying to a GDoc comment that asked for a
content change, **never reply "Updated" / "Done" / "Applied" until the doc
content reflects the change AND you have re-read the affected cell to verify**.

Order of operations:

1. Edit local source (markdown, source-of-truth doc, whatever drives the GDoc).
2. Push to live doc using the surgical toolkit above.
3. Re-read the affected cell from the live doc.
4. Only then reply, and only with a verified phrasing.

**Forbidden phrasings until verified:** "Updated", "Done", "Applied", passive
"row X renamed".
**OK phrasings:** "Updated — row X now reads '\[exact text]'" or "Staged in
local source, doc push pending — will confirm after sync."

The same rule applies to references of shared-doc state on Jira, Slack, and
in PR descriptions: never claim a doc change without showing the verified
post-state.

## Execution and verification safety

This skill governs **Google Docs formatting and surgical edit discipline**, not
generic markdown prettification. Do not claim a GDoc was updated, a comment
was posted, or a comment thread was resolved unless you used the surgical
toolkit, completed the **visual verification loop**, and (for comments)
received per-action approval. Do not full-tab-replace an existing GDoc to save time —
even with user approval for "update the doc" — unless the tab has zero human
content and zero anchored comments. Do not resolve others' comments or post
under the user's identity without explicit per-action approval. Do not reply
"Updated", "Done", or "Applied" on a GDoc comment until the live doc cell
matches the intended text after re-read verification. When the local source and
live GDoc cannot be bridged surgically, leave them out of sync and surface
the diff for human reconciliation instead of destructive rewrites.

## Related Skills

- **`rfc`** — RFC authoring (references this skill for all formatting rules)
- **`doc-check`** — document review checklist (formatting section uses same rules)
- **`rfc-iterate`** — RFC iteration (runs doc-check which applies these rules)

## Constraints (Do NOT)

- **Do NOT use ASCII art or box-drawing characters** — proportional fonts in Google Docs will always misalign them; use nested lists, tables, or prose instead
- **Do NOT write code lines over 65 characters** — Google Docs code blocks don't soft-wrap; long lines get cut off
- **Do NOT use reference-style links** (`[text][ref]`) — they often fail to convert; use inline links `[text](url)` only
- **Do NOT use strikethrough** (`~~text~~`) — may not convert correctly in Google Docs
- **Do NOT nest lists deeper than 3 levels** — deeper nesting often loses indentation when pasted
- **Do NOT use markdown image syntax** — `![alt](url)` does not render in Google Docs; note image locations for manual insertion
- **Do NOT skip heading levels** — jumping from `#` to `###` breaks document structure
- **Do NOT mark a GDoc edit done without structured checks and an every-page browser screenshot sweep** — MCP export, DOM snapshots, and section spot-checks are not enough
