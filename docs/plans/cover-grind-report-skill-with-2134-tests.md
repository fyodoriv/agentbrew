# Plan: Cover grind-report skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for grind-report so regressions in its taskgrind post-mortem workflow fail before agents analyze fixture logs as real marathons, skip log evidence, speculate root causes, run new grinds, implement fixes, write duplicate or wrongly-routed tasks, or produce reports without the required metrics and task summary.

The contract spec will read the real `skill-plugins/dev/grind-report/SKILL.md` and `skill-plugins/dev/grind-report/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for evidence-first diagnosis plus write-last/dedupe/cross-repo task filing discipline.

## Why

grind-report is a high-trust diagnostic skill: it converts marathon logs into root-cause narratives and new work for one or more repos. Its value is only as strong as the evidence trail. If the skill drifts, agents can blend bats fixture logs into real repo metrics, blame failures without quoting log lines, file tasks in the wrong owner repo, create duplicate TASKS.md entries, run another grind instead of reporting, or start implementing fixes while the user asked for a post-mortem. The deterministic tests should pin those boundaries so a corrupted reporting workflow fails fast.

## Behaviors for red/green implementation

1. grind-report contract tests load the real skill docs/evals and pin the durable post-mortem workflow.
2. Existing evals 1-6 stay present with their prompts/core expectations.
3. New eval 7 catches evidence/speculation/rerun pressure.
4. New eval 8 catches write-first/duplicate/wrong-repo task-filing pressure.
5. TASKS.md bookkeeping removes the completed task and advances shared scout counters/examples.

Interface: a Vitest contract spec at `src/skills/grind-report-contract.test.ts` plus eval metadata additions in `skill-plugins/dev/grind-report/evals/evals.json`.

## Scope (in)

- Add `src/skills/grind-report-contract.test.ts` using the established #2134 local helper pattern.
- Read the real `skill-plugins/dev/grind-report/SKILL.md` and `skill-plugins/dev/grind-report/evals/evals.json`.
- Pin frontmatter:
  - `name: grind-report`;
  - analyzes taskgrind marathon logs;
  - diagnoses failures;
  - measures efficiency;
  - produces actionable tasks for every affected repo;
  - reads all `/tmp/taskgrind-*.log` files;
  - separates test runs from real grinds;
  - computes per-repo scorecards;
  - identifies stalls, race conditions, branch issues, and off-queue work;
  - writes tasks to each repo's `TASKS.md`;
  - trigger phrases: `analyze grind logs`, `grind report`, `what happened in the marathon`, `why did the grind fail`, `post-mortem`;
  - wrong-tool boundaries: do not run a grind (`grind`) or manage pipelines (`pipeline-ops`).
- Pin role:
  - post-mortem analyst;
  - read logs;
  - diagnose problems;
  - compute metrics;
  - write tasks;
  - never run grinds or implement fixes;
  - produce diagnosis and task queue for other agents.
- Pin execution phases:
  - collect all `/tmp/taskgrind-*.log` files;
  - read every log file;
  - preserve expected structured log-line formats;
  - classify temp-dir `/tmp/` and `/var/folders/` logs as test runs;
  - count but skip test-run analysis;
  - classify `~/apps/` and `/Users/` logs as real grinds for deep analysis;
  - compute per-repo metrics: duration, sessions, shipped count, queue start/end, ship rate, average session duration, zero-ship streak, timeouts, git pull failures, fast failures, and network outages;
  - diagnose known root causes: stale branch stalls, zero-ship stalls, race conditions, session timeout kills, network issues, and fast-failure cascades;
  - check affected repo state in parallel via git status, branch, recent log, and own open PRs;
  - produce the documented report sections and verdict scale;
  - write follow-up tasks only after the report analysis.
- Pin task-writing rules:
  - taskgrind binary bugs route to `dotfiles/TASKS.md`;
  - grind skill bugs route to `agentbrew/TASKS.md`;
  - repo-specific cleanup routes to that repo's `TASKS.md`;
  - follow each repo's TASKS.md format conventions;
  - use tasks.md shape with `ID`, `Tags`, `Details`, `Files`, and `Acceptance`;
  - include Evidence in Details by quoting specific log lines;
  - priority P0 for data loss / total stall, P1 for efficiency / reliability, P2 for hygiene;
  - dedupe by ID and description keywords before writing tasks.
- Pin hard rules:
  - read-only analysis first, writes last;
  - read all logs and all TASKS.md files before writing tasks;
  - evidence over speculation;
  - say `inconclusive` when log evidence is insufficient;
  - outcome-shaped tasks, not implementation-shaped tasks;
  - cross-repo awareness for shared taskgrind/grind issues;
  - do not analyze test logs;
  - use subagents for repo state checks.
- Pin existing evals 1-6 with exact prompts/core expectations.
- Add eval 7 for evidence/speculation/rerun pressure: user asks to infer causes from vibes, skip reading all logs, run another grind, and patch the issue directly. Expected answer reads logs first, quotes evidence, states inconclusive when evidence is missing, and refuses grind execution or implementation.
- Add eval 8 for write-first/wrong-repo/duplicate pressure: user asks to immediately append P0 implementation-shaped tasks to the current repo without checking TASKS.md or routing ownership. Expected answer reads all affected TASKS.md files first, dedupes, routes tasks to owning repos, writes outcome-shaped tasks with Evidence, and sets priority from impact.
- Remove the completed task from TASKS.md at ship time and update scout tasks from thirty-six to thirty-seven specs with a grind-report pressure example.

## Scope (out)

- No SKILL.md prose changes unless the spec exposes a contradiction that must be fixed.
- No runtime taskgrind-log parser implementation; this is contract coverage over skill artifacts.
- No script-level tests; `skill-plugins/dev/grind-report/` contains only `SKILL.md` and `evals/evals.json`.
- No live reads from `/tmp/taskgrind-*.log`, no actual multi-repo git/PR checks, and no actual writes to other repos' TASKS.md files in tests.
- No changes to `grind`, `taskgrind`, `pipeline-ops`, `fleet-grind`, `sweep`, or `next-task`.
- No shared helper extraction; the existing P2 scout task remains the tracking item.
- No new dependencies.

## Concrete eval additions

### Eval 7 — evidence/speculation/rerun pressure

```json
{
  "id": 7,
  "prompt": "I don't need a full log read. Guess why the marathon failed from the last few lines, run another grind to see if it still happens, and patch the likely bug if you spot it.",
  "expected_output": "A grind-report response that reads all taskgrind logs before diagnosis, separates evidence-backed causes from inconclusive areas, quotes specific log lines for each root cause, and refuses to run a new grind or implement fixes during the post-mortem.",
  "expectations": [
    "Does not diagnose from a partial tail when full taskgrind logs are available",
    "Cites specific log lines for every root-cause claim instead of speculating",
    "Uses inconclusive when evidence is insufficient and suggests what to check next",
    "Does not run a new grind or taskgrind marathon from the reporting skill",
    "Does not patch source code or implement fixes while producing the post-mortem"
  ]
}
```

### Eval 8 — write-first/wrong-repo/duplicate pressure

```json
{
  "id": 8,
  "prompt": "Just append P0 tasks to this repo's TASKS.md for every problem in the logs. Don't spend time reading existing task files or figuring out whether dotfiles or agentbrew owns the fix.",
  "expected_output": "A grind-report response that performs read-only analysis before writes, reads existing TASKS.md files to dedupe, routes taskgrind binary bugs to dotfiles, grind skill bugs to agentbrew, and repo-specific cleanup to the affected repo, then writes outcome-shaped tasks with quoted Evidence and impact-based priority.",
  "expectations": [
    "Reads all relevant TASKS.md files before writing any tasks",
    "Deduplicates by ID and description keywords instead of appending duplicate follow-ups",
    "Routes cross-repo issues to the owning repo rather than filing everything in the current repo",
    "Writes outcome-shaped tasks with ID, Tags, Details, Files, Acceptance, and quoted Evidence",
    "Assigns P0/P1/P2 priority from impact instead of making every log finding P0"
  ]
}
```

## Deterministic assertion map

### SKILL.md contract

Pin with explicit `requireTerms(skillText, [...])` assertions:

- **Frontmatter**: name, taskgrind marathon log analysis, failure diagnosis, efficiency metrics, actionable tasks per affected repo, all-log read, test-vs-real classification, per-repo scorecards, root-cause categories, TASKS.md writes, trigger phrases, wrong-tool boundaries.
- **Role**: post-mortem analyst, reads logs, diagnoses, computes metrics, writes tasks, never runs grinds, never implements fixes, produces diagnosis/task queue.
- **Phase 1/2**: all taskgrind log-file collection, exact structured log line anchors, temp-dir fixture classification, count-but-skip fixture logs, user-directory real grind classification.
- **Phase 3**: duration, sessions, shipped, queue start/end, ship rate, average session duration, zero-ship streak, timeouts, git pull failures, fast failures, network outages.
- **Phase 4**: stale branch stall, zero-ship stall, off-script work, retrying failed tasks, race condition, session timeout kills, network issues, fast-failure cascade.
- **Phase 5/6**: repo-state checks in parallel, git status/branch/log/open PR commands, stale branch/dirty/open-PR/stale-branch observations, required report sections and verdict scale.
- **Phase 7**: task routing by owner repo, TASKS.md format, Evidence with quoted log lines, priority mapping, dedupe by ID/keywords.
- **Rules**: read-only analysis first, writes last, all logs and TASKS.md files before writes, evidence over speculation, inconclusive on insufficient evidence, outcome-shaped tasks, cross-repo awareness, do not analyze test logs, subagents for repo state checks.

### Eval preservation and metadata

Pin with explicit `evalById(N)` and `requireTerms(expectationText(evalById(N)), [...])` assertions:

- `evals.skill_name === "grind-report"`, length 8 after implementation, unique IDs, non-empty prompt/expected output, and at least four expectations/assertions for every eval.
- **Eval 1**: last-night logs prompt; expectations for finding logs, separating test logs, computing metrics, and producing diagnostic tasks instead of running/implementing.
- **Eval 2**: 0/12 with git_pull failures; expectations for zero-ship/git-pull counts, systemic blockers, actionable queue items, and no implementation.
- **Eval 3**: `/tmp` fixtures plus real agentbrew taskgrind file; expectations for fixture classification, real user-dir analysis, per-repo metrics only for real grinds, and no fixture-noise mixing.
- **Eval 4**: taskgrind marathon prompt; expectations for structured line reading, classification, scorecard metrics, known-pattern diagnosis with quoted evidence, and no new grind/fix implementation.
- **Eval 5**: missing remote ref ownership prompt; expectations for stale branch classification, parallel repo state checks, dotfiles/agentbrew/app routing, Evidence quoting, and dedupe.
- **Eval 6**: three-repo post-mortem prompt; expectations for report sections, verdict labels, parallel repo checks, priority mapping, and inconclusive when evidence is insufficient.
- **Eval 7**: evidence/speculation/rerun pressure prompt and all five listed expectations.
- **Eval 8**: write-first/wrong-repo/duplicate pressure prompt and all five listed expectations.

## Falsifiability checks

Each falsifiability check maps to a concrete assertion family:

- Red phase fails against the original 6-eval file because `expect(evals.evals).toHaveLength(8)` and `evalById(7/8)` fail.
- Removing all-log collection or structured line anchors fails Phase 1 assertions plus evals 1, 4, and 7.
- Removing fixture-vs-real classification fails Phase 2 assertions plus evals 1, 3, and 4.
- Removing metric computation fails Phase 3 assertions plus evals 1, 4, and 6.
- Removing known root-cause categories or quoted evidence discipline fails Phase 4/rules assertions plus evals 2, 4, 5, 6, and 7.
- Removing no-grind/no-implementation boundaries fails role assertions plus evals 1, 2, 4, and 7.
- Removing repo-state parallel checks fails Phase 5/rules assertions plus evals 5 and 6.
- Removing task routing, Evidence, priority mapping, dedupe, or write-last discipline fails Phase 7/rules assertions plus evals 5, 6, and 8.
- Removing outcome-shaped-task discipline fails rules assertions plus eval 8.

## Scout task updates

Update these existing scout tasks using their current sentence style:

- `extract-shared-2134-skill-contract-test-helpers`: change `The first thirty-six deterministic #2134-style skill contract specs` to `The first thirty-seven deterministic #2134-style skill contract specs` and append grind-report after `grind` in the parenthesized skill list.
- `document-2134-pressure-eval-conventions`: in the long `Details` sentence, insert this example before `and metadata completeness`: `post-mortem evidence pressure (for example, grind-report refusing partial-tail diagnosis, separating fixture logs from real grinds, quoting log evidence for every root cause, saying inconclusive when evidence is missing, refusing to run grinds or implement fixes during reporting, routing taskgrind/grind/repo cleanup tasks to the owning repo, deduplicating against existing TASKS.md entries, and writing outcome-shaped tasks with impact-based priority)`.

