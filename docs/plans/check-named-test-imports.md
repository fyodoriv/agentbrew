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

## Star export control

An unresolved name can also come from two different star exports.
Register one fixture with two owners of the same name. Node and the lint
must both reject the name. A companion fixture explicitly selects one
owner, and both must accept it. Retain the shell entry point and the
original performance ceiling.

## Linker replacement

The initial compiler adapter disagreed with Node in both same-name cases.
Replace it with the existing esbuild package pinned under `tsx` in the
lockfile. The linker can check imports without evaluating test bodies.
The scratch probe accepted the runtime file and explicit re-export. It
rejected the missing name, the conflicting star exports and an unused
missing import. Keep external packages external and write no bundle.
Use `heavy-run npx --offline vitest run src/scripts/check-orphan-tests.test.ts
--maxWorkers=1` for the gate fixture. Preserve all previously registered
cases and the 500 ms ceiling. Any extra file write, observed test execution,
Node disagreement, checkout false report, or required gate failure rejects
this candidate.

The linker can otherwise use a TypeScript sibling when an explicitly named
JavaScript file is absent. The file-existence check keeps that fallback
out of static relative JavaScript imports. The direct controls compared
Node with the candidate on five cases. Both accepted the exact runtime
export and the explicit star selection. Both refused a TypeScript-only
name, conflicting star exports, and an absent JavaScript file with a
TypeScript sibling. The candidate wrote no bundle.

The normal lint entry point also checks source deletions. In a scratch
repository with one deleted module and one unchanged importing test,
the first entry point exited zero before running the checker. The repair
exits one and prints the missing module. Biome still receives only files
that exist.

The first Linux gate passed the five new cases and failed two existing
lint caller controls at `src/lint-changed.test.ts:72` and `:85`. Each
expected exit zero and received one. The wrapper looked for its checker
inside the caller's scratch repository. Resolve the companion script
beside the wrapper, while scanning the caller's Git checkout.
