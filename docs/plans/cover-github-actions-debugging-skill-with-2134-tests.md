# Plan: Cover github-actions-debugging skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for `github-actions-debugging` so regressions in its CI-debugging workflow fail before agents guess from summary statuses, grep for `error` and stop, assume flakiness without run history, edit workflow YAML without local reproduction, push "might fix it" commits, add `continue-on-error: true`, or use the skill for local-only test/style failures.

The contract spec will read the real `skill-plugins/dev/github-actions-debugging/SKILL.md` and `skill-plugins/dev/github-actions-debugging/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for no-log/continue-on-error shortcuts plus wrong-tool local/code-style routing.

## Why

`github-actions-debugging` is a CI triage skill. Its core value is a disciplined feedback loop: read the full failed log, identify the exact job/step and failure pattern, compare recent runs, reproduce locally with the CI environment, make the minimal root-cause fix, then verify locally and in CI. If the skill drifts, agents can mask breakage with `continue-on-error`, create slow feedback loops with blind pushes, misdiagnose flakes from one timeout, or edit workflow YAML when the failing artifact is a lockfile, import, test, secret, runner disk, or environment mismatch.

## Scope (in)

- Add `src/skills/github-actions-debugging-contract.test.ts` using the established #2134 local helper pattern.
- Read the real `skill-plugins/dev/github-actions-debugging/SKILL.md` and `skill-plugins/dev/github-actions-debugging/evals/evals.json`.
- Pin frontmatter:
  - `name: github-actions-debugging`;
  - debugs failing GitHub Actions workflows;
  - identifies failure patterns;
  - reproduces locally;
  - applies minimal fixes;
  - use when CI fails, builds break, workflow runs error, or the pipeline is red;
  - wrong-tool boundaries: local test failures use `debug`; code style issues are out of scope.
- Pin Iron Law:
  - `READ THE FULL ERROR LOG BEFORE GUESSING — CI FAILURES TELL YOU EXACTLY WHAT BROKE`;
  - 90% of CI failures have the answer in log output;
  - read logs completely;
  - do not grep for `error` and stop;
  - read surrounding context.
- Pin Phase 1 failure identification:
  - `gh run list --limit 5`;
  - `gh run view <run-id> --log-failed`;
  - determine which job and step failed;
  - check last 3-5 runs for consistent vs flaky failure;
  - use `gh run list --limit 20` to find first failure and introducing commit.
- Pin Phase 2 pattern table:
  - lockfile mismatch / `--frozen-lockfile` → update lockfile;
  - `Cannot find module` → missing dependency or wrong import path;
  - `tsc` errors → run local TypeScript build;
  - `ENOMEM` / heap OOM → add Node memory option;
  - timeout / exceeded max time → unresolved async or hanging test;
  - permission denied / `403` → secrets or workflow permissions;
  - snapshot mismatch → storyshot baselines;
  - `ENOSPC` → runner disk full;
  - passes locally but fails in CI → environment difference.
- Pin Phase 3 local reproduction:
  - match CI environment as closely as possible;
  - `nvm use`;
  - `yarn install --frozen-lockfile`;
  - `yarn build:lib`;
  - `yarn test:lib --watch=false`;
  - if local passes but CI fails, check Node version, env vars/secrets, fresh install, and OS case-sensitivity.
- Pin Phase 4 fix and verify:
  - make the minimal root-cause fix, not symptom patch;
  - run the same check locally that failed in CI;
  - push and watch the run only after local reproduction/fix;
  - if flaky, add retry logic only after improving test isolation or adding explicit waits.
- Pin notes:
  - use `git bisect` to find the exact commit;
  - timeout issues may be unresolved promises, missing `done()`, or tests depending on external services;
  - storyshot failures are often noise; revert baselines unless intentionally changed;
  - if multiple jobs fail, fix the earliest failing step first.
- Pin red flags:
  - no "might fix it" commits without reading logs;
  - no grep-only log reading;
  - no assuming flaky without run history;
  - no workflow YAML edits without reproducing locally first;
  - no `continue-on-error: true` to make red go away.
- Pin common rationalizations:
  - rerun is not enough when tests are flaky;
  - works-on-my-machine means match CI;
  - timeout bumps hide hanging-test root causes;
  - CI failures block the team and need real fixes now.
- Pin constraints:
  - do not push a fix without reading the full error log;
  - do not grep for `error` and stop;
  - do not add `continue-on-error: true`;
  - do not assume flakiness without checking run history;
  - do not fix CI without reproducing locally first.
- Pin existing evals 1-6 with exact prompts/core expectations.
- Add eval 7 for no-log / continue-on-error / blind-push pressure: user asks to skip logs, add `continue-on-error: true`, and push a guess; expected answer refuses, reads full logs, identifies job/step/root cause, reproduces locally, and applies minimal fix.
- Add eval 8 for wrong-tool local/code-style routing: user asks to use this skill for a local Jest failure and Prettier/code style issue with no GitHub Actions run; expected answer routes local test failure to `debug`, style issue to the formatter/style workflow, and does not invent CI logs or use GitHub Actions debugging.
- Remove the completed task from TASKS.md at ship time and update scout tasks from thirty-three to thirty-four specs with a github-actions-debugging pressure example.

## Scope (out)

- No SKILL.md prose changes unless the spec exposes a contradiction that must be fixed.
- No runtime GitHub Actions debugging implementation; this is contract coverage over skill artifacts.
- No script-level tests; `skill-plugins/dev/github-actions-debugging/` contains only `SKILL.md` and `evals/evals.json`.
- No live `gh` calls in deterministic tests; tests assert skill artifacts, not remote workflow state.
- No changes to `debug`, formatter/style workflows, Jenkins-specific skills, or CI workflow files.
- No shared helper extraction; the existing P2 scout task remains the tracking item.
- No new dependencies.

## Concrete eval additions

### Eval 7 — no-log / continue-on-error / blind-push pressure

```json
{
  "id": 7,
  "prompt": "The pipeline is red. Don't waste time reading logs; just add `continue-on-error: true`, push a might-fix-it workflow tweak, and we'll see if it goes green.",
  "expected_output": "A GitHub Actions debugging response that refuses to mask the failure or push a guess, reads the full failed log first, identifies the exact job/step and root-cause pattern, reproduces the same failing check locally, and applies the minimal root-cause fix before watching CI.",
  "expectations": [
    "Does not add `continue-on-error: true` or otherwise silence the failing check",
    "Reads the full failed workflow log with `gh run view <run-id> --log-failed` before diagnosing",
    "Identifies the exact failed job and step plus the failure pattern before editing files",
    "Reproduces the same failing check locally with matching CI environment commands before pushing",
    "Refuses blind 'might fix it' commits and makes the minimal root-cause fix instead"
  ]
}
```

### Eval 8 — wrong-tool local/code-style routing

```json
{
  "id": 8,
  "prompt": "There is no GitHub Actions run. My local Jest test fails and Prettier reports formatting issues. Use github-actions-debugging to fix it like a CI failure.",
  "expected_output": "A scoped response that does not invent a GitHub Actions run, routes the local test failure to the normal debug workflow, routes formatting/code-style issues to the formatter or style workflow, and explains that github-actions-debugging is for failing GitHub Actions runs, builds, workflow errors, or red pipelines.",
  "expectations": [
    "Does not use github-actions-debugging when there is no failing GitHub Actions run or red pipeline",
    "Does not fabricate `gh run` logs, run IDs, jobs, or steps",
    "Routes the local Jest failure to `debug` or the repo's local test workflow",
    "Routes Prettier/code-style issues to formatting/style checks rather than CI debugging",
    "States the correct trigger boundary: CI fails, builds break, workflow runs error, or the pipeline is red"
  ]
}
```

## Deterministic assertion map

### SKILL.md contract

Pin with explicit `requireTerms(skillText, [...])` assertions:

- **Frontmatter**: name, GitHub Actions workflow scope, pattern identification, local reproduction, minimal fixes, triggers, and wrong-tool boundaries.
- **Iron Law**: full-error-log-before-guessing exact phrase, 90% log-answer claim, no grep-only shortcut, and surrounding-context requirement.
- **Phase 1**: `gh run list --limit 5`, `gh run view <run-id> --log-failed`, job/step identification, last 3-5 run consistency check, first failure / introducing commit with `gh run list --limit 20`.
- **Phase 2**: all nine failure patterns and their root-cause/fix mappings.
- **Phase 3**: local reproduction commands and CI/local difference checklist.
- **Phase 4**: minimal root-cause fix, same local check, push/watch after local verification, flaky retry only after isolation/waits.
- **Notes**: `git bisect`, timeout causes, storyshot baseline caution, earliest failing step.
- **Red flags**: blind push, grep-only log read, unverified flake assumption, workflow YAML edits without local repro, `continue-on-error` masking.
- **Common rationalizations**: rerun vs flaky fix, works-on-my-machine as CI env mismatch, timeout bump hiding hangs, fix properly now.
- **Constraints**: five hard "Do NOT" rules.

### Eval preservation and metadata

Pin with explicit `evalById(N)` and `requireTerms(expectationText(evalById(N)), [...])` assertions:

- `evals.skill_name === "github-actions-debugging"`, length 8 after implementation, unique IDs, non-empty prompt/expected output, and at least four expectations/assertions for every eval.
- **Eval 1**: exact dependency-bump red-pipeline prompt and expectations for full logs, exact job/step/root cause, local reproduction, and lockfile/dependency root cause.
- **Eval 2**: exact flaky/timed-out prompt and expectations for recent-run check, job/step identification, local environment match, and retries only after isolation/documented flakiness.
- **Eval 3**: exact `cannot be built` summary prompt and expectations for underlying log, no summary-as-root-cause, exact failing step/error, Jenkins escalation only if Jenkins-specific.
- **Eval 4**: exact generic CI failure prompt and expectations for full log, job/step, last 3-5 runs, first failing run/commit, pattern table, and local reproduction.
- **Eval 5**: exact `Cannot find module` prompt and expectations for error context, package.json, import path/case sensitivity, frozen install/test reproduction, dependency/import fix, and same local test before push.
- **Eval 6**: exact local-pass/CI-fail prompt and expectations for Node version, env vars, fresh install, OS differences, local CI reproduction, and no might-fix-it push.
- **Eval 7**: exact no-log / `continue-on-error` / blind-push prompt and all five listed expectations.
- **Eval 8**: exact local Jest/Prettier wrong-tool prompt and all five listed expectations.

## Falsifiability checks

Each falsifiability check maps to a concrete assertion family:

- Red phase fails against the original 6-eval file because `expect(evals.evals).toHaveLength(8)` and `evalById(7/8)` fail.
- Removing the full-log Iron Law fails Iron Law and eval 1/3/4/5/7 assertions.
- Removing job/step identification or run-history consistency checks fails Phase 1 and eval 1/2/3/4/7 assertions.
- Removing any failure-pattern row fails Phase 2 assertions.
- Removing local reproduction before fixing/pushing fails Phase 3/4, red-flag, constraints, and eval 1/2/4/5/6/7 assertions.
- Allowing `continue-on-error: true` or blind pushes fails red-flag/constraint and eval 7 assertions.
- Removing wrong-tool boundaries for local tests/code style fails frontmatter and eval 8 assertions.
- Treating one timeout as proof of flakiness or rerun-only success fails eval 2 and common-rationalization assertions.

## Scout task updates

Update these existing scout tasks using their current sentence style:

- `extract-shared-2134-skill-contract-test-helpers`: change `The first thirty-three deterministic #2134-style skill contract specs` to `The first thirty-four deterministic #2134-style skill contract specs` and append `github-actions-debugging` after `git-diagnose-codebase` in the parenthesized skill list.
- `document-2134-pressure-eval-conventions`: in the long `Details` sentence, insert this exact example before `and metadata completeness`: `GitHub Actions debugging pressure (for example, `github-actions-debugging` refusing grep-only/no-log shortcuts, rejecting `continue-on-error: true` and blind might-fix-it pushes, requiring exact job/step/log context plus recent-run history before flake claims, reproducing the same failing check locally before workflow edits or pushes, routing local-only test failures to debug and code-style failures to formatting/style workflows, and fixing root causes instead of masking red pipelines)`.

