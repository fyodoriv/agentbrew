# Plan: hooks-foundation-iron-law-decommissioning

## Goal
Ship the Phase 0 deterministic-hooks foundation so `agentbrew sync` can deploy manifest-backed hooks to Claude Code, Cursor, and project-local Devin surfaces, with the `code-no-timestamps` hook as the golden-path proof.

## Why
IRON LAW rules are currently advisory prose in large instruction files, and agents routinely violate them when the relevant rule falls out of the effective attention window. Agentbrew already owns cross-agent configuration sync, so it is the right place to turn hookable rules into deterministic guardrails that block violations before they land on disk or in PRs.

## Scope (in)
- Document the hook runtime contract in `docs/hook-protocol.md`.
- Validate the canonical hook manifest and overlay manifest shape, including per-hook target agents and overlay disables/replacements.
- Extend hook sync to write agent-native hook config for Claude Code, Cursor, and project-local Devin.
- Preserve user-authored hooks while pruning stale managed hooks per agent and per format.
- Include the `code-no-timestamps` deterministic hook as the Phase 0 golden-path hook.
- Update repo docs/user stories/matrix tests so hook sync parity is visible in the public contract.
- Ensure `npm run verify` covers manifest schema, hook fixture tests, typechecking, linting, dead-code checks, and the full Vitest suite.

## Scope (out)
- Does not ship all 26 Cat A deterministic hooks; those remain in `hooks-phase-1-cat-a-deterministic`.
- Does not ship Cat B LLM verifier hooks beyond shared foundation helpers.
- Does not decommission advisory rules from `shared-rules.md`; that waits for hooks to run stably.
- Does not publish or sync live user-level config as part of the PR; verification stays local/test-driven unless a human explicitly asks for a live sync.

## Implementation steps

1. Finish the plan/contract artifacts:
   - Add `docs/hook-protocol.md`.
   - Keep `README.md`, `ARCHITECTURE.md`, `AGENTS.md`, and `docs/user-stories/23-cross-repo-discovery.md` aligned with the Phase 0 target surface.

2. Harden manifest parsing and tests:
   - Validate `disabled`, `agents`, `model`, and `promptVersion`.
   - Ensure overlay replacements and disables resolve deterministically.
   - Preserve target agents when converting manifest entries to `ManagedHook`.
   - Add/finish `src/hooks/manifest.test.ts` coverage for the repo manifest and overlay behavior.

3. Finish per-agent hook sync:
   - Add `hooksFormat` and `hooksScope` metadata to agent definitions/types.
   - Write Claude hooks under `~/.claude/settings.json["hooks"]`.
   - Write Cursor hooks to `~/.cursor/hooks.json` with a `version: 1` wrapper and native camelCase event names.
   - Write Devin hooks to `.devin/hooks.v1.json` relative to the current project.
   - Track managed hook keys by agent so pruning does not delete user hooks from another format.

4. Verify the golden path:
   - Run `bash scripts/run-hook-fixtures.sh` so `code-no-timestamps` blocks timestamp payloads and allows clean payloads.
   - Run targeted Vitest tests for manifest parsing, hook sync, agent definitions, and the per-agent feature matrix.
   - Run `npm run verify` before committing the implementation.

5. Scout follow-ups:
   - Record any remaining Phase 0 gaps or Phase 1 extraction work in `TASKS.md`.
   - Remove the completed Phase 0 task block only after all acceptance criteria pass.

## Risks and mitigations
- **Risk**: Cursor or Devin hook schemas drift from the assumed Phase 0 shape. **Mitigation**: Keep the manifest vocabulary canonical to Claude events, translate Cursor event names in one adapter, and mark Devin output as project-local best-effort with tests around the generated file shape.
- **Risk**: Stale managed-key pruning deletes user-authored hooks. **Mitigation**: Store managed keys per agent/format and preserve entries outside the managed-key set.
- **Risk**: Live sync mutates user config during verification. **Mitigation**: Prefer pure unit tests and fixture tests; if a live `agentbrew sync` is needed later, ask explicitly before mutating user-level config.
- **Risk**: Phase 0 scope expands into implementing all Cat A hooks. **Mitigation**: Keep this PR limited to foundation + `code-no-timestamps`; leave conversion tasks queued under Phase 1.

## Acceptance criteria
- `docs/hook-protocol.md` documents source of truth, manifest schema, sync targets, runtime input, verdicts, timing, bypasses, and add-a-hook steps.
- Manifest parsing rejects invalid `disabled`/`agents` metadata and resolves overlay disables/replacements.
- `agentbrew sync` generation paths are covered for Claude Code settings, Cursor hooks.json, and project-local Devin hooks.v1.json.
- `code-no-timestamps` fixture tests pass through `bash scripts/run-hook-fixtures.sh`.
- `src/sync/per-agent-features.matrix.test.ts` shows hooks support for Claude Code, Cursor, and Devin.
- `npm run verify` passes.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-04
- **Concerns**:
  - None
