# Plan: real-e2e-sandbox-cwd-agentfile-isolation

## Goal
Make real-e2e CLI helpers run fixture commands from an isolated sandbox by default so tests cannot accidentally apply the agentbrew repository `Agentfile.yaml`, while preserving the command delegation behavior that strips Cursor command frontmatter.

## Why
The legacy commands/drift real-e2e scenario currently relies on `runScenarioCli` defaulting to the repository root. That keeps `tsx` and delegated command generation working, but it also lets `sync` and `status --fix` see the repo-local `Agentfile.yaml`. Applying that Agentfile can pollute fixture state with repo MCP servers and cause MCP health follow-up writes to the real `TASKS.md`. This undermines the real-e2e suite as a safe regression gate for VISION.md G5/G6 drift repair and primary-agent parity.

## Scope (in)
- Change the real-e2e CLI/eval helper defaults so the child CLI runs from a sandbox cwd unless a scenario explicitly passes `cwd`.
- Keep the `tsx` loader and CLI entrypoint resolved from the repository root.
- Ensure command delegation still uses `ai-rules` output for Cursor so command frontmatter is stripped.
- Add regression assertions that the commands/drift scenario leaves `TASKS.md` unchanged after `sync` and `status --fix`.
- Preserve explicit project Agentfile coverage in the existing `us16-agentfile-project-config` scenario.

## Scope (out)
- Does not change production Agentfile discovery semantics for normal `agentbrew sync` runs.
- Does not remove or rewrite command delegation to `ai-rules`.
- Does not alter MCP health behavior outside the real-e2e sandbox.
- Does not change fixture-owned Agentfile scenarios that opt into `--agentfile`.

## Implementation steps

1. Reproduce the bug with a focused regression in `us05-us06-commands-and-drift`:
   - Snapshot root `TASKS.md` before the scenario runs.
   - Run the existing `sync --only commands --sequential` and `status --fix` flow.
   - Assert root `TASKS.md` content is unchanged at the end.

2. Update `src/real-e2e/scenario-fixture.ts`:
   - Add an isolated default cwd under the sandbox root.
   - Keep absolute `tsx` loader and `src/cli.ts` paths tied to `repoRoot`.
   - Preserve an explicit `cwd` override for scenarios that intentionally test project-cwd behavior.

3. Update the commands/drift scenario only where needed:
   - Use the helper defaults rather than the repo root cwd.
   - Keep the existing Cursor assertions that prove frontmatter is absent.

4. Verify project Agentfile opt-in remains covered:
   - Keep `us16-agentfile-project-config` passing with explicit `--agentfile`.
   - Add explicit `cwd` only if that scenario needs project-relative behavior beyond the `--agentfile` path.

5. Verify:
   - Run the focused commands/drift scenario red, then green.
   - Run `npm run test:real-e2e:selected -- us05-us06-commands-and-drift us16-agentfile-project-config`.
   - Run a guarded `npm run test:real-e2e` and confirm `TASKS.md` has no test-generated changes.
   - Run `npm run verify` before committing.

## Risks and mitigations

- **Risk**: Moving cwd out of the repo breaks `tsx` module resolution. **Mitigation**: Keep `--import` pointing at the absolute repo-local `tsx` loader and invoke the absolute `src/cli.ts` path.
- **Risk**: Moving cwd changes `ai-rules` command output. **Mitigation**: Preserve command-source HOME setup and keep Cursor frontmatter assertions in the commands/drift scenario.
- **Risk**: A scenario that intentionally relies on project Agentfile discovery loses coverage. **Mitigation**: Preserve explicit `cwd` overrides and `--agentfile` usage for project Agentfile scenarios.
- **Risk**: The full real-e2e suite is slow. **Mitigation**: Use selected scenarios for iteration and run the full guarded suite only once before final verification.

## Acceptance criteria
- A guarded full `npm run test:real-e2e` run leaves `TASKS.md` unchanged.
- `us05-us06-commands-and-drift` remains green with Cursor frontmatter stripped.
- Real-e2e scenarios only apply a project Agentfile when they explicitly opt into one.
- MCP health follow-up tasks are never emitted from fixture-only MCPs.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-09
- **Concerns**:
  - None
