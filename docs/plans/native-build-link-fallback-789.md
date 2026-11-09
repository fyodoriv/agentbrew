# Native build link fallback (#789)

Registered before implementation. This amends control C06 in `source-build-prebuilt-764.md` only for an installed Cargo process that exits while compiling or linking. Integrity, receipt, toolchain-discovery, TypeScript, and publication failures keep their existing fail-closed behavior.

## Hypothesis

A controlled Cargo link failure changes from a failed build with a stale predecessor to a fresh plain-`tsup` build using the verified prebuilt native pair. The warning names the likely unreadable-SDK cause and the `SDKROOT` override. Non-compile failures and TypeScript failures retain their current outcomes.

## Measurement

`npx vitest run src/source-build-capability.test.ts`, followed by `npm run verify:changed` and the required full gate if it does not report `merge-ready`.

## Controls

1. Installed Cargo exits 65 from its build command: prebuild verifies the fixed prebuilt pair, exits 0, and warns about `SDKROOT`; the staged CLI publishes fresh output.
2. The resulting build contains the ordinary CLI and verified prebuilt native assets, not stale source-target executables.
3. A non-Cargo integrity failure still exits non-zero without fallback.
4. A TypeScript candidate failure still preserves the usable predecessor.
5. Existing source-build and native capability controls stay green.

## Success

All controls pass, with zero integrity-failure fallbacks and zero predecessor mutations after a TypeScript failure.

## Pivot

If the build cannot distinguish a Cargo process failure from integrity failures with a small explicit boundary, retain the failure and revise the design. Do not catch every build error as a fallback.

## Independent-review hardening

Registered before the review fixes.

- Refresh the checked-in prebuilt receipt for the changed verifier. The real `verify-prebuilt` command must pass, not only a fixture with regenerated inputs.
- Predicted broad source-receipt fallbacks: one; after the fix: zero. A private, single-purpose marker written only after the admitted Cargo failure and prebuilt verification explicitly selects the prebuilt route. Successful compilation clears any stale marker; `prepare` consumes it once.
- Predicted unsafe admissions for a signal exit, a spawn failure, and a post-build status-65 failure: three; after the fix: zero. Only a normal nonzero exit from the Cargo build invocation produces the reserved fallback status. Other post-build status-65 errors map to an ordinary failure.
- Update the older plan's contradictory C06 text to point to this amendment.

The same measurement and success/pivot thresholds apply. Any missing marker, broad catch, unsafe admission, or stale real receipt rejects the change.

## Anchor

Issue #789's observed MacOSX 27.0 linker failure and successful `SDKROOT` workaround; Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al. (2017), preregistration.
