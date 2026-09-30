# Plan: agent-artifact-inventory-static-gate

## Goal

Create a deterministic inventory and static lint gate for agent-facing artifacts owned by agentbrew: commands, instruction templates, rules, subagent definitions, hooks, MCP declarations, skill references, and source declarations.

## Why

Agent-facing artifacts are production behavior. They can change safety policy, drift repair, publishing rules, and cross-agent behavior without touching compiled TypeScript. The repo already enforces some narrow cases, such as built-in skill eval coverage and skill PR eval hooks, but it lacks one shared inventory of every artifact surface that future guards can reuse.

This belongs in agentbrew because it is multi-surface glue across commands, hooks, instructions, MCP, rules, skills, and agents. No upstream tool owns that combined source-of-truth contract.

## Scope (in)

- Create `src/agent-artifacts/inventory.ts`.
- Create `src/agent-artifacts/inventory.test.ts`.
- Create `src/agent-artifacts/lint.test.ts`.
- Reuse existing parsing/loading patterns:
  - `js-yaml` for YAML files.
  - `parseAgentfile` from `src/agentfile.ts`.
  - `loadCatalog` from `src/catalog/types.ts`.
  - `validateFrontmatter` from `src/skills/validate.ts` for SKILL.md frontmatter checks.
  - `loadAgentDefinitions` from `src/core/agents.ts` for agent target metadata.
- Inventory repo-owned sources:
  - `Agentfile.yaml`
  - `templates/AGENTS.md`
  - `src/catalog.yaml`
  - `src/core/agents.yaml`
  - `hooks/manifest.yaml`
  - `hooks/checks/*`
  - `skill-plugins/dev/*/SKILL.md`
  - command markdown under configured repo-local command source dirs when present.
- Return `{ kind, name, sourcePath, targetAgents, risk, coverage }` records.
- Add static lint diagnostics for:
  - duplicate names within a kind
  - unreadable or unparsable source files
  - prompt-like artifacts missing required frontmatter or activation metadata
  - generated output directories accidentally treated as source
  - high-risk artifacts without deterministic test, behavioral eval, or exemption metadata
  - obvious safety-policy contradictions in `templates/AGENTS.md`
- Document the inventory contract in `README.md` and `ARCHITECTURE.md`.

## Scope (out)

- Does not implement Promptfoo evals; that is `agent-command-behavioral-evals-promptfoo`.
- Does not add real-e2e sync/render scenarios; that is `agent-artifact-sync-render-e2e`.
- Does not add the PR guard hook; that is `agent-artifact-pr-test-guard`.
- Does not inspect generated files under `~/.claude`, `~/.cursor`, `~/.config/devin`, or other agent output directories.
- Does not add new runtime CLI commands unless implementation shows an existing test runner cannot consume the inventory directly.

## Implementation steps

1. Add inventory types and pure helpers in `src/agent-artifacts/inventory.ts`:
   - `AgentArtifactKind`
   - `AgentArtifactRisk`
   - `AgentArtifactCoverage`
   - `AgentArtifact`
   - `AgentArtifactDiagnostic`
   - `collectAgentArtifacts(options)`
   - `lintAgentArtifacts(artifacts)`

2. Implement source collectors:
   - `collectAgentfileArtifacts` parses `Agentfile.yaml` and emits MCP, skill, source, command-source, agent-source, rules, and hook records.
   - `collectCatalogArtifacts` uses `loadCatalog` and emits catalog MCP, skill, rule, and CLI command records.
   - `collectTemplateArtifacts` emits `templates/AGENTS.md` as a high-risk instruction artifact.
   - `collectAgentsYamlArtifacts` parses `src/core/agents.yaml` and emits an agent-definition-catalog artifact.
   - `collectHookArtifacts` parses `hooks/manifest.yaml` and emits hook records linked to check scripts.
   - `collectBuiltInSkillArtifacts` scans `skill-plugins/dev/*/SKILL.md` and validates frontmatter with existing skill validation.

3. Add coverage inference:
   - deterministic tests are files matching the artifact name or surface under `src/**`, `hooks/checks/**`, or `scripts/**`
   - behavioral evals are `evals/evals.json`, `agent-artifact-evals/**`, or artifact-local eval files
   - explicit exemption markers are `agentbrew-artifact-exemption:` lines in the artifact source or catalog description/rationale text

