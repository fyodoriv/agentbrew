# Cover analyze skill with #2134-style tests

## Goal

Add deterministic regression coverage for `skill-plugins/dev/analyze/` so the skill's read-only consistency-analysis contract, detection passes, report shape, remediation gate, and eval metadata fail loudly when they drift.

## Why

`analyze` is a pre-implementation cross-artifact consistency check. If its guidance weakens, agents can silently mutate specs/tasks while claiming to be read-only, skip whole classes of drift, produce unprioritized reports, or handle work that belongs to `clarify`, `plan`, `spec`, or `review`. Deterministic coverage protects VISION.md G5 (drift detection + auto-repair) and US 18 (validation catches broken artifacts before users rely on them).

## Scope in

- Add `src/skills/analyze-contract.test.ts` using the established #2134-style skill contract pattern.
- Read the real `skill-plugins/dev/analyze/SKILL.md` and `skill-plugins/dev/analyze/evals/evals.json` from disk.
- Assert SKILL.md contract content:
  - trigger scope: read-only cross-artifact consistency checker for existing spec/plan/tasks;
  - boundary routing: do not use for resolving ambiguities (`clarify`), creating artifacts (`plan` or `spec`), or reviewing code diffs (`review`);
  - read-only safety: no file modifications during analysis;
  - Step 1 semantic inventory: requirements, user stories, plan decisions, and tasks maps before detection;
  - Step 2 six detection passes: duplication, ambiguity, underspecification, constitution alignment, coverage gaps, inconsistency;
  - cap total findings at 50 and summarize overflow;
  - Step 3 severity-tagged report: CRITICAL/HIGH/MEDIUM/LOW and summary counts for requirements, tasks, coverage, open clarifications;
  - Step 4 remediation gate: offer fixes only after the report, modify files only after explicit user approval, and show proposed edits before making them.
- Assert eval metadata coverage:
  - general spec/plan/task consistency analysis;
  - underspecified/vague requirement detection;
  - constitution/principle alignment audit;
  - no-modification pressure case;
  - wrong-tool boundary case for ambiguity-resolution or code-review requests.

## Scope out

- Do not change `analyze` runtime behavior; this skill has no executable helper script.
- Do not run live agent evals in this slice.
- Do not edit spec/plan/task artifacts except this task's plan and `TASKS.md` queue metadata.
- Do not extract shared test helpers; the existing P2 scout tracks that.
- Do not create new lint infrastructure beyond this deterministic spec.

## Implementation steps

1. Add `src/skills/analyze-contract.test.ts` with local helper functions matching neighboring #2134 specs.
2. Pin SKILL.md trigger, routing, inventory, detection-pass, report-shape, cap, and remediation-gate terms.
3. Extend `skill-plugins/dev/analyze/evals/evals.json` from 3 to 5 scenarios by adding read-only/no-modification and wrong-tool boundary pressure cases.
4. Ensure each eval has a unique ID, non-empty prompt/output, and at least four concrete expectations.
5. Remove the completed task block from `TASKS.md` and update the helper-extraction scout task from eight to nine contract specs.
6. Run focused and full verification:
   - `npx vitest run src/skills/analyze-contract.test.ts`
   - `npm run skills:coverage`
   - `npm run verify`

## Risks and mitigations

- **Brittle prose locks**: Use exact strings for commands/report headings and regexes for wrapping-prone prose.
- **Read-only regression**: Pin no-file-modification guidance in SKILL.md and a pressure eval that asks for immediate edits.
- **Wrong-tool drift**: Pin both description boundaries and an eval that routes ambiguity/code-review work away from analyze.
- **Report quality drift**: Assert severity headings and summary counts so findings remain actionable.
- **Helper duplication**: Accept local duplication for this P0 and update the existing helper-extraction scout.

## Acceptance criteria

- New deterministic spec reads `skill-plugins/dev/analyze/SKILL.md` and `skill-plugins/dev/analyze/evals/evals.json`.
- The spec pins trigger scope, wrong-tool boundaries, read-only safety, semantic inventory, all six detection passes, severity report shape, summary counts, finding cap, and remediation approval gate.
- Evals cover general consistency, underspecification, constitution alignment, no-modification pressure, and wrong-tool boundary cases.
- `npx vitest run src/skills/analyze-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes.
- Completed task is removed from `TASKS.md`; the shared-helper scout task records nine skill specs.

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
  - Implementation suggestion: make eval #4 explicitly ask for immediate edits and eval #5 explicitly ask for ambiguity resolution or code review.
  - Implementation suggestion: use exact strings for fixed headings and regexes for wrapping-prone prose.
