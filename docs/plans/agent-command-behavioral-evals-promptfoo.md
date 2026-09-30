# Pilot Promptfoo behavioral evals for high-risk agent artifacts

## Goal

Add a small, CI-friendly Promptfoo pilot that evaluates high-risk prompt-like artifacts in this repo without using live LLM providers or external secrets.

The first suite should cover at least three artifacts:

1. `templates/AGENTS.md` — the global instruction template and highest-risk policy surface.
2. `src/cli-commands/storybook-screenshot/storybook-screenshot.md` — a high-risk command artifact from the inventory.
3. `src/cli-commands/jenkins-cli/jenkins-status.md` or `jenkins-log.md` — high-risk command artifacts from the inventory.

## Why

Static grep tests prove exact strings exist, but they do not model behavior-level drift such as:

- removing current-repo standing approval boundaries from the global instruction template;
- weakening cross-workspace/publication safety language;
- removing force-push/public-write caution from high-risk workflow artifacts;
- changing a command in a way that keeps sync tests green but loses required user-facing safety cues.

Promptfoo gives the repo a standard eval runner instead of inventing a new LLM-eval framework. The first version stays deterministic: a local provider loads artifact text and returns rule diagnostics, while Promptfoo owns case selection, assertions, filtering, and CI output.

## Scope

### In

- Add Promptfoo as a dev dependency and an `npm run eval:agent-artifacts` script.
- Add `agent-artifact-evals/promptfoo.yaml` with `--no-cache`, `--no-share`, and no remote model provider requirements.
- Add a small local JavaScript provider under `agent-artifact-evals/` that reads repo artifact text or inline fixture text and returns deterministic diagnostics.
- Add case files under `agent-artifact-evals/cases/` for:
  - current `templates/AGENTS.md` expected to pass;
  - at least two current high-risk command artifacts expected to pass;
  - at least one unsafe fixture expected to produce a diagnostic, proving the suite fails if safety language is removed.
- Add tests that validate the Promptfoo config/cases and, if practical, run the deterministic suite or a filtered subset in Vitest.
- Add docs explaining when to use deterministic unit tests, Promptfoo behavioral evals, and explicit exemptions.
- Update agent-artifact inventory coverage so the covered high-risk command/instruction artifacts report the Promptfoo suite as behavioral coverage.
- Remove the completed TASKS.md item and scout a focused follow-up if the pilot reveals a broader reusable eval-manifest abstraction.

### Out

- No live LLM provider calls in CI.
- No `llm-rubric` or agent trajectory tests in the first CI tier.
- No external repo publication or Promptfoo Cloud sharing.
- No broad migration of every skill eval into Promptfoo.
- No replacement of existing Vitest/static checks.

## Reuse / GET-first evidence

- Context7 Promptfoo docs confirm:
  - YAML config can use `providers: [echo]` for deterministic smoke tests;
  - local JavaScript providers can expose `callApi(prompt, options, context)` and return `{ output }`;
  - `tests: file://cases/*.yaml` can compose cases from files;
  - `javascript`, `contains`, and metadata-filter assertions support deterministic CI checks;
  - CLI supports `--filter-pattern`, `--filter-metadata`, `--no-cache`, `--no-share`, and `--no-write`.
- This means the repo should GET Promptfoo's runner and assertion/reporting layer, not build a bespoke eval CLI.

## Implementation steps

1. **Dependency and script**
   - Run `npm install --save-dev promptfoo` so the CLI is pinned in `package-lock.json`.
   - Add:
     ```json
     "eval:agent-artifacts": "promptfoo eval -c agent-artifact-evals/promptfoo.yaml --no-cache --no-share --no-write --no-progress-bar"
     ```
   - Keep this script separate from `npm run verify` at first unless runtime and determinism are acceptable.

2. **Promptfoo config**
   - Create `agent-artifact-evals/promptfoo.yaml`.
   - Use a local provider, e.g. `file://provider.cjs:callApi`, with one prompt such as `{{artifact_path}}`.
   - Load cases via `file://cases/*.yaml`.
   - Add metadata per case (`artifact`, `surface`, `tier`) so users can run:
     ```bash
     npm run eval:agent-artifacts -- --filter-metadata artifact=templates/AGENTS.md
     npm run eval:agent-artifacts -- --filter-pattern jenkins
     ```

