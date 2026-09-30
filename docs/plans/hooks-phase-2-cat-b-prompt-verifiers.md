# Plan: hooks-phase-2-cat-b-prompt-verifiers

## Goal
Ship the Cat B prompt-routing verifier slice: three warn-mode semantic hooks for repeated-work codification, action-oriented human asks, and rule/skill location routing.

## Why
These rules are semantic enough that deterministic grep checks would either miss important violations or warn too often. Agentbrew already owns the hook manifest, fixture runner, and Haiku verifier wrapper, so this slice should extend the existing verifier pattern rather than invent a parallel enforcement surface.

## Scope (in)
- Add three verifier scripts under `hooks/verifiers/`.
- Add mocked fixture tests for `ALLOW`, `BLOCK`, default-allow, bypass, and irrelevant-input paths.
- Add live integration stubs gated by `AGENTBREW_RUN_LLM_TESTS=1`.
- Register all three in `hooks/manifest.yaml` as `tier: verifier`, `verdict: warn`, `model: claude-haiku-4-5`, and `promptVersion: 1`.
- Remove the completed task from `TASKS.md` after acceptance passes.

## Scope (out)
- Does not flip any verifier to block mode.
- Does not ship the task/config rollout verifier slice.
- Does not decommission shared advisory rules; Phase 3 handles that after observation.
- Does not mutate user prompts or file content; all three hooks only warn in this slice.

## Implementation steps
1. Reuse `hooks/lib/stdin-json.sh`, `hooks/lib/verdict.sh`, and `hooks/lib/claude-verifier.sh`.
2. Add `codify-repeated-work.sh` on `UserPromptSubmit`:
   - read the submitted prompt and optional transcript path,
   - build a bounded transcript excerpt when available,
   - ask Haiku whether this is the third-or-later repeated workflow that should become a skill before continuing,
   - warn on `BLOCK` and otherwise allow.
3. Add `ask-action-not-treasure-map.sh` on `UserPromptSubmit`:
   - inspect the current prompt plus recent transcript context when available,
   - warn when the agent is about to leave the user a file-map instead of an actionable command or direct next step.
4. Add `rule-skill-location.sh` on `PreToolUse Write|Edit`:
   - only evaluate paths that look like rule or skill authoring surfaces,
   - send path plus content/diff excerpt and the routing matrix summary to Haiku,
   - warn when the proposed location appears wrong.
5. Add one fixture file and one opt-in live integration stub per verifier.
6. Extend the canonical manifest test to assert the three new Cat B entries.
7. Run hook fixtures, targeted manifest tests, and the full verify gate.

## Risks and mitigations
- **Risk**: Prompt payloads may lack enough transcript context. **Mitigation**: default allow on missing context or ambiguity, and keep warn mode.
- **Risk**: UserPromptSubmit hooks may warn on normal user requests. **Mitigation**: prompt wording requires high confidence and repeated evidence before `BLOCK`.
- **Risk**: Rule/skill routing false positives could interrupt legitimate local experimentation. **Mitigation**: restrict matcher to rule/skill paths, keep warn mode, and provide the suggested canonical location in the warning.
- **Risk**: LLM latency affects every prompt. **Mitigation**: cap verification at 2s and bound transcript/content excerpts.

## Acceptance criteria
- `bash scripts/run-hook-fixtures.sh` runs the three new verifier fixture files.
- Mocked `BLOCK` responses produce warn-mode stderr and exit 0.
- Mocked `ALLOW`, timeout, missing `claude`, bypass, and irrelevant inputs exit 0 silently.
- Manifest entries include `model: claude-haiku-4-5`, `promptVersion: 1`, and `agents: ["claude-code"]`.
- `npm run verify` passes.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-05
- **Concerns**:
  - None
