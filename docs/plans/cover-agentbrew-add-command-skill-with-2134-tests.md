# Cover agentbrew-add-command skill with #2134-style tests

## Goal

Add deterministic regression coverage for `skill-plugins/dev/agentbrew-add-command/` so command-source, per-agent transform, deployment, and safety-boundary regressions fail in CI.

## Why

The skill teaches agents how to create slash commands that agentbrew deploys across multiple agent surfaces. It already has `evals/evals.json`, but no deterministic harness that reads the skill source and eval data directly. A #2134-style contract spec should catch accidental weakening of:

- the single canonical command source path;
- per-agent generated-copy boundaries;
- YAML frontmatter and `description` requirements;
- Cursor `<!-- turbo -->` to `// turbo` transform guidance;
- deploy/verify commands after creation or edits;
- edit/remove workflows;
- kebab-case and focused-command rules;
- plaintext secret/token refusal guidance;
- eval coverage for positive, transform, correction/ambiguity, and refusal scenarios.

## Scope in

- Add a Vitest deterministic contract spec for `agentbrew-add-command`.
- Read the real `SKILL.md` and `evals/evals.json` from disk.
- Assert required SKILL.md contract content:
  - canonical commands live under `~/.config/agentbrew/commands/<name>.md`;
  - per-agent copies under `~/.claude/commands/`, `~/.cursor/commands/`, and similar are generated outputs;
  - YAML frontmatter includes `description`;
  - Cursor turbo annotations use `<!-- turbo -->` in the canonical file and transform to `// turbo`;
  - `agentbrew sync`, `agentbrew sync --only commands`, and `agentbrew commands list` verify deployment;
  - existing commands are edited at the canonical source and removed through `agentbrew remove <name>`;
  - command filenames use kebab-case and commands stay focused;
  - command files must not contain secrets or tokens.
- Assert eval metadata coverage:
  - reusable command positive path;
  - Cursor turbo transform path;
  - per-agent-copy correction/ambiguity path;
  - secret/token refusal path; add a fourth eval if the current set lacks it.
- Keep `npm run skills:coverage` and `npm run verify` green.

## Scope out

- Do not add an executable script just to satisfy the pattern.
- Do not change command-sync implementation code or command schema.
- Do not run live agent evals as part of this deterministic slice.
- Do not extract shared #2134 helper utilities in this P0; the existing P2 scout tracks that after multiple specs.
- Do not touch unrelated skills.

## Implementation steps

1. Add `src/skills/agentbrew-add-command-contract.test.ts`; this follows the existing repo harness location used by the current #2134-style skill contract specs.
2. Write deterministic tests against the current artifacts:
   - parse `SKILL.md` as text;
   - parse `evals/evals.json` as JSON;
   - use grouped concept assertions with actionable failure messages.
3. Run the focused spec. If it exposes a real eval coverage gap, add the smallest `evals.json` scenario that covers it.
4. Avoid SKILL.md prose edits unless the current skill truly lacks a safety-critical contract term.
5. Run:
   - `npx vitest run src/skills/agentbrew-add-command-contract.test.ts`
   - `npm run skills:coverage`
   - `npm run verify`
6. Remove the completed task block from `TASKS.md` before the implementation commit.

## Risks and mitigations

- **Brittle phrase locks**: Use exact strings for paths, commands, and annotation tokens; use regexes for wrapping-prone prose.
- **False confidence**: Keep the test scoped to deterministic artifact drift; do not claim it proves live agent behavior.
- **Over-scoping into command implementation**: This task is for skill contract coverage, not command-sync behavior.
- **Premature abstraction**: Duplicate small local helpers in this spec and leave shared-helper extraction to the scout task.

## Acceptance criteria

- A new deterministic spec reads `SKILL.md` and `evals/evals.json`.
- The spec pins canonical-source, generated-copy, frontmatter, turbo transform, deploy/verify, edit/remove, naming/focus, and secret/token boundaries.
- Evals cover positive, transform, generated-copy correction/ambiguity, and refusal/safety scenarios; if the existing three evals do not cover secret refusal, add a fourth eval and require the deterministic spec to find it.
- `npx vitest run src/skills/agentbrew-add-command-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes.
- Completed task is removed from `TASKS.md`.

## Vision trace

- **Vision goal**: G5 — Drift detection + auto-repair. This adds CI-visible drift detection for an agent-facing command workflow artifact.
- **User story**: `docs/user-stories/18-lint-validate.md` and `docs/user-stories/25-status-and-health.md`; validation/status should catch broken agent artifacts before users rely on them.
- **Competitor prior art**: N/A — this is internal deterministic regression coverage for an agentbrew-owned skill, not a user-facing feature proposal.

## Reviewer verdict

- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - None blocking. Implementation should verify whether the current three evals cover secret/token refusal; if not, add a fourth eval before marking complete.
