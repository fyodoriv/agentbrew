# Plan: storybook-screenshot-live-smoke-gate

## Goal

Add a deterministic live smoke test that proves the built `storybook-screenshot` binary can fetch a Storybook index, navigate two `iframe.html?id=...` stories with Playwright, and write PNG files.

## Why

The restored tool currently has helper coverage and a `--help` check, but its highest-risk path is runtime integration: local Storybook metadata, browser startup, page navigation, and filesystem output. A smoke gate catches package/bin/dependency regressions before users rely on the command.

## Scope (in)

- Add an exact-pinned Playwright dev dependency and browser-install support needed for CI/local verification.
- Add a local fixture HTTP server inside the test that serves `index.json` and two Storybook-like `iframe.html` pages.
- Run the built `dist/storybook-screenshot.js --all --base-url <fixture> --out-dir <tmp>` from a Vitest smoke test and assert two PNG files exist with PNG signatures.
- Keep the smoke deterministic and local-only; no user project or external Storybook server required.
- Put the smoke in a separate `src/storybook-screenshot.smoke.test.ts` file so unit helper coverage remains fast and focused.
- Bind the fixture server to `127.0.0.1` on port `0` so the OS assigns a free port and parallel test runs avoid collisions.

## Scope (out)

- No visual diffing or golden screenshots.
- No public npm publish, release creation, or external PR/comment action.
- No changes to generated user agent config under `~/.claude`, `~/.cursor`, `~/.codeium`, or `.devin`.
- No broadened Storybook feature support beyond what the existing binary already exposes.

## Implementation steps

1. Add a failing Vitest smoke spec that starts a tiny `node:http` fixture server, invokes `dist/storybook-screenshot.js`, and expects two PNG outputs.
2. Add `"playwright": "1.58.2"` with `npm install --save-dev --save-exact playwright@1.58.2`; package.json and package-lock.json both pin the resolved version.
3. Add a `playwright:install` package script that runs `playwright install chromium`, and call it from `npm run verify` before the full Vitest suite so CI/fresh local clones install the browser explicitly.
4. Ensure the smoke spec runs `npm run build` before spawning `dist/storybook-screenshot.js`; keep `npm run verify` covering the smoke through the existing full Vitest suite.
5. Use fixture stories `button--primary` → `button--primary.png` and `app/components:card default` → `app-components-card-default.png` so the smoke covers both normal and sanitized filenames.
6. Update AGENTS.md's Development command list with `npm run playwright:install` and note that `npm run verify` runs it automatically for the Storybook smoke gate.
7. Update package scripts/config only if necessary for deterministic browser availability.
8. Remove the completed TASKS.md block when the smoke passes.

## Risks and mitigations

- **Browser binary missing in CI**: `npm run verify` will call `npm run playwright:install` before Vitest, so a fresh CI clone has Chromium before the smoke spec runs.
- **Smoke test runtime bloat**: keep fixture pages static and use only Chromium/headless; assert PNG signatures instead of doing image comparison.
- **Flake from `networkidle`**: fixture pages serve only local static assets and no long-running requests.
- **Built binary stale in local test runs**: the smoke spec can run `npm run build` in `beforeAll` or invoke the existing build command explicitly before spawning `dist/storybook-screenshot.js`.
- **Verification-time regression**: measure on the same local machine with `time npm run verify` before and after the smoke, and record PR CI duration from GitHub Actions logs if available; if either increases by more than 15s, move it to a documented CI smoke script.

## Acceptance criteria

- A local fixture server serves at least two stories via Storybook-compatible `index.json`.
- A Vitest smoke test runs the built `storybook-screenshot --all --base-url <fixture> --out-dir <tmp>` command.
- The test asserts both expected PNG files exist and start with the PNG magic bytes `89 50 4E 47 0D 0A 1A 0A`.
- The smoke test runs under `npm run verify` or a clearly documented CI smoke phase.
- The completed `storybook-screenshot-live-smoke-gate` task block is removed entirely from TASKS.md in the shipping commit.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-04
- **Concerns**:
  - None.