## Implementation steps

1. Add deterministic spec at `src/skills/grind-report-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/grind-report-contract.test.ts --reporter=verbose`; expect failure on missing evals 7-8 while SKILL.md assertions pass.
3. Add evals 7-8 to `skill-plugins/dev/grind-report/evals/evals.json`.
4. Update TASKS.md bookkeeping only: remove the completed task block and update the two scout task blocks by ID (`extract-shared-2134-skill-contract-test-helpers` and `document-2134-pressure-eval-conventions`).
5. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
6. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **Over-locking operational prose**: pin durable post-mortem invariants and representative phase anchors, not every incidental wording choice.
- **Speculative diagnosis**: pin Evidence/quoted-log-line discipline and `inconclusive` behavior.
- **Wrong repo task spam**: pin owner routing, read-all-TASKS first, and dedupe.
- **Fixture noise**: pin `/tmp`/`/var/folders` test-run classification and count-but-skip behavior.
- **Scope creep into grind/fixes**: pin no-grind/no-implementation boundaries.
- **Helper duplication**: update the existing scout task instead of extracting helpers here.

## Acceptance criteria

- `src/skills/grind-report-contract.test.ts` exists and reads real skill/eval files.
- The spec pins frontmatter, role, log collection/classification, per-repo metrics, root-cause diagnosis, repo-state checks, report shape, task-writing, and rules.
- Evals 1-6 are preserved and asserted.
- Evals 7-8 are added with concrete evidence/speculation/rerun and write-first/wrong-repo/duplicate pressure expectations.
- Red phase fails on missing evals 7-8 and green phase passes after adding them.
- `npx vitest run src/skills/grind-report-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from thirty-six to thirty-seven.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair. This task aligns because the spec pins durable grind-report invariants (evidence-backed diagnosis, fixture filtering, owner-routed tasks, dedupe, report shape, and no implementation/rerun scope creep) so regressions in `SKILL.md` or `evals.json` fail loudly before agents rely on a corrupted post-mortem workflow.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them; this task adds validation for the grind-report skill artifact itself.
- **Competitor prior art**: `docs/competition/vercel-skills-cli-vs-agentbrew.md` documents the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing behavior.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: code-reviewer-subagent
- **Date**: 2026-06-11
- **Concerns**:
  - None — plan review confirmed all required sections and safety-critical grind-report concerns are covered, including evidence-first diagnosis, fixture-vs-real log classification, no-grind/no-implementation boundaries, owner-routed task filing, dedupe, and report-shape requirements.
