# Plan: skill-coverage-builtins-scope

## Goal
Add a deterministic built-in-skill coverage scope so `agentbrew skills coverage` can measure only `skill-plugins/dev` skills when enforcing the 90% L2 eval-coverage gate.

## Why
The current coverage command scans every installed skill source on the developer's machine. That makes the denominator machine-specific (`246` in the discovery run) while the parent task and CI gate need the in-repo built-in denominator (`67` local dev skills in this worktree). A CI gate over all installed skills would fail for unrelated personal/team registries; a built-in scope makes the metric stable and tied to files this repo owns.

## Scope (in)
- Add a `--builtins` option to `agentbrew skills coverage`.
- Filter coverage entries to skills whose source label/path identifies the in-repo `skill-plugins/dev` source.
- Preserve the existing default behavior: no flag still reports all installed skills.
- Add tests that prove the default all-sources view and the builtins-only view use different denominators.
- Keep JSON and human output consistent with the filtered summary.

## Scope (out)
- Does not add the 90% gate to `npm run verify`; that remains blocked on this task plus remaining eval coverage.
- Does not author more `evals/evals.json` files.
- Does not change `validateAllSkills()` semantics for lint/status/drift.
- Does not rename source labels or change state.yaml source registration.

## Implementation steps

1. Extend the coverage options type and CLI parser:
   - Add `builtins?: boolean` to coverage options.
   - Register `--builtins` on `skills coverage` with help text describing the stable in-repo scope.

2. Add one RED test for the new behavior:
   - Mock `validateAllSkills()` with a mix of source labels/directories: in-repo builtins and external skills.
   - Assert `computeSkillCoverage({ builtins: true })` reports only the built-in denominator.
   - Assert default `computeSkillCoverage()` still includes all entries.

3. Implement the smallest filter:
   - Add an options parameter to `computeSkillCoverage()`.
   - Filter validation results before layering `validateEvals()` and structural warning counts.
   - Treat a skill as built-in when its directory path contains `/skill-plugins/dev/` or its source label is the repo's dev-skill label.

4. Wire through `runSkillsCoverage()`:
   - Pass options into `computeSkillCoverage()`.
   - JSON output naturally reflects the filtered summary.
   - Human output uses the existing summary printer.

5. Verify and scout:
   - Run targeted tests for coverage + validation.
   - Run `npm run dev -- skills coverage --json --builtins` and confirm the denominator is stable for in-repo builtins.
   - Run `npm run verify` before committing.
   - Record any discovered follow-up tasks in `TASKS.md`.

## Risks and mitigations

- **Risk**: Source labels vary by installation. **Mitigation**: Use directory path under `skill-plugins/dev` as the primary detection path and source label only as an additional convenience.
- **Risk**: The new flag is confused with permanent built-ins only. **Mitigation**: CLI help and task follow-up can say this scope means in-repo dev skills, not only non-migration-candidate skills.
- **Risk**: Filtering after validation still scans external skills. **Mitigation**: This task's acceptance is stable denominator, not scan performance. A future performance optimization can add path-scoped validation if needed.
- **Risk**: CI gate still cannot pass until more eval fixtures exist. **Mitigation**: Keep `skill-evals-flip-ci-threshold-90` blocked; this task only unblocks the metric shape.

## Acceptance criteria

- `agentbrew skills coverage --json --builtins` counts only `skill-plugins/dev` skills.
- Default `agentbrew skills coverage --json` continues to count all installed skills.
- Coverage tests assert both scoped and unscoped denominators.
- CLI help documents `--builtins`.
- `npm run verify` passes.

## Reviewer validation

PLAN_VERDICT: APPROVED

RATIONALE: The plan is well-scoped, TDD-first, backward-compatible, and directly unblocks the 90% CI gate task (`skill-evals-flip-ci-threshold-90`). It correctly identifies the denominator stability problem, proposes a minimal filtering solution with documented risk mitigations, and includes comprehensive acceptance criteria.
