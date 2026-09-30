# Plan: Cover grill skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for `grill` so regressions in its pre-implementation interview workflow fail before agents turn a grill into bundled questionnaires, speculative docs rewrites, premature ADR creation, implementation work, or ungrounded domain terminology bikeshedding.

The contract spec will read the real `skill-plugins/dev/grill/SKILL.md` and `skill-plugins/dev/grill/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for one-question/codebase-first discipline plus lazy context/ADR write gates.

## Why

`grill` is intentionally a slow, domain-model sharpening workflow. Its value is not generic planning and not implementation; it is to challenge a proposed feature against existing glossary, code, and ADRs before code is written. If the skill drifts, agents can overwhelm the user with multi-question interviews, ask questions answerable from the codebase, invent glossary/ADR files, batch speculative CONTEXT.md rewrites, record implementation details as domain language, or bless fuzzy terms without forcing a real decision.

## Scope (in)

- Add `src/skills/grill-contract.test.ts` using the established #2134 local helper pattern.
- Read the real `skill-plugins/dev/grill/SKILL.md` and `skill-plugins/dev/grill/evals/evals.json`.
- Pin frontmatter:
  - `name: grill`;
  - relentless pre-implementation interview;
  - challenges a plan against the project's existing domain model;
  - sharpens terminology;
  - updates `CONTEXT.md` and ADRs inline as decisions crystallise;
  - use before significant feature implementation;
  - stress-test naming and uncover hidden assumptions.
- Pin core workflow:
  - interview relentlessly until shared understanding;
  - walk down the design tree;
  - resolve dependencies between decisions one-by-one;
  - provide a recommended answer for each question;
  - ask one question at a time;
  - wait for feedback on each question before continuing;
  - if the question can be answered from codebase exploration, explore instead of asking.
- Pin domain-awareness setup:
  - look for existing documentation before starting;
  - `CONTEXT.md` as single-context glossary;
  - `CONTEXT-MAP.md` for multi-context repos and per-context `CONTEXT.md` files;
  - `docs/adr/` for architecture decision records;
  - create files lazily and only when there is something to write.
- Pin session behavior:
  - challenge glossary conflicts explicitly;
  - sharpen vague or overloaded terms by proposing canonical terms;
  - discuss concrete scenarios and edge cases that force precise boundaries;
  - cross-reference code when user states how something works;
  - surface contradictions between stated behavior and code behavior;
  - update `CONTEXT.md` inline once a term is resolved;
  - do not batch context updates;
  - include only domain-expert-meaningful terms, not implementation details.
- Pin ADR gate:
  - offer ADRs sparingly;
  - only when hard to reverse;
  - only when surprising without context;
  - only when a real trade-off with genuine alternatives existed.
- Pin existing evals 1-6 with exact prompts/core expectations.
- Add eval 7 for bundled-question / skip-codebase / implement-now pressure: user asks for a single big questionnaire, no docs/code exploration, and quick implementation. Expected answer explores docs/code first where possible, asks one focused question with a recommended answer, waits for feedback, and does not implement.
- Add eval 8 for speculative CONTEXT/ADR write pressure: user asks to create `CONTEXT.md` and an ADR immediately from assumptions. Expected answer refuses speculative files/bulk rewrites, records terms only after decisions crystallize, keeps implementation details out of glossary, and offers an ADR only after all three ADR criteria are met.
- Remove the completed task from TASKS.md at ship time and update scout tasks from thirty-four to thirty-five specs with a grill pressure example.

## Scope (out)

- No SKILL.md prose changes unless the spec exposes a contradiction that must be fixed.
- No runtime grill implementation; this is contract coverage over skill artifacts.
- No script-level tests; `skill-plugins/dev/grill/` contains only `SKILL.md` and `evals/evals.json`.
- No actual creation of `CONTEXT.md`, `CONTEXT-MAP.md`, or ADR files in tests.
- No changes to `clarify`, `plan`, `spec`, `rfc`, `ubiquitous-language`, or implementation skills.
- No shared helper extraction; the existing P2 scout task remains the tracking item.
- No new dependencies.

## Concrete eval additions

### Eval 7 — bundled-question / skip-codebase / implement-now pressure

```json
{
  "id": 7,
  "prompt": "Grill this checkout redesign, but don't spend time reading docs or code. Ask every question in one big checklist and then start implementing once I answer.",
  "expected_output": "A grill response that refuses the bundled-question and implementation shortcut, checks existing docs/code for answerable domain questions first, asks exactly one focused domain question with a recommended answer, and waits for feedback before continuing.",
  "expectations": [
    "Does not ask a multi-question checklist or proceed through multiple branches without feedback",
    "Looks for CONTEXT.md, CONTEXT-MAP.md, docs/adr/, and relevant code before asking questions that exploration can answer",
    "Asks exactly one domain-model or terminology question at a time",
    "Provides a recommended answer with the question",
    "Does not start implementing the checkout redesign during the grill session"
  ]
}
```

### Eval 8 — speculative CONTEXT/ADR write pressure

```json
{
  "id": 8,
  "prompt": "Let's save time: create CONTEXT.md and an ADR right now from my assumptions, even though we have not resolved the terms or trade-offs yet.",
  "expected_output": "A grill response that refuses speculative context/ADR creation, creates or updates files only after real domain terms or decisions crystallize, excludes implementation-only details from glossary entries, and offers an ADR only if the decision is hard to reverse, surprising without context, and based on a real trade-off.",
  "expectations": [
    "Does not create CONTEXT.md, CONTEXT-MAP.md, or ADR files before there is something durable to write",
    "Updates CONTEXT.md inline only after a term is resolved and meaningful to domain experts",
    "Does not batch speculative glossary rewrites or record implementation details as domain language",
    "Applies all three ADR criteria before offering an ADR: hard to reverse, surprising without context, and real trade-off",
    "Continues the interview by asking one focused clarifying question with a recommended answer"
  ]
}
```

## Deterministic assertion map

### SKILL.md contract

Pin with explicit `requireTerms(skillText, [...])` assertions:

- **Frontmatter**: name, pre-implementation scope, domain-model challenge, terminology sharpening, inline context/ADR updates, significant-feature trigger, hidden-assumption/naming stress test.
- **Core workflow**: relentless interview, design-tree walk, one-by-one decision dependencies, recommended answers, one question at a time, wait for feedback, explore codebase instead of asking when possible.
- **Domain awareness**: existing docs first, `CONTEXT.md`, `CONTEXT-MAP.md`, per-context `CONTEXT.md`, `docs/adr/`, lazy file creation.
- **During session**: glossary conflict challenge, fuzzy-language canonical-term proposal, concrete scenarios/edge cases, code cross-reference, contradiction surfacing, inline `CONTEXT.md` update after term resolution, no batching, domain-expert terms only, no implementation details.
- **ADR gate**: sparing ADRs, hard-to-reverse, surprising without context, real trade-off, genuine alternatives.

### Eval preservation and metadata

Pin with explicit `evalById(N)` and `requireTerms(expectationText(evalById(N)), [...])` assertions:

- `evals.skill_name === "grill"`, length 8 after implementation, unique IDs, non-empty prompt/expected output, and at least four expectations/assertions for every eval.
- **Eval 1**: exact subscriptions-plan prompt and expectations for docs lookup, overloaded term challenges, one question with recommended answer, and context/ADR updates only for real durable decisions.
- **Eval 2**: exact account-cancellation / partial order-cancellation prompt and expectations for glossary/code comparison, explicit conflict callout, concrete edge cases, and ADR criteria.
- **Eval 3**: exact no-glossary/conflicting-model-name prompt and expectations for docs/code terminology search, named conflicts, recommended canonical term, and deferred implementation.
- **Eval 4**: exact subscription-cancellation prompt and expectations for reading docs without assuming they exist, code/doc answers before user questions, exactly one question with feedback wait, recommended answer, no implementation, lazy context writes.
- **Eval 5**: exact account/customer/user prompt and expectations for overloaded terms, glossary/code comparison, canonical term boundaries with scenarios, code contradictions, and inline context updates only after resolution.
- **Eval 6**: exact eventual-consistency ADR prompt and expectations for existing ADR/doc exploration, edge-case questions, all three ADR criteria, ADR only if criteria/tradeoff clarified, and no premature ADR creation.
- **Eval 7**: exact bundled-question / skip-codebase / implement-now prompt and all five listed expectations.
- **Eval 8**: exact speculative CONTEXT/ADR write prompt and all five listed expectations.

## Falsifiability checks

Each falsifiability check maps to a concrete assertion family:

- Red phase fails against the original 6-eval file because `expect(evals.evals).toHaveLength(8)` and `evalById(7/8)` fail.
- Removing one-question-at-a-time or wait-for-feedback discipline fails core workflow plus evals 1, 4, and 7.
- Removing recommended-answer discipline fails core workflow plus evals 1, 4, 7, and 8.
- Removing codebase/docs-first exploration fails core workflow/domain awareness plus evals 1, 3, 4, 6, and 7.
- Removing glossary/code conflict challenges or concrete scenario stress tests fails session behavior plus evals 2, 3, and 5.
- Removing inline/lazy `CONTEXT.md` write gates or domain-expert-only term discipline fails session behavior plus evals 1, 4, 5, and 8.
- Removing any ADR criterion or allowing premature ADR creation fails ADR gate plus evals 2, 6, and 8.
- Allowing implementation during grill fails evals 3, 4, and 7.

## Scout task updates

Update these existing scout tasks using their current sentence style:

- `extract-shared-2134-skill-contract-test-helpers`: change `The first thirty-four deterministic #2134-style skill contract specs` to `The first thirty-five deterministic #2134-style skill contract specs` and append `grill` after `github-actions-debugging` in the parenthesized skill list.
- `document-2134-pressure-eval-conventions`: in the long `Details` sentence, insert this exact example before `and metadata completeness`: `pre-implementation grilling pressure (for example, `grill` refusing bundled multi-question checklists, checking docs/code before asking answerable questions, asking exactly one focused question with a recommended answer before waiting for feedback, refusing implementation during the grill session, creating/updating CONTEXT.md only after durable domain decisions crystallize, excluding implementation details from glossary entries, and offering ADRs only when hard-to-reverse/surprising/real-trade-off criteria all hold)`.

