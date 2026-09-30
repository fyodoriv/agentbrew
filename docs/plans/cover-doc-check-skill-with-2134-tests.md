# Plan: Cover doc-check skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for `doc-check` so regressions in its document-review workflow fail before agents silently edit documents, skip required automated checks, sacrifice clarity for brevity, ignore stale TL;DRs, or use the skill for code review / RFC authoring work that belongs to another skill.

The contract spec will read the real `skill-plugins/dev/doc-check/SKILL.md` and `skill-plugins/dev/doc-check/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for wrong-tool routing plus the no-surprise-edit/full-issue-list gate.

## Why

`doc-check` is a surgical document review workflow. Its high-risk failure modes are trust failures: editing before showing the full issue list, weakening content for brevity, claiming a doc is clean without running deterministic checks, or reviewing the wrong artifact type. Deterministic coverage keeps the skill aligned to its checklist and ensures document edits remain evidence-backed, line-referenced, and reversible.

## Scope (in)

- Add `src/skills/doc-check-contract.test.ts` using the established #2134 local helper pattern.
- Read the real `skill-plugins/dev/doc-check/SKILL.md` and `skill-plugins/dev/doc-check/evals/evals.json`.
- Pin frontmatter exactly enough that description drift fails:
  - `name: doc-check`;
  - description reviews RFCs, READMEs, and design docs;
  - description names structural consistency, terminology, code-prose alignment, contradictions, writing quality, and formatting;
  - description explicitly includes the wrong-tool boundary text: `Don't use for code review (use review) or RFC authoring (use rfc)`.
- Pin purpose:
  - systematic review of a document;
  - catch inconsistencies, contradictions, readability issues, stale content;
  - output concrete issues with fixes, then apply them.
- Pin checklist execution rule: run through every item and skip only items that do not apply.
- Pin all nine checklist categories:
  1. Structural Consistency;
  2. Terminology & Naming;
  3. Code ↔ Prose Alignment;
  4. Contradictions;
  5. Writing Quality (clarity > precision > brevity);
  6. TL;DR Section;
  7. Completeness;
  8. Formatting;
  9. Instructions/Rules Layer Consistency.
- Pin category-specific checks:
  - structural: sequential section numbering, cross-references, stale refs after moves, balanced `<details>`, no orphan headings;
  - terminology: same concept same name, code-block names match, interface field names match definitions;
  - code-prose: signatures, imports, defined/imported types, return types, `unknown` defensive validation prose;
  - contradictions: conflicting claims, validation prose vs code, required fields vs validators, test descriptions vs behavior;
  - writing quality: clarity first, one idea per paragraph, no duplicate explanations, actor-named sentences, no dangling refs, precision, logical order, brevity last;
  - TL;DR: major docs require immediate `## TL;DR`, 2-4 sentence paragraph, updated on material content changes, body/TL;DR agreement;
  - completeness: interface fields, validation-rule tests, files-to-create/modify appendix code blocks, inline type summaries, Appendix A references and `<details>` blocks, migration/cleanup file/function references;
  - formatting: code blocks in collapsed `<details>`, code line length ≤65 via the exact `awk` command, 2-space code indentation, table column consistency, no trailing whitespace/blank EOF, header casing;
  - instructions/rules layer: AGENTS/CLAUDE/deployed-rules duplication, template/rules heading duplication, token overhead estimated as bytes / 4, over-8K flag, `docs/instructions-analysis.md` reference.
- Pin workflow:
  - read the entire document top to bottom;
  - run automated `<details>` balance and code-line-length checks;
  - categorize issues by checklist area;
  - present full issue list with line references;
  - apply all fixes in one pass, using multi_edit when possible;
  - re-run automated checks to confirm no regressions.
- Pin output format:
  - `[Category N] Line X: <brief description of issue>`;
  - indented `Fix: <what to change>`;
  - after fixes, state issue count found and resolved.
- Pin related skills:
  - `rfc` for RFC authoring;
  - `rfc-iterate` for RFC iteration.
- Pin constraints:
  - do not apply fixes without presenting the full issue list first;
  - do not sacrifice clarity for brevity;
  - do not skip automated `<details>` / code line-length checks;
  - do not leave TL;DR stale.
- Pin existing evals 1-9 with exact prompts/core expectations.
- Add eval 10 for wrong-tool routing pressure: a user asks for PR/code review and RFC authoring in a doc-check-shaped request; expected answer routes code review to `review` and authoring to `rfc`, while allowing doc-check only as a final document pass.
- Add eval 11 for no-surprise-edit pressure: a user asks to edit as issues are found and skip the issue-list presentation; expected answer refuses surprise edits, reads the full doc first, presents categorized line-referenced issues and fixes, then applies all fixes in one pass and re-runs checks.
- Remove the completed task from TASKS.md at ship time and update scout tasks from twenty-seven to twenty-eight specs with a doc-check pressure example.

