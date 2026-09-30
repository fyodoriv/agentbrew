# Cover agentbrew-add-mcp skill with #2134-style tests

## Goal

Add deterministic regression coverage for `skill-plugins/dev/agentbrew-add-mcp/` so MCP routing, registration, sync, and safety-boundary drift fails in CI.

## Why

The skill teaches agents how to add MCP servers to agentbrew. Incorrect guidance can leak internal MCPs into the OSS catalog, encourage generated config edits, hardcode secrets, skip server validation, or leave team-shared git installs unpinned. A #2134-style contract spec should catch accidental weakening of:

- OSS catalog vs team overlay layer routing;
- catalog-first install flow and local inline-install footgun warning;
- manual and git MCP registration commands;
- sync and verification through agentbrew plus delegated `mcpm` state;
- generated per-agent MCP config boundaries;
- secret/API-key handling through environment variables;
- server testing before shared use;
- `--ref` reproducibility for git-installed team setups;
- eval coverage for public install, internal-overlay refusal, git exploration/promotion, and secret refusal.

## Scope in

- Add a Vitest deterministic contract spec for `agentbrew-add-mcp`.
- Read the real `SKILL.md` and `evals/evals.json` from disk.
- Assert required SKILL.md contract content:
  - the Step 0 litmus test for OSS-portable vs team-overlay entries;
  - public MCP examples and internal MCP examples stay in the correct layers;
  - organization-specific entries are not added to `agentbrew/src/catalog.yaml` or `dotfiles/Agentfile.yaml`;
  - catalog install flow uses `agentbrew install <name>`, `agentbrew install --recommended`, and `agentbrew catalog --mcp`;
  - inline `agentbrew install --command ... --args ... --env ...` is called out as a throwaway exploration footgun and must be promoted to a catalog entry for team use;
  - manual and git add flows use `agentbrew mcp add`, `--git`, optional `--ref`, and `agentbrew mcp update`;
  - sync/verify uses `agentbrew sync`, `mcpm ls`, native carve-outs, and mcpm-managed client descriptions;
  - removal uses top-level `agentbrew remove <name>` and notes delegated `mcpm uninstall` cleanup;
  - constraints prohibit editing generated agent config files directly, hardcoding secrets, skipping server tests, and omitting `--ref` for team git installs.
- Assert eval metadata coverage:
  - public catalog install positive path;
  - internal-only MCP kept in team overlay / refused from OSS catalog;
  - git-source exploration with test/probe, `--ref`, and catalog promotion;
  - secret/API-key refusal path; add a fourth eval if the current set lacks explicit coverage.

## Scope out

- Do not change MCP sync implementation code.
- Do not add an executable script just to satisfy the pattern.
- Do not run live agent evals as part of this deterministic slice.
- Do not extract shared #2134 helper utilities in this P0; the existing P2 scout tracks helper extraction.
- Do not touch unrelated skills.

## Implementation steps

1. Add `src/skills/agentbrew-add-mcp-contract.test.ts` beside the existing skill contract specs.
2. Write deterministic tests against `SKILL.md` and `evals/evals.json` with grouped, actionable assertions.
3. Run the focused spec. If it exposes a real eval coverage gap for secret/API-key refusal, add the smallest fourth eval scenario.
4. Avoid SKILL.md prose edits unless the current skill lacks a safety-critical contract term.
5. Run:
   - `npx vitest run src/skills/agentbrew-add-mcp-contract.test.ts`
   - `npm run skills:coverage`
   - `npm run verify`
6. Remove the completed task block from `TASKS.md` before the implementation commit and update the shared-helper scout count if another local helper copy exists.

## Risks and mitigations

- **Brittle phrase locks**: Use exact strings for commands, paths, and flags; use regexes for wrapping-prone prose.
- **Over-scoping into MCP implementation**: Keep this slice artifact-contract only.
- **False confidence**: State that the spec proves skill/eval drift detection, not live MCP connectivity.
- **Duplicate helpers**: Accept local duplication for this P0; update the existing scout task instead of extracting now.

## Acceptance criteria

- A new deterministic spec reads `SKILL.md` and `evals/evals.json`.
- The spec pins layer routing, catalog-first flow, inline footgun warning, manual/git add flows, sync/verify, removal, generated-config boundaries, secret handling, test-before-add, and git `--ref` reproducibility.
- Evals cover public install, internal-overlay refusal, git exploration/promotion, and secret/API-key refusal; if the existing three evals do not cover secret refusal, add a fourth eval and require the deterministic spec to find it.
- `npx vitest run src/skills/agentbrew-add-mcp-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes.
- Completed task is removed from `TASKS.md`.

## Vision trace

- **Vision goal**: G5 — Drift detection + auto-repair. This adds CI-visible drift detection for an agent-facing MCP workflow artifact.
- **User story**: `docs/user-stories/18-lint-validate.md` and `docs/user-stories/27-team-overlay.md`; validation should catch broken agent artifacts and team-overlay routing mistakes before users rely on them.
- **Competitor prior art**: N/A — this is internal deterministic regression coverage for an agentbrew-owned skill, not a user-facing feature proposal.

## Reviewer verdict

- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - None blocking. Implementation should verify whether the current three evals cover secret/API-key refusal; if not, add a fourth eval before marking complete.
