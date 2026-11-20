# Detect stale CLI build copies outside a checkout

- **Hypothesis**: The existing health entry point reports both stale standalone build controls where it currently reports zero. A current copy and checkout stay clear. A snapshot warning does not trigger an in-place build.
- **Measurement**: Run `npx vitest run src/cli-build-health.test.ts` on disposable Git and build-copy fixtures. After `heavy-run npm run build`, run the task's copied-bundle status comparison once and the checkout comparison five times.
- **Success**: Two stale fixture cases report one warning each. All current and unknown-source controls stay clear. The copied bundle reports one warning and all five checkout runs report zero.
- **Pivot**: Any warning on a qualified current checkout, false source comparison, extra network request, or attempted rebuild in the standalone copy rejects the candidate. Retain the missing-record warning if only the revision comparison fails.
- **Anchor**: The `cli-build-snapshot-drift` task and Basili, Caldiera, and Rombach (1994), Goal Question Metric.

The comparison uses the saved origin tracking revision of an existing local
source checkout. It qualifies the built commit by ancestry and compares
build inputs. A regular status read performs no fetch.

The compiled control passed on macOS with the build stamp equal to the
checkout revision. It observed one stale copy warning and zero warnings in
each of five fresh checkout reads. The installed copy can come from a
local tool outside the checkout. Use its original installer to replace it.