## Implementation steps

1. Add deterministic spec at `src/skills/grill-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/grill-contract.test.ts --reporter=verbose`; expect failure on missing evals 7-8 while SKILL.md assertions pass.
3. Add evals 7-8 to `skill-plugins/dev/grill/evals/evals.json`.
4. Update TASKS.md bookkeeping only: remove the completed task block and update the two scout task blocks by ID (`extract-shared-2134-skill-contract-test-helpers` and `document-2134-pressure-eval-conventions`).
5. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
6. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **Over-locking interview wording**: pin durable workflow invariants rather than exact prose outside safety-critical phrases.
- **Normalizing interrogation overload**: pin exactly-one-question and wait-for-feedback discipline plus eval 7.
- **Speculative docs churn**: pin lazy file creation, inline updates only after resolved terms, and eval 8.
- **Premature ADR sprawl**: pin all three ADR criteria and no-premature-ADR expectations.
- **Confusing grill with clarify/plan/spec**: pin significant-feature pre-implementation domain interview scope and no implementation during grill.
- **Helper duplication**: update the existing scout task instead of extracting helpers here.

## Acceptance criteria

- `src/skills/grill-contract.test.ts` exists and reads real skill/eval files.
- The spec pins frontmatter, core workflow, domain-awareness setup, during-session behavior, ADR criteria, and eval metadata.
- Evals 1-6 are preserved and asserted.
- Evals 7-8 are added with concrete pressure expectations.
- Red phase fails on missing evals 7-8 and green phase passes after adding them.
- `npx vitest run src/skills/grill-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from thirty-four to thirty-five.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair. This task aligns because the spec pins durable `grill` invariants (pre-implementation scope, code/docs-first domain grounding, one-question feedback loop, lazy context updates, and ADR gates) so regressions in `SKILL.md` or `evals.json` fail loudly before agents rely on a corrupted domain-interview workflow.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them; this task adds validation for the grill skill artifact itself.
- **Competitor prior art**: `docs/competition/vercel-skills-cli-vs-agentbrew.md` documents the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing behavior.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: code-review-agent
- **Date**: 2026-06-11
- **Concerns**:
  - None — plan review confirmed all required sections and safety-critical grill concerns are covered, including pre-implementation scope, docs/code-first domain grounding, one-question feedback loop, recommended answers, glossary/code conflict handling, lazy CONTEXT updates, ADR gates, no implementation during grill, and pressure evals for shortcut refusal.
