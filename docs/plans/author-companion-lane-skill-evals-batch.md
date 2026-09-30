# Plan: author-companion-lane-skill-evals-batch

## Goal
Add spec-valid `evals/evals.json` files for four uncovered companion-lane built-in skills: `companion-researcher`, `companion-skill-curate`, `companion-task-groom`, and `companion-test-gaps`.

## Why
The parent eval-coverage epic needs the built-in L2 eval denominator to reach ≥90% before CI can enforce it. The current built-in coverage is 19/66 (29%). This batch raises coverage by four skills without touching eval files already covered by open PRs #1140 and #1145.

## Scope (in)
- Author realistic `expectations`-format evals for the four selected companion-lane skills.
- Cover the behavior that distinguishes these skills from generic advice: read-only boundaries, write allow-lists, sub-skill routing, task filing, no state-mutating agentbrew commands, no public writes, and bounded reporting.
- Update `TASKS.md` progress for this focused subtask and remove the subtask block when shipped.
- Run targeted eval validation and the full `npm run verify` gate before commit.

## Scope (out)
- Does not run agent-driven with/without-skill benchmarks; this batch only lands spec-valid eval definitions.
- Does not edit `SKILL.md` prose or change companion workflow behavior.
- Does not author evals for skills touched by open PRs #1140 or #1145.
- Does not flip the 90% CI coverage gate; that remains blocked until the parent epic reaches ≥90%.

## Implementation steps

1. Read the selected `SKILL.md` files and nearby existing companion eval files for style.
2. Add `evals/evals.json` under each selected skill directory with three realistic prompts each.
3. Ensure every eval has:
   - a unique integer `id`;
   - a realistic user prompt;
   - an `expected_output` summary;
   - at least three non-empty `expectations`.
4. Validate the batch:
   - `npm run dev -- skills coverage --ci --threshold 34 --builtins`
   - targeted validation if available through existing skill validation tests.
   - `npm run verify`.
5. Remove `author-companion-lane-skill-evals-batch` from `TASKS.md` once accepted, and append a parent progress note with the new built-in coverage count.

## Risks and mitigations

- **Risk**: Prompts are too generic and fail the "no garbage tests" bar. **Mitigation**: Make each prompt target a concrete boundary from the skill docs, such as "worker is editing TASKS.md", "catalog source refresh would mutate state", or "coverage tool is missing".
- **Risk**: Merge conflicts with open eval PRs. **Mitigation**: Do not touch files listed in PRs #1140 or #1145.
- **Risk**: Coverage threshold in this branch does not account for concurrently open PRs. **Mitigation**: Gate this branch on 23/66 (34%) from current `main`, not on cumulative open-PR coverage.
- **Risk**: Full verify takes time and may surface unrelated main instability. **Mitigation**: Run targeted validation first to localize this batch, then full verify per repo policy before commit.

## Acceptance criteria
- Four new eval files exist:
  - `skill-plugins/dev/companion-researcher/evals/evals.json`
  - `skill-plugins/dev/companion-skill-curate/evals/evals.json`
  - `skill-plugins/dev/companion-task-groom/evals/evals.json`
  - `skill-plugins/dev/companion-test-gaps/evals/evals.json`
- `npm run dev -- skills coverage --ci --threshold 34 --builtins` passes.
- `npm run verify` passes.
- The focused subtask is removed from `TASKS.md`; the parent task remains open with updated progress.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-04
- **Concerns**:
  - None
