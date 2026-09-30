# Plan: Cover handoff skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for handoff so regressions in its continuation-artifact workflow fail before agents lose resume-critical context, paste huge duplicate artifacts, write handoffs into the repository by default, skip the mktemp/read-before-write discipline, omit blockers or verification state, or ignore the user's requested next-session focus.

The contract spec will read the real `skill-plugins/dev/handoff/SKILL.md` and `skill-plugins/dev/handoff/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for transcript-dump/repo-artifact overreach plus focus/blocker/verification preservation.

## Why

handoff is invoked at the riskiest point in a long session: context is low and a fresh agent must continue without replaying the entire conversation. The skill's safety depends on compacting only durable continuation state, storing it in a temp markdown file, referencing existing artifacts instead of duplicating them, preserving PR/task/branch/verification/blocker state, and tailoring next steps to the user's stated focus. If the skill drifts, the next agent can waste time re-reading, miss blockers, repeat failed commands, commit unwanted repository docs, or lose the exact next action.

## Behaviors for red/green implementation

1. handoff contract tests load the real skill docs/evals and pin the durable continuation-artifact workflow.
2. Existing evals 1-6 stay present with their prompts/core expectations.
3. New eval 7 catches transcript-dump/repo-artifact overreach pressure.
4. New eval 8 catches focus/blocker/verification-loss pressure.
5. TASKS.md bookkeeping removes the completed task and advances shared scout counters/examples.

Interface: a Vitest contract spec at `src/skills/handoff-contract.test.ts` plus eval metadata additions in `skill-plugins/dev/handoff/evals/evals.json`.

## Scope (in)

- Add `src/skills/handoff-contract.test.ts` using the established #2134 local helper pattern.
- Read the real `skill-plugins/dev/handoff/SKILL.md` and `skill-plugins/dev/handoff/evals/evals.json`.
- Pin frontmatter:
  - `name: handoff`;
  - compact current conversation into a handoff document;
  - fresh agent session can continue without losing context;
  - use at end of long session or before context limit;
  - argument hint: `[what the next session will focus on]`.
- Pin core workflow:
  - write a handoff document summarising the current conversation;
  - save it to a path produced by `mktemp -t handoff-XXXXXX.md`;
  - read the file first with the Read tool before writing.
- Pin reference-not-duplicate discipline:
  - do not duplicate content already in other artifacts;
  - committed code is referenced by file path and commit SHA;
  - open PRs/issues by URL or number;
  - TASKS.md entries by task ID;
  - ADRs/specs by path.
- Pin required handoff sections:
  - What was accomplished, 1-3 bullets, artifact paths/SHAs;
  - Current state: working, broken, in-flight;
  - Next steps: ordered, specific, actionable;
  - Gotchas: non-obvious session traps;
  - Suggested skills for the next session, if any.
- Pin user focus tailoring:
  - if the user passed an argument, treat it as the next-session focus;
  - tailor the Next steps section accordingly.
- Pin existing evals 1-6 with exact prompts/core expectations.
- Add eval 7 for transcript-dump/repo-artifact overreach pressure: user asks to paste the whole transcript, PR body, and TASKS.md into a repo file. Expected answer creates a temp handoff file, reads before writing, references existing artifacts instead of duplicating them, keeps accomplishments concise, and does not write into the repo unless explicitly requested as a repo artifact.
- Add eval 8 for focus/blocker/verification-loss pressure: user asks for a quick handoff and says the next agent will continue a specific PR or release. Expected answer preserves branch/PR/task IDs, current working tree, verification commands and outcomes, blockers, exact next actions, gotchas, and tailors next steps to that focus.
- Remove the completed task from TASKS.md at ship time and update scout tasks from thirty-seven to thirty-eight specs with a handoff pressure example.

## Scope (out)

- No SKILL.md prose changes unless the spec exposes a contradiction that must be fixed.
- No executable script tests; `skill-plugins/dev/handoff/` contains only `SKILL.md` and `evals/evals.json`.
- No actual handoff-file creation in the test suite; the spec validates skill docs/eval artifacts only.
- No repository handoff document creation.
- No changes to conversation summarization tooling outside the handoff skill artifacts.
- No shared helper extraction; the existing P2 scout task remains the tracking item.
- No new dependencies.

## Concrete eval additions

### Eval 7 — transcript-dump/repo-artifact pressure

```json
{
  "id": 7,
  "prompt": "Make the handoff exhaustive: paste the full transcript, entire PR body, and all of TASKS.md into docs/HANDOFF.md so nothing is lost.",
  "expected_output": "A handoff response that saves a temp markdown file via mktemp/read-before-write, references existing artifacts instead of duplicating them, keeps accomplished work concise, and refuses repo-file output unless the user explicitly requested a repository artifact.",
  "expectations": [
    "Does not paste the full transcript, full PR body, or full TASKS.md into the handoff",
    "Uses a mktemp-style markdown path and reads it before writing",
    "References existing artifacts by path, commit SHA, PR URL/number, task ID, or spec path",
    "Keeps What was accomplished to 1-3 bullets instead of an exhaustive changelog",
    "Does not write the handoff into the repository unless the user explicitly requests a repo artifact"
  ]
}
```

### Eval 8 — focus/blocker/verification-loss pressure

```json
{
  "id": 8,
  "prompt": "Write a quick handoff. The next session should focus on getting PR #42 green; don't worry about listing every command or blocker.",
  "expected_output": "A focused continuation artifact that preserves PR/task/branch identifiers, working-tree state, verification commands and outcomes, blockers, gotchas, and ordered next steps tailored to getting PR #42 green.",
  "expectations": [
    "Treats the user's PR #42 instruction as the next-session focus",
    "Records branch, PR or issue identifiers, TASKS.md task IDs, and in-flight state when available",
    "Includes verification commands already run and their pass/fail outcomes instead of omitting command history",
    "Calls out blockers and gotchas even when the user asks for a quick handoff",
    "Orders next steps so the next agent can resume PR-green work without replaying the transcript"
  ]
}
```

## Deterministic assertion map

### SKILL.md contract

Pin with explicit `requireTerms(skillText, [...])` assertions:

- **Frontmatter**: name, compact current conversation, handoff document, fresh agent continuation, no lost context, long-session/context-limit triggers, argument hint.
- **Workflow**: write a handoff document summarising the current conversation, save with `mktemp -t handoff-XXXXXX.md`, read before writing.
- **Reference discipline**: no duplicate content already in artifacts; committed code path + SHA; PR/issues URL or number; TASKS.md task ID; ADR/spec path.
- **Required sections**: accomplished work 1-3 bullets with artifacts by path/SHA, current state working/broken/in-flight, ordered specific actionable next steps, gotchas, suggested skills.
- **Focus handling**: user argument becomes next-session focus and tailors Next steps.

### Eval preservation and metadata

Pin with explicit `evalById(N)` and `requireTerms(expectationText(evalById(N)), [...])` assertions:

- `evals.skill_name === "handoff"`, length 8 after implementation, unique IDs, non-empty prompt/expected output, and at least four expectations/assertions for every eval.
- **Eval 1**: release-focused handoff; expectations for mktemp/read-before-write, artifact references instead of duplicates, state/next steps/gotchas, focus tailoring.
- **Eval 2**: long session compacting; expectations for PR/issues, task IDs, commit SHAs, avoiding duplicates, gotchas.
- **Eval 3**: conflicted PR update; expectations for branch/PR/issue IDs, conflicted/modified files without full diffs, verification commands/outcomes, hook/blocker gotchas.
- **Eval 4**: release dashboard focus; expectations for mktemp/read-before-write, focus-tailored next steps, required sections, artifact references, no artifact duplication.
- **Eval 5**: context almost full; expectations for durable context, working tree/verification/PR/blocker state, ordered next steps, gotchas, temp markdown path reporting.
- **Eval 6**: no full PR body/TASKS paste; expectations for explicit no-duplication recognition, references over copied text, concise accomplishments, current state, no repo write unless explicitly requested.
- **Eval 7**: transcript-dump/repo-artifact pressure and all five listed expectations.
- **Eval 8**: focus/blocker/verification-loss pressure and all five listed expectations.

## Falsifiability checks

Each falsifiability check maps to a concrete assertion family:

- Red phase fails against the original 6-eval file because `expect(evals.evals).toHaveLength(8)` and `evalById(7/8)` fail.
- Removing mktemp or read-before-write fails SKILL workflow assertions plus evals 1, 4, and 7.
- Removing reference-not-duplicate discipline fails SKILL reference assertions plus evals 1, 2, 4, 6, and 7.
- Removing required sections fails SKILL section assertions plus evals 1, 4, and 5.
- Removing focus tailoring fails SKILL focus assertions plus evals 1, 4, and 8.
- Removing branch/PR/task/verification/blocker/gotcha preservation fails evals 2, 3, 5, and 8.
- Removing no-repo-output-by-default discipline fails evals 6 and 7.
- Weakening accomplishments from 1-3 concise bullets to exhaustive changelog fails SKILL section assertions plus eval 7.

## Scout task updates

Update these existing scout tasks using their current sentence style:

- `extract-shared-2134-skill-contract-test-helpers`: change `The first thirty-seven deterministic #2134-style skill contract specs` to `The first thirty-eight deterministic #2134-style skill contract specs` and append `handoff` after `grind-report` in the parenthesized skill list.
- `document-2134-pressure-eval-conventions`: in the long `Details` sentence, insert this example before `and metadata completeness`: `handoff continuation pressure (for example, handoff refusing full-transcript/PR-body/TASKS.md dumps, writing to a temp markdown path via mktemp/read-before-write, referencing artifacts by path/SHA/PR/task/spec instead of duplicating them, keeping accomplishments to 1-3 bullets, preserving branch/PR/task/working-tree/verification/blocker/gotcha state, tailoring next steps to the user's requested focus, and not writing repo handoff files unless explicitly requested)`.

