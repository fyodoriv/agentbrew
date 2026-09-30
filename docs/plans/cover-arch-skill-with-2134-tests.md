# Cover arch skill with #2134-style tests

## Goal

Add deterministic regression coverage for `skill-plugins/dev/arch/` so the skill's architecture-review workflow, Ousterhout deep-module vocabulary, candidate presentation contract, premature-interface boundary, and eval metadata fail loudly when they drift.

## Why

`arch` is a high-leverage design skill. If its guidance weakens, agents can produce generic refactor advice, skip the deletion test, recommend shallow test-only helpers, design interfaces before the user chooses a candidate, or mutate architecture artifacts without the required user decision. Deterministic coverage protects VISION.md G5 (drift detection + auto-repair) and US 18 (validation catches broken agent artifacts before users rely on them).

## Scope in

- Add `src/skills/arch-contract.test.ts` using the established #2134-style skill contract pattern.
- Read the real `skill-plugins/dev/arch/SKILL.md` and `skill-plugins/dev/arch/evals/evals.json` from disk.
- Assert SKILL.md contract content:
  - trigger scope: improve architecture, find refactoring opportunities, make a codebase more testable;
  - purpose: surface architectural friction and propose deepening opportunities that put more behavior behind smaller interfaces;
  - Ousterhout/deep-modules framing and testability/AI-navigability goal;
  - exact vocabulary terms: Module, Interface, Depth, Seam, Adapter, Locality, Deletion test;
  - Explore process: use the Explore subagent, find bouncing-between-modules friction, shallow modules, testability-only pure-function extractions, and hard-to-test interfaces;
  - deletion test application to suspected shallow modules;
  - candidate presentation fields: Files, Problem, Solution, Benefits;
  - boundary: do not propose interfaces yet; ask which candidate the user wants to explore;
  - grilling loop: constraints, deepened module shape, seam contents, surviving tests;
  - side effects only as decisions crystallise: add new names to `CONTEXT.md`; offer ADRs for rejected candidates with load-bearing reasons.
- Assert eval metadata coverage:
  - general architectural-friction candidate list;
  - testability-focused deepening candidates;
  - selected-candidate design-tree discussion;
  - premature-interface-design pressure case;
  - shallow test-only helper / broad rewrite pressure case.

## Scope out

- Do not change `arch` runtime behavior; this skill has no executable helper script.
- Do not run live agent evals in this slice.
- Do not edit architecture docs or `CONTEXT.md`; the contract only tests guidance.
- Do not extract shared test helpers; existing scout tasks track shared #2134 helper/documentation work.
- Do not create new lint infrastructure beyond this deterministic spec.

## Implementation steps

1. Add `src/skills/arch-contract.test.ts` with local helper functions matching neighboring #2134 specs.
2. Pin SKILL.md trigger, purpose, vocabulary, explore, deletion-test, candidate-output, premature-interface, grilling-loop, and side-effect terms.
3. Extend `skill-plugins/dev/arch/evals/evals.json` from 3 to 5 scenarios by adding premature-interface and shallow-helper/broad-rewrite pressure cases.
4. Ensure each eval has a unique ID, non-empty prompt/output, and at least four concrete expectations.
5. Remove the completed task block from `TASKS.md` and update the helper-extraction scout task from nine to ten contract specs.
6. Run focused and full verification:
   - `npx vitest run src/skills/arch-contract.test.ts`
   - `npm run skills:coverage`
   - `npm run verify`

## Risks and mitigations

- **Brittle prose locks**: Use exact strings for fixed vocabulary/process headings and regexes for wrapping-prone prose.
- **Generic refactor drift**: Pin the deepening-opportunity wording, deletion test, and locality/leverage/testability benefits.
- **Premature design drift**: Pin "Do NOT propose interfaces yet" and add a pressure eval that asks for interface design immediately.
- **Test-only helper drift**: Add a pressure eval that asks for shallow test-helper extraction and requires deepening/seam reasoning instead.
- **Side-effect confusion**: Pin that `CONTEXT.md` and ADR side effects happen only after user decisions crystallise.

## Acceptance criteria

- New deterministic spec reads `skill-plugins/dev/arch/SKILL.md` and `skill-plugins/dev/arch/evals/evals.json`.
- The spec pins trigger scope, Ousterhout/deep-module purpose, vocabulary, Explore process, deletion test, candidate presentation, premature-interface boundary, grilling-loop requirements, and decision-gated side effects.
- Evals cover general friction, testability, selected-candidate design, premature-interface pressure, and shallow-helper/broad-rewrite pressure cases.
- `npx vitest run src/skills/arch-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes.
- Completed task is removed from `TASKS.md`; the shared-helper scout task records ten skill specs.

## Vision trace

- **Vision goal**: G5 — Drift detection + auto-repair.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts before users rely on them.
- **Competitor prior art**: N/A — internal deterministic regression coverage for an agentbrew-owned skill.

## Reviewer verdict

- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - None blocking.
  - Implementation suggestion: make eval #4 test premature interface design before user selection.
  - Implementation suggestion: make eval #5 test shallow test-only helper or broad rewrite pressure without deepening/seam reasoning.
