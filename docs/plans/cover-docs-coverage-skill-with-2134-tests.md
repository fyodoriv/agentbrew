# Plan: Cover docs-coverage skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for `docs-coverage` so regressions in its four-layer documentation-coverage workflow fail before agents audit only README, ignore user stories or instruction files, leave aspirational docs for unimplemented features, skip verification after edits, or miss instruction-token/duplication drift.

The contract spec will read the real `skill-plugins/dev/docs-coverage/SKILL.md` and `skill-plugins/dev/docs-coverage/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for four-layer shortcut refusal plus documented-not-implemented/aspirational-doc refusal.

Plan review note: current `SKILL.md` and `evals.json` are intentionally not edited until after this plan is approved. Implementation will make the narrow four-layer wording fix and eval additions/strengthening described below.

## Why

`docs-coverage` protects repo trust across README, user stories, implementation, and instructions/rules. Its high-risk failures are narrow audits and stale promises: checking only one doc surface, treating docs as truth over code, accepting “coming soon” claims for implemented or absent behavior, or failing to verify counts and command references after edits. Deterministic coverage keeps the skill aligned to full-surface coverage and code-backed documentation.

## Scope (in)

- Add `src/skills/docs-coverage-contract.test.ts` using the established #2134 local helper pattern.
- Read the real `skill-plugins/dev/docs-coverage/SKILL.md` and `skill-plugins/dev/docs-coverage/evals/evals.json`.
- Fix and pin frontmatter/purpose wording so instructions/rules cannot be downgraded:
  - update `SKILL.md` description to include README, user stories, implementation, and instructions/rules;
  - update the opening purpose line from "three layers" to "four layers";
  - pin `name: docs-coverage`;
  - pin the four-layer description;
  - pin `argument-hint: "[readme-path] [user-stories-dir]"`;
  - pin user/model triggers.
- Pin purpose:
  - audits documentation coverage across four layers: README, user stories, implementation, and instructions/rules;
  - defaults to `./README.md` and `./docs/user-stories/`.
- Pin Phase 1 claim extraction:
  - README: every feature, command, flag, behavior;
  - user stories: every story file, flows and features;
  - implementation: grep CLI commands, exported functions, config options;
  - instructions/rules: deployed AGENTS.md, CLAUDE.md, `shared-rules.md`, conventions/rules/guidance;
  - instructions/rules is the fourth documentation layer and must stay consistent with README, user stories, and implementation.
- Pin Phase 2 coverage matrix:
  - every feature found in any layer must be checked across all four;
  - matrix columns Feature, In README?, In user story?, Implemented?, In instructions?, Gap;
  - any “No” column is a gap;
  - instructions-specific token-overhead and duplication checks, including `wc -c / 4`, over-8K flag, duplicated headings between template and managed rules, and `docs/instructions-analysis.md` reference.
- Pin Phase 3 gap handling:
  - implemented but not documented: write missing README/user story coverage;
  - documented but not implemented: implement it or remove documentation;
  - never ship docs for non-existent features;
  - README but no user story: create story in existing format;
  - required user-story format: H1 title, blockquote hook, bash command examples, feature tables / implementation details, error handling / what-if sections;
  - user story but no README: add concise README mention and link, not full story duplication.
- Pin Phase 4 verification:
  - README counts for agents, skills, tests match actual data files;
  - user-story table lists every story file;
  - CLI reference commands match actual `.command()` calls;
  - no `coming soon`, `planned`, or `Status:` disclaimers for features that already work.
- Pin principles:
  - README is storefront optimized for scanning;
  - user stories are the spec and document WHY/full flow;
  - code is truth and docs/code disagreements require fixing docs or fixing code then docs;
  - silent failures are docs bugs that require code and docs fixes.
- Pin existing evals 1-6 with exact prompts/core expectations.
- Strengthen existing evals 1, 4, and 6 so their expectations explicitly state that instructions/rules are a first-class/fourth documentation layer rather than optional extra context.
- Add eval 7 for four-layer shortcut pressure: a user asks to “just compare README to code” and skip user stories/instructions; expected answer refuses the shortcut and builds the four-layer matrix.
- Add eval 8 for aspirational-doc pressure: a user asks to keep README “coming soon”/roadmap docs for an unimplemented feature; expected answer refuses stale aspirational docs and either removes/corrects docs or implements the feature plus user-story coverage.
- Remove the completed task from TASKS.md at ship time and update scout tasks from twenty-eight to twenty-nine specs with a docs-coverage pressure example.

## Scope (out)

- No broad SKILL.md rewrite; only the narrow frontmatter/purpose wording fix that aligns the existing body with its fourth-layer instructions/rules contract.
- No runtime docs-coverage implementation; this is contract coverage over skill artifacts.
- No script-level tests; `skill-plugins/dev/docs-coverage/` contains only `SKILL.md` and `evals/evals.json`.
- No new documentation-audit command; the skill is workflow prose and eval coverage only.
- No changes to `doc-check`, `companion-docs-sync`, or `readme-audit` skills.
- No shared helper extraction; the existing P2 scout task remains the tracking item.
- No new dependencies.

## Existing eval strengthening

Before adding new pressure evals, update existing `docs-coverage` eval expectations so the fourth layer cannot regress:

- **Eval 1**: change the first expectation to say `Extracts claims from README, user stories, implementation, and instructions/rules as first-class documentation layers`.
- **Eval 4**: add/strengthen an expectation that says `Treats instructions/rules as a first-class documentation layer, not optional extra context`.
- **Eval 6**: change the first expectation to say `Reads deployed instruction files such as AGENTS.md, CLAUDE.md, and shared-rules.md as the first-class fourth documentation layer`.

## Concrete eval additions

### Eval 7 — four-layer shortcut pressure

```json
{
  "id": 7,
  "prompt": "For speed, just compare README.md to the code and skip user stories and AGENTS.md unless something looks suspicious.",
  "expected_output": "A docs-coverage response that refuses the two-layer shortcut and builds the required four-layer matrix across README, user stories, implementation, and instructions/rules.",
  "expectations": [
    "Does not limit the audit to README versus code when user stories or instructions may contain the only stale or missing claim",
    "Reads every user story and deployed instruction/rules file as first-class coverage layers",
    "Builds a matrix with README, user story, implemented, instructions, and gap columns for every feature found in any layer",
    "Flags rows where any layer is missing or contradictory instead of treating a two-layer match as complete",
    "Runs the documented count, command-reference, user-story table, and instruction-overhead checks after fixes"
  ]
}
```

### Eval 8 — aspirational-doc pressure

```json
{
  "id": 8,
  "prompt": "README advertises a planned export command that is not implemented yet. Keep it as a coming-soon feature so users know it's on the roadmap.",
  "expected_output": "A docs-coverage response that refuses aspirational storefront docs for non-existent behavior and either removes/corrects the claim or treats implementation plus user-story coverage as required work.",
  "expectations": [
    "Identifies the claim as documented-but-not-implemented drift after checking actual CLI commands, exports, config options, and user stories",
    "Does not keep coming-soon, planned, or Status disclaimers in README for behavior that does not exist",
    "Chooses between removing/correcting the documentation or implementing the feature and then documenting it across the required layers",
    "Requires user-story coverage if the feature involves a multi-step user flow",
    "Verifies README counts, CLI command references, and user-story tables after any doc or implementation change"
  ]
}
```

## Deterministic assertion map

### SKILL.md contract

Pin with explicit `requireTerms(skillText, [...])` assertions:

- **Frontmatter**: `name: docs-coverage`; four-layer description naming README, user stories, implementation, and instructions/rules; argument hint; triggers `user` and `model`.
- **Purpose**: `Audit documentation coverage across four layers: README, user stories, implementation, and instructions/rules`; defaults to `./README.md` and `./docs/user-stories/`.
- **Phase 1**: heading plus README features/commands/flags/behaviors, every user story file, flows/features, implementation grep for CLI commands/exported functions/config options, instruction files AGENTS/CLAUDE/shared-rules, conventions/rules/guidance, fourth-layer consistency requirement.
- **Phase 2**: heading plus “every feature found in ANY layer”, all matrix column headings, “Flag any row where a column is "No"”, and instructions-specific token/duplication checks.
- **Phase 3**: heading plus every gap type and response: implemented-not-documented, documented-not-implemented, README-without-story, story-without-README, never ship docs for non-existent features, and existing user-story format bullets.
- **Phase 4**: heading plus README counts, user-story table, `.command()` calls, and no `coming soon` / `planned` / `Status:` disclaimers.
- **Principles**: README storefront/scanning, user stories as spec/WHY/full flow, code truth, and silent failures as docs bugs.

### Eval preservation and metadata

Pin with explicit `evalById(N)` and `requireTerms(expectationText(evalById(N)), [...])` assertions:

- `evals.skill_name === "docs-coverage"`, length 8 after implementation, unique IDs, non-empty prompt/expected output, and at least four expectations/assertions for every eval.
- **Eval 1**: exact prompt about README/user stories/AGENTS/implementation agreeing for a new CLI flag plus expectations that instructions/rules are a first-class layer, four-layer extraction, matrix gap column, code-as-truth, and counts/command verification.
- **Eval 2**: exact prompt about README command with no implementation/story plus expectations for documented-not-implemented drift, no coming-soon/stale claims, user stories for real flows, and repo-specific verification.
- **Eval 3**: exact prompt about auto-heal covered in story/code but omitted from README/AGENTS plus expectations for missing coverage columns, concise README mention, durable instruction updates, and verification.
- **Eval 4**: exact prompt about repo-wide sync plus expectations for instructions/rules as a first-class layer, four-layer extraction, four-layer matrix, missing/contradictory row flags, gap-type differentiation, and not README-only.
- **Eval 5**: exact prompt about `sync --discover` plus expectations for implementation search, story coverage, README/story update when underdocumented, correcting non-implemented claims, and post-change verification.
- **Eval 6**: exact prompt about new AGENTS.md rule plus expectations that instruction files are the fourth documentation layer, token overhead with `wc -c / 4`, duplication checks, `docs/instructions-analysis.md`, and not accepting one-file rule presence.
- **Eval 7**: exact four-layer shortcut prompt and all five listed expectations, especially refusing README-vs-code-only coverage and requiring README, user story, implemented, instructions, and gap columns.
- **Eval 8**: exact aspirational-doc prompt and all five listed expectations.

## Falsifiability checks

Each falsifiability check maps to a concrete assertion family:

- Red phase fails against the original 6-eval file because `expect(evals.evals).toHaveLength(8)` and `evalById(7/8)` fail.
- Removing frontmatter name/four-layer description/argument hint/triggers fails frontmatter assertions.
- Reverting the purpose line to a three-layer audit fails Purpose assertions.
- Removing instruction/rules as the fourth layer fails Phase 1/Phase 2 assertions and eval 1/4/6/7 assertions.
- Removing matrix columns or “any No is a gap” fails Phase 2 assertions and eval 1/4/7 assertions.
- Removing documented-not-implemented handling or “Never ship docs for features that don't exist” fails Phase 3 assertions and eval 2/5/8 assertions.
- Removing user-story format requirements fails Phase 3 assertions.
- Removing verification checks for counts, story table, `.command()` calls, or no `coming soon` / `planned` / `Status:` disclaimers fails Phase 4 assertions and eval 1/2/5/8 assertions.
- Removing README/storefront, user stories/spec, code/truth, or silent-failures principles fails Principles assertions.
- Allowing README-vs-code-only audits fails eval 7 assertions.
- Allowing aspirational docs for absent behavior fails eval 8 assertions.

## Scout task updates

Update these existing scout tasks using their current sentence style:

- `extract-shared-2134-skill-contract-test-helpers`: change `The first twenty-eight deterministic #2134-style skill contract specs` to `The first twenty-nine deterministic #2134-style skill contract specs` and append `docs-coverage` after `doc-check` in the parenthesized skill list.
- `document-2134-pressure-eval-conventions`: in the long `Details` sentence, insert this exact example before `and metadata completeness`: `docs-coverage pressure (for example, \`docs-coverage\` refusing README-vs-code-only shortcuts, requiring README/user-story/implementation/instructions matrix coverage for every feature discovered in any layer, treating instruction-token overhead and duplicated managed rules as first-class drift, refusing aspirational \`coming soon\`/\`planned\`/\`Status:\` claims for absent behavior, and verifying README counts, user-story tables, CLI \`.command()\` references, and instruction overhead after fixes)`.

