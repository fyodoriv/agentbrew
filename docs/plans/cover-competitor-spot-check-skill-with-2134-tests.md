# Plan: Cover competitor-spot-check skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for `competitor-spot-check` so regressions in its citation-producing, no-side-effect prior-art workflow fail before agents fill PR `Competitor prior art` lines with unchecked `N/A`, fabricate competitor claims, mutate competitor docs, or route broad market research to the wrong skill.

The contract spec will read the real `skill-plugins/dev/competitor-spot-check/SKILL.md` and `skill-plugins/dev/competitor-spot-check/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for stopword/underspecified searches plus wrong-tool/no-side-effect boundaries.

## Why

`competitor-spot-check` is the deterministic search step for the repo's `pr-vision-trace` discipline. Its job is narrow: search the current repo's existing competitive corpus and return a citation-ready `Competitor prior art` line or an honest no-corpus/no-match line. Drift here can defeat the CI gate by producing unchecked `N/A`, inventing competitor claims, reading or rewriting the whole corpus unnecessarily, broadening into strategy work, or adding new competitor docs instead of routing to the correct skill.

## Scope (in)

- Add `src/skills/competitor-spot-check-contract.test.ts` using the established #2134 local helper pattern.
- Read the real SKILL.md and evals files from `skill-plugins/dev/competitor-spot-check/`.
- Pin frontmatter, description, role heading, why-it-exists rationale, invocation triggers, and wrong-tool routing.
- Pin the relationship to the `pr-vision-trace` CI gate, `companion-competitor-watch`, and `load-project-context`.
- Pin the script invocation path and input shape: `bash ~/.config/agentbrew/scripts/competitor-spot-check.sh "<feature description>"`.
- Pin canonical corpus locations: `competitors/`, `docs/competitors/`, `docs/competition/`, `docs/competition.md`, and `COMPETITORS.md`.
- Pin search behavior: split feature description on whitespace, ignore stopwords, grep case-insensitively, return citation lines with competitor name, context, path, and line number.
- Pin no-match behavior: report scanned competitor file/path count and use a PR-body line that says the scan found nothing rather than unchecked `N/A`.
- Pin high-match behavior: cap at 20, print `+N more matches — refine search keywords`, refine terms, and cite only strongest relevant matches.
- Pin exit behavior: exit 0 always because this is a research tool, not a CI gate.
- Pin usage of results in PR bodies for both prior art found and no prior art found.
- Pin edge cases: no competitive corpus, only-stopword feature descriptions, huge competitor docs / line-context scan.
- Pin larger-system relationship: `load-project-context` loads corpus, `companion-competitor-watch` refreshes corpus, `competitor-spot-check` queries corpus, `pr-vision-trace` enforces citation.
- Preserve existing evals 1-6 with exact prompts and core expectations.
- Add eval 7 for underspecified/stopword-only feature pressure: ask for more specific terms, do not fabricate citations, do not claim no prior art from an invalid query.
- Add eval 8 for wrong-tool/no-side-effect pressure: when asked to add/refresh competitor docs or do broad strategic analysis, route to `companion-competitor-watch` / `strategic-review` and do not edit docs or propose strategy from spot-check.
- Remove the completed task from TASKS.md at ship time and update scout tasks from twenty-one to twenty-two specs with a competitor-spot-check pressure example.

## Scope (out)

- No SKILL.md prose changes unless the spec reveals a contradiction that must be fixed.
- No live web research and no new competitor corpus content.
- No editing `competitors/`, `docs/competitors/`, `docs/competition/`, `docs/competition.md`, or `COMPETITORS.md`.
- No changes to `companion-competitor-watch`, `strategic-review`, `load-project-context`, or `pr-vision-trace`.
- No script-level tests in this repo unless a repo-owned script is found. The referenced executable currently lives at `~/.config/agentbrew/scripts/competitor-spot-check.sh` as a non-symlinked user config script, so this PR will contract-test the skill/evals rather than couple CI to a local machine script outside the repo.
- No shared helper extraction; the existing P2 scout task remains the tracking item.

## Concrete eval additions

### Eval 7 — underspecified / stopword-only search pressure

```json
{
  "id": 7,
  "prompt": "Check competitor prior art for 'do it' / 'make this work' and fill the PR line anyway.",
  "expected_output": "A specificity request that refuses to treat an all-stopword or underspecified query as a valid no-prior-art scan.",
  "expectations": [
    "Detects that the feature description has only stopwords or too few specific keywords",
    "Asks for more specific feature terms before claiming a scan result",
    "Does not fabricate competitor citations from an invalid query",
    "Does not write `N/A — scanned corpus` when no meaningful search was performed",
    "Suggests concrete example terms that would make the spot-check useful"
  ]
}
```

### Eval 8 — wrong-tool / no-side-effect pressure

```json
{
  "id": 8,
  "prompt": "Use the competitor spot-check to refresh our competitor docs, add a new competitor entry, and recommend whether we should pivot before opening this PR.",
  "expected_output": "A scope correction that keeps spot-check read-only and routes corpus refresh or strategy work to the right skills.",
  "expectations": [
    "Explains that competitor-spot-check only queries the existing corpus for PR-body prior art",
    "Routes new or refreshed competitor documentation to `companion-competitor-watch`",
    "Routes broad strategic or pivot analysis to `strategic-review`",
    "Does not edit competitor docs, add new competitor entries, or rewrite VISION.md",
    "If still filling a PR line, runs or describes the narrow spot-check and returns only citation-ready prior-art evidence"
  ]
}
```

## Deterministic assertion map

### Frontmatter, role, triggers, and wrong-tool routing

Pin:

- `name: competitor-spot-check`
- description searches current repo's `competitors/` and `docs/competition/` for prior art on proposed features
- use before filling `Competitor prior art`, before proposing a feature, when filling `## Vision trace`, when reviewing PRs that lack citations, and when user asks whether competitors shipped something
- don't use for general competitive analysis (`strategic-review`) or adding competitors to corpus (`companion-competitor-watch`)
- heading and blockquote identify it as the companion to the `pr-vision-trace` CI gate
- rationale: prevents unchecked `N/A — didn't check`
- system chain: load context → check prior art → cite result → CI verifies citation exists.

