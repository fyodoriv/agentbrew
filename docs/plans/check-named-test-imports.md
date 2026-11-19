# Catch stale named imports before tests run

## Registered experiment

Goal: catch missing JavaScript test imports during changed-file lint. Question: can the existing compiler find the exact missing export without rejecting valid imports? Metrics: missed names, false reports, and added wall time.

Hypothesis: the current lint admits one fixture with a removed named export. A small adapter over the installed TypeScript compiler rejects it. The adapter also catches a broken re-export, accepts the valid and unrelated controls, and adds at most 500 ms median in a disposable checkout.

Measurement: run `npm run lint:changed` on a throwaway test that imports a removed local export for the baseline. Run `node --test scripts/check-orphan-tests.test.mjs` and `node scripts/check-orphan-tests.mjs` for the candidate. Repeat the same changed-lint entry point. Time ten paired warm invocations under `heavy-run --exclusive` with the same changed source set.

Success: the baseline admits the one intentionally broken test and the candidate rejects it with one file and export name. The broken re-export is also rejected. Valid aliases, relative re-exports, package imports and import-like literal text are accepted. Current checkout and required hosted checks pass, with zero false reports and at most 500 ms median added time.

Pivot: any missed fixture, false report on the checkout, higher median time, or failed required gate rejects the implementation. Settle compiler scope before widening a heuristic.

Anchor: Minsky's `scripts/check-orphan-tests.mjs`, Agentbrew task `check-tests-import-only-existing-exports`, and Meszaros (2007), *xUnit Test Patterns*.

## Reuse decision

Use Agentbrew's pinned TypeScript compiler and its module resolver. The Minsky script describes the failure and synchronous workflow. Its regex parser assumes a separate `novel` tree and cannot parse re-export declarations as the compiler does. Keep package imports and TypeScript tests on their existing paths. Add no dependency or second export parser.

## Baseline

Prediction `8a532dd0` preceded the test. Biome passed both changed fixture
files. Node then refused the test because the local module did not export
`missing`. The equivalent fixture assertions moved to
`src/scripts/check-orphan-tests.test.ts` so the standard Vitest gate runs them.

## Runtime path control

The compiler can choose a type or source file with the same stem as a
JavaScript file. Register a scratch control with a `.ts` file and an
explicit `.js` import. The JavaScript file exports one different name.
Node must accept the actual JavaScript export and reject the type-file
name. The lint must agree on both inputs and name the missing export.
Two disagreements reject the default compiler resolution. Any candidate
disagreement or median added time above 500 ms rejects the adapter.
The child Git process may initialize only the scratch repository.
