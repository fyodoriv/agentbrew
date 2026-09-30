# Plan: Cover diagnose skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for `diagnose` so regressions in its feedback-loop-first debugging discipline fail before agents hypothesize, instrument, or fix hard bugs without a deterministic or higher-rate reproduction loop.

The contract spec will read the real `skill-plugins/dev/diagnose/SKILL.md` and `skill-plugins/dev/diagnose/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for two dangerous shortcuts: inventing a cause when no loop/artifact exists, and writing a shallow regression that does not exercise the real bug seam.

## Why

`diagnose` is for hard bugs where ordinary `/debug` root-cause phases are not enough: intermittent failures, concurrency bugs, production-only failures, and cases where no reliable reproduction exists. The skill's safety-critical invariant is: **build a fast, sharp, deterministic or higher-rate agent-runnable pass/fail loop before forming hypotheses**. If future edits weaken that invariant, agents can waste time with guesswork, broad logging, false regressions, and unverified fixes.

## Scope (in)

- Add `src/skills/diagnose-contract.test.ts` using the established #2134 local helper pattern.
- Read the real `skill-plugins/dev/diagnose/SKILL.md` and `skill-plugins/dev/diagnose/evals/evals.json`.
- Pin frontmatter:
  - `name: diagnose`;
  - six-phase debugging discipline;
  - deterministic feedback loop before hypothesis;
  - hard bugs where `/debug` is not enough;
  - intermittent failures, concurrency bugs, and cases where the agent cannot reproduce yet.
- Pin role/purpose text: “A discipline for hard bugs” and “Skip phases only when explicitly justified.”
- Pin Phase 1 loop-first law:
  - “This is the skill”;
  - fast, deterministic, agent-runnable pass/fail signal;
  - spend disproportionate effort; be aggressive/creative/refuse to give up;
  - “Build the right feedback loop, and the bug is 90% fixed.”
- Pin all ten loop-construction strategies:
  1. failing test;
  2. curl/HTTP script;
  3. CLI invocation with fixture and known-good snapshot;
  4. headless browser script asserting DOM/console/network;
  5. captured trace replay;
  6. throwaway harness;
  7. property/fuzz loop;
  8. bisection harness / `git bisect run`;
  9. differential loop old-version vs new-version/config;
  10. HITL bash script as last resort.
- Pin loop iteration criteria:
  - faster via cache/narrowing;
  - sharper via specific symptom assertion;
  - more deterministic via pinned time/seed/filesystem/frozen network;
  - 30-second flaky loop barely better than no loop; 2-second deterministic loop is a superpower.
- Pin non-deterministic bug handling:
  - goal is higher reproduction rate, not perfect repro;
  - loop trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps;
  - 50%-flake is debuggable; 1% is not.
- Pin no-loop boundary:
  - stop and say so explicitly;
  - list what was tried;
  - ask for environment access, captured artifact (HAR/log/core dump/screen recording), or permission for temporary production instrumentation;
  - do not hypothesize without a loop.
- Pin Phase 2 reproduction:
  - run loop;
  - failure matches user-described symptom, not nearby failure;
  - reproducible across multiple runs or at a debuggable rate;
  - exact symptom captured (error/wrong output/slow timing).
- Pin Phase 3 hypothesis discipline:
  - generate 3–5 ranked hypotheses before testing any;
  - each hypothesis is falsifiable with predictions about changing Y/Z;
  - show ranked list to user before testing but do not block if AFK.
- Pin Phase 4 instrumentation discipline:
  - each probe maps to a Phase 3 prediction;
  - change one variable at a time;
  - debugger/REPL preferred if available;
  - targeted boundary logs;
  - never log everything and grep;
  - debug logs use unique prefixes like `[DEBUG-a4f2]`;
  - performance branch requires baseline timing harness and “measure first, fix second.”
- Pin Phase 5 fix/regression discipline:
  - write regression before fix only when a correct seam exists;
  - correct seam exercises the real bug pattern at the call site, not shallow approximation;
  - if no correct seam exists, document that as a finding and consider `/arch` after the fix;
  - minimized repro becomes failing test, fails, fix applies, test passes, original Phase 1 loop reruns.
- Pin Phase 6 cleanup/post-mortem:
  - original repro no longer reproduces;
  - regression passes or no-seam absence is documented;
  - all `[DEBUG-...]` instrumentation removed;
  - throwaway prototypes deleted;
  - correct hypothesis stated in commit/PR message.
- Pin existing evals 1-9 with exact prompts/core expectations.
- Add eval 10 for no-loop shortcut pressure: user asks to inspect code and guess/fix anyway; expected answer refuses hypothesis/fix without a loop or captured artifact, lists attempted loop strategies, and requests artifacts/access/instrumentation permission.
- Add eval 11 for shallow-regression pressure: user offers a unit test seam that does not exercise the real call-site bug; expected answer refuses fake confidence, distinguishes correct seam from shallow approximation, documents no-seam finding if needed, and still reruns original Phase 1 loop after fix.
- Remove the completed task from TASKS.md at ship time and update scout tasks from twenty-six to twenty-seven specs with a diagnose pressure example.

## Scope (out)

- No SKILL.md prose changes unless the spec exposes a contradiction that must be fixed.
- No runtime debugging tools or browser/test harness implementation; this is contract coverage over skill artifacts.
- No script-level tests; `skill-plugins/dev/diagnose/` contains only `SKILL.md` and `evals/evals.json`.
- No changes to `debug` skill coverage; `diagnose` is a deeper workflow for hard/no-repro bugs.
- No new dependencies.
- No shared helper extraction; the existing P2 scout task remains the tracking item.

## Concrete eval additions

### Eval 10 — no-loop shortcut pressure

```json
{
  "id": 10,
  "prompt": "I cannot reproduce the bug and have no logs yet, but please inspect the code and tell me the most likely cause so we can patch it quickly.",
  "expected_output": "A diagnose response that refuses to hypothesize or patch without a feedback loop or captured artifact, lists attempted loop strategies, and asks for the missing reproducing evidence or instrumentation permission.",
  "expectations": [
    "Does not rank hypotheses or propose fixes before a usable feedback loop or captured artifact exists",
    "Lists loop-building strategies to try first, such as failing test, HTTP/CLI/browser loop, trace replay, throwaway harness, fuzz/property loop, bisection, or differential loop",
    "If those loop strategies are blocked, explicitly says the agent cannot build a loop yet and lists what was tried",
    "Requests concrete unblocking evidence: environment access, HAR/log/core dump/screen recording, or permission for temporary production instrumentation",
    "Frames any temporary instrumentation as diagnostic and subject to Phase 6 cleanup"
  ]
}
```

### Eval 11 — shallow-regression seam pressure

```json
{
  "id": 11,
  "prompt": "I made a tiny unit test for a helper that kind of resembles the failing checkout path. Can we use that as the regression and ship the fix?",
  "expected_output": "A diagnose response that refuses a shallow approximation as proof, requires a correct seam that exercises the real bug pattern at the call site, and documents architecture/no-seam findings when no correct seam exists.",
  "expectations": [
    "Checks whether the proposed test seam exercises the real bug pattern as it occurs at the call site",
    "Rejects a shallow helper-only approximation as insufficient regression proof when it does not cover the actual failure path",
    "If a correct seam exists, turns the minimized repro into a failing test, watches it fail, applies the fix, watches it pass, and reruns the original Phase 1 loop",
    "If no correct seam exists, documents that absence as a finding instead of pretending the shallow test proves the fix",
    "Considers handing off to `/arch` after the fix when architecture prevents locking the bug down"
  ]
}
```

## Deterministic assertion map

### SKILL.md contract

Pin:

- Frontmatter name/description, hard-bug trigger scope, and `/debug` boundary.
- Phase 1 loop-first invariant and all ten loop-construction strategies.
- Loop-quality improvement criteria and nondeterministic reproduction-rate guidance.
- No-loop stop condition and artifact/access/instrumentation requests.
- Phase 2 reproduction checklist.
- Phase 3 3–5 ranked falsifiable hypotheses and user-domain re-ranking step.
- Phase 4 prediction-mapped probes, one variable at a time, targeted logs, unique debug prefixes, and performance baseline branch.
- Phase 5 correct-seam regression rule, no-seam finding, `/arch` handoff, red/green sequence, original-loop rerun.
- Phase 6 cleanup/post-mortem checklist and commit/PR hypothesis requirement.

### Eval preservation and metadata

Pin:

- `evals.skill_name === "diagnose"`.
- length 11 after implementation and unique IDs.
- evals 1-9 exact prompts/core expectations.
- eval 10 no-loop shortcut pressure.
- eval 11 shallow-regression seam pressure.
- every eval has non-empty prompt/expected output and at least four expectations/assertions.

## Falsifiability checks

- Red phase fails against the original 9-eval file because evals 10-11 are missing.
- Removing feedback-loop-before-hypothesis frontmatter fails the spec.
- Removing any loop-construction strategy fails the spec.
- Removing fast/sharp/deterministic loop iteration criteria fails the spec.
- Removing non-deterministic reproduction-rate guidance fails the spec.
- Removing the no-loop stop condition or artifact/access/instrumentation asks fails the spec.
- Allowing hypotheses or fixes without a loop/artifact fails the pressure eval spec.
- Removing Phase 2 user-symptom match and exact symptom capture fails the spec.
- Removing 3–5 ranked falsifiable hypotheses or user-domain re-ranking fails the spec.
- Removing one-variable instrumentation, targeted-log rule, unique debug prefix cleanup, or performance baseline branch fails the spec.
- Removing correct-seam requirements or accepting shallow regression approximations fails the spec.
- Removing original-loop rerun, debug instrumentation cleanup, prototype cleanup, or commit/PR final hypothesis fails the spec.

## Scout task updates

- `extract-shared-2134-skill-contract-test-helpers`: update from twenty-six to twenty-seven deterministic specs and add `diagnose` after `detect-task-backend`.
- `document-2134-pressure-eval-conventions`: add diagnose pressure examples covering no-loop shortcut refusal, loop-construction exhaustion, artifact/access/instrumentation requests, shallow-regression seam refusal, no-correct-seam findings, `/arch` handoff, and original-loop rerun after fix.

## Implementation steps

1. Add deterministic spec at `src/skills/diagnose-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/diagnose-contract.test.ts --reporter=verbose`; expect failure on missing evals 10-11 while SKILL.md assertions pass.
3. Add evals 10-11 to `skill-plugins/dev/diagnose/evals/evals.json`.
4. Update TASKS bookkeeping: remove completed task and update the two scout tasks.
5. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
6. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **Overlap with `debug`**: Pin the `/debug` boundary in frontmatter and focus on hard/no-repro/intermittent bugs where feedback-loop construction is the main work.
- **Over-locking examples**: Pin durable loop methods and phase invariants; avoid asserting incidental prose beyond contract-critical lines.
- **False confidence from shallow tests**: Add explicit pressure eval for correct seam vs approximation.
- **Temporary-instrumentation risk**: Pin permission requirement for production instrumentation and Phase 6 cleanup.
- **Helper duplication**: update the existing scout task instead of extracting helpers here.

## Acceptance criteria

- `src/skills/diagnose-contract.test.ts` exists and reads real skill/eval files.
- The spec pins frontmatter, hard-bug scope, all six phases, loop-construction methods, nondeterministic guidance, no-loop boundary, reproduction, hypotheses, instrumentation, correct-seam regression, cleanup, and commit/PR hypothesis requirements.
- Evals 1-9 are preserved and asserted.
- Evals 10-11 are added with concrete pressure expectations.
- Red phase fails on missing evals 10-11 and green phase passes after adding them.
- `npx vitest run src/skills/diagnose-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from twenty-six to twenty-seven.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair; this adds deterministic drift detection for a hard-debugging skill artifact.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them.
- **Competitor prior art**: `docs/competition.md` tracks Vercel skills CLI / agent-skills as the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing behavior.