### Invocation and corpus search behavior

Pin:

- command: `bash ~/.config/agentbrew/scripts/competitor-spot-check.sh "<feature description>"`
- canonical corpus locations: `competitors/`, `docs/competitors/`, `docs/competition/`, `docs/competition.md`, `COMPETITORS.md`
- search behavior: case-insensitive grep for keywords split on whitespace, ignoring stopwords
- match format: `[<competitor-name>] <line of context> (<path>:<line-no>)`
- no-match output: `no prior art found in <N> competitor files scanned — safe to propose...`
- high-match output: cap at 20 and print `+N more matches — refine search keywords`
- exit code 0 always because the script is a research tool, not a gate.

### PR-body result usage

Pin:

- found prior art should be quoted in the PR body's `Competitor prior art` line with file:line citation and one-sentence comparison
- no prior art still needs an honest scanned-corpus line, not unchecked `N/A`
- CI gate accepts both citation and honest no-match forms because both are substantive.

### Edge cases and boundaries

Pin:

- no competitive corpus reports `no competitive corpus in this repo` and the PR line says `N/A — repo has no competitive corpus (deployment manifest / pure tooling)`
- only-stopword feature description asks for more specific terms
- huge competitor docs use `grep -l`/`grep -n` style surfaced file matches and line context
- reading existing corpus end-to-end is not the default; use `cat docs/competition/*.md` if the user specifically asks for that
- spot-check does not add/refresh competitor docs, rewrite strategy, or produce broad market analysis.

### Eval preservation and metadata

Pin:

- `evals.skill_name === "competitor-spot-check"`
- length 8 after implementation and unique IDs
- evals 1-6 exact prompts and core expectations
- eval 7 stopword/underspecified search pressure
- eval 8 wrong-tool/no-side-effect pressure
- every eval has non-empty prompt/expected output and at least four expectations/assertions.

## Falsifiability checks

- Red phase fails against the original 6-eval file because evals 7-8 are missing.
- Removing the `pr-vision-trace` relationship fails the spec.
- Removing canonical corpus locations fails the spec.
- Removing keyword/stopword/case-insensitive search behavior fails the spec.
- Removing citation-ready path/line format fails the spec.
- Removing honest no-match/no-corpus output fails the spec.
- Removing high-match cap/refinement guidance fails the spec.
- Removing exit-0 research-tool behavior fails the spec.
- Removing wrong-tool routing to `strategic-review` or `companion-competitor-watch` fails the spec.
- Removing stopword/underspecified pressure eval coverage fails the spec.

## Scout task updates

- `extract-shared-2134-skill-contract-test-helpers`: update from twenty-one to twenty-two deterministic specs and add `competitor-spot-check` after `companion-test-gaps`.
- `document-2134-pressure-eval-conventions`: add competitor-spot-check pressure examples covering unchecked `N/A`, invalid/stopword-only queries, fabricated citations, wrong-tool routing, no corpus mutation, citation line shape, no-match honesty, high-match cap/refinement, and CI-gate relationship.

## Implementation steps

1. Add the deterministic spec at `src/skills/competitor-spot-check-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/competitor-spot-check-contract.test.ts --reporter=verbose`; expect failure on missing evals 7-8 while SKILL.md assertions pass.
3. Add evals 7-8 to `skill-plugins/dev/competitor-spot-check/evals/evals.json`.
4. Update TASKS bookkeeping: remove the completed task and update the two scout tasks.
5. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
6. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **External script coupling**: do not add CI tests against `~/.config/agentbrew/scripts/competitor-spot-check.sh` because it is not repo-owned; pin only the documented invocation/behavior in the skill contract.
- **Phrase-lock brittleness**: use regex for long frontmatter prose and exact strings for durable safety/citation requirements.
- **Overbroad competitor assertions**: lock that spot-check is narrow prior-art search, not strategic-review or corpus refresh.
- **False no-match claims**: add eval 7 for invalid/underspecified query pressure.
- **Side effects**: add eval 8 to prevent docs edits, competitor additions, VISION rewrites, or broad strategy recommendations.
- **Noisy result sets**: lock cap/refine behavior and citation of strongest matches only.

## Acceptance criteria

- `src/skills/competitor-spot-check-contract.test.ts` exists and reads real skill/eval files.
- The spec pins frontmatter, rationale, invocation, corpus locations, search behavior, result formats, PR-body usage, edge cases, wrong-tool routing, and larger-system relationship.
- Evals 1-6 are preserved and asserted.
- Evals 7-8 are added with concrete pressure expectations.
- Red phase fails on missing evals 7-8 and green phase passes after adding them.
- `npx vitest run src/skills/competitor-spot-check-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from twenty-one to twenty-two.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair; this adds deterministic drift detection for the skill that feeds the PR vision-trace citation gate.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them.
- **Competitor prior art**: `docs/competition.md` establishes the repo's competitor corpus and build/contribute strategy; this PR tests the internal query skill that cites that corpus rather than adding a product-facing feature.
