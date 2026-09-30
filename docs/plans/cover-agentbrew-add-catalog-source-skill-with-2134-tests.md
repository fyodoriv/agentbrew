# Cover agentbrew-add-catalog-source skill with #2134-style tests

## Goal

Add deterministic regression coverage for `skill-plugins/dev/agentbrew-add-catalog-source/` so catalog-routing, no-vendoring, recommendation, validation, and eval metadata regressions fail in CI.

## Why

The skill guides catalog changes that affect every agentbrew user. It currently has `evals/evals.json`, but no deterministic harness that reads the skill source and eval data directly. A #2134-style contract spec should catch accidental weakening of:

- shared catalog vs team-overlay routing;
- curator-not-host/no-SKILL.md-vendoring boundaries;
- whole-repo `repo_sources` guidance for team overlays;
- required validation commands and local catalog count checks;
- recommendation gating through `rationale`;
- duplicate-name and wrong-file safety checks;
- PR ticket/title expectations and no-unearned-success claims;
- eval coverage for positive, refusal, and ambiguity/safety scenarios.

## Scope in

- Add a Vitest deterministic contract spec for `agentbrew-add-catalog-source`.
- Read the real `SKILL.md` and `evals/evals.json` from disk.
- Assert required SKILL.md contract content:
  - public/generic source routes to `src/catalog.yaml`;
  - organization-specific/internal source routes to the team overlay `catalog-overlay.yaml`;
  - source content is never vendored into `skill-plugins/dev/` unless it documents agentbrew itself;
  - descriptions include `Don't use for X` guidance;
  - `recommended: true` requires a `rationale`;
  - duplicate names in the same file are invalid;
  - validators and local catalog list/count checks run before readiness claims;
  - whole-repo team overlays prefer `repo_sources` for multi-skill repos;
  - every PR/title uses a project ticket.
- Assert eval metadata coverage:
  - public portable skill positive path;
  - internal/private MCP or private-service refusal from shared catalog;
  - recommended-by-default safety/rationale path;
  - ambiguity/whole-repo-source path; add a fourth eval if the current set lacks it, because `repo_sources` is a safety-critical team-overlay path.
- Keep `npm run skills:coverage` and `npm run verify` green.

## Scope out

- Do not add an executable script just to satisfy the pattern.
- Do not change catalog code or catalog schema.
- Do not run live agent evals as part of this deterministic slice.
- Do not extract shared #2134 helper utilities yet; a P2 scout task already tracks that once enough specs exist.
- Do not touch unrelated skills.

## Implementation steps

1. Add `src/skills/agentbrew-add-catalog-source-contract.test.ts`; this matches the current repo harness location used by the first #2134-style skill contract spec while keeping `skill-plugins/dev/` as the source-artifact tree.
2. Write deterministic tests against the current artifacts:
   - parse `SKILL.md` as text;
   - parse `evals/evals.json` as JSON;
   - use grouped concept assertions with actionable failure messages.
3. Run the focused spec. If it exposes a real eval coverage gap, add the smallest `evals.json` scenario that covers it.
4. Avoid SKILL.md prose edits unless the current skill truly lacks a safety-critical contract term.
5. Run:
   - `npx vitest run src/skills/agentbrew-add-catalog-source-contract.test.ts`
   - `npm run skills:coverage`
   - `npm run verify`
6. Remove the completed task block from `TASKS.md` before the implementation commit.

## Risks and mitigations

- **Brittle phrase locks**: Use grouped concept checks for the decision tree and rules section; use regexes only for wrapping-prone terms and exact strings only for schema-like tokens such as file names, commands, and YAML keys.
- **False confidence**: Keep the test scoped to deterministic artifact drift; do not claim it proves live agent behavior.
- **Over-scoping into catalog implementation**: This task is for skill contract coverage, not catalog command behavior.
- **Premature abstraction**: Duplicate small local helpers for this second spec and leave shared-helper extraction to the existing P2 follow-up.

## Acceptance criteria

- A new deterministic spec reads `SKILL.md` and `evals/evals.json`.
- The spec pins shared-vs-overlay routing, no-vendoring, `repo_sources`, recommendation rationale, duplicate-name, validation, local verification, ticket/PR, and no-unearned-success boundaries.
- Evals cover positive, refusal/private/internal, recommendation-safety, and ambiguity/source-selection scenarios; if the existing three evals do not cover `repo_sources`, add a fourth eval and require the deterministic spec to find it.
- `npx vitest run src/skills/agentbrew-add-catalog-source-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes.
- Completed task is removed from `TASKS.md`.

## Vision trace

- **Vision goal**: G5 — Drift detection + auto-repair. This adds CI-visible drift detection for an agent-facing catalog workflow artifact.
- **User story**: `docs/user-stories/18-lint-validate.md` and `docs/user-stories/25-status-and-health.md`; validation/status should catch broken agent artifacts before users rely on them.
- **Competitor prior art**: N/A — this is internal deterministic regression coverage for an agentbrew-owned skill, not a user-facing feature proposal.

## Reviewer verdict

- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - Minor clarification addressed during planning: the `repo_sources` ambiguity path must be covered by a fourth eval if the current eval set lacks it.
  - Minor clarification addressed during planning: decision-tree/rules assertions should use grouped concept checks and wrapping-tolerant regexes rather than exact paragraph locks.
  - Minor clarification addressed during planning: `src/skills/agentbrew-add-catalog-source-contract.test.ts` is the intended repo harness location, matching the first #2134-style skill contract spec.
