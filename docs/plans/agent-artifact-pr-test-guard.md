# Plan: agent-artifact-pr-test-guard

## Goal

Generalize the existing PR-time skill eval hook into a deterministic guard that blocks high-impact agent artifact PRs unless the same PR carries tests, evals, or an explicit exemption reason.

## Why

Agent-facing artifacts change runtime behavior even when no TypeScript code changes. Commands, hooks, instruction templates, MCP declarations, agent definitions, and Agentfile entries can alter safety policy, browser behavior, publication rules, and drift repair. The repo already has a narrow `gh-pr-skill-requires-evals` hook for new skills; this task extends that protection to the rest of the artifact inventory.

This belongs in agentbrew because the artifact surfaces are multi-agent/multi-surface glue. No upstream tool owns the combined contract across agentbrew commands, hooks, templates, MCP, rules, skills, sources, and Agentfile.

## Scope (in)

- Create `hooks/checks/gh-pr-agent-artifacts-require-tests.sh`.
- Create `hooks/checks/gh-pr-agent-artifacts-require-tests.test.sh`.
- Register the hook in `hooks/manifest.yaml` after the existing PR-body / skill-eval hooks.
- Reuse `src/agent-artifacts/inventory.ts` as the classifier source instead of reimplementing artifact classification in shell.
- Reuse existing hook libraries in `hooks/lib/` for stdin JSON and verdict output.
- Add an emergency bypass env var with an actionable warning that tells the user to file a follow-up task.
- Update `docs/hook-protocol.md` and `README.md` with the guard's contract.
- Remove the completed task block from `TASKS.md` when shipped.

## Scope (out)

- Does not build behavioral eval infrastructure; `agent-command-behavioral-evals-promptfoo` owns that.
- Does not make every current artifact globally fail lint; the hook evaluates changed paths in a PR diff.
- Does not publish or comment on external PRs.
- Does not replace `gh-pr-skill-requires-evals`; this hook complements it for non-skill artifacts and broader coverage evidence.
- Does not add a new visible CLI command.

## Implementation steps

1. Inspect `gh-pr-skill-requires-evals.sh`, `hooks/lib/*`, `hooks/manifest.yaml`, and `src/agent-artifacts/inventory.ts` for reusable primitives.
2. Add a tiny Node helper or inline `node --input-type=module` call from the shell hook that imports the inventory module and emits JSON for changed artifact paths. Keep shell logic focused on hook input, git diff, and verdicts.
3. Implement diff detection for `gh pr create` / `gh pr edit`:
   - resolve base ref like the existing skill hook
   - inspect `git diff --name-status "$BASE_REF"...HEAD`
   - ignore docs-only unrelated changes
   - classify changed high-risk artifacts by matching diff paths against inventory records and the task's explicit path list
4. Implement evidence detection:
   - deterministic tests: changed files under relevant `*.test.*`, hook `.test.sh`, `scripts/*test*`, or inventory-declared coverage files
   - behavioral evals: changed `evals/evals.json`, `agent-artifact-evals/**`, or artifact-local eval files
   - exemption marker: PR body contains a structured `Agent artifact test exemption:` line with a non-empty reason
5. Implement verdicts:
   - bypass non-Bash tools and non-`gh pr create/edit` commands
   - allow changed artifacts with same-PR tests/evals
   - allow docs-only unrelated PRs
   - warn/allow explicit exemptions with reason
   - block missing evidence with a concise message listing artifact paths and accepted remedies
   - bypass when `HOOK_BYPASS_GH_PR_AGENT_ARTIFACTS_REQUIRE_TESTS=1`, with the message telling the user to file a P0 follow-up task
6. Add shell fixture tests covering:
   - changed command without test blocks
   - changed command with eval passes
   - changed `templates/AGENTS.md` with sync/render test passes
   - changed hook without fixture blocks
   - changed MCP/Agentfile entry with static test passes
   - docs-only unrelated PR bypasses
   - explicit exemption warns/allows with reason
   - bypass env var allows with follow-up wording
7. Register the hook in `hooks/manifest.yaml` with explicit `agents: ["claude-code", "cursor"]`.
8. Update docs:
   - `docs/hook-protocol.md`: note the broader agent-artifact PR evidence gate
   - `README.md`: add the test command / expectation under the existing testing or hooks section
9. Scout while working and add at least one follow-up task if a missing test, duplicated hook parser, or stale docs issue appears.
10. Verify:
   - `bash hooks/checks/gh-pr-agent-artifacts-require-tests.test.sh`
   - `bash scripts/run-hook-fixtures.sh`
   - `npx vitest run src/agent-artifacts`
   - `npm run verify`

## Risks and mitigations

- **Risk**: Shell path classification grows into a second artifact inventory. **Mitigation**: call/reuse `src/agent-artifacts/inventory.ts` and keep shell classification as a diff adapter only.
- **Risk**: False positives block legitimate PRs. **Mitigation**: support explicit exemption marker and emergency bypass env var, with warnings that create follow-up work instead of silent bypass.
- **Risk**: Hook runtime exceeds the deterministic-hook budget. **Mitigation**: operate on changed paths only, avoid network calls, and keep the Node helper pure/local.
- **Risk**: Inventory path coverage is incomplete for some artifact types. **Mitigation**: fixtures pin the task's explicit path list and add scout tasks for any remaining gaps.
- **Risk**: Overlap with `gh-pr-skill-requires-evals` creates duplicate messages. **Mitigation**: keep the existing skill hook stricter for new skills; this hook can either bypass new-skill SKILL.md paths or accept the same eval evidence without duplicating the skill-specific requirements.

## Acceptance criteria

- Shell fixture tests cover changed command without test (block), changed command with eval (pass), changed AGENTS template with sync/render test (pass), changed hook without fixture (block), changed MCP/Agentfile entry with static test (pass), docs-only unrelated PR (bypass), and explicit exemption marker (warn/pass with reason).
- Hook is registered after the existing PR-body / skill hooks.
- Emergency bypass env var allows the PR action and tells the user to file a follow-up task.
- Missing-evidence block message lists the changed artifact paths and the accepted remedies.
- `bash hooks/checks/gh-pr-agent-artifacts-require-tests.test.sh` passes.
- `bash scripts/run-hook-fixtures.sh` passes.
- `npm run verify` passes before commit.
- Completed task block is removed from `TASKS.md`.

## Vision trace

- **Vision goal**: VISION.md G5 "Drift detection + auto-repair"; G6 "Full automatic parity across primary agents".
- **User story**: `docs/user-stories/06-drift-detection.md` — drift checks cover skills, commands, instructions, and other sync surfaces; hooks enforce guardrails before bad changes land.
- **Competitor prior art**: N/A — this is internal multi-surface regression coverage for agentbrew-owned artifacts; no competitor owns the combined artifact contract.

## Reviewer verdict

- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - Non-blocking implementation clarifications: use one exemption marker format consistently, and decide whether the broad artifact hook bypasses new-skill paths already covered by `gh-pr-skill-requires-evals` or accepts the same eval evidence.
