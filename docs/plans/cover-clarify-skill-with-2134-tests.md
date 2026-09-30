# Cover clarify skill with #2134-style tests

## Goal

Add deterministic regression coverage for `skill-plugins/dev/clarify/` so its interactive ambiguity-resolution contract keeps asking one focused question at a time, caps the interview, routes wrong-tool requests away, reads answerable codebase context before asking, and saves each accepted answer incrementally.

## Why

`clarify` is a human-in-the-loop skill. Its highest-risk drift is wasting user attention: asking too many questions at once, asking questions the codebase can answer, skipping the recommendation format, batching edits until the end, or taking over adjacent workflows (`analyze`, `plan`, `spec`, `grill`) instead of staying in its lane. Deterministic coverage protects VISION.md G5 (drift detection + auto-repair) and US 18 (validation catches broken agent artifacts before users rely on them).

## Scope in

- Add `src/skills/clarify-contract.test.ts` using the established #2134-style skill contract pattern.
- Read the real `skill-plugins/dev/clarify/SKILL.md` and `skill-plugins/dev/clarify/evals/evals.json` from disk.
- Assert SKILL.md contract content:
  - description: interactively resolves ambiguities in an existing spec/plan/requirement using a 10-category scan;
  - asks one question at a time with a recommended answer;
  - saves incrementally after each accepted answer;
  - wrong-tool boundaries: use `analyze` for cross-artifact drift, `plan` for creating plans from scratch, `spec` for gated spec workflows, and `grill` for pre-implementation domain-naming interviews;
  - never more than five questions and never more than one at a time;
  - the full 10-category taxonomy and `Clear` / `Partial` / `Missing` marks;
  - prioritization and cap: at most five ambiguities, ordered Scope > Security > UX > Implementation detail;
  - codebase-answerable questions must be answered by reading the codebase instead of asking the user;
  - exact question format with options and `**Recommended: B**` rationale;
  - wait for user response before proceeding;
  - update the spec inline, save atomically after each accepted answer, show updated text, then ask the next question;
  - final marker-count reporting and `[DEFERRED: reason]` handling for skipped questions.
- Assert eval metadata coverage:
  - existing vague export spec flow;
  - vague error-message requirement flow;
  - placeholder / `[NEEDS CLARIFICATION]` flow;
  - wrong-tool routing pressure for analyze/plan/spec/grill boundaries;
  - anti-batching pressure for one-question-at-a-time and save-after-each-answer behavior.

## Concrete eval additions

Add exactly two eval entries, numbered 4 and 5:

```json
{
  "id": 4,
  "prompt": "Clarify this roadmap by comparing it to TASKS.md for drift: the roadmap says launch export MVP, while TASKS.md has [NEEDS CLARIFICATION] on export scope.",
  "expected_output": "A boundary response that routes cross-artifact drift checking to analyze while offering to clarify the fuzzy existing artifact one question at a time.",
  "expectations": [
    "Does not run cross-artifact consistency analysis as part of clarify; routes that work to analyze",
    "Explains that clarify is for resolving ambiguities in an existing fuzzy artifact, not comparing roadmap/TASKS drift",
    "Offers to clarify the export-scope ambiguity by asking one targeted question at a time",
    "Does not create or edit a plan, run a gated spec workflow, or conduct a grill-style domain-naming interview"
  ]
}
```

```json
{
  "id": 5,
  "prompt": "Continuation: the draft says 'Users can share project data with teammates.' You asked Question 1/5 about visibility and recommended B: workspace members only. I pick option B. Go ahead and ask the remaining four questions together, then save everything at the end.",
  "expected_output": "An incremental clarification turn that applies the accepted answer immediately, saves the spec, shows the updated text, and asks only the next question.",
  "expectations": [
    "Updates the spec inline at the sharing visibility ambiguity using option B: workspace members only",
    "Saves the file immediately after the accepted answer instead of batching edits until the end",
    "Shows the updated text before asking anything else",
    "Asks only the next question and refuses to ask the remaining questions together"
  ]
}
```

Eval 4 is a single-boundary wrong-tool pressure case for `analyze`; SKILL.md assertions separately pin the documented `plan`, `spec`, and `grill` boundaries. Eval 5 is a continuation-style anti-batching and incremental-save pressure case with concrete draft context. Existing eval 1 remains the broad positive workflow case, eval 2 remains terminology/completion-signal ambiguity pressure, and eval 3 remains placeholder/deferred-marker pressure. The final `evals.json` keeps root `skill_name: "clarify"`, preserves evals 1-3 unchanged, and appends evals 4-5 so the array has exactly five entries with IDs 1-5.

## Concrete test assertions

The spec will use the same helper names as neighboring specs: `requireTerms`, `expectationText`, `scenarioText`, and `evalMatching`.

Core SKILL.md assertions will pin these exact strings or regexes:

