# Plan: recreate-storybook-screenshot-tool

## Goal

Restore a cross-agent `storybook-screenshot` workflow without reviving the deleted command paths.

## Why

The old command was removed in an earlier cleanup, but the underlying workflow is still useful for visual iteration in Storybook-heavy repos. The durable fix should live in an agentbrew-owned source surface so Claude Code, Cursor, and Windsurf receive the same command vocabulary through normal command sync.

## Scope (in)

- Add a tracked command source for `storybook-screenshot` under agentbrew.
- Add a minimal executable launcher that delegates to existing Playwright screenshot primitives where possible.
- Preserve the useful behaviors from the old workflow: port detection, `--list`, `--all`, single-story/URL capture, and optional step-script execution.
- Add tests or fixture checks for argument planning and command docs.
- Remove the completed task block and add a follow-up scout task if implementation surfaces non-blocking gaps.

## Scope (out)

- No public npm publish or registry release.
- No writes to generated user config files (`~/.claude`, `~/.cursor`, `~/.codeium`) in this PR.
- No browser-driven visual QA beyond local CLI/test verification.
- No replacement for the separate blocked JetBrains `gradle-test` task.

## Implementation steps

1. Reuse-first check: prefer Playwright's existing `page.screenshot()`/CLI behavior and implement only the Storybook-specific orchestration layer.
2. Add a user-facing package bin (`storybook-screenshot`) backed by `src/storybook-screenshot.ts` and emitted by `tsup` into `dist/storybook-screenshot.js`. The bin is the durable home because `scripts/` is not shipped in the package, while package bins work for a global `agentbrew` install and for local repo development.
3. Add focused tests for the pure helpers and any filesystem-safe planning behavior.
4. Add a source command file in `src/cli-commands/storybook-screenshot/storybook-screenshot.md` and a `cli_tools` catalog entry so `agentbrew install storybook-screenshot` deploys the command to Claude Code, Cursor, Windsurf, and other command-capable agents through existing command sync.
5. Do not add this to `Agentfile.yaml`; Agentfile `commands:` is for project-local command-source directories, while this is a catalog-sourced CLI command that should follow the existing `jenkins-cli` pattern.
6. Run targeted tests, task lint, and `npm run verify`.

## Risks and mitigations

- Playwright is not a production dependency. Mitigation: dynamically import it at runtime and print an install hint if unavailable, so agentbrew's normal install/test path stays lightweight.
- Storybook index shapes vary across versions. Mitigation: support both `index.json` stories maps and array-like legacy shapes; keep URL mode independent of Storybook metadata.
- Command sync for Cursor is delegated to `ai-rules`, so hand-editing `~/.cursor/commands` would drift. Mitigation: store one canonical command source and let existing sync/delegation handle agent-specific copies.
- Full `--all` screenshotting can be slow on large Storybooks. Mitigation: default viewport and output path are predictable; users can run single-story captures for iteration.

## Catalog entry sketch

```yaml
cli_tools:
  - name: storybook-screenshot
    description: "Slash command and binary for capturing Storybook stories with Playwright."
    category: dev-tooling
    recommended: false
    rationale: "Restores the cross-agent visual-iteration workflow without reviving the deleted command paths."
    commands:
      - storybook-screenshot
```

## Acceptance criteria

- `scripts/storybook-screenshot.mjs --help`, pure helper tests, task lint, and `npm run verify` pass.
- `src/cli-commands/storybook-screenshot/storybook-screenshot.md` exists and contains no references to the deleted command paths.
- `src/catalog.yaml` exposes a `storybook-screenshot` CLI tool with the command source.
- The completed `recreate-storybook-screenshot-tool` task is removed from `TASKS.md` in the shipping commit.
