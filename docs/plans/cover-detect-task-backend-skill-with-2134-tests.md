# Plan: Cover detect-task-backend skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for `detect-task-backend` so regressions in task-backend detection, fallback order, descriptor branching, validation/error handling, and generated-backend write safety fail before task-aware skills append to the wrong place.

The contract spec will read the real `skill-plugins/dev/detect-task-backend/SKILL.md`, `evals/evals.json`, `docs/task-backend-contract.md`, and `src/core/task-backend.ts`. It will also fix existing eval drift: current eval 4 references obsolete `.tasksmd.json`, while the real contract uses `Agentfile.yaml` first and `.agents/tasks.config.yaml` as the fallback; current eval 5 implies live GitHub/project access, while `resolveTaskBackend` validates config and returns a descriptor without doing network I/O.

## Why

This skill is a reference consumer for every task-aware skill. Its dangerous failure mode is subtle: an agent guesses the backend by checking for `TASKS.md`, appends tasks to a repo that declared `github-issues`, or treats malformed GitHub Issues config as a default file queue. Deterministic tests should pin the shared resolver contract and keep the skill/evals aligned with the actual implementation so downstream skills can branch safely.

## Scope (in)

- Add `src/skills/detect-task-backend-contract.test.ts` using the established #2134 local helper pattern.
- Read real files:
  - `skill-plugins/dev/detect-task-backend/SKILL.md`;
  - `skill-plugins/dev/detect-task-backend/evals/evals.json`;
  - `docs/task-backend-contract.md`;
  - `src/core/task-backend.ts`.
- Pin frontmatter name and description.
- Pin SKILL.md purpose: reference consumer for the task backend contract, not an ad hoc file-probing recipe.
- Pin use case: skills need to know whether a repo uses `TASKS.md` or GitHub Issues before filing/listing/picking tasks.
- Pin implementation pattern:
  - import `resolveTaskBackend` from `agentbrew/src/core/task-backend`;
  - call `resolveTaskBackend(repoPath)`;
  - branch on `descriptor.backend === "github-issues"`;
  - carry `repo` and `project` metadata to GitHub issue helpers;
  - default/else path reads/writes `TASKS.md`.
- Pin configuration and docs/code alignment:
  - preferred config is `Agentfile.yaml`;
  - `task_backend: github-issues`, `repo: owner/repo`, `project: 123`;
  - default backend is `tasks-md` when no config exists;
  - resolver fallback is `.agents/tasks.config.yaml`, not `.tasksmd.json`;
  - valid backends are exactly `tasks-md` and `github-issues`.
- Pin implementation details from `src/core/task-backend.ts`:
  - exported `TaskBackend` union and `TaskBackendDescriptor` interface;
  - optional `repo`/`project` only for GitHub Issues;
  - `processConfig` returns default when `task_backend` is undefined;
  - GitHub Issues requires both validated `repo` and `project`;
  - Agentfile raw YAML is read to avoid hiding malformed config;
  - parse failures warn and fall through to fallback/default as implemented;
  - final fallback returns `{ backend: DEFAULT_BACKEND }`.
- Pin docs contract:
  - Overview and Resolution Logic priority Agentfile → `.agents/tasks.config.yaml` → default;
  - validation rules and actionable errors;
  - Hexagonal Architecture / port-adapter framing.
- Preserve evals 1-3 and 6 exact prompts/core expectations.
- Update stale eval 4 to remove `.tasksmd.json` and assert Agentfile → `.agents/tasks.config.yaml` → default resolution plus descriptor instructions.
- Update stale eval 5 to validate GitHub Issues config shape and report “access checks happen in issue helpers/tools,” not pretend `resolveTaskBackend` performs live repository/project access.
- Add eval 7 for wrong-backend write pressure: a repo with `task_backend: github-issues` and a lingering `TASKS.md` must not receive appended tasks; generated backend tools should be used instead.
- Add eval 8 for malformed-config/default pressure: invalid `task_backend`, missing `repo`, malformed `repo`, and non-positive/non-integer `project` should be surfaced as config errors rather than silently defaulting to `TASKS.md`; no config should default to `tasks-md`.
- Remove the completed task from TASKS.md at ship time and update scout tasks from twenty-five to twenty-six specs with a detect-task-backend pressure example.

## Scope (out)

- No runtime changes to `src/core/task-backend.ts` unless the deterministic spec exposes an implementation/doc contradiction that must be resolved.
- No live GitHub API calls or project access checks in tests; this skill detects local configuration and returns a descriptor.
- No script-level tests under the skill; `skill-plugins/dev/detect-task-backend/` contains only `SKILL.md` and `evals/evals.json`.
- No new dependencies.
- No shared helper extraction; the existing P2 scout task remains the tracking item.