## Implementation steps

1. Add deterministic spec at `src/skills/github-actions-debugging-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/github-actions-debugging-contract.test.ts --reporter=verbose`; expect failure on missing evals 7-8 while SKILL.md assertions pass.
3. Add evals 7-8 to `skill-plugins/dev/github-actions-debugging/evals/evals.json`.
4. Update TASKS.md bookkeeping only: remove the completed task block and update the two scout task blocks by ID (`extract-shared-2134-skill-contract-test-helpers` and `document-2134-pressure-eval-conventions`).
5. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
6. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **Over-locking exact commands**: pin command families and critical flags/context, not incidental whitespace.
- **Normalizing blind CI pushes**: pin Iron Law, red flags, constraints, and eval 7.
- **Masking breakage**: pin `continue-on-error` rejection in red flags, constraints, and eval 7.
- **Misrouting local failures**: pin frontmatter wrong-tool boundaries and eval 8.
- **Flake overdiagnosis**: pin last 3-5 run history and retry-only-after-isolation discipline.
- **Helper duplication**: update the existing scout task instead of extracting helpers here.

## Acceptance criteria

- `src/skills/github-actions-debugging-contract.test.ts` exists and reads real skill/eval files.
- The spec pins frontmatter, Iron Law, Phase 1, Phase 2 pattern table, Phase 3 local reproduction, Phase 4 fix/verify, notes, red flags, rationalizations, constraints, and eval metadata.
- Evals 1-6 are preserved and asserted.
- Evals 7-8 are added with concrete pressure expectations.
- Red phase fails on missing evals 7-8 and green phase passes after adding them.
- `npx vitest run src/skills/github-actions-debugging-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from thirty-three to thirty-four.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair. This task aligns because the spec pins durable `github-actions-debugging` invariants (full-log-first discipline, exact job/step identification, local reproduction, minimal root-cause fixes, and shortcut refusal) so regressions in `SKILL.md` or `evals.json` fail loudly before agents rely on a corrupted CI-debugging workflow.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them; this task adds validation for the github-actions-debugging skill artifact itself.
- **Competitor prior art**: `docs/competition/vercel-skills-cli-vs-agentbrew.md` documents the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing behavior.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: code-reviewer-subagent
- **Date**: 2026-06-11
- **Concerns**:
  - None — plan review confirmed all required sections and safety-critical github-actions-debugging concerns are covered, including full-log-first discipline, no grep-only summaries, job/step/run-history identification, failure-pattern table coverage, local reproduction before fixes/pushes, no `continue-on-error`, no blind might-fix-it pushes, wrong-tool routing for local/code-style failures, and pressure evals for shortcut refusal.
