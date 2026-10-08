---
name: rfc
description: >
  Writes RFC documents following the 9-section structure with POC branch workflow.
  Covers authoring, code listings, Google Docs compatibility, and final
  verification. Don't use for iterating on existing RFCs (use rfc-iterate) or processing
  reviewer feedback (use rfc-review).
---

## When to invoke

**Yes:** authoring a new standalone RFC with POC branch workflow, 9-section structure, and verified
research before architectural claims.

**No:** iterating on an existing RFC (`rfc-iterate`); processing reviewer feedback only
(`rfc-review`); committing RFC drafts to git; embedding full code listings in the RFC body.

## Scope

This skill writes **local RFC drafts under `.tmp/rfc/`** and links implementation via `poc/*`
branches with blob URLs. It requires hands-on verification before adoption claims and keeps RFC text
and POC code in sync.

## Execution and verification safety

Research and test tools in a temp directory before writing adoption claims. Do not commit RFC docs
to git — they stay gitignored under `.tmp/rfc/`. Do not embed full code listings; use POC branch
blob URLs. Do not draft from memory without verification. Keep RFC header metadata limited to **POC
PR** only. Sync RFC text and POC branch after every code or prose change.

## Purpose

Write a complete, standalone RFC that is sufficient to implement without referencing any prior RFCs.

## Audience

A developer who will either lead development of this change or wants to stay in sync with the feature. They need enough context to understand the approach, spot problems, and suggest improvements — not just follow instructions.

## Goals of an RFC

The RFC exists to get feedback. Specifically:
- Surface what can be improved about the approach
- Identify what doesn't work or has gaps
- Align stakeholders before committing to implementation

Write to invite critique, not to document a finalized decision. Make trade-offs and limitations visible so reviewers can challenge them.

## Authoring Workflow

1. **Research before writing** (MANDATORY):
   - Read official docs for any tool/library/framework being proposed — focus on directory structure, config format, CLI behavior, integration constraints. Not just the README.
   - If proposing adoption of an external tool, run it in a temp directory to verify claims. Check: does the bootstrap flow work with our layout? Do default paths conflict with our conventions? What config files are needed and where?
   - Document verified facts vs assumptions. Every architectural claim in the RFC must be backed by doc links or hands-on testing, not general knowledge.
   - **Anti-pattern: drafting an RFC about a tool you haven't tested.** This causes multiple expensive iteration rounds catching wrong directory structures, broken PATH, incorrect CLI flags, and stale mental models. 30 minutes of upfront research prevents hours of rework.
2. Gather inputs: problem statement, current behavior, target users, config sources, required files, runtime constraints, and rollout strategy.
3. Draft Summary and Design Goals first; confirm scope and non-goals.
4. Fill Architecture Overview with the solution paragraph and runtime flow.
5. Define types and usage in Type-Safe API.
6. Provide the full implementation and concrete integration steps.
7. Add tests, limitations, and do a final clarity pass for sentence order and concision.

## POC Branch Workflow

RFC docs are **never committed to git** — they live in `.tmp/rfc/` which is gitignored (local drafts only).

POC code goes on a dedicated branch per RFC. Each RFC gets its own `poc/<rfc-name>` branch.

1. **Create the POC branch** from `main` before writing implementation code:
   ```bash
   git fetch origin main
   git checkout -b poc/<rfc-name> origin/main
   ```
2. **Make an initial empty commit** to establish the branch:
   ```bash
   git commit --allow-empty -m "chore: init poc/<rfc-name> branch"
   ```
3. **Push and open a draft PR** immediately — this gives you a PR number and blob URLs to reference in the RFC:
   ```bash
   git push -u origin poc/<rfc-name>
   gh pr create --draft --title "poc: <feature-name>" --body "POC for RFC: <rfc-name>"
   ```
4. **Update the RFC header** with the PR link (`**POC PR:** [#NNN](url)`).
5. **Update section 4** file references to use blob URLs pointing to the POC branch.
6. **Implement POC code** in commits on this branch. Keep RFC and code in sync.
7. When switching between POC branches, use `git checkout` — don't mix POC work across branches.

## RFC Location

All RFCs: `.tmp/rfc/` (gitignored, local drafts)
File naming: `kebab-case-feature-name.md` (example: `configurable-command-center.md`)