## Concrete eval updates/additions

### Eval 4 — update stale detection priority

Replace `.tasksmd.json` expectations with the current contract:

```json
{
  "id": 4,
  "prompt": "I'm working in a repo and need to know whether to file tasks in TASKS.md or GitHub Issues. Detect the task backend for me.",
  "expected_output": "A clear identification of the repo's task backend (TASKS.md or GitHub Issues) by using resolveTaskBackend(repoPath), with configuration details and instructions for filing tasks in the correct backend.",
  "expectations": [
    "Checks Agentfile.yaml/Agentfile.yml/Agentfile first for task_backend, repo, and project fields",
    "Falls back to .agents/tasks.config.yaml when no Agentfile is present",
    "Falls back to default tasks-md when neither config file declares a backend",
    "Returns a TaskBackendDescriptor with backend type ('tasks-md' or 'github-issues') and relevant GitHub Issues config (repo, project)",
    "Provides clear instructions on how to file tasks in the detected backend (e.g., issue APIs/tasks CLI for GitHub Issues, append to TASKS.md for default)"
  ]
}
```

### Eval 5 — update live-access expectation

Replace “attempts to access GitHub repository/project” with local validation and handoff:

```json
{
  "id": 5,
  "prompt": "Our team just switched from TASKS.md to GitHub Issues for task tracking. Verify that the configuration is correct.",
  "expected_output": "Confirmation that the local task-backend configuration is valid for GitHub Issues, with actionable errors for missing or malformed repo/project fields and guidance for issue-tool access checks.",
  "expectations": [
    "Reads Agentfile.yaml or .agents/tasks.config.yaml and confirms task_backend is set to 'github-issues'",
    "Validates that repo and project fields are present and correctly formatted (owner/repo and positive integer project ID)",
    "Reports configuration errors for missing fields, invalid backend values, malformed repo strings, or invalid project numbers",
    "Does not silently fall back to TASKS.md when github-issues config is malformed",
    "Explains that live repository/project accessibility is checked by the GitHub Issues helper or tasks CLI after the descriptor is valid",
    "Suggests updating scripts or CI that reference TASKS.md directly to branch on resolveTaskBackend instead"
  ]
}
```

### Eval 7 — generated-backend write safety

```json
{
  "id": 7,
  "prompt": "Agentfile.yaml says task_backend: github-issues, but this repo still has an old TASKS.md. I need to file a new follow-up. Can I just append to TASKS.md because it's already there?",
  "expected_output": "A generated-backend safety answer that treats the resolver descriptor as authoritative and refuses to append to stale TASKS.md when github-issues is configured.",
  "expectations": [
    "Calls resolveTaskBackend(repoPath) and treats the returned descriptor as the source of truth over the mere presence of TASKS.md",
    "Refuses to append a new task to TASKS.md when descriptor.backend is 'github-issues'",
    "Carries descriptor.repo and descriptor.project into the GitHub Issues helper or tasks CLI path",
    "Mentions stale TASKS.md may exist as history or migration residue and is not evidence of the active backend",
    "Falls back to TASKS.md only when the descriptor backend is tasks-md"
  ]
}
```

### Eval 8 — malformed config and default boundary

```json
{
  "id": 8,
  "prompt": "A repo has task_backend: github-issues but no project number, and another repo has no Agentfile or .agents/tasks.config.yaml at all. Should both just default to TASKS.md?",
  "expected_output": "A boundary answer that distinguishes malformed explicit GitHub Issues config from absent config: malformed explicit config is an actionable error, absent config defaults to tasks-md.",
  "expectations": [
    "Reports missing project/repo for explicit github-issues config as an actionable configuration error",
    "Does not silently default malformed github-issues config to TASKS.md",
    "Validates task_backend must be exactly 'tasks-md' or 'github-issues'",
    "Validates repo must be owner/repo and project must be a positive integer",
    "Defaults to tasks-md only when no Agentfile or .agents/tasks.config.yaml declares a backend"
  ]
}
```

## Deterministic assertion map

### SKILL.md contract

Pin:

- `name: detect-task-backend`
- Description references detecting `TASKS.md` vs GitHub Issues using the agentbrew task backend contract
- “Detect Task Backend” heading
- `resolveTaskBackend(repoPath)` reference consumer framing
- “When to use” branch behavior for filing/listing/picking tasks
- implementation snippet import/call/branch/default path
- GitHub Issues branch carries `repo`/`project`
- `Agentfile.yaml` config example and GitHub Issues fields
- see-also links.

