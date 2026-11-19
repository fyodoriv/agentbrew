# Report a missing setup as an install failure

A named catalog install on an empty configuration printed the initialization
hint, then returned success. The command continued to automatic sync, which
also lacked state. A script could report an install that never started.

- **Hypothesis**: The catalog install rejects missing state before reading
  the catalog or writing any artifact. With initialized state, the same
  named rule installs and a preview still performs no write.
- **Measurement**: Run
  `npx vitest run src/catalog/install.test.ts src/commands/cli-install.test.ts`
  on hosted CI. In a disposable home, run
  `agentbrew install conventional-commits` and its `--dry-run` form before
  and after `agentbrew init --skip-install --skip-sync`. Disable networking
  and background jobs for the disposable run.
- **Success**: Both missing-state cases (apply and preview) signal exit 1,
  with zero catalog reads or rule writes. One real initialized preview and
  one apply exit 0. The preview writes zero rule blocks and apply writes one.
- **Pivot**: Any write without state, wrong exit, or initialized regression
  rejects the fix. Keep the change scoped to the catalog install entry point.
- **Anchor**: `install` in `src/catalog/install.ts` and the disposable
  rule-install check on Nov 18, 2026. Basili, Caldiera, and Rombach (1994),
  Goal Question Metric.

## Missing shared rules follow-up

Initialization without recommended items or sync can leave shared rules
unavailable. A named catalog rule then prints the rules setup hint and
returns success without installing the rule. Preserve that hint.

- **Hypothesis**: An explicit rule apply fails when its shared rules file is
  missing. A preview remains read-only and successful once Agentbrew state
  exists. An initialized shared rules file admits an apply and a retry.
- **Measurement**: Extend the existing missing-rules fixture. Run the actual
  command with valid state and missing shared rules, then run
  `agentbrew rules init` in the same disposable home and retry.
- **Success**: One missing-rules apply exits 1 with zero rule files or
  automatic sync and keeps the setup hint. A preview exits 0 with zero writes.
  One subsequent apply and one retry exit 0 with exactly one rule block.
- **Pivot**: Any unexpected write, missing hint, false success, duplicate rule,
  or regression in a complete setup rejects the candidate.
- **Anchor**: The no-shared-rules result in `src/catalog/install-other.ts` and
  the existing `installRule` missing-file fixture.

## Disposable CLI result

The original CLI returned exit 0 in both missing-state cases and after
an attempt to install a rule without a shared rules file. The candidate
returned exit 1 in all three cases. It created no rule files and started
no automatic sync for the refusals. With initialized state, preview
returned exit 0 and wrote no rule file. After `agentbrew rules init`,
apply and retry both returned exit 0 and left exactly one rule block.
The run used a disposable configuration and denied outbound networking.
