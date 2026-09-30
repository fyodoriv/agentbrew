# Cover autoresearch skill with #2134-style tests

## Goal

Add deterministic regression coverage for `skill-plugins/dev/autoresearch/` so the skill's metric-driven autonomous loop, setup confirmation gate, dual verification gates, commit/revert safety, stuck-recovery ladder, cross-run learning, and eval metadata fail loudly when they drift.

## Why

`autoresearch` is intentionally powerful: it can edit files, commit, verify, keep, discard, and repeat indefinitely. If its contract weakens, agents can run open-ended loops without a measurable target, skip user confirmation, batch risky changes, claim subjective progress, or keep broken commits. Deterministic coverage protects VISION.md G5 (drift detection + auto-repair) and US 18 (validation catches broken agent artifacts before users rely on them).

## Scope in

- Add `src/skills/autoresearch-contract.test.ts` using the established #2134-style skill contract pattern.
- Read the real `skill-plugins/dev/autoresearch/SKILL.md` and `skill-plugins/dev/autoresearch/evals/evals.json` from disk.
- Assert SKILL.md contract content:
  - description: Modify → Verify → Keep/Discard → Repeat;
  - trigger scope: quantifiable iterative metrics such as errors, coverage, performance;
  - wrong-use boundaries: one-shot tasks, subjective goals, human-judgment-every-step work, feature development, bug hunting, and architecture decisions;
  - role: Autonomous Research Engineer, one atomic change at a time, mechanical verification, failures auto-revert;
  - core loop: read state/history/lessons, pick one hypothesis, make one atomic change, commit before verification, dual-gate verify/guard, keep/discard, log, repeat;
  - setup fields: Goal, Scope, Metric, Direction, Verify, Guard, Iterations;
  - setup confirmation gate before starting;
  - baseline measurement and guard pass before iteration;
  - dual-gate KEEP/REWORK/DISCARD matrix;
  - result log shape and every-5-iteration health check;
  - stuck recovery ladder: REFINE, PIVOT, web search, STOP;
  - cross-run lessons and max-50 lesson summarization;
  - parallel experiments constraints: only when multiple hypotheses are equally viable, each hypothesis is independent, and the metric is deterministic;
  - modes and hard rules;
  - output report markdown structure: Goal, Results, Key Lessons, Remaining Work, Verdict, and `<!-- VERDICT: PASS -->` marker.
- Assert eval metadata coverage:
  - `any`-elimination loop setup;
  - coverage-improvement campaign;
  - bundle-size optimization loop;
  - eval #4: wrong-use boundary for one-shot/subjective/human-judgment work;
  - eval #5: safety-gate pressure that asks to skip confirmation, batch changes, or skip mechanical guard verification.

## Scope out

- Do not change `autoresearch` runtime behavior; this skill has no deterministic helper script.
- Do not run live agent evals in this slice.
- Do not execute an autoresearch loop, create `.orchestrator/` artifacts, or make metric-optimization commits.
- Do not extract shared test helpers; existing scout tasks track shared #2134 helper/documentation work.
- Do not create new lint infrastructure beyond this deterministic spec.

## Implementation steps

1. Add `src/skills/autoresearch-contract.test.ts` with local helper functions matching neighboring #2134 specs.
2. Pin SKILL.md trigger scope, wrong-tool boundaries, setup, confirmation, baseline, core loop, dual gates, keep/discard matrix, stuck recovery, lessons, parallel experiments, modes, hard rules, and output report terms.
3. Extend `skill-plugins/dev/autoresearch/evals/evals.json` from 3 to 5 scenarios by adding wrong-use and skip-safety-gates pressure cases.
4. Ensure each eval has a unique ID, non-empty prompt/output, and at least four concrete expectations.
5. Remove the completed task block from `TASKS.md`, update the helper-extraction scout task from ten to eleven contract specs, and add at least one scout follow-up if implementation reveals a reusable gap.
6. Run focused and full verification:
   - `npx vitest run src/skills/autoresearch-contract.test.ts`
   - `npm run skills:coverage`
   - `npm run verify`

## Risks and mitigations

- **Brittle prose locks**: Use exact strings for fixed headings/tables/hard rules and regexes for wrapping-prone prose.
- **Safety-gate drift**: Pin both the confirmation gate and the commit-before-verification / revert-on-discard mechanics.
- **Subjective-success drift**: Pin mechanical verification, metric direction, baseline measurement, and the final evidence-based verdict format.
- **Autonomous loop runaway drift**: Pin health checks, stuck recovery, and explicit STOP reporting after repeated failed pivots.
- **Wrong-tool drift**: Add a pressure eval that asks for one-shot/subjective/human-judgment work and requires routing away from autoresearch.

## Acceptance criteria

- New deterministic spec reads `skill-plugins/dev/autoresearch/SKILL.md` and `skill-plugins/dev/autoresearch/evals/evals.json`.
- The spec pins trigger scope, wrong-use boundaries, setup fields, setup confirmation, baseline, core loop, dual gates, keep/discard behavior, stuck recovery, cross-run lessons, modes, hard rules, and report format.
- Evals cover `any` elimination, coverage improvement, bundle-size optimization, wrong-use routing, and skip-safety-gates pressure.
- `npx vitest run src/skills/autoresearch-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes.
- Completed task is removed from `TASKS.md`; the shared-helper scout task records eleven skill specs.

## Vision trace

- **Vision goal**: G5 — Drift detection + auto-repair.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts before users rely on them.
- **Competitor prior art**: N/A — internal deterministic regression coverage for an agentbrew-owned skill.

## Reviewer verdict

- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - None blocking. Minor suggestions incorporated: named the two pressure evals, expanded parallel-experiment constraints, and made the output report/verdict marker explicit.
