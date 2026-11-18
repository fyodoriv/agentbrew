# Cold selected native sync baseline

Register a second physical cohort for valid selections. Keep the four
import-boundary receipts and the three invalid physical results. This
cohort records only baseline output. It does not approve a runtime
publication or activation design.

## Source and fixture

Use the source tree of the invalid-selection repair. Valid selection
behavior remains unchanged there. Build the real CLI with the repository's
pinned Node environment. Use the existing plugin-store entry point to
verify and install a local signed tag without including native emission
in fixture setup. Use a new throwaway signing key for each workflow run.
Never read or print a private key, Git configuration, or real plugin data.

Use one test plugin named `fixture-native` at version `1.0.0` and signed
tag `v1.0.0`. Its declared contents are a benign Bash hook, an inert
local Node server declaration and one scoped Markdown rule for Claude.
Fixture scripts use only a reserved synthetic repository domain.
Before any target runs, record the exact fixture file hashes and modes,
signed tag object, commit, tree, public signer fingerprint, capability
hash, qualified lock, empty marketplace, and bundle digest. Refuse any
post-capture identity change. Setup may use only scratch-local Git and
signing calls. Never run the installed hook, launcher, rule command or
agent.

## Measurements

- **Hypothesis**: The current cold hooks, MCP and rules selections all
  cross a shared native publication boundary. The fixture will report
  these outputs without running them. Full default sync is the positive
  control for all expected native receipts.
- **Measurement**: Run the built CLI once in each of four independent
  scratch homes. Select hooks, MCP or rules with the real CLI and
  compare with a no-selection invocation with recommendations disabled.
  Use a fresh network namespace and an empty credential environment.
  Bind read-only Git inspection to the fixture plugin and workspace,
  canonical fixture paths, fixed executable and exact argument lists.
  Deny unrecognized subprocesses and leave the measurement unqualified
  on any denial. No path in the real home is an input or destination.
- **Success**: Four complete baseline receipts with exact exit and
  dated revision, with expected requested facet and default outputs.
  Enumerate actual declared hooks, generated rule hook, MCP config and
  launcher, package envelope, marketplace index, settings activation,
  workspace output and redaction receipts separately. Preserve exact
  changes by path, bytes, link, mode and mtime in scratch.
- **Pivot**: An unrecognized write, denied process, missing identity,
  missing default control, unexpected execution or private data fails
  qualification. Preserve incomplete results and correct measurement
  independently. Do not promote selected publication from this cohort.
- **Anchor**: Frozen sync-selection continuation handoff and
  `src/plugins/claude-native.ts`, `src/plugins/store.ts`.

This cohort covers cold native publication. Warm owner/version decisions,
disabled or unknown settings, shared-source envelopes, generated rule
ownership, launcher pruning and required redaction still need registered
controls before any behavior change.