3. **Deterministic provider**
   - Implement a tiny CommonJS provider because Promptfoo examples support `file://provider.js:callApi`.
   - Read `context.vars.artifact_path` relative to repo root unless `context.vars.fixture_text` is present.
   - Return a stable text report:
     ```text
     PASS templates/AGENTS.md
     diagnostic_count=0
     ```
     or:
     ```text
     FAIL unsafe-publication-fixture
     diagnostic publish-approval missing explicit approval language
     ```
   - Keep the rule set small and artifact-specific:
     - AGENTS template must preserve current-repo autonomy, standing approvals, cross-workspace publishing, public impersonation ban, destructive-operation confirmation, and force/history rewrite guardrails.
     - Command artifacts must preserve executable command shape, safety/permission cues relevant to the command, and no unearned success/completion claims.

4. **Cases**
   - Current AGENTS template: assert `diagnostic_count=0`.
   - Current Storybook screenshot command: assert `diagnostic_count=0`.
   - Current Jenkins command: assert `diagnostic_count=0`.
   - Unsafe fixture: inline or file fixture missing publication/force-push approval language; assert the expected diagnostic appears.

5. **Tests**
   - Add a Vitest spec for the provider helper/rule output using current artifacts and the unsafe fixture.
   - Add a config smoke test that executes:
     ```bash
     npm run eval:agent-artifacts -- --filter-metadata tier=deterministic
     ```
     if the installed Promptfoo runtime is fast and stable enough.
   - If Promptfoo runtime is too slow for full `npm run verify`, keep the npm script out of `verify` and add a documented explicit command plus lightweight Vitest tests for config/case validity.

6. **Coverage inventory integration**
   - Extend `behavioralCoverage()` in `src/agent-artifacts/inventory.ts` so the Promptfoo config is listed for the artifacts it covers.
   - Add/adjust `src/agent-artifacts/inventory.test.ts` expectations so the covered high-risk command/instruction artifacts report behavioral eval coverage.

7. **Docs and task cleanup**
   - Add `docs/testing-agent-artifacts.md` or a README section covering:
     - deterministic Vitest tests for static structure and pure helpers;
     - Promptfoo behavioral evals for prompt-like semantics;
     - live LLM/trajectory evals as future gated/nightly tier;
     - how to filter the suite.
   - Remove `agent-command-behavioral-evals-promptfoo` from TASKS.md after implementation.
   - Scout a follow-up only if the provider/case mapping starts growing beyond the pilot.

## Risks and mitigations

- **Promptfoo pulls in many dependencies or is slow.**
  - Mitigation: pin it as dev dependency, measure the targeted command, and keep it outside `npm run verify` if runtime is not acceptable.
- **Local provider becomes a custom eval framework.**
  - Mitigation: keep it to artifact loading + small deterministic diagnostics; Promptfoo remains the runner, filter engine, and assertion/reporting layer.
- **YAML cases duplicate Vitest assertions.**
  - Mitigation: use Promptfoo only for behavior-level policy preservation and unsafe fixtures; keep structural lint in Vitest.
- **False confidence from no live LLM.**
  - Mitigation: document deterministic tier as a pilot; file a follow-up for gated `llm-rubric` or agent trajectory tests if needed.
- **CI/network instability.**
  - Mitigation: no remote providers, no cloud sharing, no cache writes, no secrets.

## Acceptance criteria

- `npm run eval:agent-artifacts` runs locally and reports artifact path + assertion/case names on failure.
- The suite covers at least three high-risk artifacts, including `templates/AGENTS.md`.
- A fixture with unsafe publication/force-push wording produces a diagnostic, while current covered artifacts pass.
- CI can run the deterministic subset without external secrets, or the plan documents why the first PR keeps it as a local explicit command.
- README or `docs/testing-agent-artifacts.md` explains deterministic tests vs Promptfoo evals vs explicit exemptions.
- Agent-artifact inventory reports behavioral eval coverage for the Promptfoo-covered artifacts.
- `npx vitest run <new specs>` passes.
- `npm run verify` passes before commit.

## Vision trace

- **Vision goal**: G5 — drift detection + auto-repair; this adds behavioral drift detection for agent-facing policy/config artifacts.
- **Vision goal**: G6 — full automatic parity across primary agents; command/instruction behavior must stay safe across synced surfaces.
- **User story**: US-24/US-25 sync/status surfaces and artifact coverage guardrails.
- **Competitor prior art**: Promptfoo provides the established eval runner; agentbrew should integrate it rather than build a bespoke framework.

## Reviewer verdict

- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - none
