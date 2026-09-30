# Plan: Cover git-diagnose-codebase skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for `git-diagnose-codebase` so regressions in its five-command git-history diagnostic fail before agents read source files too early, run noisy repo-root churn queries, overinterpret tiny histories, turn a history scan into code review or implementation, skip the churn×bug intersection, ignore bus-factor/commit-message/firefighting caveats, or claim final decisions from history signal alone.

The contract spec will read the real `skill-plugins/dev/git-diagnose-codebase/SKILL.md` and `skill-plugins/dev/git-diagnose-codebase/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for repo-root/source-reading shortcuts plus overconfident caveat-free conclusions.

## Why

`git-diagnose-codebase` is a high-leverage triage skill. Its value is not a code review; it is a fast, reproducible, five-minute map of risk before reading arbitrary files. The safety-critical boundaries are narrow: run git-history commands first, scope them to application directories, use top-churn ∩ bug-cluster intersection as the primary deliverable, and present caveated signal for downstream audit/sweep/strategic-review skills. If the skill drifts, agents can waste the reading budget on lockfiles and config churn, mislabel squash-merged repos as bus-factor crises, treat sparse histories as authoritative, or start fixing code from history alone.

## Scope (in)

- Add `src/skills/git-diagnose-codebase-contract.test.ts` using the established #2134 local helper pattern.
- Read the real `skill-plugins/dev/git-diagnose-codebase/SKILL.md` and `skill-plugins/dev/git-diagnose-codebase/evals/evals.json`.
- Pin frontmatter:
  - `name: git-diagnose-codebase`;
  - reads unfamiliar codebase git history in five minutes;
  - does not open files first;
  - runs five git-log/shortlog diagnostics: churn, bus factor, bug clusters, velocity, firefighting;
  - cross-references top churn with bug-keyword files to surface highest-risk files first;
  - use at start of audit, sweep, strategic review, or onboarding;
  - wrong-tool boundaries: code review goes to `review`, implementation/fixes go to `plan`, visual UX audit goes to `design-review`.
- Pin use cases:
  - onboarding to an unfamiliar repo;
  - Step 0 before `project-audit`, `sweep`, and `strategic-review`;
  - answering where the repo has the most pain.
- Pin non-use cases:
  - one PR review uses `review`;
  - known single-file work should just read that file;
  - flaky test/specific exception uses `debug`;
  - repos under 50 commits have too little signal and should be read directly.
- Pin background and core claim:
  - Ally Piechowski source article;
  - Microsoft Research churn-defect study;
  - Adam Tornhill reference;
  - top 5 churn ∩ top 20 bug clusters are highest-risk files.
- Pin Step 0 working-directory discipline:
  - run from `app/` or `src/`, never repo root;
  - repo-root runs are dominated by lockfile/changelog/config churn;
  - when everything is at root, scope queries with `-- 'src/'` or equivalent;
  - adjust default scope to repo shape such as `lib/`, `pkg/`, or `services/<name>/`.
- Pin the five commands in order:
  1. Churn — top 20 most-edited files in `src/` in the last year using `git log --format=format: --name-only --since="1 year ago" -- 'src/' | sort | uniq -c | sort -nr | head -20`.
  2. Bus factor — all-time and last-6-month contributors using `git shortlog --summary --numbered --no-merges HEAD` and `git shortlog --summary --numbered --no-merges --since="6 months ago" HEAD`.
  3. Bug clusters — files touched by `fix|bug|broken` commits using `git log -i -E --grep="fix|bug|broken" --name-only --format='' --since="1 year ago" -- 'src/' | sort | uniq -c | sort -nr | head -20`.
  4. Velocity — commits per month over the last 24 months using `git log --format='%ad' --date=format:'%Y-%m' --since="2 years ago" | sort | uniq -c`.
  5. Firefighting — recent `revert|hotfix|emergency|rollback` commits using `git log --oneline --since="1 year ago" | grep -iE 'revert|hotfix|emergency|rollback'`.
- Pin command interpretations:
  - churn output is a frequency histogram;
  - files with more than 30 edits/year are hot spots;
  - top 5 churn feeds the cross-reference;
  - 1-2 person repo with recent gap signals owner-leaving risk;
  - bug-cluster regex may need team-specific adjustment;
  - velocity trend matters more than absolute count;
  - more than 12 firefighting hits/year means team is firefighting;
  - zero firefighting hits is ambiguous.
- Pin Step 6 cross-reference:
  - top-5 churn files and top-20 bug-cluster files;
  - `comm -12` intersection;
  - files on both lists are the highest-risk code in the repo;
  - output seeds `project-audit` Step 1, `sweep` Step 0.5, and `strategic-review` Phase 1.1.
- Pin caveats:
  - squash-merge compresses authorship and requires asking before bus-factor conclusions;
  - commit-message discipline determines bug-keyword recall, so sample 20 recent commit messages and compensate with diff grep when noisy;
  - zero firefighting hits is ambiguous and should be disambiguated with maintainer or incident-tracker context.
- Pin smoke-test/worked-example role:
  - applied to `~/apps/agentbrew`;
  - numbers are regression evidence that commands work;
  - caveats are applied in the written output;
  - cross-reference files are the first audit targets.
- Pin output discipline:
  - files in churn×bug clusters are read first;
  - high-churn/low-bug files are likely actively evolving and should have tests confirmed;
  - high-bug/low-churn files are stable-but-leaky and likely under-tested;
  - bus-factor risk and declining velocity/firefighting are flags, not files to read;
  - the skill produces signal, not final decisions.
- Pin see-also links:
  - `project-audit`, `sweep`, `strategic-review`, source article, Microsoft Research, and Tornhill.
- Pin existing evals 1-9 with exact prompts/core expectations.
- Add eval 10 for repo-root/source-reading pressure: user asks to open source files and run root-wide history including lockfiles/config; expected answer keeps to git history first, scopes to application dirs, avoids source-file reading, and routes later fixes/audit to downstream skills.
- Add eval 11 for overconfident caveat-free conclusion pressure: user asks to declare a bus-factor crisis and stable/no-firefighting verdict from raw history; expected answer applies squash-merge, commit-message, and zero-firefighting caveats and labels history as signal rather than final decision.
- Remove the completed task from TASKS.md at ship time and update scout tasks from thirty-two to thirty-three specs with a git-diagnose-codebase pressure example.

## Scope (out)

- No SKILL.md prose changes unless the spec exposes a contradiction that must be fixed.
- No runtime git-diagnostic implementation; this is contract coverage over skill artifacts.
- No script-level tests; `skill-plugins/dev/git-diagnose-codebase/` contains only `SKILL.md` and `evals/evals.json`.
- No live git-history commands in deterministic tests; tests assert skill artifacts, not repository metrics.
- No changes to `project-audit`, `sweep`, `strategic-review`, `review`, `debug`, `plan`, or `design-review` skills.
- No shared helper extraction; the existing P2 scout task remains the tracking item.
- No new dependencies.

## Concrete eval additions

### Eval 10 — repo-root/source-reading pressure

```json
{
  "id": 10,
  "prompt": "Before the audit, open the biggest files and run the churn command from repo root so lockfiles, generated files, docs, and config are included. Then tell me what to fix first.",
  "expected_output": "A git-diagnose-codebase response that keeps the first pass to git history, refuses to open source files before the diagnostic, scopes churn and bug-cluster queries to application directories instead of noisy repo-root artifacts, and hands the resulting risk map to project-audit/sweep/strategic-review rather than proposing fixes directly.",
  "expectations": [
    "Does not open or read source files before the five-command git-history diagnostic",
    "Does not run the churn and bug-cluster queries unscoped at repo root when lockfiles, generated files, docs, or config would dominate",
    "Uses `src/`, `app/`, `lib/`, `pkg/`, `services/<name>/`, or an equivalent scoped path for history queries",
    "Produces the churn × bug-cluster intersection as the risk map instead of arbitrary file sampling",
    "Routes actual fixing or deeper audit work to project-audit, sweep, or strategic-review rather than making fixes from history alone"
  ]
}
```

### Eval 11 — overconfident caveat-free conclusion pressure

```json
{
  "id": 11,
  "prompt": "The shortlog shows one author and the firefighting query has zero hits. Declare a bus-factor crisis and also say the repo is stable without asking anything else.",
  "expected_output": "A caveated git-diagnose-codebase response that refuses to draw final conclusions from raw shortlog or zero-firefighting output alone, checks squash-merge and project context before bus-factor claims, samples commit-message discipline before trusting bug-keyword recall, and treats zero firefighting hits as ambiguous until maintainer or incident-tracker context is checked.",
  "expectations": [
    "Does not declare a bus-factor crisis from shortlog alone without checking squash-merge behavior or project context",
    "Does not treat zero firefighting hits as proof of stability without considering poor commit messages or out-of-band incidents",
    "Samples recent commit messages or otherwise evaluates commit-message discipline before trusting bug-cluster and firefighting counts",
    "Asks or records a caveat when maintainer or incident-tracker context is needed",
    "Frames the diagnostic as signal for a downstream audit or review, not a final decision by itself"
  ]
}
```

## Deterministic assertion map

### SKILL.md contract

Pin with explicit `requireTerms(skillText, [...])` assertions:

- **Frontmatter**: name, five-minute git-history read, no file opening, five command families, churn×bug cross-reference, use surfaces, and wrong-tool boundaries.
- **Use / non-use**: onboarding, audit/sweep/strategic-review Step 0, pain question; one-PR review, known file, flaky test/specific exception, and <50 commits exclusions.
- **Background**: Piechowski article, Microsoft churn-defect study, Tornhill, top-5 churn ∩ top-20 bug-clusters claim.
- **Step 0 scope**: app/src working dir, never repo root, root-noise rationale, scoped `-- 'src/'` fallback, repo-shape adjustment.
- **Five commands**: headings and exact command fragments for churn, bus factor, bug clusters, velocity, and firefighting, plus order assertions.
- **Interpretation rules**: histogram, >30 edits hot spots, owner-leaving signal, regex adjustment, trend not absolute count, >12 firefighting/year, zero-firefighting ambiguity.
- **Step 6 deliverable**: top-5 churn, top-20 bug clusters, `comm -12`, both-list intersection as highest-risk code, downstream seeds.
- **Caveats**: squash-merge authorship, commit-message discipline and 20-message sample, zero-firefighting ambiguity and maintainer/incident-tracker disambiguation.
- **Smoke test / worked example**: applied agentbrew example, regression evidence, caveats applied, cross-reference first audit targets.
- **Output discipline**: read cross-reference files first, high-churn/low-bug and high-bug/low-churn interpretation, bus-factor and velocity/firefighting as flags, signal not decisions.
- **See also**: project-audit, sweep, strategic-review, source article, Microsoft Research, Tornhill.

### Eval preservation and metadata

Pin with explicit `evalById(N)` and `requireTerms(expectationText(evalById(N)), [...])` assertions:

- `evals.skill_name === "git-diagnose-codebase"`, length 11 after implementation, unique IDs, non-empty prompt/expected output, and at least four expectations/assertions for every eval.
- **Eval 1**: exact 3-year-old TypeScript repo/no-source prompt and expectations for five commands, app-dir scoping, churn×bug intersection, separated bus-factor/velocity/firefighting, and caveats.
- **Eval 2**: exact pain-before-project-audit prompt and expectations for churn/bug history, first audit targets, commit-message sampling, no code review/fixes, downstream feed.
- **Eval 3**: exact 18-commit prompt and expectations for <50 commit signal floor, direct read fallback, low-confidence labels, no authoritative conclusions, debug separation.
- **Eval 4**: exact onboarding-large-repo prompt and expectations for ordered commands, scoped history, top-5×top-20 deliverable, no architecture conclusions from history alone.
- **Eval 5**: exact 25-commit prompt and expectations for history size check, <50 outside useful range, no sparse overinterpretation, direct reading/project-audit pivot.
- **Eval 6**: exact bus-factor crisis prompt and expectations for squash-merge caveat, recent merge/project context, commit-message/zero-firefighting caveats, signal not final decision.
- **Eval 7**: exact Node.js repo prompt and expectations for all five commands, churn×bug deliverable, all three caveats, and no source reading.
- **Eval 8**: exact monorepo prompt and expectations for per-package scoped queries, independent package cross-references, labels, and package firefighting mode.
- **Eval 9**: exact hidden-risk/stability prompt and expectations for unbiased full diagnostic, contradictions, contributor gap, and stable vs ambiguous distinction.
- **Eval 10**: exact repo-root/source-reading prompt and all five listed expectations.
- **Eval 11**: exact overconfident caveat-free prompt and all five listed expectations.

## Falsifiability checks

Each falsifiability check maps to a concrete assertion family:

- Red phase fails against the original 9-eval file because `expect(evals.evals).toHaveLength(11)` and `evalById(10/11)` fail.
- Removing the no-source-reading / five-minute git-history premise fails frontmatter and eval 1/7/10 assertions.
- Removing app/src scoped-query discipline or allowing repo-root churn fails Step 0 and eval 1/4/8/10 assertions.
- Removing one of the five command families fails command-section assertions and eval 1/4/7/9 assertions.
- Removing churn×bug intersection as the primary deliverable fails Step 6 and eval 1/2/4/7/8/10 assertions.
- Removing <50-commit signal-floor handling fails non-use and eval 3/5 assertions.
- Removing squash-merge, commit-message, or zero-firefighting caveats fails caveat and eval 1/6/7/9/11 assertions.
- Removing wrong-tool boundaries for PR review, implementation, debugging, or visual UX audit fails frontmatter/non-use assertions.
- Turning history signal into final code/architecture decisions fails output-discipline and eval 2/4/6/10/11 assertions.

## Scout task updates

Update these existing scout tasks using their current sentence style:

- `extract-shared-2134-skill-contract-test-helpers`: change `The first thirty-two deterministic #2134-style skill contract specs` to `The first thirty-three deterministic #2134-style skill contract specs` and append `git-diagnose-codebase` after `fix-styles` in the parenthesized skill list.
- `document-2134-pressure-eval-conventions`: in the long `Details` sentence, insert this exact example before `and metadata completeness`: `git-history diagnostic pressure (for example, \`git-diagnose-codebase\` refusing to open source files before the five-command history pass, scoping churn and bug-cluster queries away from noisy repo-root lockfiles/config/docs, refusing to overinterpret repos with fewer than 50 commits, preserving churn×bug intersection as the primary deliverable, applying squash-merge/commit-message/zero-firefighting caveats before bus-factor or stability claims, routing code review/fixes/debugging/visual audit to the right skills, and framing history as signal rather than final decisions)`.

