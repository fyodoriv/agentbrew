# Plan: hooks-phase-2-cat-b-pr-body-decay

## Goal
Ship the first Cat B verifier hook: a warn-mode guard for `gh pr edit` bodies that look stale relative to the current diff.

## Why
PR descriptions decay when agents edit the body after code has moved on. Agentbrew already owns hook manifest sync, and Phase 2 needs one narrow verifier slice to prove the LLM-backed hook pattern before the remaining semantic rules land.

## Scope (in)
- Add one verifier script under `hooks/verifiers/`.
- Add fixture coverage with mocked `claude` responses.
- Add a live integration test that only runs when `AGENTBREW_RUN_LLM_TESTS=1`.
- Register the hook in `hooks/manifest.yaml` as `tier: verifier`, `verdict: warn`, `model: claude-haiku-4-5`, `promptVersion: 1`.
- Extend `scripts/run-hook-fixtures.sh` so verifier fixtures run with deterministic hook fixtures.
- Remove the completed slice task from `TASKS.md` after acceptance passes and leave follow-up slices queued.

## Scope (out)
- Does not flip any Cat B hook to block mode.
- Does not ship the remaining 11 Cat B verifier hooks.
- Does not run live `agentbrew sync` against user-level hook config.
- Does not decommission advisory rules from shared rules; Phase 3 handles that after observation.

## Implementation steps
1. Extend the hook fixture runner to include `hooks/verifiers/*.test.sh` when the directory exists.
2. Add `pr-body-diff-consistency.sh` that:
   - reads Claude Code hook JSON from stdin,
   - only evaluates Bash `gh pr edit` commands with inline `--body`,
   - collects a bounded local `git diff --stat` / `git diff --name-only` summary,
   - calls `verify_with_claude` with Haiku, 2s timeout, and prompt version 1,
   - emits `verdict_warn` on `BLOCK` and allows on `ALLOW`, timeout, missing `claude`, missing body, or irrelevant command.
3. Add a fixture test that supplies a mock `claude` binary on PATH and covers allow, warn, default-allow, bypass, and env-bypass paths.
4. Add a gated integration test for live Haiku.
5. Add the manifest entry and run the hook fixture suite plus full verify.

## Risks and mitigations
- **Risk**: The verifier blocks legitimate PR edits. **Mitigation**: Start in warn mode and log decisions; block mode waits for the 7-day observation task.
- **Risk**: Shell parsing of `gh pr edit --body` misses complex quoting. **Mitigation**: Support common inline bodies now and bypass `--body-file`; keep parsing bounded and file a follow-up if a parser gap appears.
- **Risk**: LLM latency slows common tool calls. **Mitigation**: Only run on `gh pr edit --body`, cap with `HOOK_VERIFIER_TIMEOUT=2`, and default allow on failure.
- **Risk**: Fixture runner accidentally skips verifier tests. **Mitigation**: Add the verifier fixture to the same runner used by `npm run verify`.

## Acceptance criteria
- `bash scripts/run-hook-fixtures.sh` runs `hooks/verifiers/pr-body-diff-consistency.test.sh`.
- Mocked `ALLOW` exits 0 with no warning.
- Mocked `BLOCK` exits 0 with a warn-mode stderr message.
- Timeout, missing `claude`, missing body, and irrelevant commands default allow.
- Manifest entry uses `tier: verifier`, `verdict: warn`, `model: claude-haiku-4-5`, and `promptVersion: 1`.
- `npm run verify` passes.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-04
- **Concerns**:
  - None — plan is well-structured, appropriately scoped, and consistent with Cat B hook architecture and repo rules.