## Implementation steps

1. Add deterministic spec at `src/skills/docs-coverage-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/docs-coverage-contract.test.ts --reporter=verbose`; expect failure on the current three-layer wording and missing/weak eval coverage.
3. Apply the narrow `SKILL.md` wording fix: update the frontmatter description and opening purpose line to name README, user stories, implementation, and instructions/rules as four layers.
4. Strengthen evals 1, 4, and 6, then add evals 7-8 to `skill-plugins/dev/docs-coverage/evals/evals.json`.
5. Update TASKS.md bookkeeping only: remove the completed task block and update the two scout task blocks by ID (`extract-shared-2134-skill-contract-test-helpers` and `document-2134-pressure-eval-conventions`).
6. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
7. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **Overlap with doc-check/readme-audit**: Pin docs-coverage as cross-layer coverage, not prose-quality review or README rewrite.
- **Over-locking concise prose**: Pin durable phase headings, layer names, matrix columns, gap types, verification checks, and principles rather than incidental examples.
- **False confidence from README-only checks**: Add eval 7 pressure that refuses the shortcut.
- **Trust failures from aspirational docs**: Add eval 8 pressure that refuses `coming soon`/roadmap claims for absent behavior.
- **Helper duplication**: update the existing scout task instead of extracting helpers here.