4. Add risk classification:
   - high: instruction templates, hooks, MCP declarations with env/url/smoke/heal behavior, commands, built-in skills, task/backend config
   - medium: agent definitions, rules, source declarations
   - low: descriptive catalog metadata without executable or prompt behavior

5. Add lint diagnostics:
   - duplicate `{kind, name}`
   - missing required name
   - missing description/activation metadata for prompt-like artifacts
   - generated output path under source discovery
   - high-risk artifact with no coverage or exemption
   - `templates/AGENTS.md` missing publish-approval wording or saying generated agent files should be edited directly

6. Add tests in `src/agent-artifacts/inventory.test.ts`:
   - inventory lists all required kinds against the real repo fixture
   - paths are repo-relative and do not include generated home output paths
   - known sources such as `templates/AGENTS.md`, `hooks/manifest.yaml`, `Agentfile.yaml`, `src/catalog.yaml`, and built-in skills appear
   - target agents are populated from existing target metadata where possible

7. Add tests in `src/agent-artifacts/lint.test.ts`:
   - duplicate command/subagent names fail
   - broken YAML/frontmatter yields one path-specific diagnostic
   - prompt-like artifact without metadata fails
   - high-risk artifact without coverage or exemption fails
   - safety-policy contradiction in `templates/AGENTS.md` fails

8. Update docs:
   - `README.md`: add a short testing section explaining `npm test src/agent-artifacts`.
   - `ARCHITECTURE.md`: add the inventory as a static analysis layer over sync/catalog sources.

9. Scout while working:
   - add at least one follow-up TASKS.md item if the implementation reveals a missing test, stale docs, or duplicated logic outside this task's scope.

10. Complete:
   - run `npm test src/agent-artifacts`
   - run `npm run typecheck`
   - run `npm run lint`
   - run `npm run verify` before every commit required by repo policy
   - remove the completed task block from `TASKS.md`

## Risks and mitigations

- **Risk**: Coverage inference is noisy because artifacts do not declare coverage metadata today. **Mitigation**: keep inference deterministic, allow explicit exemption markers, and document the sidecar/metadata pivot already named in the task.
- **Risk**: Inventory becomes another bespoke framework. **Mitigation**: use it as a thin adapter over existing repo loaders and validators, with no CLI surface in the first PR.
- **Risk**: False duplicate reports across catalog entries and Agentfile references. **Mitigation**: scope duplicates to `{kind, name, sourceGroup}` where references and definitions are different groups.
- **Risk**: Full current repo has high-risk artifacts without existing coverage and would fail immediately. **Mitigation**: make the lint test assert known currently-covered high-risk fixtures and return diagnostics programmatically; do not wire it into `npm run verify` as a blocking repo-wide gate until the later PR-guard task.
- **Risk**: The implementation adds source lines despite the delete-before-add goal. **Mitigation**: keep the module small, reuse existing helpers, and avoid introducing a CLI or custom parser.

## Acceptance criteria

- `npm test src/agent-artifacts` passes.
- Inventory includes commands, built-in skills, instruction templates, rules, subagent definitions/source declarations, hooks, MCP declarations, and skill references owned by the repo.
- Duplicate command/subagent names fail with path-specific diagnostics.
- Prompt-like artifacts missing required frontmatter or activation metadata fail with path-specific diagnostics.
- High-risk artifacts must expose deterministic tests, behavioral evals, or an explicit exemption reason in the lint API/tests.
- Generated output paths under agent home/config directories are not treated as source artifacts.
- `README.md` and `ARCHITECTURE.md` describe the inventory contract.
- `TASKS.md` removes the completed `agent-artifact-inventory-static-gate` block and includes at least one scouted follow-up task from touched files.

## Vision trace

- **Vision goal**: VISION.md G4 "42+ agents from a single source of truth"; G6 "Full automatic parity across primary agents"; G5 "Drift detection + auto-repair".
- **User story**: `docs/user-stories/06-drift-detection.md`; `docs/user-stories/20-agent-definitions.md`.
- **Competitor prior art**: N/A — this is internal multi-surface regression coverage; competitor comparison is represented by the delegate/contribute/absorb strategy in VISION.md and no competitor owns the combined artifact contract.

## Reviewer verdict

- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-09
- **Concerns**:
  - None