```typescript
requireTerms(skillText, [
  "Interactively resolves ambiguities in an existing spec, plan, or requirement",
  "using a 10-category ambiguity scan. Asks one question at a time, each with a",
  "recommended answer. Saves incrementally after each accepted answer.",
  /Don't use for cross-artifact drift detection\s+\(use analyze\), creating a plan from scratch \(use plan\), running a fully-\s+gated spec workflow \(use spec\), or pre-implementation interview to challenge\s+domain naming \(use grill\)\./,
  /Turns ambiguous specs into actionable ones through targeted questions.*never\s+more than 5, never more than one at a time\./s,
  "Functional Scope",
  "Domain & Data Model",
  "UX Flow",
  "Non-Functional",
  "Integration",
  "Edge Cases",
  "Constraints",
  "Terminology",
  "Completion Signals",
  "Placeholders",
  // Pins the documented taxonomy marking convention.
  "Mark each category: **Clear** / **Partial** / **Missing**.",
  "Select at most 5 ambiguities that most affect implementation correctness.",
  "Prioritize: Scope > Security > UX > Implementation detail.",
  "If the spec can be answered by reading the codebase, do that instead of asking.",
  // Pins the documented question-template format in the SKILL.md code block, not a literal runtime answer.
  "Question [N/5]: [The specific question]",
  "**Recommended: B** — [1-2 sentence rationale explaining why B is the better choice]",
  "Wait for user response before proceeding to the next question.",
  "Update the spec inline at the point of ambiguity",
  "Save the file (atomic write — don't batch)",
  "Show the updated text, then present the next question",
  "After all questions: show the updated `[NEEDS CLARIFICATION]` count (before →\nafter).",
  "If the user wants to skip a question, mark it `[DEFERRED: reason]`\nrather than leaving it blank.",
]);
```

Eval coverage assertions will use these scenario lookups:

```typescript
evalMatching(/export their project data|multiple formats/i);
evalMatching(/handles errors gracefully|helpful messages/i);
evalMatching(/\[TBD\]|\[NEEDS CLARIFICATION\]|auth flow/i);
evalMatching(/compare it to TASKS\.md|roadmap.*TASKS|cross-artifact/i);
evalMatching(/remaining four questions together|save everything at the end|workspace members only|option B/i);
```

The metadata test will also pin existing evals 1-3 by ID, prompt, and representative expectation text so the new pressure cases are appended rather than replacing or silently rewriting existing coverage. Each scenario assertion will check at least four expectations covering taxonomy/one-question format, terminology/completion-signal refinement, placeholder/deferred handling, wrong-tool routing, and incremental-save anti-batching behavior.

## Scope out

- Do not change `clarify` runtime behavior; this skill has no deterministic helper script.
- Do not run live agent evals in this slice.
- Do not conduct a real clarification interview with the user.
- Do not extract shared test helpers; existing scout tasks track shared #2134 helper/documentation work.
- Do not rewrite the skill prose unless the tests reveal a real missing contract.

## Implementation steps

1. Add `src/skills/clarify-contract.test.ts` with local helper functions matching neighboring #2134 specs.
2. Pin SKILL.md trigger scope, wrong-tool boundaries, taxonomy, prioritization/cap, codebase-answerable rule, question format, response wait, incremental-save steps, final marker count, and deferred-marker handling.
3. Extend `skill-plugins/dev/clarify/evals/evals.json` from 3 to 5 scenarios by adding wrong-tool-routing and anti-batching pressure cases.
4. Ensure each eval has a unique ID, non-empty prompt/output, and at least four concrete expectations.
5. Remove the completed task block from `TASKS.md`, update TASKS.md task `extract-shared-2134-skill-contract-test-helpers` from twelve to thirteen contract specs, and enrich the pressure-eval conventions scout task with clarify's interactive / human-attention pressure if useful.
6. Run focused and full verification:
   - `npx vitest run src/skills/clarify-contract.test.ts`
   - `npm run skills:coverage`
   - `npm run verify`

## Risks and mitigations

- **Human-attention drift**: Pin the one-question-at-a-time contract, five-question cap, wait-for-response step, and anti-batching eval.
- **Wrong-tool drift**: Add an eval that explicitly requests analyze/plan/spec/grill-adjacent work and require routing away from clarify.
- **Unnecessary-question drift**: Pin the codebase-answerable rule so agents read available context before asking.
- **Lost-work drift**: Pin atomic save-after-each-accepted-answer behavior and add eval pressure against end-of-session batching.
- **Brittle prose locks**: Use exact strings for fixed headings/tables/format blocks and regexes for wrapping-prone description text.

## Acceptance criteria

- New deterministic spec at `src/skills/clarify-contract.test.ts` reads `skill-plugins/dev/clarify/SKILL.md` and `skill-plugins/dev/clarify/evals/evals.json`.
- The spec pins trigger scope, wrong-tool boundaries, 10-category taxonomy, `Clear` / `Partial` / `Missing` marking, prioritization/cap, codebase-answerable rule, exact question format, wait-for-response behavior, incremental save behavior, final marker-count report, and deferred-marker handling.
- Evals cover vague export specs, vague error-message requirements, placeholder/deferred markers, wrong-tool routing, and anti-batching / incremental-save pressure; evals 1-3 remain unchanged and evals 4-5 are appended under root `skill_name: "clarify"`.
- `npx vitest run src/skills/clarify-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes.
- Completed task is removed from `TASKS.md`; the shared-helper scout task records thirteen skill specs.

## Vision trace

- **Vision goal**: G5 — Drift detection + auto-repair.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts before users rely on them.
- **Competitor prior art**: N/A — internal deterministic regression coverage for an agentbrew-owned human-in-the-loop clarification skill.

## Reviewer verdict

- **Verdict**: needs-revision
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - Fix wrapped-text assertions with regexes.
  - Make eval 4 a single wrong-tool boundary case.
  - Add concrete context to eval 5.
  - Clarify final evals.json structure and preservation of evals 1-3.
  - Cite the helper-extraction scout task ID.

## Reviewer verdict

- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - None. Revision cycle 2 resolved wrapped-text regexes, single-boundary wrong-tool eval 4, concrete continuation context for eval 5, final eval structure, preservation of evals 1-3, and the helper-extraction scout task ID.