## Acceptance criteria

- `src/skills/docs-coverage-contract.test.ts` exists and reads real skill/eval files.
- The implementation updates SKILL.md to use four-layer wording in frontmatter/purpose while preserving the existing body contract.
- The spec pins updated four-layer frontmatter/purpose wording, Phase 1-4 workflow, four-layer matrix, gap handling, verification checks, principles, and eval metadata.
- Evals 1-6 are preserved and asserted, with evals 1/4/6 strengthened for first-class instructions/rules coverage.
- Evals 7-8 are added with concrete pressure expectations.
- Red phase fails on missing evals 7-8 and green phase passes after adding them.
- `npx vitest run src/skills/docs-coverage-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from twenty-eight to twenty-nine.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair. This task aligns because the spec pins durable `docs-coverage` invariants (four-layer claim extraction, matrix columns, gap-type handling, verification checks, principles, and pressure evals) so regressions in `SKILL.md` or `evals.json` fail loudly before agents audit only README or leave aspirational docs behind.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them; this task adds validation for the docs-coverage skill artifact itself.
- **Competitor prior art**: `docs/competition/vercel-skills-cli-vs-agentbrew.md` documents the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing behavior.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-11
- **Concerns**:
  - None — plan review confirmed it resolves the three-layer/four-layer ambiguity, defers SKILL/eval edits to post-approval, strengthens instructions/rules first-class eval assertions, specifies scout task edits by ID, and includes concrete falsifiability and acceptance criteria.
