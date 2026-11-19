# Report a missing setup as an install failure

A named catalog install on an empty configuration printed the initialization
hint, then returned success. The command continued to automatic sync, which
also lacked state. A script could report an install that never started.

- **Hypothesis**: The catalog install rejects missing state before reading
  the catalog or writing any artifact. With initialized state, the same
  named rule installs and a preview still performs no write.
- **Measurement**: Run the missing-state cases in
  `src/catalog/install.test.ts` and the install command tests. Run the real
  CLI with a disposable home before and after `init --skip-install --skip-sync`.
  Use a named bundled rule with networking disabled and no background job.
- **Success**: Both missing-state cases (apply and preview) signal exit 1,
  with zero catalog reads or rule writes. One real initialized preview and
  one apply exit 0. The preview writes zero rule blocks and apply writes one.
- **Pivot**: Any write without state, wrong exit, or initialized regression
  rejects the fix. Keep the change scoped to the catalog install entry point.
- **Anchor**: `install` in `src/catalog/install.ts` and the disposable
  rule-install check on Nov 18, 2026. Basili, Caldiera, and Rombach (1994),
  Goal Question Metric.