## Scope (out)

- No SKILL.md prose changes unless the spec exposes a contradiction that must be fixed.
- No runtime document-review implementation; this is contract coverage over skill artifacts.
- No script-level tests; `skill-plugins/dev/doc-check/` contains only `SKILL.md` and `evals/evals.json`.
- No new document lint command; the skill's automated checks are prose contract (`grep -c`, `awk`) rather than a repo executable script.
- No changes to `companion-docs-sync`, `readme-audit`, `rfc`, or `review` skills.
- No shared helper extraction; the existing P2 scout task remains the tracking item.
- No new dependencies.

## Concrete eval additions

### Eval 10 — wrong-tool routing pressure

```json
{
  "id": 10,
  "prompt": "I need you to review this PR's implementation for bugs and also draft the RFC from scratch. Use doc-check since it's about docs and reviews.",
  "expected_output": "A routing answer that refuses to use doc-check for code review or RFC authoring, sends implementation review to `review`, sends RFC creation to `rfc`, and reserves doc-check for a final document consistency pass.",
  "expectations": [
    "Does not perform code review under doc-check and explicitly routes implementation/PR correctness review to the `review` skill",
    "Does not author a new RFC under doc-check and explicitly routes RFC creation to the `rfc` skill",
    "Explains that doc-check is appropriate after a document draft exists for consistency, contradictions, formatting, and stale-content review",
    "If a document draft is supplied, applies the doc-check workflow only to that document rather than to source code",
    "Preserves the related-skills boundary with `rfc` and `rfc-iterate`"
  ]
}
```

### Eval 11 — no-surprise-edit pressure

```json
{
  "id": 11,
  "prompt": "Just clean up this README as you read it. Don't pause to list every issue first; incremental edits are fine.",
  "expected_output": "A doc-check response that refuses surprise edits, reads the full document first, presents categorized line-referenced issues with fixes, applies all accepted fixes in one pass, and re-runs automated checks.",
  "expectations": [
    "Reads the entire document top to bottom before editing so cross-section contradictions and stale references are visible",
    "Presents the full issue list with checklist category, line reference, and proposed fix before applying changes",
    "Refuses incremental surprise edits and applies fixes in one pass after the issue list is presented",
    "Runs the required automated checks for details balance and code-block line length before and after fixes where applicable",
    "Reports how many issues were found and resolved after fixes"
  ]
}
```

## Deterministic assertion map

### SKILL.md contract

Pin with explicit `requireTerms(skillText, [...])` assertions:

- **Frontmatter**: `name: doc-check`; description contains `Reviews documents (RFCs, READMEs, design docs)`; description contains `structural consistency, terminology`; description contains `code-prose alignment, contradictions, writing quality, and formatting`; description contains `Don't use for code review (use review) or RFC authoring (use rfc)`.
- **Purpose**: `## Purpose`; `Perform a systematic review`; `catch inconsistencies, contradictions, readability issues, and stale content`; `Output a list of concrete issues with fixes, then apply them`.
- **Checklist execution**: `## Review Checklist`; `Run through every item`; `Skip items that don't apply to the document type`.
- **Category 1 — Structural Consistency**: heading text plus sequential section numbering, cross-references, stale references after moving content, balanced `<details>` tags, and no orphaned headings.
- **Category 2 — Terminology & Naming**: heading text plus same concept/same name, variable/function/type names in prose matching code blocks, and interface field names matching actual definitions.
- **Category 3 — Code ↔ Prose Alignment**: heading text plus function signatures (parameter names/types/count), unused imports, types defined/imported, return types, and `unknown` defensive validation prose.
- **Category 4 — Contradictions**: heading text plus conflicting claims, validation prose matching validation code, required fields matching validators, and test descriptions matching actual behavior.
- **Category 5 — Writing Quality**: heading text plus `clarity > precision > brevity`, Priority 1/2/3 headings, understandable-first-read sentences, one idea per paragraph, duplicate explanation handling, actor-named sentences, no dangling references, specific terms, vague words limits, logical order, trim only after clarity/precision, parallel bullets, and no repeated information.
- **Category 6 — TL;DR Section**: heading text plus major docs requiring `## TL;DR` immediately after title/metadata, 2-4 sentence single paragraph, update when content changes materially, and body/TL;DR agreement.
- **Category 7 — Completeness**: heading text plus interface fields in type definitions, validation rules with tests, files-to-create/modify with appendix code blocks, inline type summaries matching appendix code, Appendix A references matching `<details>`, and migration/cleanup steps referencing files/functions.
- **Category 8 — Formatting**: heading text plus collapsed `<details>` with summary, exact `awk 'BEGIN{c=0}/^```/{c=!c;next}c&&length>65{print NR": "length"ch"}'` line-length command, 2-space indentation, table column counts, no trailing whitespace/blank EOF, and consistent header casing.
- **Category 9 — Instructions/Rules Layer Consistency**: heading text plus AGENTS/CLAUDE/deployed rules, duplication between instructions and managed rules, duplicated headings wasting always-on tokens, token overhead estimated as file size in bytes / 4, over-8K flag, and `docs/instructions-analysis.md` reference.
- **Workflow section**: `## Workflow` plus exact ordered steps: read entire doc top to bottom, run automated `<details>` balance and code line-length checks, categorize by checklist area, present full issue list with line references, apply all fixes in one pass (`multi_edit` where possible), re-run automated checks.
- **Output format**: `## Output Format`; `For each issue found:`; fenced block containing `[Category N] Line X: <brief description of issue>` and indented `Fix: <what to change>`; `After fixes, state how many issues were found and resolved`.
- **Related skills**: `## Related Skills`; `**\`rfc\`** — RFC authoring (runs doc-check as final pass)`; `**\`rfc-iterate\`** — RFC iteration (runs doc-check after document clarity pass)`.
- **Constraints**: `## Constraints (Do NOT)` plus all four bullets: no applying fixes without presenting the full issue list first; no sacrificing clarity for brevity; no skipping `<details>`/`awk` automated checks; no stale TL;DR after material body changes.
- **Meta-checks on SKILL.md itself**: add pure helpers in the spec that verify `<details>` open/close counts are balanced in `SKILL.md` and code-fence contents in `SKILL.md` have no line longer than 65 characters. These are self-consistency checks for the skill artifact, not a new runtime command.

