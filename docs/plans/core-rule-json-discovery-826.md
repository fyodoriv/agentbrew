# JSON dispatch model: default test discovery

The 11-case test-only model has a focused pass and independent source review.
Goal: prove the default Agentbrew test configuration collects its file before
relying on the full gate. Predict the unmodified default Vitest configuration
lists exactly one matching file, the default verification plan invokes
`npx vitest run`, and the ordinary unfiltered gate passes. This does not
qualify real plugin state or delivery and adds no production path.

Run the following file-specific self-checking list command on the final tree,
with the default configuration and no `VERIFY_PLAN`. Accept a relative or absolute path,
but exactly one line must name the fixed file. Missing or duplicate discovery,
a different default plan, filtered execution or a failed full gate rejects
this preparation. Then run the ordinary full gate with `VERIFY_PLAN` unset,
`NO_CACHE=1`, and the standard one-worker settings. Preserve the 11 named
focused result and request independent review of the final tree. The list
shows eligibility; it does not alone prove that the full gate executed all 11
cases. Retain that focused result and the full-gate log separately.

```sh
bash <<'BASH'
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
unset VERIFY_PLAN
grep -Fxq '    include: ["src/**/*.test.ts"],' vitest.config.ts || exit 2
grep -Fxq 'test-all npx vitest run' scripts/verify.sh || exit 2
JOBS=1 heavy-run npm exec -- vitest list src/plugins/core-rule-json-model.test.ts --filesOnly >"$log" 2>&1 || exit 1
[ "$(grep -Ec '(^|/)src/plugins/core-rule-json-model\.test\.ts$' "$log")" -eq 1 ]
BASH
```

For the full gate, first require the exhausted controlled source-lease describe
to be absent from `src/sync/pull-source-caches.test.ts`; a match refuses the
run and a search error is not absence. Then use:

```sh
unset VERIFY_PLAN LOCKED_INSTALL_OBSERVATION LOCKED_INSTALL_OBSERVATION_NPM_CLI CHECKUP_RUN_OBSERVATION CHECKUP_RUN_TEST_CLI HISTORY_SCANNER_CALIBRATION
NO_CACHE=1 JOBS=1 CARGO_BUILD_JOBS=1 VITEST_MAX_WORKERS=1 LOCKFILE_SYNC_NPM=npm@10.9.2 heavy-run npm run verify
```

Anchors: the existing Vitest default test configuration and verification
plan; Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al.
(2017), preregistration. The installed Vitest v4 CLI help documents `list`
and `--filesOnly`; the [current Vitest CLI guide](https://vitest.dev/guide/cli#vitest-list)
also describes the command.
