# Cover agentfile-init skill with #2134-style tests

## Goal

Add deterministic regression coverage for `skill-plugins/dev/agentfile-init/` so Agentfile creation guidance, stack detection, catalog-selection boundaries, dry-run verification, and eval metadata drift fail in CI.

## Why

`agentfile-init` writes the project-local `Agentfile.yaml`, which is the source of truth for agentbrew project configuration. Weak guidance can overwrite an existing Agentfile, over-provision MCP servers, skip AGENTS.md/project-context checks, run `agentbrew sync` before a dry-run preview, or create boilerplate agent guides that do not reflect the repo. This maps to VISION.md G3 (one sync command), G4 (single source of truth for agent config), and US 16 (Agentfile project config).

## Scope in

- Add a Vitest deterministic contract spec at `src/skills/agentfile-init-contract.test.ts`, following the established #2134-style skill specs in `src/skills/`.
- Read the real `skill-plugins/dev/agentfile-init/SKILL.md` and `evals/evals.json` from disk.
- Assert SKILL.md contract content:
  - trigger scope: create an Agentfile for a project, set up agentbrew, and do not handle single-MCP additions;
  - existing Agentfile guard: check for `Agentfile.yaml`, `Agentfile.yml`, and `Agentfile`, then read/update rather than overwrite;
  - stack detection inputs and outputs: root manifest files, CI files, TASKS.md, language/framework, CI, database, error tracking, task management, AGENTS.md;
  - catalog selection: `context7` always first, `tasks-mcp` only with TASKS.md, `github`, `postgres`, `sentry`, `splunk`, `jenkins`, `notion`, `brave-search`, and `playwright` only when justified;
  - Agentfile structure/rules: catalog shorthand strings, no over-provisioning, comments for non-obvious choices, `context7` first;
  - sync boundary: `agentbrew sync --dry-run` before reviewing output, with real `agentbrew sync` only after the preview is accepted;
  - agent-guide lifecycle: update existing `AGENTS.md`; create one from `docs/agent-guide-baseline.md` only for agent-tool projects that lack a guide; do not copy boilerplate verbatim;
  - reference examples: minimal, Node web app, Python/Postgres, and enterprise patterns.
- Assert eval metadata coverage:
  - existing Node/TASKS/GitHub Actions positive case;
  - existing-Agentfile Python/Postgres non-destructive update case;
  - enterprise/Jenkins/Splunk/no-AGENTS case;
  - over-provisioning refusal case;
  - immediate-sync/no-dry-run ambiguity case.

## Scope out

- Do not change `agentfile-init` runtime behavior; this skill has no helper script.
- Do not create or modify an actual `Agentfile.yaml` for this repo.
- Do not run live agent evals in this slice.
- Do not extract shared test helpers; the existing P2 scout tracks that.
- Do not edit generated agent config files or user-level agentbrew state.

## Implementation steps

1. Add `src/skills/agentfile-init-contract.test.ts` using the local helper pattern from neighboring contract specs.
2. Pin the SKILL.md trigger, existing-file guard, stack detection, catalog-selection, Agentfile structure, sync, AGENTS.md lifecycle, and example terms listed above.
3. Add eval #4 for refusing/avoiding over-provisioning when asked to add every MCP server.
4. Add eval #5 for refusing to run real `agentbrew sync` before `agentbrew sync --dry-run` review.
5. Remove the completed task block from `TASKS.md` before the implementation commit, and update the shared-helper scout task to say the skill-spec count is eight.
6. Run focused and full verification:
   - `npx vitest run src/skills/agentfile-init-contract.test.ts`
   - `npm run skills:coverage`
   - `npm run verify`

## Risks and mitigations

- **Brittle phrase locks**: Use exact strings for commands and YAML snippets; use regexes for wrapping-prone prose.
- **Over-provisioning drift**: Pin both the positive stack-to-MCP table and refusal/ambiguity evals so catalog recommendations stay justified.
- **Side-effect confusion**: Pin `sync --dry-run` before real sync in SKILL.md and evals.
- **Agent-guide boilerplate**: Pin the baseline-link/repo-specific-facts guidance rather than encouraging copy-paste.
- **Helper duplication**: Accept local duplication for this P0 and update the helper-extraction scout.

## Acceptance criteria

- New deterministic spec reads `skill-plugins/dev/agentfile-init/SKILL.md` and `skill-plugins/dev/agentfile-init/evals/evals.json`.
- The spec pins trigger scope, existing-file safeguards, stack detection, catalog selection, Agentfile structure, dry-run/sync boundaries, AGENTS.md lifecycle guidance, and examples.
- Evals cover Node setup, existing Python/Postgres update, enterprise/no-AGENTS setup, over-provisioning refusal, and no-dry-run ambiguity.
- `npx vitest run src/skills/agentfile-init-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes.
- Completed task is removed from `TASKS.md`; the shared-helper scout task records eight skill specs.

## Vision trace

- **Vision goal**: G3 — One sync command does everything; G4 — single source of truth for agent configuration.
- **User story**: `docs/user-stories/16-agentfile-project-config.md` / US 16 — Agentfile project config.
- **Competitor prior art**: N/A — internal deterministic regression coverage for an agentbrew-owned project setup skill.