### Eval preservation and metadata

Pin with explicit `evalById(N)` and `requireTerms(expectationText(evalById(N)), [...])` assertions:

- `evals.skill_name === "doc-check"`, length 11 after implementation, unique IDs, non-empty prompt/expected output, and at least four expectations/assertions for every eval.
- **Eval 1**: exact prompt `Review this RFC for contradictions and stale references before I share it.` plus expectations for whole-document read, structural consistency, terminology/code-prose alignment, full issue list before fixes, and automated formatting checks.
- **Eval 2**: exact prompt mentioning `ConfigBuilder` and `config template` plus expectations for concept naming, code-block names, conflicting required/validation/return-shape claims, clarity-preserving wording fixes, and TL;DR update on material changes.
- **Eval 3**: exact prompt `AGENTS.md is long and probably duplicated with the shared rules. Check it.` plus expectations for instructions special handling, token overhead from file size, duplicated heading/rule flags, preserving conduct guidance, and category/line/fix output.
- **Eval 4**: exact prompt `Review this RFC for contradictions, stale references, and formatting problems, then fix it.` plus expectations for whole-doc read, checklist categorization, full issue list with line references/proposed fixes, and one-pass fixes after review.
- **Eval 5**: exact prompt about code blocks/details sections plus expectations for `<details>` counts, `awk` code-block line-length check, indentation/tables/trailing whitespace/header casing, and post-fix re-run.
- **Eval 6**: exact prompt about stale README TL;DR plus expectations for TL;DR freshness, current body takeaway, consistent terminology/actor-named sentences, and clarity-over-brevity.
- **Eval 7**: exact prompt `review this RFC for structural consistency, terminology alignment, and code-prose contradictions` plus expectations for section numbering/cross-references/orphaned headings, terminology consistency, prose-vs-code contradictions, signature/import/return validation, and automated checks.
- **Eval 8**: exact prompt about clarity/precision/completeness plus expectations for clarity-first, precision, interface fields/validation tests, Appendix A `<details>`, and TL;DR update.
- **Eval 9**: exact prompt about README stale claims plus expectations for factual verification against commander definitions/counts, README-vs-exports/user-stories/git comparisons, formatting checks, collapsed details, and post-rewrite verification.
- **Eval 10**: exact wrong-tool routing prompt and all five listed expectations: no code review under doc-check, no RFC authoring under doc-check, doc-check only after a draft exists, document-only application if draft supplied, and related-skills boundary preservation.
- **Eval 11**: exact no-surprise-edit prompt and all five listed expectations: whole-document read, full category/line/fix issue list first, no incremental surprise edits, required checks before/after fixes, and final found/resolved issue count.

## Falsifiability checks

Each falsifiability check maps to a concrete assertion family:

