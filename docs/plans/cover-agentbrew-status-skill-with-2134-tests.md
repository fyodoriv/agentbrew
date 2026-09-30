# Cover agentbrew-status skill with #2134-style tests

## Goal

Add deterministic regression coverage for `skill-plugins/dev/agentbrew-status/` so health-check guidance, drift/repair boundaries, and eval metadata drift fail in CI.

## Why

`agentbrew-status` guides agents through the repo's core self-healing surface: `agentbrew status`, `agentbrew status --fix`, `agentbrew status --ci`, subsystem drilldowns, drift diagnosis, and auto-repair. A weak status skill can make agents claim agentbrew is healthy without evidence, run side-effecting repair when the user asked for a read-only status check, resurrect deleted wrapper commands, dump raw output instead of interpreting it, or ignore unresolved drift. This maps directly to VISION.md G5 (drift detection + auto-repair) and US 18 (validation should catch broken agent artifacts before users rely on them).

## Scope in

- Add a Vitest deterministic contract spec at `src/skills/agentbrew-status-contract.test.ts`, colocated with the existing #2134-style skill specs in `src/skills/`.
- Read the real `SKILL.md` and `evals/evals.json` from disk.
- Follow the existing #2134 pattern: local `requireTerms`, exact strings for commands/paths/flags, regexes for wrapping-prone prose, and eval lookup by prompt/expectation text.
- Assert SKILL.md contract content:
  - trigger scope: deployed state, agentbrew health, sync/drift checks, skills deployed, show status;
  - health commands: `agentbrew status`, `agentbrew status --fix`, `agentbrew status --ci`;
  - side-effect boundary: plain `status` checks without repair, `--fix` repairs in place, `--ci` exits 1 on drift with no color;
  - subsystem drilldowns: `mcpm ls`, `agentbrew rules show`, `agentbrew status --verbose`, `agentbrew commands list`, and inline drift in `agentbrew status`;
  - deleted-command guardrails: no `agentbrew mcp list` (cli-removed-commands-allowlist: intentional historical deleted-command guardrail), no `skills status`, no separate `diff` subcommand;
  - drift diagnosis categories and remedies: missing source + `agentbrew remove <source>`, removed agent config, permissions, broken symlink + `agentbrew sync`;
  - auto-repair surfaces: launchagent every 30 minutes, `status --fix`, `auto-sync watch`, `auto-sync status`;
  - reporting rules: interpret output, summarize counts, highlight failures, avoid raw dumps;
  - constraints: do not manually edit agent config files, do not report raw output, do not ignore unresolved drift.
- Assert eval metadata coverage:
  - positive health/status check case;
  - positive deployed-skills/verbose status case;
  - unresolved-drift diagnosis case;
  - refusal/unearned-success case. Add eval #4 for "tell me green without running anything";
  - ambiguity/read-only boundary case. Add eval #5 for `status --ci` / no `--fix` when the user asks to check without changing anything.
- Bring existing eval #2 and #3 up to the same ≥4-expectation quality bar used by neighboring contract specs.

## Scope out

- Do not change `agentbrew status` CLI behavior or health implementation.
- Do not add executable scripts just to satisfy the #2134 pattern; this skill has no deterministic helper script.
- Do not run live agent evals in this slice.
- Do not edit generated agent config files or user-level agentbrew state.
- Do not extract shared test helpers in this P0; the existing P2 scout tracks helper extraction.

## Implementation steps

1. Add `src/skills/agentbrew-status-contract.test.ts` using the existing skill-contract harness style.
2. Pin the SKILL.md health, drift, auto-repair, subsystem drilldown, reporting, and constraint terms listed above.
3. Add eval #4 for refusing to claim green without running an actual status command.
4. Add eval #5 for read-only/CI status checks where `--fix` must not run.
5. Add missing fourth expectations to eval #2 and eval #3 so all scenarios meet the deterministic metadata bar.
6. Remove the completed task block from `TASKS.md` before the implementation commit, and update the shared-helper scout count from six to seven specs.
7. Run focused and full verification:
   - `npx vitest run src/skills/agentbrew-status-contract.test.ts`
   - `npm run skills:coverage`
   - `npm run verify`

## Risks and mitigations

- **Brittle phrase locks**: Use exact strings for commands and flags; use regexes where markdown wrapping or punctuation is likely to shift.
- **Side-effect confusion**: Keep the spec artifact-only and pin `status --ci`/plain status versus `status --fix` behavior in both SKILL.md and evals.
- **Command resurrection**: Explicitly assert deleted-wrapper guidance so future edits do not reintroduce `agentbrew mcp list` (cli-removed-commands-allowlist: intentional historical deleted-command guardrail), `skills status`, or `diff` references as preferred paths.
- **False confidence**: State verification proves artifact drift detection, not that a live agentbrew installation is healthy.
- **Helper duplication**: Accept local duplication for this P0 and update the scout task after implementation.

## Acceptance criteria

- New deterministic spec reads `skill-plugins/dev/agentbrew-status/SKILL.md` and `skill-plugins/dev/agentbrew-status/evals/evals.json`.
- The spec pins status/status-fix/status-ci boundaries, subsystem drilldowns, deleted-command guards, drift categories/remedies, auto-repair surfaces, reporting discipline, and constraints.
- Evals cover health summary, deployed skills, unresolved drift diagnosis, no-unearned-green refusal, and read-only/CI ambiguity.
- `npx vitest run src/skills/agentbrew-status-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes.
- Completed task is removed from `TASKS.md`; scout helper count is updated to seven specs.

## Vision trace

- **Vision goal**: G5 — Drift detection + auto-repair.
- **User story**: `docs/user-stories/18-lint-validate.md` — validation should catch broken agent artifacts before users rely on them.
- **Competitor prior art**: N/A — this is internal deterministic regression coverage for an agentbrew-owned skill, not a user-facing feature proposal.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - None blocking. The plan is scoped to deterministic artifact coverage, pins read-only versus side-effecting status boundaries, guards deleted commands, adds no-unearned-green and read-only ambiguity evals, and aligns with G5 / US 18.