## RFC Header

The only metadata field in the RFC header is **POC PR**. No Status, Owner, Reviewer, or Last Updated fields.

```markdown
## RFC: Feature Name

**POC PR:** [#NNN](url)  <!-- or _none yet_ -->
```

## RFC Structure (9 sections)

Structure follows **overview → details → code**.

**Overview (sections 1–2):**

1. **Summary**
   - 2–3 short sentences: problem + solution + scope. Not dense.
   - Use cases, then requirements as sub-sections. Merge design goals into requirements (each requirement as **Bold** — description).
   - Use cases and requirements must only claim what is actually implemented. Mark unimplemented capabilities with "(planned)" or "(post-POC)".
2. **Architecture Overview**
   - No "Current State" sub-section — fold context into the Summary paragraph instead.
   - Runtime Flow / Pros sub-sections.
   - When describing ordering-sensitive flows (e.g., cleanup, initialization), document the exact sequence because it is load-bearing. Don't summarize as "does A and B" if the order of A and B matters.

**Details (sections 3–5):**

3. **Config Design**
   - Config structure and how merging works (concise rules + table). Use plain language for headings ("How Merging Works", not "Merge Semantics").
   - Full config example in `<details>`. No worked examples here—capture those as test cases in section 6.
   - Edge case rules (brief prose, not walkthroughs).
4. **Implementation Steps**
   - Each phase opens with a one-sentence "why" explaining what it enables.
   - Phased steps (4.1, 4.2, ...) with references to Appendix A for full code.
   - Small inline before/after diffs are OK.
   - No TypeScript type listings—full types live only in Appendix A.
   - Don't repeat details already covered (e.g., merge rules in section 3, validation rules in section 6). Cross-reference instead.
   - Function descriptions: just state what each is responsible for, not how it works.
5. **How to Add / Change / Delete** (self-serve guide)
   - Open with a short line saying what this section is for and who it's for.
   - Step-by-step instructions for contributors, organized by use case.
   - No checklists—keep it action-oriented.

**Code & Validation (sections 6–9):**

6. **What Must Be Tested**
   - Describe in plain English the behaviors and invariants that must hold. No test counts, test names, or test file paths.
   - Group by scope (unit, integration, planned).
7. **Follow-up Work**
   - Deferred items with enough detail to start without re-reading the RFC.
8. **Migration Plan**
   - Phased rollout: parallel operation → new features → cleanup.
9. **Known Limitations**
   - Table: limitation | impact | mitigation.
   - Every row must match the actual code behavior, not the conceptual description. If a predicate "skips memory actions", the table must say that — not "runs on every action".

**POC Branch (replaces Appendix A)**

Do NOT embed full code listings in the RFC. Instead:
   - Commit implementation code to a `poc/*` branch and open a PR.
   - Add a **POC PR** link in the RFC header metadata (e.g., `**POC PR:** [#NNN](url)`).
   - In implementation steps (section 4), link to files on the POC branch using blob URLs: `[path/to/file.ts](https://github.com/OWNER/REPO/blob/poc/<branch>/path/to/file.ts)`. Do NOT use PR diff anchors (`#diff-...`) — they don't navigate correctly.
   - Short inline code snippets (under 10 lines) for API examples in sections 3/5 are OK.
   - Keep the RFC and POC branch in sync — any code change must be reflected in the RFC text, and vice versa.
   - The POC must include a real integration: an actual call site in an existing module that uses the new feature, complete with tests. A POC with only library code and no consumer is incomplete.

## Global Requirements (must cover somewhere)

- Rollout / flag gating approach and plan.
- Error handling with retry strategy.
- Cleanup on unmount or teardown behavior.
- Initial state/default behavior and empty states.
- Data validation (schema or runtime checks).
- TODO comments for dependencies or questions for other teams.

## Consistency Rules

- When the same concept is described in multiple places (overview, step-by-step flow, limitations table), all descriptions must use identical language. If you change one, grep for all occurrences.
- Don't add "See section N" cross-references — the RFC is short enough that readers can find related content. Cross-references create maintenance burden and often go stale.
- Don't include implementation-detail subsections (e.g., "When Changes Are Sent" listing specific debounce/max-wait/batch-size values). These are constants visible in the code. Keep the RFC focused on architecture, design decisions, and behaviors.
- Don't document runtime workarounds, compat shims, or minor tech details (e.g., "we use X instead of Y because of a version mismatch"). Those belong in code comments, not the RFC.

