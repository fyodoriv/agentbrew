# Verify installed versions in the build preflight

Scope: N1 and N5 from the [registered evidence](locked-install-evidence.md).
The previous baseline accepted a stale transitive version and successful
commands with absent or malformed comparison data. N2 and N3 cover the
installer's donor and target shortcuts and remain separate.

The read-only capability check on the development checkout returned 702
physical and 908 locked rows. There were no duplicate physical locations,
unlisted physical rows or mismatched versions. The 206 absent locked rows
were all marked optional. Both results represented the checked-in stub by
its source location. This shows npm can project the needed fields. It does
not qualify the proposed guard.

- **Hypothesis**: npm's physical and lock-only queries, verified against
  installed manifest versions, reject N1 and all three N5 variants.
- **Measurement**: Run the original guard and candidate on fixed scratch
  manifests. Seed N1, failed/empty/malformed comparison output, and one
  missing required record. Verify clean, omitted optional and checked-in
  link variants. All cases run in hosted CI.
- **Success**: All five negative controls refuse. All three positive
  scenarios pass. Linux and macOS gates still pass against a normal
  installation. The guard writes no dependency or lock files.
- **Pivot**: A valid install refused, partial output admitted, or any
  application of npm output outside the repository rejects the projection.
  Keep the earlier evidence and revise the adapter without weakening fixtures.
- **Anchor**: The qualified N1/N5 baseline and [npm query documentation](https://docs.npmjs.com/cli/v10/commands/npm-query/).

Compare location, package name and version. For under-lock query rows
cataloged at a local checked-in target, require the target's installed
metadata on disk as npm reports that location. Compare a present optional
dependency normally. A missing row is admissible only when the locked
record marks it optional. This checks versions and locations, without
claiming every byte in a package matches its tarball.
