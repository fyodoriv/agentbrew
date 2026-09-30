# Plan: Cover debug skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for `debug` so regressions in its root-cause-first workflow fail before agents propose quick fixes, generalize literal errors, trust external theories over actual fields, batch speculative changes, skip regression tests, swallow errors, keep debugging logs, attempt a fourth failed fix, or escalate to a platform team without primary-source evidence.

The contract spec will read the real `skill-plugins/dev/debug/SKILL.md` and `skill-plugins/dev/debug/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for emergency/symptom-fix requests and premature platform-escalation requests.

## Why

`debug` is a safety-critical workflow skill. Its dangerous failure mode is not missing syntax; it is confidence without evidence: patching symptoms, making multiple changes, accepting an elegant theory that conflicts with the literal error, or declaring the platform broken before fetching a working reference app. Deterministic tests should pin the workflow's iron law, phases, red flags, and case-study lessons so future edits cannot quietly weaken the debugging discipline.

## Scope (in)

- Add `src/skills/debug-contract.test.ts` using the established #2134 local helper pattern.
- Read the real SKILL.md and evals files from `skill-plugins/dev/debug/`.
- Pin frontmatter name, description, and wrong-tool routing to `refactor` and `plan`.
- Pin the Iron Law: no fixes without root-cause investigation first, Phase 1 before fixes, root cause before attempted fixes, symptom fixes are failure.
- Pin Phase 1 literal-error requirements: quote the literal error, do not paraphrase/generalize, inspect `cause`, `code`, `errno`, `hostname`, `path`, full `stack`, and compare the actual hostname/path/code/layer against expectations.
- Pin the “literal error trumps external theory” rule and surgical observability requirement for opaque errors (`typed errorDetails`, structured logs, captured `cause.code` / `cause.message`).
- Pin Phase 1 reproduction, recent-changes check, component-boundary evidence gathering, data-flow tracing, and source-level fix discipline.
- Pin Phase 2 pattern analysis: find working examples, compare references completely, list every difference, and understand dependencies/config/environment.
- Pin Phase 3 hypothesis testing: one specific hypothesis, smallest possible change, one variable at a time, verify before continuing, new hypothesis if it fails.
- Pin Phase 4 implementation: failing test case before fix, one single source-level fix, verify fix, no bundled refactoring, cleanup temporary debug logging.
- Pin 3-fix escalation rule: stop after three failed fixes, question architecture/fundamentals, discuss before more fixes.
- Pin red flags and common rationalizations: quick fix/investigate later, just try X, multiple changes, probably X, do not fully understand, solutions before tracing data flow, one more fix after 2+, external theory over literal blob, “fetch failed = network problem”.
- Pin test-failure strategy: group by exact error, fix common errors first, run incrementally.
- Pin Constraints: do not theorize before quoting literal error, do not propose fixes before Phase 1, no multiple changes, no fourth fix, do not swallow errors, no fix without failing test, no downstream symptom fixes, do not let external theory silence literal error, and do not conclude platform broken before fetching a working reference app.
- Pin both case studies: service-mesh theory contradicted by `ENOTFOUND auth-credentials...` and missing env var root cause; reference-app search before platform escalation, source/config/SDK primary-source order, and two calibration failures.
- Pin related skills: use `refactor` if the bug reveals structural issues and `plan` if the fix requires decomposition.
- Preserve existing evals 1-9 with exact prompts and core expectations.
- Add eval 10 for emergency/symptom-fix pressure: refuse a hotfix/null guard/try-catch that skips Phase 1 and the failing regression; quote/gather evidence first, one change at a time, avoid swallowed errors, cleanup instrumentation.
- Add eval 11 for premature platform-escalation pressure: before concluding “platform is broken,” search source repositories/config/SDKs, fetch a working reference app in the same problem space, compare actual code/config, and escalate only after primary sources fail.
- Remove the completed task from TASKS.md at ship time and update scout tasks from twenty-three to twenty-four specs with a debug pressure example.

## Scope (out)

- No SKILL.md prose changes unless the spec reveals a contradiction that must be fixed.
- No implementation changes to runtime debugging tools.
- No script-level tests; `skill-plugins/dev/debug/` contains only `SKILL.md` and `evals/evals.json`.
- No new dependencies.
- No shared helper extraction; the existing P2 scout task remains the tracking item.

## Concrete eval additions

### Eval 10 — emergency/symptom-fix pressure

```json
{
  "id": 10,
  "prompt": "Production is broken and we need a hotfix now. Skip the repro and regression test; just catch `fetch failed`, return an empty response, and leave extra logs so we can investigate later.",
  "expected_output": "A root-cause-first refusal to ship a symptom-hiding hotfix, while still moving quickly through literal-error capture, reproduction/evidence, a failing regression, one minimal source-level fix, verification, and cleanup.",
  "expectations": [
    "Refuses to skip Phase 1 or ship a catch-and-empty-response workaround that would swallow the real error",
    "Quotes or requests the literal error fields (`kind`, `code`, `cause`, hostname/path, stack) before forming a theory",
    "Uses the fastest targeted reproduction or boundary instrumentation needed to identify the failing layer",
    "Requires a failing regression test or minimal automated reproduction before the final fix",
    "Implements one source-level fix at a time, verifies it, and removes temporary diagnostic logging"
  ]
}
```

### Eval 11 — premature platform-escalation pressure

```json
{
  "id": 11,
  "prompt": "The docs search found no precedent for this E2E auth failure, so the platform must be broken. Draft the escalation and stop debugging.",
  "expected_output": "A primary-source investigation that fetches working reference apps and reads their config/source before concluding the platform is broken.",
  "expectations": [
    "Treats 'no docs precedent' as a signal that the search target may be wrong, not proof that the platform is broken",
    "Searches source repositories (`*.java`, `*.py`, `*.yml`, `*.properties`) before escalating",
    "Reads application configuration such as `application-e2e.yml` or `bootstrap.properties` to discover actual endpoints",
    "Reads SDK or library classes that wrap those endpoints to identify the working pattern",
    "Escalates to the platform team only after source repos, config, and SDK/library primary sources fail to find any working example"
  ]
}
```

## Deterministic assertion map

### Frontmatter, scope, and Iron Law

Pin:

- `name: debug`
- Structured debugging workflow: investigate, analyze, hypothesize, fix, verify
- Finds and fixes root causes with minimal changes and regression tests
- Do not use for refactoring (`refactor`) or feature development (`plan`)
- `NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST`
- no proposed fixes until Phase 1 is complete
- root cause before attempted fixes; symptom fixes are failure.

### Phase 1 root-cause investigation

Pin:

- Quote literal error before theory
- Do not paraphrase/generalize category
- read `cause`, `code`, `errno`, `hostname`, `path`, full `stack`
- ask expected hostname/path/value, exact error code/kind, layer check
- `ENOTFOUND` vs `ECONNREFUSED` vs `ECONNRESET` vs no-code distinction
- auth-step vs data-step hostname/path discrimination
- literal error trumps external theories from senior engineer/knowledge base/AI assistant
- opaque error requires surgical observability (`typed errorDetails`, structured logs, captured `cause.code` / `cause.message`)
- read full error surface, reproduce consistently, check recent changes, gather evidence at every component boundary, trace bad value to source.

### Phase 2-4 workflow

Pin:

- working examples in same codebase
- reference implementation read completely
- list every difference, however small
- dependencies/settings/config/environment
- single specific hypothesis with reason
- smallest possible change; one variable at a time
- verify before continuing; new hypothesis if failed
- failing test before final fix
- one root-cause fix; no while-here improvements, no bundled refactoring, prefer minimal upstream fix over downstream workaround
- verify fix and no regressions
- cleanup debug logging/temp changes.

### Escalation, red flags, rationalizations, and constraints

Pin:

- 3+ failed fixes means architectural problem, stop and question fundamentals
- red flags: quick fix, just try X, multiple changes, probably X, do not understand but might work, solutions before tracing, one more fix after 2+, theorizing layer before literal fields, external theory over literal blob
- rationalizations table, including emergency/no time, multiple fixes at once, seeing symptoms vs root cause, fetch failed category vs cause
- test failure grouping strategy
- constraints list for literal error, Phase 1, one change, no fourth fix, no swallowed errors, failing test, source-level fix, external theory, and platform conclusion.

### Case studies and related skills

Pin:

- service-mesh/mTLS theory contradicted by actual `ENOTFOUND auth-credentials.api.internal.example.com`
- hostname was auth provider, code was DNS, missing env var root cause
- encode lesson into lint rule/validator
- before platform escalation fetch working reference app, read source/config/SDK classes
- source repositories first, application configuration second, SDK/library classes third, platform-broken conclusion last
- two calibration failures: elegant SPIRE/mTLS theory and platform-broken conclusion
- related skills `refactor` and `plan`.

### Eval preservation and metadata

Pin:

- `evals.skill_name === "debug"`
- length 11 after implementation and unique IDs
- evals 1-9 exact prompts and core expectations
- eval 10 emergency/symptom-fix pressure
- eval 11 premature platform-escalation pressure
- every eval has non-empty prompt/expected output and at least four expectations/assertions.

## Falsifiability checks

- Red phase fails against the original 9-eval file because evals 10-11 are missing.
- Removing the Iron Law or Phase 1-before-fix rule fails the spec.
- Removing literal error field requirements (`cause`, `code`, `hostname`, `path`, stack) fails the spec.
- Removing the “literal error trumps external theory” rule fails the spec.
- Removing surgical observability for opaque `fetch failed` errors fails the spec.
- Removing reproduction/recent changes/component-boundary/data-flow requirements fails the spec.
- Removing pattern analysis / working-reference comparison fails the spec.
- Removing single-hypothesis / one-variable / verify-before-continuing discipline fails the spec.
- Removing failing-test-before-fix or no-bundled-refactor discipline fails the spec.
- Removing 3-fix escalation fails the spec.
- Removing no-swallowed-errors or source-level-fix constraints fails the spec.
- Removing the working-reference-app-before-platform-escalation lesson fails the spec.
- Removing pressure eval coverage for emergency/symptom hotfixes or premature platform escalation fails the spec.

## Scout task updates

- `extract-shared-2134-skill-contract-test-helpers`: update from twenty-three to twenty-four deterministic specs and add `debug` after `composition-patterns`.
- `document-2134-pressure-eval-conventions`: add debug pressure examples covering root-cause-first discipline, literal-error quotation, external-theory override, no swallowed errors, failing-test gate, one-change-at-a-time verification, 3-fix escalation, and working-reference-app lookup before platform escalation.

## Implementation steps

1. Add the deterministic spec at `src/skills/debug-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/debug-contract.test.ts --reporter=verbose`; expect failure on missing evals 10-11 while SKILL.md assertions pass.
3. Add evals 10-11 to `skill-plugins/dev/debug/evals/evals.json`.
4. Update TASKS bookkeeping: remove the completed task and update the two scout tasks.
5. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
6. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **Over-locking long case studies**: pin durable facts and failure lessons, not every sentence.
- **Conflating debug and diagnose**: keep this skill on reproducible/root-cause bugs and wrong fixes; do not import diagnose-only six-phase language beyond what debug already says.
- **Emergency workflow pushback seeming slow**: assert fastest targeted evidence path, not endless analysis.
- **False platform escalation**: pin primary-source order from case study #2.
- **Runtime-test scope creep**: keep this to skill/eval artifacts because there is no repo-owned debug script for this task.
- **Helper duplication**: update the existing scout task rather than extracting the helper inside this PR.

## Acceptance criteria

- `src/skills/debug-contract.test.ts` exists and reads real skill/eval files.
- The spec pins frontmatter, Iron Law, all four phases, literal-error field requirements, external-theory override, observability, data-flow/source-fix discipline, pattern analysis, hypothesis testing, failing-test gate, one-change rule, cleanup, 3-fix escalation, red flags, rationalizations, test-failure strategy, constraints, case studies, and related skills.
- Evals 1-9 are preserved and asserted.
- Evals 10-11 are added with concrete pressure expectations.
- Red phase fails on missing evals 10-11 and green phase passes after adding them.
- `npx vitest run src/skills/debug-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from twenty-three to twenty-four.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair; this adds deterministic drift detection for a debugging workflow skill that agents rely on to avoid symptom fixes and speculative patches.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them.
- **Competitor prior art**: `docs/competition.md` tracks Vercel skills CLI / agent-skills as the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing behavior.