## Implementation steps

1. Add deterministic spec at `src/skills/handoff-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/handoff-contract.test.ts --reporter=verbose`; expect failure on missing evals 7-8 while SKILL.md assertions pass.
3. Add evals 7-8 to `skill-plugins/dev/handoff/evals/evals.json`.
4. Update TASKS.md bookkeeping only: remove the completed task block and update the two scout task blocks by ID (`extract-shared-2134-skill-contract-test-helpers` and `document-2134-pressure-eval-conventions`).
5. Run focused spec, CLI removed-command guard if docs changed under `docs/`, `npm run skills:coverage`, and full `npm run verify`.
6. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **Over-locking terse prose**: pin durable continuation requirements and representative anchors, not every incidental sentence.
- **False task-ID refs in plan docs**: avoid backticked standalone skill names near TASKS.md prose when the docs task-ref linter could treat them as task IDs.
- **Huge handoff artifacts**: pin reference-not-duplicate and 1-3 accomplishment bullets.
- **Wrong output location**: pin mktemp/read-before-write and no repo file unless explicitly requested.
- **Lost handoff usefulness**: pin branch/PR/task/verification/blocker/gotcha state and ordered next steps.
- **Helper duplication**: update the existing scout task instead of extracting helpers here.

## Acceptance criteria

- `src/skills/handoff-contract.test.ts` exists and reads real skill/eval files.
- The spec pins frontmatter, mktemp/read-before-write workflow, reference-not-duplicate discipline, required sections, and user-focus tailoring.
- Evals 1-6 are preserved and asserted.
- Evals 7-8 are added with concrete transcript-dump/repo-artifact and focus/blocker/verification-loss pressure expectations.
- Red phase fails on missing evals 7-8 and green phase passes after adding them.
- `npx vitest run src/skills/handoff-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from thirty-seven to thirty-eight.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair. This task aligns because the spec pins durable handoff invariants so regressions in `SKILL.md` or `evals.json` fail before agents rely on a corrupted continuation workflow.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them; this task adds validation for the handoff skill artifact itself.
- **Competitor prior art**: `docs/competition/vercel-skills-cli-vs-agentbrew.md` documents the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing behavior.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: code-reviewer
- **Date**: 2026-06-11
- **Concerns**:
  - None — plan review confirmed all required sections and safety-critical handoff concerns are covered, including mktemp/read-before-write, reference-not-duplicate discipline, required continuation sections, focus tailoring, no repo handoff output unless explicitly requested, and eval pressure coverage.