### Docs/code task-backend contract

Pin:

- docs overview, field definitions, resolution priority, validation, API shape, examples, and hexagonal architecture framing
- code union/interface/default constant/processConfig validation behavior
- code reads Agentfile raw YAML and fallback `.agents/tasks.config.yaml`
- no `.tasksmd.json` contract references in this skill/evals.

### Eval metadata and scenarios

Pin:

- `evals.skill_name === "detect-task-backend"`
- length 8 after implementation and unique IDs
- evals 1-3 and 6 exact prompts/core expectations
- updated evals 4-5 align with actual resolver contract
- eval 7 generated-backend write safety
- eval 8 malformed-config vs absent-config boundary
- every eval has non-empty prompt/expected output and at least four expectations/assertions.

## Falsifiability checks

- Red phase fails against the original 6-eval file because evals 7-8 are missing and stale evals 4-5 still mention obsolete `.tasksmd.json` / live access behavior.
- Removing `resolveTaskBackend(repoPath)` from SKILL.md fails the spec.
- Removing the GitHub Issues branch or TASKS.md default branch fails the spec.
- Removing Agentfile config fields fails the spec.
- Removing docs priority Agentfile → `.agents/tasks.config.yaml` → default fails the spec.
- Reintroducing `.tasksmd.json` as a detect-task-backend contract source fails the spec.
- Removing validation for exact backend values, owner/repo repo format, positive integer project, or required repo/project for GitHub Issues fails the spec.
- Silently falling back malformed GitHub Issues config to TASKS.md fails the spec.
- Allowing a stale TASKS.md file to override `github-issues` descriptor fails the spec.
- Adding live GitHub access expectations to the resolver skill fails the spec.

## Scout task updates

- `extract-shared-2134-skill-contract-test-helpers`: update from twenty-five to twenty-six deterministic specs and add `detect-task-backend` after `design-review`.
- `document-2134-pressure-eval-conventions`: add detect-task-backend pressure examples covering generated-backend write safety, stale TASKS.md migration residue, resolver-descriptor authority, malformed explicit config vs absent config, no stale `.tasksmd.json`, and no live GitHub access claims in local config detection.

## Implementation steps

1. Update `skill-plugins/dev/detect-task-backend/SKILL.md` only if needed to align it with `docs/task-backend-contract.md` and `src/core/task-backend.ts` fallback/validation details.
2. Add deterministic spec at `src/skills/detect-task-backend-contract.test.ts`.
3. Red phase: run `npx vitest run src/skills/detect-task-backend-contract.test.ts --reporter=verbose`; expect failure on missing evals 7-8 and stale eval 4/5 expectations.
4. Update evals 4-5 and add evals 7-8 in `skill-plugins/dev/detect-task-backend/evals/evals.json`.
5. Update TASKS bookkeeping: remove completed task and update the two scout tasks.
6. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
7. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **Locking stale eval behavior**: explicitly fix `.tasksmd.json` and live-access drift instead of preserving it.
- **Conflating local detection with issue API health**: pin descriptor validation and hand off live access checks to GitHub Issues helpers/tools.
- **Over-testing implementation internals**: assert stable public contract and validation behavior, not every line of code.
- **Scope creep into resolver refactor**: only change runtime code if contract/docs/tests expose a real contradiction.
- **Helper duplication**: update the existing scout task rather than extracting helpers in this PR.

## Acceptance criteria

- `src/skills/detect-task-backend-contract.test.ts` exists and reads real skill/eval/docs/code files.
- The spec pins SKILL.md frontmatter, purpose, use case, implementation snippet, config example, see-also links, and resolver-descriptor branching.
- The spec pins docs/code contract: Agentfile first, `.agents/tasks.config.yaml` fallback, `tasks-md` default, validation errors, descriptor interface, and no `.tasksmd.json` source.
- Evals 1-3 and 6 are preserved and asserted.
- Evals 4-5 are updated to match the actual resolver contract.
- Evals 7-8 are added with concrete pressure expectations.
- Red phase fails on missing/stale eval coverage and green phase passes after updating evals.
- `npx vitest run src/skills/detect-task-backend-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from twenty-five to twenty-six.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair; this adds deterministic drift detection for the task-backend reference consumer and catches stale task-backend contract drift.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them.
- **Competitor prior art**: `docs/competition.md` tracks Vercel skills CLI / agent-skills as the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing behavior.