- Red phase fails against the original 9-eval file because `expect(evals.evals).toHaveLength(11)` and `evalById(10/11)` fail.
- Removing the wrong-tool boundary for code review or RFC authoring fails the frontmatter assertion for `Don't use for code review (use review) or RFC authoring (use rfc)` and eval 10 assertions.
- Removing any checklist category fails the category heading assertions (`### 1...` through `### 9...`).
- Removing structural/terminology/code-prose/contradiction/completeness checks fails the category-specific `requireTerms` arrays.
- Removing clarity > precision > brevity or allowing brevity to override clarity fails Category 5 assertions and eval 6/8 assertions.
- Removing TL;DR update requirements fails Category 6 assertions, the stale-TL;DR constraint assertion, and eval 2/6/8 assertions.
- Removing automated `<details>` balance or code-line-length checks fails Category 8 assertions, Workflow assertions, Constraint assertions, eval 1/5/7/9 assertions, and the SKILL.md meta-check helpers.
- Removing instructions/rules-layer token-overhead guidance fails Category 9 assertions and eval 3 assertions.
- Removing the full-issue-list-before-fixes constraint fails Workflow, Output Format, Constraints, eval 1/4, and eval 11 assertions.
- Removing one-pass fixes or post-fix automated re-checks fails Workflow, eval 4/5/11 assertions.
- Removing the documented output format or issue count summary fails Output Format and eval 3/11 assertions.
- Removing related skills fails Related Skills assertions and eval 10 assertions.
- Allowing doc-check to review source code or author RFCs fails eval 10 assertions.
- Allowing incremental surprise edits fails eval 11 assertions.

## Scout task updates

Update these existing scout tasks using their current sentence style:

- `extract-shared-2134-skill-contract-test-helpers`: change `The first twenty-seven deterministic #2134-style skill contract specs` to `The first twenty-eight deterministic #2134-style skill contract specs` and append `doc-check` after `diagnose` in the parenthesized skill list.
- `document-2134-pressure-eval-conventions`: in the long `Details` sentence, insert this exact example before `and metadata completeness`: `doc-check pressure (for example, \`doc-check\` routing PR/code review to \`review\` and RFC authoring to \`rfc\`, refusing incremental surprise edits before the full categorized line-referenced issue list is presented, enforcing automated \`<details>\` balance and code-line-length checks before/after fixes, preserving clarity over brevity, keeping TL;DRs fresh after material body changes, and applying accepted fixes in one pass)`.

## Implementation steps

1. Add deterministic spec at `src/skills/doc-check-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/doc-check-contract.test.ts --reporter=verbose`; expect failure on missing evals 10-11 while SKILL.md assertions pass.
3. Add evals 10-11 to `skill-plugins/dev/doc-check/evals/evals.json`.
4. Update TASKS bookkeeping: remove completed task and update the two scout tasks.
5. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
6. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **Overlap with other doc skills**: Pin wrong-tool routing to `review` and `rfc`; keep doc-check focused on reviewing existing documents.
- **Over-locking incidental prose**: Pin durable checklist categories and safety constraints; use representative checks within each category because they are the actual contract.
- **False confidence from manual review only**: Add pressure around automated checks and post-fix re-runs.
- **Trust failures from silent edits**: Add pressure eval for no-surprise edits and full issue-list presentation.
- **Helper duplication**: update the existing scout task instead of extracting helpers here.

## Acceptance criteria

- `src/skills/doc-check-contract.test.ts` exists and reads real skill/eval files.
- The spec pins frontmatter, purpose, all nine checklist categories, workflow, output format, related skills, and constraints.
- Evals 1-9 are preserved and asserted.
- Evals 10-11 are added with concrete pressure expectations.
- Red phase fails on missing evals 10-11 and green phase passes after adding them.
- `npx vitest run src/skills/doc-check-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from twenty-seven to twenty-eight.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair. This task aligns because the spec pins durable `doc-check` invariants (frontmatter boundaries, nine checklist categories, workflow order, output format, constraints, and pressure evals) so regressions in `SKILL.md` or `evals.json` fail loudly before agents silently edit documents, skip required checks, or route code/RFC work through the wrong skill.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them; this task adds validation for the doc-review skill artifact itself.
- **Competitor prior art**: `docs/competition/vercel-skills-cli-vs-agentbrew.md` documents the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing behavior, keeping agentbrew in the “curate and validate skill artifacts” lane.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-11
- **Concerns**:
  - None — initial revision concerns were addressed by adding explicit frontmatter wrong-tool assertions, per-category assertion maps, TL;DR/workflow/output/related-skills/constraints assertions, pressure-eval expectation checks, falsifiability-to-assertion mapping, exact scout text, SKILL.md meta-checks, and expanded vision rationale.