## Implementation steps

1. Add deterministic spec at `src/skills/git-diagnose-codebase-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/git-diagnose-codebase-contract.test.ts --reporter=verbose`; expect failure on missing evals 10-11 while SKILL.md assertions pass.
3. Add evals 10-11 to `skill-plugins/dev/git-diagnose-codebase/evals/evals.json`.
4. Update TASKS.md bookkeeping only: remove the completed task block and update the two scout task blocks by ID (`extract-shared-2134-skill-contract-test-helpers` and `document-2134-pressure-eval-conventions`).
5. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
6. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **Over-locking exact commands**: pin command families and critical flags/scopes, not incidental whitespace.
- **Normalizing repo-root noise**: pin Step 0 and eval 10 against root-wide lockfile/config/doc dominance.
- **Overconfident conclusions**: pin caveats and eval 11.
- **Skill overreach into code review/fixes**: pin wrong-tool boundaries and output discipline.
- **Tiny-history false positives**: pin <50 commit non-use cases and eval 3/5.
- **Helper duplication**: update the existing scout task instead of extracting helpers here.

## Acceptance criteria

- `src/skills/git-diagnose-codebase-contract.test.ts` exists and reads real skill/eval files.
- The spec pins frontmatter, use/non-use cases, background claim, Step 0 scoping, five-command workflow, command interpretation, Step 6 cross-reference deliverable, caveats, smoke-test role, output discipline, see-also links, and eval metadata.
- Evals 1-9 are preserved and asserted.
- Evals 10-11 are added with concrete pressure expectations.
- Red phase fails on missing evals 10-11 and green phase passes after adding them.
- `npx vitest run src/skills/git-diagnose-codebase-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from thirty-two to thirty-three.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair. This task aligns because the spec pins durable `git-diagnose-codebase` invariants (scoped five-command history pass, churn×bug cross-reference, caveats, and output boundaries) so regressions in `SKILL.md` or `evals.json` fail loudly before agents rely on a corrupted diagnostic.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them; this task adds validation for the git-diagnose-codebase skill artifact itself.
- **Competitor prior art**: `docs/competition/vercel-skills-cli-vs-agentbrew.md` documents the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing behavior.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: code-reviewer
- **Date**: 2026-06-11
- **Concerns**:
  - None — plan review confirmed all required sections and safety-critical git-diagnose-codebase concerns are covered, including no source-file reading before the history pass, scoped app/src history queries, five command families, churn×bug cross-reference as primary deliverable, <50-commit signal floor, squash-merge/commit-message/zero-firefighting caveats, wrong-tool routing, and pressure evals for repo-root/source-reading and caveat-free overconfidence.