## Writing Priority

1. **Clarity** — easy to read and reason about. No unnecessary details. Every sentence should be understandable on first read.
2. **Precision** — use specific terms (function names, file paths, config keys). Vague language like "handles" or "controls" is OK in summaries but not in design sections. Appendix provides full details.
3. **Brevity** — shorter is better, but only after clarity and precision are satisfied. Never sacrifice understanding for fewer words.

**Applying the priority:**
- If a sentence is short but unclear, make it longer and clearer.
- If two sections explain the same concept, keep it in one place and cross-reference from the other. Duplication hurts clarity (readers wonder if the two versions mean different things).
- Name the actor in each sentence ("ConfigBuilder evaluates", not "expressions are evaluated"). Active voice is clearer.
- When a paragraph covers two distinct concepts, split it. One idea per paragraph.

## Style Guidelines

RFCs are published to Google Docs, so all content must render correctly there. Use standard markdown (no HTML except `<details>`/`<summary>`), avoid raw URLs (use `[text](url)`), keep tables simple (no merged cells), and use fenced code blocks with language tags.

Additional RFC-specific rules:
- All code blocks must be wrapped in collapsed `<details>` with a short `<summary>` line.
- **Code line length: 65 chars max.** Use 2-space indentation in all code blocks (TypeScript, JSON, JSON Schema). Break long lines at logical boundaries (function args, object properties, conditions).
- Code examples must be complete and runnable.
- Infer types from usage where possible (no redundant interfaces).
- Destructure options to primitives to avoid dependency issues.
- Use tables for structured comparisons (merge operations, file lists, limitations).
- Short numbered lists (e.g., runtime flow ≤7 steps) can be inline—only use `<details>` for longer content.
- Avoid `<details>` for trivial content (e.g., a 3-line file tree). Inline it instead.

## Final Pass

Before marking the RFC as done, run through:
1. All `<details>` tags balanced (open + close).
2. All code lines ≤65 chars (run awk check).
3. Cross-references ("see section N", PR file links) point to the correct heading/file.
4. Type/function names in prose match actual code in the POC branch.
5. Validation rules in prose match validator code and test cases.
6. No contradictions between config examples and prose descriptions.
7. **POC sync check:** verify the RFC accurately describes the current code in the POC branch. If code changed, update the RFC. If RFC changed, update the code.
8. **Self-review:** Review the RFC for structural consistency (section numbering, balanced `<details>` tags, no orphaned headings), terminology consistency (same concept = same name throughout), code-prose alignment (signatures, imports, return types match), contradictions between sections, and formatting (code lines ≤65 chars, 2-space indentation, consistent table columns). Present all issues found with line references and proposed fixes. Apply fixes after user approval.

## Constraints (Do NOT)

- **Don't write an RFC about a tool you haven't tested** — draft after research, not before; wrong directory structures, broken CLI flags, and stale mental models cause multiple expensive iteration rounds
- **Don't embed full code listings in the RFC** — commit implementation to the `poc/*` branch and link via blob URLs; code in the RFC doc goes stale and creates a maintenance burden
- **Don't commit RFC docs to git** — they live in `.tmp/rfc/` (gitignored); committed RFC docs pollute history and confuse what's implemented vs proposed
- **Don't repeat information across sections** — if merge semantics are in section 3, implementation steps cross-reference; duplication makes readers wonder if the two versions mean different things
- **Don't include already-mitigated limitations in Known Limitations** — only real, current limitations belong there
- **Don't add Status, Owner, Reviewer, or Last Updated fields to the RFC header** — the only metadata field is **POC PR**
- **Don't use "See section N" cross-references** — the RFC is short enough that readers can find content; these go stale and create maintenance burden
- **Don't let RFC and POC branch drift** — whenever code changes, update the RFC text; whenever RFC text changes, update the code; they must always match

## Related Skills
- **`rfc-iterate`** — iterate on an existing RFC + POC (sync doc ↔ code, critical review, process reviewer feedback, tighten writing)
- **`doc-check`** — systematic document review (run as final pass before publishing)
