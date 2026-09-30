# Cover agentbrew-add-skill skill with #2134-style tests

## Goal

Add deterministic regression coverage for `skill-plugins/dev/agentbrew-add-skill/` so skill-source install, sync, verification, and safety-boundary drift fails in CI.

## Why

The skill teaches agents how to install existing skills into agentbrew. Incorrect guidance can cause agents to copy generated skill files manually, add unreviewed GitHub repos that can steer future agents, skip duplicate-source checks, use local paths in team/shared configs, fail to verify deployment, or misuse this skill for creating new skills from scratch. A #2134-style contract spec should catch accidental weakening of:

- catalog-first installs and recommended installs;
- GitHub source install with `--list` preview and optional `--skill` selection;
- local folder install with live symlink behavior and team portability caveats;
- source tracking in `~/.config/agentbrew/state.yaml` and refresh through `agentbrew sync --pull`;
- verification through `agentbrew catalog --sources`, `agentbrew status --verbose`, and `agentbrew sync`;
- post-install invokability checks in native skill directories;
- rules for valid `SKILL.md` frontmatter and kebab-case names;
- duplicate-source avoidance;
- unreviewed-source refusal;
- boundary that creating new skills belongs to `skill-creator`, not this install skill.

## Scope in

- Add a Vitest deterministic contract spec for `agentbrew-add-skill` at `src/skills/agentbrew-add-skill-contract.test.ts`; this is the existing repo skill-test harness location used by the `agentbrew-add-catalog-source`, `agentbrew-add-command`, and `agentbrew-add-mcp` contract specs.
- Read the real `SKILL.md` and `evals/evals.json` from disk.
- Follow the local #2134-style pattern: load artifact files, assert critical prose and metadata with grouped `requireTerms` checks, use exact strings for commands/paths/flags, use regexes for wrapping-prone prose, and locate eval scenarios by prompt/expected-output/expectation text.
- Assert required SKILL.md contract content:
  - description triggers for adding/installing existing skills and the explicit `skill-creator` boundary for new skill creation;
  - one registration deploys to all agents on sync;
  - catalog flow uses `agentbrew catalog --skills`, `agentbrew install <skill-name>`, and `agentbrew install --recommended`;
  - GitHub source flow uses `agentbrew install user/repo`, `--list`, and `--skill <name>`;
  - GitHub repos must contain directories with `SKILL.md` and source state is tracked in `~/.config/agentbrew/state.yaml`;
  - refresh flow uses `agentbrew sync --pull`;
  - local folder flow uses `agentbrew install /path/to/skills-folder`, symlinks source edits live, and warns about team/shared portability;
  - verify/sync flow uses `agentbrew catalog --sources`, `agentbrew status --verbose`, `agentbrew sync`, and native skill directory checks;
  - rules require valid frontmatter, kebab-case names matching directories, duplicate-source checks, source review, and catalog/GitHub preference for team setups;
  - constraints prohibit unreviewed GitHub sources, duplicate sources, local paths in team/shared configs, and skipping `agentbrew status --verbose`.
- Assert eval metadata coverage:
  - catalog install positive path;
  - GitHub source preview/list positive path;
  - local folder development path with portability caveat;
  - unreviewed-source refusal path. The current three evals only cover catalog install, GitHub preview/list install, and local folder development; they do not explicitly cover refusal to add an unreviewed source, so a fourth eval MUST be added.

## Scope out

- Do not change skill-sync implementation code.
- Do not add an executable script just to satisfy the pattern.
- Do not run live agent evals as part of this deterministic slice.
- Do not extract shared #2134 helper utilities in this P0; the existing P2 scout tracks helper extraction.
- Do not touch unrelated skills.

## Implementation steps

1. Add `src/skills/agentbrew-add-skill-contract.test.ts` beside the existing skill contract specs.
2. Write deterministic tests against `SKILL.md` and `evals/evals.json` with grouped, actionable assertions.
3. Run the focused spec. If it exposes a real eval coverage gap for unreviewed-source refusal, add the smallest fourth eval scenario.
4. Avoid SKILL.md prose edits; inspection confirms the current SKILL.md already contains the safety-critical terms for catalog/GitHub/local flows, source review warnings, duplicate-source checks, `skill-creator` boundary guidance, `agentbrew status --verbose` verification, and local-path team-config caveats.
5. Run:
   - `npx vitest run src/skills/agentbrew-add-skill-contract.test.ts`
   - `npm run skills:coverage`
   - `npm run verify`
6. Remove the completed task block from `TASKS.md` before the implementation commit and update the shared-helper scout count if another local helper copy exists.

## Current artifact check

- Existing `SKILL.md` already includes the required safety-critical contract terms; no prose edits are expected.
- Existing evals cover three positive/caveat scenarios only: catalog install, GitHub preview/list install, and local folder development. They do not include explicit unreviewed-source refusal, so eval #4 is required.
- `src/skills/` is the active skill-contract-test harness location, with four existing #2134-style specs using the same placement.
- `npm run verify` is the final completion gate after focused tests and `npm run skills:coverage`.

## Risks and mitigations

- **Brittle phrase locks**: Use exact strings for commands, paths, and flags; use regexes for wrapping-prone prose.
- **Over-scoping into sync implementation**: Keep this slice artifact-contract only.
- **False confidence**: State that the spec proves skill/eval drift detection, not live skill-source connectivity.
- **Duplicate helpers**: Accept local duplication for this P0; update the existing scout task instead of extracting now.

## Acceptance criteria

- A new deterministic spec reads `SKILL.md` and `evals/evals.json`.
- The spec pins catalog/GitHub/local install flows, source tracking, refresh, verification, native invokability checks, valid skill shape, duplicate-source avoidance, source-review safety, local-path portability, and `skill-creator` boundary guidance.
- Evals cover catalog install, GitHub preview/list install, local folder development, and unreviewed-source refusal; add the mandatory fourth eval because the existing three evals do not cover unreviewed-source refusal, and require the deterministic spec to find it.
- `npx vitest run src/skills/agentbrew-add-skill-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes.
- Completed task is removed from `TASKS.md`.

## Vision trace

- **Vision goal**: G5 — Drift detection + auto-repair. This adds CI-visible drift detection for an agent-facing skill-install workflow artifact.
- **User story**: `docs/user-stories/18-lint-validate.md` and `docs/user-stories/24-local-source-skills.md`; validation should catch broken agent artifacts and local-source portability mistakes before users rely on them.
- **Competitor prior art**: N/A — this is internal deterministic regression coverage for an agentbrew-owned skill, not a user-facing feature proposal.

## Reviewer verdict

- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - None blocking. The mandatory fourth unreviewed-source refusal eval, current SKILL.md term verification, #2134 pattern summary, and test harness location confirmation are now explicit.
